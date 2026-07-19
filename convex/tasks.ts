import { query, mutation } from './_generated/server'
import { v } from 'convex/values'

const statusV = v.union(
  v.literal('backlog'),
  v.literal('progress'),
  v.literal('review'),
  v.literal('done'),
)
const priorityV = v.union(
  v.literal('low'),
  v.literal('medium'),
  v.literal('high'),
  v.literal('urgent'),
)

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query('tasks').collect()
  },
})

export const add = mutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    status: v.optional(statusV),
    priority: priorityV,
    assigneeId: v.id('employees'),
    reporterId: v.id('employees'),
    deadline: v.string(),
    tags: v.optional(v.array(v.string())),
    kpiRef: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert('tasks', {
      title: args.title,
      description: args.description,
      status: args.status ?? 'backlog',
      priority: args.priority,
      assigneeId: args.assigneeId,
      reporterId: args.reporterId,
      deadline: args.deadline,
      tags: args.tags ?? [],
      checklist: [],
      attachments: 0,
      comments: 0,
      kpiRef: args.kpiRef,
    })
  },
})

// Перемещение карточки между колонками Kanban
export const setStatus = mutation({
  args: { id: v.id('tasks'), status: statusV },
  handler: async (ctx, { id, status }) => {
    await ctx.db.patch(id, { status })
  },
})

export const update = mutation({
  args: {
    id: v.id('tasks'),
    patch: v.object({
      title: v.optional(v.string()),
      description: v.optional(v.string()),
      priority: v.optional(priorityV),
      assigneeId: v.optional(v.id('employees')),
      deadline: v.optional(v.string()),
      tags: v.optional(v.array(v.string())),
      checklist: v.optional(
        v.array(v.object({ text: v.string(), done: v.boolean() })),
      ),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await ctx.db.patch(id, patch)
  },
})

export const remove = mutation({
  args: { id: v.id('tasks') },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id)
  },
})
