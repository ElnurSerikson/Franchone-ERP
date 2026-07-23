import { query, mutation } from './_generated/server'
import { v } from 'convex/values'

// Номер недели внутри месяца — как в KPI_SMM.xlsx: MIN(5; ROUNDUP(день/7)).
// Возвращает 0-based индекс для weekPlans/weekFacts.
function weekIndex(date: string): number {
  const day = Number(date.slice(8, 10))
  return Math.min(5, Math.ceil(day / 7)) - 1
}

export const list = query({
  args: { month: v.optional(v.string()) },
  handler: async (ctx, { month }) => {
    const rows = await ctx.db.query('smmMetrics').collect()
    const metrics = month ? rows.filter((r) => r.month === month) : rows
    if (!month) return metrics

    // Факт берём не из таблицы, а собираем из ежедневных отчётов — в Excel это
    // SUMIFS по номеру недели. Считаем на чтении, чтобы правка отчёта задним
    // числом сразу отражалась в KPI и не могло возникнуть рассинхрона.
    // План задан на роль (строка «аккаунт × формат»), а не на человека, поэтому
    // суммируем отчёты всех сотрудников с должностью smm за этот месяц.
    const reports = await ctx.db.query('dailyReports').collect()
    const facts = new Map<string, number[]>()
    for (const r of reports) {
      if (r.position !== 'smm' || !r.smm) continue
      if (r.date.slice(0, 7) !== month) continue
      const w = weekIndex(r.date)
      for (const line of r.smm) {
        const key = `${line.page}|${line.type}`
        const arr = facts.get(key) ?? [0, 0, 0, 0, 0]
        arr[w] += line.count
        facts.set(key, arr)
      }
    }

    return metrics.map((m) => ({
      ...m,
      weekFacts: facts.get(`${m.account}|${m.format}`) ?? [0, 0, 0, 0, 0],
    }))
  },
})

// Обновить план по неделям и вес (настройки руководителя).
// Факта здесь нет намеренно: он производный от ежедневных отчётов, см. list.
export const setPlan = mutation({
  args: {
    id: v.id('smmMetrics'),
    weekPlans: v.array(v.number()),
    weight: v.number(),
  },
  handler: async (ctx, { id, weekPlans, weight }) => {
    await ctx.db.patch(id, { weekPlans, weight })
  },
})
