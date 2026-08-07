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
import type { Doc } from './_generated/dataModel'
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

    const tasks = (
      await ctx.db
        .query('tasks')
        .withIndex('by_assignee', (q) => q.eq('assigneeId', employeeId))
        .collect()
    )
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

    // Владельцу — короткая сводка по команде: у него в ERP полный доступ,
    // и держать её отдельно от разговора незачем.
    let team: {
      name: string
      position: string
      openTasks: number
      overdueTasks: number
      kpi: number | null
      reportMissing: boolean
    }[] = []
    if (me.role === 'owner') {
      const staff = (await ctx.db.query('employees').collect()).filter(
        (e) => e.status === 'active' && !e.hidden && isStaff(e) && e._id !== employeeId,
      )
      const payroll = await computeMonth(ctx, month)
      const due = await deadlineTime(ctx)
      for (const e of staff) {
        const own = (
          await ctx.db
            .query('tasks')
            .withIndex('by_assignee', (q) => q.eq('assigneeId', e._id))
            .collect()
        ).filter((t) => t.status !== 'done')
        let missing = false
        if (REPORTING.has(e.position) && yesterday >= e.hiredAt) {
          const rows = await submissionsFor(ctx, e, due)
          missing = !rows.some((r) => r.date === yesterday && !r.reopened)
        }
        team.push({
          name: e.name,
          position: e.positionLabel,
          openTasks: own.length,
          overdueTasks: own.filter((t) => !!t.deadline && t.deadline < date).length,
          kpi: payroll.find((r) => r.employeeId === e._id)?.kpi ?? null,
          reportMissing: missing,
        })
      }
    }

    return {
      name: me.name,
      position: me.positionLabel,
      department: me.department,
      isOwner: me.role === 'owner',
      tasks,
      meetings,
      report,
      kpi: mine?.kpi ?? null,
      month,
      team,
    }
  },
})

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
