import { query, mutation } from './_generated/server'
import { v, ConvexError } from 'convex/values'
import { currentEmployee, isManager, hiddenEmployeeIds } from './lib'
import { requireCan, inScope } from './permissions'

// Текущий месяц в часовом поясе Алматы (YYYY-MM).
function businessMonth(): string {
  return new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 7)
}

// Сводка по отделу продаж за месяц — агрегируем ежедневные отчёты
// с продажным блоком (§3.3). KPI персональный: если задан employeeId —
// считаем только его выручку. Пусто, пока нет отчётов.
export const summary = query({
  args: { month: v.optional(v.string()), employeeId: v.optional(v.id('employees')) },
  handler: async (ctx, { month: arg, employeeId }) => {
    const month = arg ?? businessMonth()
    // Выручка — руководству и самому отделу продаж, не всем подряд.
    const me = await currentEmployee(ctx)
    if (!isManager(me) && me?.position !== 'sales') {
      return { leads: 0, meetings: 0, deals: 0, revenue: 0, days: 0, planRevenue: 0 }
    }
    const hidden = await hiddenEmployeeIds(ctx)
    let leads = 0, meetings = 0, deals = 0, revenue = 0, days = 0
    for (const r of await ctx.db.query('dailyReports').collect()) {
      if (!r.sales || r.date.slice(0, 7) !== month) continue
      if (hidden.has(r.employeeId)) continue // тестовый/скрытый не в KPI
      if (employeeId && r.employeeId !== employeeId) continue // только его факт
      leads += r.sales.leads
      meetings += r.sales.meetings
      deals += r.sales.sales
      revenue += r.sales.revenue
      days++
    }
    // План — персональный за месяц (если сотрудник задан).
    let planRevenue = 0
    if (employeeId) {
      const plan = (
        await ctx.db
          .query('salesPlans')
          .withIndex('by_employee', (q) => q.eq('employeeId', employeeId))
          .collect()
      ).find((p) => p.month === month)
      planRevenue = plan?.planRevenue ?? 0
    }
    return { leads, meetings, deals, revenue, days, planRevenue }
  },
})

// Установить персональный план выручки на месяц (руководство).
export const setPlan = mutation({
  args: { employeeId: v.id('employees'), month: v.string(), planRevenue: v.number() },
  handler: async (ctx, { employeeId, month, planRevenue }) => {
    const me = await requireCan(ctx, 'kpi', 'edit')
    const emp = await ctx.db.get(employeeId)
    if (emp && !inScope(me, emp)) throw new ConvexError('Можно менять планы только в вашем доступе')
    const row = (
      await ctx.db
        .query('salesPlans')
        .withIndex('by_employee', (q) => q.eq('employeeId', employeeId))
        .collect()
    ).find((p) => p.month === month)
    if (row) await ctx.db.patch(row._id, { planRevenue })
    else await ctx.db.insert('salesPlans', { employeeId, month, planRevenue })
  },
})
