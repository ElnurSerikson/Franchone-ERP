// Telegram-модуль — живой разговор.
//
// Бот принимает не только команды. Человек здоровается, спрашивает «что у меня
// сегодня», уточняет, благодарит. Раньше на всё, кроме «поставь задачу» и
// «назначь встречу», приходил один и тот же отказ — со стороны это выглядело
// так, будто бот сломан.
//
// Отвечает модель, но факты она не выдумывает: всё, что бот знает о человеке,
// собирается здесь запросами к ERP и передаётся в подсказке готовым. Чего в
// подсказке нет — того бот не знает и так и говорит.
//
// Права те же, что в ERP: сотрудник видит своё, владелец — сводку по команде.

import { v } from 'convex/values'
import { internalQuery, internalMutation } from './_generated/server'
import type { QueryCtx, MutationCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { computeMonth } from './payroll'
import { isStaff } from './lib'
import { submissionsFor, REPORTING } from './reports'

// Сколько реплик держим в памяти разговора. Шесть пар «вопрос — ответ»:
// хватает, чтобы понять «а перенеси на завтра», и не тащит в подсказку
// вчерашние темы.
const KEEP = 12

function today(): { date: string; month: string; yesterday: string } {
  const shifted = new Date(Date.now() + 5 * 3600 * 1000).toISOString()
  const date = shifted.slice(0, 10)
  return {
    date,
    month: shifted.slice(0, 7),
    yesterday: new Date(Date.parse(`${date}T00:00:00Z`) - 86400000).toISOString().slice(0, 10),
  }
}

const PRIORITY: Record<string, string> = {
  low: 'низкий',
  medium: 'обычный',
  high: 'высокий',
  urgent: 'срочный',
}

const TASK_STATUS: Record<string, string> = {
  assigned: 'назначена',
  in_progress: 'в работе',
  done: 'сделана',
}

async function deadlineTime(ctx: QueryCtx): Promise<string> {
  const s = await ctx.db
    .query('settings')
    .withIndex('by_key', (q) => q.eq('key', 'global'))
    .first()
  return s?.reportDeadlineTime ?? '14:00'
}

// Сводка по сотруднику: то, что живой помощник держал бы в голове, отвечая на
// вопрос «что у меня сейчас».
export const brief = internalQuery({
  args: { employeeId: v.id('employees') },
  handler: async (ctx, { employeeId }) => {
    const me = await ctx.db.get(employeeId)
    if (!me) return null
    const { date, month, yesterday } = today()

    // Свои задачи — это и порученные мне, и поставленные мной. Раньше в
    // фактах были только первые, и на «верни в работу задачу про смету» бот
    // честно отвечал, что такой не видит: смету владелец поставил другому.
    const nameOf = new Map(
      (await ctx.db.query('employees').collect()).map((e) => [e._id as string, e.name]),
    )
    const mineAll = (await ctx.db.query('tasks').collect()).filter(
      (t) => t.assigneeId === employeeId || t.reporterId === employeeId,
    )

    const tasks = mineAll
      .filter((t) => t.status !== 'done')
      // Сначала просроченные, потом ближайшие по сроку, бессрочные в конце.
      .sort((a, b) => (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999'))
      .slice(0, 15)
      .map((t) => ({
        title: t.title,
        status: TASK_STATUS[t.status] ?? t.status,
        priority: PRIORITY[t.priority] ?? t.priority,
        deadline: t.deadline ?? null,
        overdue: !!t.deadline && t.deadline < date,
        // Чья это задача: своя в работе или порученная другому. Иначе бот
        // говорит «у вас три задачи», считая чужие.
        assignee: t.assigneeId === employeeId ? null : (nameOf.get(t.assigneeId as string) ?? null),
      }))

    // Закрытые задачи тоже нужны в фактах. Без них на «верни в работу задачу
    // про смету» бот отвечал, что такой задачи не видит, — она уже была
    // выполнена и в список открытых не попадала.
    const doneRecent = mineAll
      .filter((t) => t.status === 'done')
      .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
      .slice(0, 10)
      .map((t) => ({
        title: t.title,
        onTime: t.completedOnTime !== false,
        assignee: t.assigneeId === employeeId ? null : (nameOf.get(t.assigneeId as string) ?? null),
      }))

    const meetings = (await ctx.db.query('meetings').collect())
      .filter(
        (m) =>
          m.participantIds.includes(employeeId) &&
          m.date >= date &&
          (m.status ?? 'planned') === 'planned',
      )
      .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`))
      .slice(0, 10)
      .map((m) => ({
        title: m.title,
        date: m.date,
        time: m.time,
        place: m.place ?? null,
        moved: (m.rescheduleCount ?? 0) > 0,
      }))

    // Отчёт за вчера сдаётся до срока сегодня — именно он сейчас актуален.
    let report: { date: string; due: string; submitted: boolean } | null = null
    if (REPORTING.has(me.position) && me.role !== 'owner' && yesterday >= me.hiredAt) {
      const due = await deadlineTime(ctx)
      const rows = await submissionsFor(ctx, me, due)
      report = {
        date: yesterday,
        due,
        submitted: rows.some((r) => r.date === yesterday && !r.reopened),
      }
    }

    const mine = (await computeMonth(ctx, month)).find((r) => r.employeeId === employeeId)

    // Про коллег бот рассказывает ровно столько, сколько человеку положено
    // видеть в самой ERP. Разграничение делается здесь, а не инструкцией
    // модели: чего нет в фактах, то и не выскочит в ответе по ошибке.
    //
    // Сотруднику — имена, должности и загрузка: без этого не понять, кому
    // ставить задачу и кого сейчас лучше не грузить. Чужие KPI, отчёты и
    // просрочки — только владельцу.
    const isOwner = me.role === 'owner'
    const staff = (await ctx.db.query('employees').collect()).filter(
      (e) => e.status === 'active' && !e.hidden && isStaff(e) && e._id !== employeeId,
    )
    const payroll = isOwner ? await computeMonth(ctx, month) : []
    const due = await deadlineTime(ctx)

    const team: {
      name: string
      position: string
      department: string
      openTasks: number
      overdueTasks: number
      kpi: number | null
      reportMissing: boolean | null
    }[] = []
    for (const e of staff) {
      const own = (
        await ctx.db
          .query('tasks')
          .withIndex('by_assignee', (q) => q.eq('assigneeId', e._id))
          .collect()
      ).filter((t) => t.status !== 'done')
      let missing: boolean | null = null
      if (isOwner && REPORTING.has(e.position) && yesterday >= e.hiredAt) {
        const rows = await submissionsFor(ctx, e, due)
        missing = !rows.some((r) => r.date === yesterday && !r.reopened)
      }
      team.push({
        name: e.name,
        position: e.positionLabel,
        department: e.department,
        openTasks: own.length,
        overdueTasks: isOwner ? own.filter((t) => !!t.deadline && t.deadline < date).length : 0,
        kpi: isOwner ? (payroll.find((r) => r.employeeId === e._id)?.kpi ?? null) : null,
        reportMissing: missing,
      })
    }

    return {
      name: me.name,
      position: me.positionLabel,
      department: me.department,
      isOwner,
      tasks,
      doneRecent,
      meetings,
      report,
      kpi: mine?.kpi ?? null,
      month,
      team,
    }
  },
})

// ——— Сводка дня ———
//
// Её собирает код, а не модель. Приветствие и утренняя рассылка приходят
// каждый день, и вёрстка в них должна быть одна и та же — модель же каждый
// раз пересказывает по-своему. Разговорные ответы остаются за моделью.
export const digest = internalQuery({
  args: { employeeId: v.id('employees') },
  handler: async (ctx, { employeeId }) => await digestFor(ctx, employeeId),
})

// Тот же расчёт, но вызываемый напрямую: утренняя рассылка идёт из мутации
// крона, а мутация не может обратиться к запросу.
export async function digestFor(
  ctx: QueryCtx | MutationCtx,
  employeeId: Id<'employees'>,
): Promise<{ name: string; first: string; isOwner: boolean; lines: string[]; quiet: boolean } | null> {
  {
    const me = await ctx.db.get(employeeId)
    if (!me) return null
    const { date, month, yesterday } = today()
    const isOwner = me.role === 'owner'
    const lines: string[] = []

    const tasks = (
      await ctx.db
        .query('tasks')
        .withIndex('by_assignee', (q) => q.eq('assigneeId', employeeId))
        .collect()
    ).filter((t) => t.status !== 'done')
    const overdue = tasks.filter((t) => !!t.deadline && t.deadline < date)
    const dueToday = tasks.filter((t) => t.deadline === date)

    if (overdue.length) {
      lines.push(`⚠️ Просрочено: ${overdue.length} ${plural(overdue.length, 'задача', 'задачи', 'задач')}`)
    }
    if (dueToday.length) {
      lines.push(`📌 Срок сегодня: ${dueToday.length} ${plural(dueToday.length, 'задача', 'задачи', 'задач')}`)
    }
    if (!overdue.length && !dueToday.length && tasks.length) {
      lines.push(`📌 В работе ${tasks.length} ${plural(tasks.length, 'задача', 'задачи', 'задач')}, сроки не горят`)
    }

    const meetings = (await ctx.db.query('meetings').collect())
      .filter(
        (m) =>
          m.participantIds.includes(employeeId) &&
          m.date === date &&
          (m.status ?? 'planned') === 'planned',
      )
      .sort((a, b) => a.time.localeCompare(b.time))
    for (const m of meetings) {
      lines.push(`📅 ${m.time} · ${m.title}${m.place ? ` · ${m.place}` : ''}`)
    }

    // Свой отчёт — только у тех, кто его сдаёт.
    if (REPORTING.has(me.position) && !isOwner && yesterday >= me.hiredAt) {
      const dueAt = await deadlineTime(ctx)
      const rows = await submissionsFor(ctx, me, dueAt)
      if (!rows.some((r) => r.date === yesterday && !r.reopened)) {
        lines.push(`📝 Отчёт за ${humanDate(yesterday)} не сдан · срок сегодня до ${dueAt}`)
      }
    }

    // Владельцу — состояние команды вместо собственных отчётов: он смотрит в
    // бота, чтобы понять, где горит, а не что сдавать самому.
    if (isOwner) {
      const dueAt = await deadlineTime(ctx)
      const staff = (await ctx.db.query('employees').collect()).filter(
        (e) => e.status === 'active' && !e.hidden && isStaff(e) && e._id !== employeeId,
      )
      const late: string[] = []
      let teamOverdue = 0
      for (const e of staff) {
        if (REPORTING.has(e.position) && yesterday >= e.hiredAt) {
          const rows = await submissionsFor(ctx, e, dueAt)
          if (!rows.some((r) => r.date === yesterday && !r.reopened)) late.push(firstWord(e.name))
        }
        const own = (
          await ctx.db
            .query('tasks')
            .withIndex('by_assignee', (q) => q.eq('assigneeId', e._id))
            .collect()
        ).filter((t) => t.status !== 'done' && !!t.deadline && t.deadline < date)
        teamOverdue += own.length
      }
      if (late.length) lines.push(`📝 Не сдали отчёт: ${late.join(', ')}`)
      if (teamOverdue) {
        lines.push(
          `⚠️ У команды просрочено ${teamOverdue} ${plural(teamOverdue, 'задача', 'задачи', 'задач')}`,
        )
      }
    }

    const kpi = (await computeMonth(ctx, month)).find((r) => r.employeeId === employeeId)
    if (kpi && Number.isFinite(kpi.kpi)) {
      lines.push(`📊 KPI за месяц · ${Math.round(kpi.kpi * 100)}%`)
    }

    return {
      name: me.name,
      first: firstWord(me.name),
      isOwner,
      lines,
      quiet: lines.length === 0,
    }
  }
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 14) return many
  const mod10 = n % 10
  if (mod10 === 1) return one
  if (mod10 >= 2 && mod10 <= 4) return few
  return many
}

const MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
]

export function humanDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  return `${d} ${MONTHS[m - 1] ?? ''}`.trim()
}

function firstWord(full: string): string {
  return full.trim().split(/\s+/)[0] || full
}

export const recent = internalQuery({
  args: { chatId: v.number() },
  handler: async (ctx, { chatId }) => {
    const rows = await ctx.db
      .query('telegramMessages')
      .withIndex('by_chat', (q) => q.eq('chatId', chatId))
      .order('desc')
      .take(KEEP)
    return rows.reverse().map((r) => ({ role: r.role, text: r.text }))
  },
})

export const remember = internalMutation({
  args: {
    chatId: v.number(),
    employeeId: v.id('employees'),
    role: v.union(v.literal('user'), v.literal('bot')),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert('telegramMessages', { ...args, at: Date.now() })
    // Держим окно постоянным: лишнее сразу выкидываем, а не копим до крона.
    const all = await ctx.db
      .query('telegramMessages')
      .withIndex('by_chat', (q) => q.eq('chatId', args.chatId))
      .order('desc')
      .collect()
    for (const old of all.slice(KEEP)) await ctx.db.delete(old._id)
  },
})

// Разговор обрывается вместе с доступом: отключили сотрудника — история уходит.
export async function forgetChat(ctx: MutationCtx, chatId: number): Promise<void> {
  const rows: Doc<'telegramMessages'>[] = await ctx.db
    .query('telegramMessages')
    .withIndex('by_chat', (q) => q.eq('chatId', chatId))
    .collect()
  for (const r of rows) await ctx.db.delete(r._id)
}
