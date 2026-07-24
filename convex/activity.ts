import { query } from './_generated/server'
import { v } from 'convex/values'
import { currentEmployee, isManager } from './lib'
import { LOGIN_WINDOW_MS } from './auth'

// Схлопывает всплески: события внутри окна визита — это один вход.
// Нужно и для уже накопленных дублей, которые записались до правки в auth.
function visits(times: number[]): number[] {
  const desc = [...times].sort((a, b) => b - a)
  const out: number[] = []
  for (const t of desc) {
    if (out.length === 0 || out[out.length - 1] - t > LOGIN_WINDOW_MS) out.push(t)
  }
  return out
}

// История входов одного сотрудника (§10 ТЗ). Надзорные данные — только
// руководству; сотруднику доступна собственная история.
export const loginHistory = query({
  args: { employeeId: v.id('employees'), limit: v.optional(v.number()) },
  handler: async (ctx, { employeeId, limit }) => {
    const me = await currentEmployee(ctx)
    if (!me) return []
    if (!isManager(me) && me._id !== employeeId) return []
    const events = await ctx.db
      .query('loginEvents')
      .withIndex('by_employee', (q) => q.eq('employeeId', employeeId))
      .collect()
    return visits(events.map((e) => e.at)).slice(0, limit ?? 50)
  },
})

// Сводка входов по активным сотрудникам (для контроля активности §10).
// Это надзорные данные — отдаём только руководству. Роутер прячет экран,
// но сам запрос доступен любому авторизованному, поэтому проверяем здесь.
export const overview = query({
  args: {},
  handler: async (ctx) => {
    const me = await currentEmployee(ctx)
    if (!isManager(me)) return []

    const emps = await ctx.db.query('employees').collect()
    const now = Date.now()
    const D = 24 * 60 * 60 * 1000
    const active = emps.filter((e) => e.status === 'active' && !e.hidden)

    return Promise.all(
      active.map(async (e) => {
        const events = await ctx.db
          .query('loginEvents')
          .withIndex('by_employee', (q) => q.eq('employeeId', e._id))
          .collect()
        const times = visits(events.map((ev) => ev.at))
        const last = Math.max(e.lastLoginAt ?? 0, times[0] ?? 0) || null
        return {
          employeeId: e._id,
          loginTotal: times.length,
          loginCount30d: times.filter((t) => now - t <= 30 * D).length,
          loginCount7d: times.filter((t) => now - t <= 7 * D).length,
          lastLoginAt: last,
        }
      }),
    )
  },
})
