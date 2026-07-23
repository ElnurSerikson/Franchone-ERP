import { query, mutation } from './_generated/server'
import { v } from 'convex/values'
import type { QueryCtx, MutationCtx } from './_generated/server'
import { currentEmployee, requireEmployee } from './lib'

// Бизнес-часовой пояс компании — Asia/Almaty (UTC+5, без перехода на летнее время).
const TZ = '+05:00'
const DEFAULT_DEADLINE = '20:00'
const REPORTING = new Set(['smm', 'targetolog', 'sales'])

// Сегодняшняя календарная дата в часовом поясе Алматы.
function businessToday(): string {
  return new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 10)
}

// Сдвиг календарной даты на целое число дней (без дрейфа по TZ).
function addDays(date: string, delta: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + delta * 86400000)
    .toISOString()
    .slice(0, 10)
}

// Момент дедлайна для даты в часовом поясе Алматы (ms).
function deadlineMs(date: string, time: string): number {
  return Date.parse(`${date}T${time}:00${TZ}`)
}

async function deadlineTime(ctx: QueryCtx | MutationCtx): Promise<string> {
  const s = await ctx.db
    .query('settings')
    .withIndex('by_key', (q) => q.eq('key', 'global'))
    .first()
  return s?.reportDeadlineTime ?? DEFAULT_DEADLINE
}

// ——— Payload-валидаторы (общие для мутации) ———
const smmRows = v.array(
  v.object({ page: v.string(), type: v.string(), count: v.number() }),
)
const targetologRows = v.array(
  v.object({
    code: v.string(), // ID кампании из реестра
    budget: v.number(),
    leads: v.number(),
  }),
)
const salesPayload = v.object({
  leads: v.number(),
  meetings: v.number(),
  sales: v.number(),
  revenue: v.number(),
  note: v.optional(v.string()),
})

// Мой отчёт за сегодня + короткая история (для страницы «Отчёты» сотрудника).
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const me = await currentEmployee(ctx)
    if (!me) return null
    const time = await deadlineTime(ctx)
    const today = businessToday()

    const all = await ctx.db
      .query('dailyReports')
      .withIndex('by_employee', (q) => q.eq('employeeId', me._id))
      .collect()
    all.sort((a, b) => (a.date < b.date ? 1 : -1)) // по дате, свежие сверху

    return {
      today,
      deadlineTime: time,
      position: me.position,
      report: all.find((r) => r.date === today) ?? null,
      history: all.slice(0, 21),
    }
  },
})

// Отправка / правка отчёта за дату (по умолчанию — за сегодня).
export const submit = mutation({
  args: {
    date: v.optional(v.string()),
    smm: v.optional(smmRows),
    targetolog: v.optional(targetologRows),
    sales: v.optional(salesPayload),
  },
  handler: async (ctx, args) => {
    const me = await requireEmployee(ctx)
    if (me.role === 'owner' || !REPORTING.has(me.position)) {
      throw new Error('Для вашей роли ежедневный отчёт не предусмотрен')
    }
    const position = me.position as 'smm' | 'targetolog' | 'sales'
    const date = args.date ?? businessToday()
    const now = Date.now()
    const payload = { smm: args.smm, targetolog: args.targetolog, sales: args.sales }

    const existing = await ctx.db
      .query('dailyReports')
      .withIndex('by_employee_date', (q) =>
        q.eq('employeeId', me._id).eq('date', date),
      )
      .first()

    if (existing) {
      await ctx.db.patch(existing._id, {
        ...payload,
        editedAt: now,
        editedById: me._id,
        editCount: existing.editCount + 1,
        history: [...existing.history, { at: now, byId: me._id, action: 'edited' as const }],
      })
      return existing._id
    }

    const time = await deadlineTime(ctx)
    const onTime = now <= deadlineMs(date, time)
    return await ctx.db.insert('dailyReports', {
      employeeId: me._id,
      position,
      date,
      submittedAt: now,
      onTime,
      editCount: 0,
      history: [{ at: now, byId: me._id, action: 'submitted' as const }],
      ...payload,
    })
  },
})

// Сетка дисциплины отчётности для руководителя: сотрудники × последние N дней.
export const discipline = query({
  args: { days: v.optional(v.number()) },
  handler: async (ctx, { days }) => {
    const N = days ?? 14
    const time = await deadlineTime(ctx)
    const today = businessToday()
    const now = Date.now()
    const deadlinePassedToday = now > deadlineMs(today, time)

    const dates: string[] = []
    for (let i = N - 1; i >= 0; i--) dates.push(addDays(today, -i))

    const emps = (
      await ctx.db
        .query('employees')
        .withIndex('by_status', (q) => q.eq('status', 'active'))
        .collect()
    ).filter((e) => !e.hidden && e.role !== 'owner' && REPORTING.has(e.position))

    const rows = []
    for (const e of emps) {
      const reps = await ctx.db
        .query('dailyReports')
        .withIndex('by_employee', (q) => q.eq('employeeId', e._id))
        .collect()
      const byDate = new Map(reps.map((r) => [r.date, r]))

      let onTime = 0
      let late = 0
      let missed = 0
      const cells = dates.map((d) => {
        const r = byDate.get(d)
        if (r) {
          if (r.onTime) onTime++
          else late++
          return {
            date: d,
            status: r.onTime ? ('onTime' as const) : ('late' as const),
            submittedAt: r.submittedAt,
            edited: (r.editCount ?? 0) > 0,
          }
        }
        if (d < today || (d === today && deadlinePassedToday)) {
          missed++
          return { date: d, status: 'missed' as const }
        }
        return { date: d, status: 'pending' as const }
      })

      const required = onTime + late + missed
      rows.push({
        employeeId: e._id,
        name: e.name,
        initials: e.initials,
        avatarColor: e.avatarColor,
        positionLabel: e.positionLabel,
        position: e.position,
        cells,
        onTime,
        late,
        missed,
        fillRate: required ? (onTime + late) / required : 0,
      })
    }

    return { today, deadlineTime: time, dates, rows }
  },
})

// Конкретный отчёт (для модалки руководителя при клике по ячейке).
export const reportFor = query({
  args: { employeeId: v.id('employees'), date: v.string() },
  handler: async (ctx, { employeeId, date }) => {
    return await ctx.db
      .query('dailyReports')
      .withIndex('by_employee_date', (q) =>
        q.eq('employeeId', employeeId).eq('date', date),
      )
      .first()
  },
})
