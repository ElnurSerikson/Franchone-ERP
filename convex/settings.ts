import { query, mutation } from './_generated/server'
import { v } from 'convex/values'

export const get = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query('settings')
      .withIndex('by_key', (q) => q.eq('key', 'global'))
      .first()
  },
})

export const update = mutation({
  args: {
    leadWeight: v.number(),
    cplWeight: v.number(),
    reportMonth: v.string(),
    reportDeadlineTime: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('settings')
      .withIndex('by_key', (q) => q.eq('key', 'global'))
      .first()
    if (existing) {
      await ctx.db.patch(existing._id, args)
    } else {
      await ctx.db.insert('settings', { key: 'global', ...args })
    }
  },
})
