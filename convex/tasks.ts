import { query, mutation } from './_generated/server'
import { v, ConvexError } from 'convex/values'
import { requireEmployee, isManager, isOnTime } from './lib'

const statusV = v.union(v.literal('assigned'), v.literal('in_progress'), v.literal('done'))
const priorityV = v.union(
  v.literal('low'),
  v.literal('medium'),
  v.literal('high'),
  v.literal('urgent'),
)

// ——— Запросы ———

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query('tasks').collect()
  },
})

export const get = query({
  args: { id: v.id('tasks') },
  handler: async (ctx, { id }) => ctx.db.get(id),
})

export const comments = query({
  args: { taskId: v.id('tasks') },
  handler: async (ctx, { taskId }) => {
    const rows = await ctx.db
      .query('taskComments')
      .withIndex('by_task', (q) => q.eq('taskId', taskId))
      .collect()
    return Promise.all(
      rows.map(async (c) => {
        const a = await ctx.db.get(c.authorId)
        return {
          _id: c._id,
          text: c.text,
          createdAt: c._creationTime,
          author: a ? { name: a.name, initials: a.initials, color: a.avatarColor } : null,
        }
      }),
    )
  },
})

export const events = query({
  args: { taskId: v.id('tasks') },
  handler: async (ctx, { taskId }) => {
    const rows = await ctx.db
      .query('taskEvents')
      .withIndex('by_task', (q) => q.eq('taskId', taskId))
      .collect()
    return Promise.all(
      rows.map(async (e) => {
        const a = await ctx.db.get(e.byId)
        return {
          _id: e._id,
          type: e.type,
          fromStatus: e.fromStatus,
          toStatus: e.toStatus,
          note: e.note,
          createdAt: e._creationTime,
          author: a ? { name: a.name, initials: a.initials, color: a.avatarColor } : null,
        }
      }),
    )
  },
})

export const attachments = query({
  args: { taskId: v.id('tasks') },
  handler: async (ctx, { taskId }) => {
    const rows = await ctx.db
      .query('taskAttachments')
      .withIndex('by_task', (q) => q.eq('taskId', taskId))
      .collect()
    return Promise.all(
      rows.map(async (a) => ({
        _id: a._id,
        kind: a.kind,
        name: a.name,
        url: a.kind === 'file' && a.storageId ? await ctx.storage.getUrl(a.storageId) : a.url,
      })),
    )
  },
})

// ——— Мутации ———

export const create = mutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    assigneeId: v.id('employees'),
    priority: priorityV,
    deadline: v.string(),
    tags: v.optional(v.array(v.string())),
    kpiRef: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const me = await requireEmployee(ctx)
    const id = await ctx.db.insert('tasks', {
      title: args.title,
      description: args.description,
      status: 'assigned',
      priority: args.priority,
      assigneeId: args.assigneeId,
      reporterId: me._id,
      deadline: args.deadline,
      tags: args.tags ?? [],
      checklist: [],
      attachments: 0,
      comments: 0,
      kpiRef: args.kpiRef,
    })
    await ctx.db.insert('taskEvents', { taskId: id, type: 'created', byId: me._id })
    return id
  },
})

export const setStatus = mutation({
  args: { id: v.id('tasks'), status: statusV },
  handler: async (ctx, { id, status }) => {
    const me = await requireEmployee(ctx)
    const task = await ctx.db.get(id)
    if (!task) throw new Error('Задача не найдена')
    if (task.status === status) return

    if (status === 'done') {
      const now = Date.now()
      await ctx.db.patch(id, {
        status,
        completedAt: now,
        completedOnTime: isOnTime(now, task.deadline),
      })
    } else {
      await ctx.db.patch(id, { status, completedAt: undefined, completedOnTime: undefined })
    }
    await ctx.db.insert('taskEvents', {
      taskId: id,
      type: 'status',
      fromStatus: task.status,
      toStatus: status,
      byId: me._id,
    })
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
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const me = await requireEmployee(ctx)
    const task = await ctx.db.get(id)
    if (!task) throw new Error('Задача не найдена')
    if (patch.assigneeId && patch.assigneeId !== task.assigneeId) {
      await ctx.db.insert('taskEvents', { taskId: id, type: 'assignee', byId: me._id })
    }
    await ctx.db.patch(id, patch)
  },
})

export const remove = mutation({
  args: { id: v.id('tasks') },
  handler: async (ctx, { id }) => {
    // Удаление безвозвратное — вместе с комментариями, историей и файлами.
    // Поэтому только руководство, постановщик или исполнитель задачи.
    const me = await requireEmployee(ctx)
    const task = await ctx.db.get(id)
    if (!task) throw new ConvexError('Задача не найдена')
    const own = task.reporterId === me._id || task.assigneeId === me._id
    if (!isManager(me) && !own) {
      throw new ConvexError('Удалить задачу может постановщик, исполнитель или руководитель')
    }

    const comments = await ctx.db
      .query('taskComments')
      .withIndex('by_task', (q) => q.eq('taskId', id))
      .collect()
    for (const c of comments) await ctx.db.delete(c._id)

    const evs = await ctx.db
      .query('taskEvents')
      .withIndex('by_task', (q) => q.eq('taskId', id))
      .collect()
    for (const e of evs) await ctx.db.delete(e._id)

    const atts = await ctx.db
      .query('taskAttachments')
      .withIndex('by_task', (q) => q.eq('taskId', id))
      .collect()
    for (const a of atts) {
      if (a.storageId) await ctx.storage.delete(a.storageId)
      await ctx.db.delete(a._id)
    }

    await ctx.db.delete(id)
  },
})

export const addComment = mutation({
  args: { taskId: v.id('tasks'), text: v.string() },
  handler: async (ctx, { taskId, text }) => {
    const me = await requireEmployee(ctx)
    const trimmed = text.trim()
    if (!trimmed) return
    await ctx.db.insert('taskComments', { taskId, authorId: me._id, text: trimmed })
    const task = await ctx.db.get(taskId)
    if (task) await ctx.db.patch(taskId, { comments: task.comments + 1 })
  },
})

export const toggleChecklistItem = mutation({
  args: { taskId: v.id('tasks'), index: v.number() },
  handler: async (ctx, { taskId, index }) => {
    await requireEmployee(ctx)
    const task = await ctx.db.get(taskId)
    if (!task || !task.checklist[index]) return
    const checklist = task.checklist.map((it, i) =>
      i === index ? { ...it, done: !it.done } : it,
    )
    await ctx.db.patch(taskId, { checklist })
  },
})

export const addLink = mutation({
  args: { taskId: v.id('tasks'), name: v.string(), url: v.string() },
  handler: async (ctx, { taskId, name, url }) => {
    const me = await requireEmployee(ctx)
    await ctx.db.insert('taskAttachments', {
      taskId,
      kind: 'link',
      name: name.trim() || url,
      url: url.trim(),
      byId: me._id,
    })
    const task = await ctx.db.get(taskId)
    if (task) await ctx.db.patch(taskId, { attachments: task.attachments + 1 })
  },
})

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireEmployee(ctx)
    return await ctx.storage.generateUploadUrl()
  },
})

export const addFile = mutation({
  args: { taskId: v.id('tasks'), storageId: v.id('_storage'), name: v.string() },
  handler: async (ctx, { taskId, storageId, name }) => {
    const me = await requireEmployee(ctx)
    await ctx.db.insert('taskAttachments', {
      taskId,
      kind: 'file',
      name,
      storageId,
      byId: me._id,
    })
    const task = await ctx.db.get(taskId)
    if (task) await ctx.db.patch(taskId, { attachments: task.attachments + 1 })
  },
})

export const removeAttachment = mutation({
  args: { id: v.id('taskAttachments') },
  handler: async (ctx, { id }) => {
    await requireEmployee(ctx)
    const att = await ctx.db.get(id)
    if (!att) return
    if (att.storageId) await ctx.storage.delete(att.storageId)
    await ctx.db.delete(id)
    const task = await ctx.db.get(att.taskId)
    if (task) await ctx.db.patch(att.taskId, { attachments: Math.max(0, task.attachments - 1) })
  },
})
