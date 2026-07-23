import { query, mutation } from './_generated/server'
import { v } from 'convex/values'

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query('employees').collect()
  },
})

export const create = mutation({
  args: {
    name: v.string(),
    role: v.union(v.literal('owner'), v.literal('head'), v.literal('employee')),
    position: v.union(
      v.literal('smm'),
      v.literal('targetolog'),
      v.literal('sales'),
      v.literal('packer'),
      v.literal('developer'),
    ),
    positionLabel: v.string(),
    department: v.string(),
    salary: v.number(),
    email: v.string(),
    phone: v.string(),
    avatarColor: v.string(),
    initials: v.string(),
    hiredAt: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert('employees', { ...args, status: 'active' })
  },
})

export const update = mutation({
  args: {
    id: v.id('employees'),
    patch: v.object({
      name: v.optional(v.string()),
      positionLabel: v.optional(v.string()),
      department: v.optional(v.string()),
      salary: v.optional(v.number()),
      email: v.optional(v.string()),
      phone: v.optional(v.string()),
      role: v.optional(
        v.union(v.literal('owner'), v.literal('head'), v.literal('employee')),
      ),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await ctx.db.patch(id, patch)
  },
})

export const archive = mutation({
  args: { id: v.id('employees') },
  handler: async (ctx, { id }) => {
    await ctx.db.patch(id, { status: 'archived' })
  },
})
