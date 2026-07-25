import { query, mutation } from './_generated/server'
import { v, ConvexError } from 'convex/values'
import { requireManager } from './lib'

// Справочник отделов (§11). Название хранится в employees.department.

export const list = query({
  args: {},
  handler: async (ctx) =>
    (await ctx.db.query('departments').collect()).sort((a, b) => a.name.localeCompare(b.name)),
})

async function requireOwner(ctx: Parameters<typeof requireManager>[0]) {
  const me = await requireManager(ctx)
  if (me.role !== 'owner') throw new ConvexError('Отделы ведёт владелец')
  return me
}

export const create = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    await requireOwner(ctx)
    const clean = name.trim()
    if (!clean) throw new ConvexError('Укажите название отдела')
    const dup = (await ctx.db.query('departments').collect()).some(
      (d) => d.name.toLowerCase() === clean.toLowerCase(),
    )
    if (dup) throw new ConvexError('Такой отдел уже есть')
    return await ctx.db.insert('departments', { name: clean })
  },
})

export const rename = mutation({
  args: { id: v.id('departments'), name: v.string() },
  handler: async (ctx, { id, name }) => {
    await requireOwner(ctx)
    const clean = name.trim()
    if (!clean) throw new ConvexError('Укажите название')
    const dept = await ctx.db.get(id)
    if (!dept) throw new ConvexError('Отдел не найден')
    const old = dept.name
    await ctx.db.patch(id, { name: clean })
    // Переносим сотрудников старого отдела на новое название — связь по строке.
    for (const e of await ctx.db.query('employees').collect()) {
      if (e.department === old) await ctx.db.patch(e._id, { department: clean })
    }
  },
})

export const remove = mutation({
  args: { id: v.id('departments') },
  handler: async (ctx, { id }) => {
    await requireOwner(ctx)
    const dept = await ctx.db.get(id)
    if (!dept) return
    const inUse = (await ctx.db.query('employees').collect()).some((e) => e.department === dept.name)
    if (inUse) throw new ConvexError('Отдел занят — сначала переведите сотрудников')
    await ctx.db.delete(id)
  },
})
