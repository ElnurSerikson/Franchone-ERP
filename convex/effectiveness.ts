// Раздел «Эффективность» (ТЗ СИСТЕМА §3).
//
// Принцип раздела: он НЕ создаёт параллельную систему оценки и не требует
// повторного ввода данных. Ничего здесь не заполняется вручную — всё
// агрегируется из уже существующих задач и ежедневных отчётов и показывается
// в разрезе сотрудников и времени.
//
// Новые статусы задач и отчётов не вводятся (§3.3, §3.4, §2.6): расчёт
// опирается только на действующие поля.

import { query } from './_generated/server'
import { v } from 'convex/values'
import type { QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { currentEmployee, isManager, hiddenEmployeeIds } from './lib'
import { deadlineMs, submissionsFor, REPORTING } from './reports'

function businessToday(): string {
  return new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 10)
}

function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}

function addDays(date: string, delta: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + delta * 86400000).toISOString().slice(0, 10)
}

// Список календарных дат периода включительно. Ограничен годом — за больший
// срок посуточная развёртка не нужна, а память экономит.
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = []
  let cur = from
  while (cur <= to && out.length < 400) {
    out.push(cur)
    cur = addDays(cur, 1)
  }
  return out
}

function monthsBetween(from: string, to: string): string[] {
  const out: string[] = []
  let cur = from.slice(0, 7)
  const last = to.slice(0, 7)
  while (cur <= last && out.length < 120) {
    out.push(cur)
    const [y, m] = cur.split('-').map(Number)
    cur = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
  }
  return out
}

type ReportStats = {
  required: number
  onTime: number
  lateByAdmin: number
  missing: number
  onTimeRate: number | null
}

type TaskStats = {
  total: number
  done: number
  notDone: number
  doneOnTime: number
  doneLate: number
  overdue: number
  completionRate: number | null
}

// §3.3: показатели по отчётам за период. Считаются по действующей логике
// отчётов — своих статусов раздел не заводит.
// Экспортируется для dev-проверки: сверять надо боевой расчёт, не копию.
export async function reportStats(
  ctx: QueryCtx,
  e: Doc<'employees'>,
  dates: string[],
  nowMs: number,
  time: string,
): Promise<ReportStats> {
  // Должность без ежедневной отчётности — обязательных отчётов нет.
  if (e.role === 'owner' || !REPORTING.has(e.position)) {
    return { required: 0, onTime: 0, lateByAdmin: 0, missing: 0, onTimeRate: null }
  }
  const byDate = new Map((await submissionsFor(ctx, e, time)).map((r) => [r.date, r]))

  let required = 0
  let onTime = 0
  let lateByAdmin = 0
  let missing = 0
  for (const d of dates) {
    // До найма отчёта не могло быть в принципе — такие дни в знаменатель не
    // идут, иначе новичок стартует со 100% нарушений.
    if (d < e.hiredAt) continue
    // День, дедлайн которого ещё не наступил, обязательным пока не считается.
    if (nowMs <= deadlineMs(d, time)) continue
    required++
    const r = byDate.get(d)
    if (!r || r.reopened) {
      missing++
      continue
    }
    // §3.3: «сдан в срок» и «внесён администратором после блокировки». Отчёт,
    // попавший в систему после дедлайна, — это и есть вторая категория.
    if (r.onTime) onTime++
    else lateByAdmin++
  }
  return {
    required,
    onTime,
    lateByAdmin,
    missing,
    onTimeRate: required > 0 ? onTime / required : null,
  }
}

// §3.4: показатели по задачам. Опираются на существующие поля status,
// deadline, completedAt и completedOnTime.
export function taskStats(tasks: Doc<'tasks'>[], from: string, to: string, today: string): TaskStats {
  // §1.5: задача, созданная в одном месяце со сроком в другом, не теряется —
  // она попадает в период, если в него входит хотя бы одна из её дат.
  const inPeriod = tasks.filter((t) => {
    const created = new Date(t._creationTime + 5 * 3600 * 1000).toISOString().slice(0, 10)
    const done = t.completedAt
      ? new Date(t.completedAt + 5 * 3600 * 1000).toISOString().slice(0, 10)
      : null
    const dates = [created, t.deadline ?? null, done].filter((d): d is string => !!d)
    return dates.some((d) => d >= from && d <= to)
  })

  const done = inPeriod.filter((t) => t.status === 'done')
  const doneOnTime = done.filter((t) => t.completedOnTime !== false).length
  const overdue = inPeriod.filter(
    (t) => t.status !== 'done' && !!t.deadline && t.deadline < today,
  ).length

  return {
    total: inPeriod.length,
    done: done.length,
    notDone: inPeriod.length - done.length,
    doneOnTime,
    doneLate: done.length - doneOnTime,
    overdue,
    completionRate: inPeriod.length > 0 ? done.length / inPeriod.length : null,
  }
}

// §3.1: раздел для управленческого контроля администратора.
export const summary = query({
  args: {
    // §3.2: конкретный месяц, несколько месяцев или произвольный диапазон —
    // всё сводится к паре дат. Без аргументов берётся текущий месяц (§3.1).
    from: v.optional(v.string()),
    to: v.optional(v.string()),
    employeeId: v.optional(v.id('employees')),
    department: v.optional(v.string()),
    position: v.optional(v.string()),
  },
  handler: async (ctx, { from: fromArg, to: toArg, employeeId, department, position }) => {
    const me = await currentEmployee(ctx)
    const today = businessToday()
    const month = today.slice(0, 7)
    const a = fromArg ?? `${month}-01`
    const b = toArg ?? monthEnd(month)
    const from = a <= b ? a : b
    const to = a <= b ? b : a

    const empty = {
      period: { from, to },
      rows: [] as unknown[],
      totals: null as ReportStats | null,
      departments: [] as string[],
      positions: [] as { slug: string; label: string }[],
      employees: [] as { _id: Id<'employees'>; name: string }[],
    }
    if (!me || !isManager(me)) return empty

    const hidden = await hiddenEmployeeIds(ctx)
    const all = (await ctx.db.query('employees').collect()).filter(
      (e) =>
        e.status === 'active' &&
        e.role !== 'owner' &&
        (me.role === 'owner' || !hidden.has(e._id)) &&
        // Руководитель отдела видит только свой отдел.
        (me.role === 'owner' || e.department === me.department),
    )

    const picked = all.filter(
      (e) =>
        (!employeeId || e._id === employeeId) &&
        (!department || e.department === department) &&
        (!position || e.position === position),
    )

    const dates = datesBetween(from, to)
    const nowMs = Date.now()
    const s = await ctx.db
      .query('settings')
      .withIndex('by_key', (q) => q.eq('key', 'global'))
      .first()
    const time = s?.reportDeadlineTime ?? '14:00'

    const tasks = await ctx.db.query('tasks').collect()
    const tasksByAssignee = new Map<string, Doc<'tasks'>[]>()
    for (const t of tasks) {
      const arr = tasksByAssignee.get(t.assigneeId as string) ?? []
      arr.push(t)
      tasksByAssignee.set(t.assigneeId as string, arr)
    }

    const rows = []
    for (const e of picked) {
      rows.push({
        employeeId: e._id,
        name: e.name,
        initials: e.initials,
        avatarColor: e.avatarColor,
        positionLabel: e.positionLabel,
        department: e.department,
        reports: await reportStats(ctx, e, dates, nowMs, time),
        tasks: taskStats(tasksByAssignee.get(e._id as string) ?? [], from, to, today),
      })
    }
    rows.sort((x, y) => x.name.localeCompare(y.name, 'ru'))

    const positions = await ctx.db.query('positions').collect()

    return {
      period: { from, to },
      rows,
      totals: rows.reduce<ReportStats>(
        (acc, r) => ({
          required: acc.required + r.reports.required,
          onTime: acc.onTime + r.reports.onTime,
          lateByAdmin: acc.lateByAdmin + r.reports.lateByAdmin,
          missing: acc.missing + r.reports.missing,
          onTimeRate: null,
        }),
        { required: 0, onTime: 0, lateByAdmin: 0, missing: 0, onTimeRate: null },
      ),
      departments: [...new Set(all.map((e) => e.department))].sort((x, y) =>
        x.localeCompare(y, 'ru'),
      ),
      positions: positions
        .filter((p) => all.some((e) => e.position === p.slug))
        .map((p) => ({ slug: p.slug, label: p.label })),
      employees: all
        .map((e) => ({ _id: e._id, name: e.name }))
        .sort((x, y) => x.name.localeCompare(y.name, 'ru')),
    }
  },
})

// §3.5: карточка сотрудника — та же статистика, но помесячно, за всё время
// его работы в системе.
export const employeeHistory = query({
  args: { employeeId: v.id('employees'), from: v.optional(v.string()), to: v.optional(v.string()) },
  handler: async (ctx, { employeeId, from: fromArg, to: toArg }) => {
    const me = await currentEmployee(ctx)
    if (!me || !isManager(me)) return null
    const e = await ctx.db.get(employeeId)
    if (!e) return null
    if (me.role !== 'owner' && e.department !== me.department) return null

    const today = businessToday()
    // По умолчанию — вся история сотрудника: от даты найма до сегодня (§3.5).
    const from = fromArg ?? e.hiredAt
    const to = toArg ?? today

    const s = await ctx.db
      .query('settings')
      .withIndex('by_key', (q) => q.eq('key', 'global'))
      .first()
    const time = s?.reportDeadlineTime ?? '14:00'
    const nowMs = Date.now()

    const tasks = (await ctx.db.query('tasks').collect()).filter((t) => t.assigneeId === employeeId)

    const months = []
    for (const m of monthsBetween(from, to)) {
      const mFrom = `${m}-01` > from ? `${m}-01` : from
      const mTo = monthEnd(m) < to ? monthEnd(m) : to
      months.push({
        month: m,
        reports: await reportStats(ctx, e, datesBetween(mFrom, mTo), nowMs, time),
        tasks: taskStats(tasks, mFrom, mTo, today),
      })
    }

    return {
      employeeId,
      name: e.name,
      initials: e.initials,
      avatarColor: e.avatarColor,
      positionLabel: e.positionLabel,
      department: e.department,
      hiredAt: e.hiredAt,
      months: months.reverse(),
    }
  },
})
