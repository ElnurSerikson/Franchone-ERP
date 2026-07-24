import { query } from './_generated/server'
import { currentEmployee } from './lib'

// Сводка входов по активным сотрудникам (для контроля активности §10).
// Это надзорные данные — отдаём только руководству. Роутер прячет экран,
// но сам запрос доступен любому авторизованному, поэтому проверяем здесь.
export const overview = query({
  args: {},
  handler: async (ctx) => {
    const me = await currentEmployee(ctx)
    if (me?.role !== 'owner' && me?.role !== 'head') return []

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
        const times = events.map((ev) => ev.at).sort((a, b) => b - a)
        const last = Math.max(e.lastLoginAt ?? 0, times[0] ?? 0) || null
        return {
          employeeId: e._id,
          loginTotal: times.length,
          loginCount30d: times.filter((t) => now - t <= 30 * D).length,
          loginCount7d: times.filter((t) => now - t <= 7 * D).length,
          lastLoginAt: last,
          recent: times.slice(0, 10),
        }
      }),
    )
  },
})
