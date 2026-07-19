import { query, mutation } from './_generated/server'
import { v } from 'convex/values'

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query('campaigns').collect()
  },
})

// Обновить фактические показатели кампании (ежедневный/итоговый ввод)
export const updateActuals = mutation({
  args: {
    id: v.id('campaigns'),
    factBudget: v.number(),
    factLeads: v.number(),
  },
  handler: async (ctx, { id, factBudget, factLeads }) => {
    await ctx.db.patch(id, { factBudget, factLeads })
  },
})

// Обновить план кампании (веса и цели ставит руководитель)
export const updatePlan = mutation({
  args: {
    id: v.id('campaigns'),
    planBudget: v.number(),
    planLeads: v.number(),
    weight: v.number(),
  },
  handler: async (ctx, { id, planBudget, planLeads, weight }) => {
    await ctx.db.patch(id, { planBudget, planLeads, weight })
  },
})
