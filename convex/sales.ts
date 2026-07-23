import { query } from './_generated/server'
import { v } from 'convex/values'

// Текущий месяц в часовом поясе Алматы (YYYY-MM).
function businessMonth(): string {
  return new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 7)
}

// Сводка по отделу продаж за месяц — агрегируем ежедневные отчёты
// с продажным блоком (§3.3). Пусто, пока нет отчётов.
export const summary = query({
  args: { month: v.optional(v.string()) },
  handler: async (ctx, { month: arg }) => {
    const month = arg ?? businessMonth()
    const reports = await ctx.db.query('dailyReports').collect()
    let leads = 0
    let meetings = 0
    let deals = 0
    let revenue = 0
    let days = 0
    for (const r of reports) {
      if (r.sales && r.date.slice(0, 7) === month) {
        leads += r.sales.leads
        meetings += r.sales.meetings
        deals += r.sales.sales
        revenue += r.sales.revenue
        days++
      }
    }
    return { leads, meetings, deals, revenue, days }
  },
})
