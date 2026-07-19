import { query, mutation } from './_generated/server'
import { v } from 'convex/values'

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query('smmMetrics').collect()
  },
})

// Обновить факт по неделям (ежедневный отчёт SMM агрегируется в недельный факт)
export const setWeekFacts = mutation({
  args: { id: v.id('smmMetrics'), weekFacts: v.array(v.number()) },
  handler: async (ctx, { id, weekFacts }) => {
    await ctx.db.patch(id, { weekFacts })
  },
})

// Обновить план по неделям и вес (настройки руководителя)
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
