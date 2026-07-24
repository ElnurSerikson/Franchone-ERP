import { query, mutation } from './_generated/server'
import { v } from 'convex/values'
import { requireEmployee } from './lib'

// Значения по умолчанию — из дашбордов KPI_SMM.xlsx и KPI_TARGETOLOG.xlsx.
const DEFAULTS = {
  leadWeight: 0.7,
  cplWeight: 0.3,
  salarySmm: 600000,
  salaryTargetolog: 200000,
  reportMonth: 'Июль 2026',
  reportDeadlineTime: '20:00',
}

export const get = query({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db
      .query('settings')
      .withIndex('by_key', (q) => q.eq('key', 'global'))
      .first()
    // Отдаём с подставленными умолчаниями, чтобы фронт не дублировал числа.
    return { ...DEFAULTS, ...(row ?? {}) }
  },
})

export const update = mutation({
  args: {
    leadWeight: v.optional(v.number()),
    cplWeight: v.optional(v.number()),
    salarySmm: v.optional(v.number()),
    salaryTargetolog: v.optional(v.number()),
    reportMonth: v.optional(v.string()),
    reportDeadlineTime: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const me = await requireEmployee(ctx)
    if (me.role !== 'owner' && me.role !== 'head') {
      throw new Error('Настройки меняет руководитель')
    }
    // Патчим только переданные поля: undefined в Convex стирает значение,
    // и частичное сохранение не должно обнулять соседние настройки.
    const patch = Object.fromEntries(
      Object.entries(args).filter(([, value]) => value !== undefined),
    )
    const existing = await ctx.db
      .query('settings')
      .withIndex('by_key', (q) => q.eq('key', 'global'))
      .first()
    if (existing) await ctx.db.patch(existing._id, patch)
    else await ctx.db.insert('settings', { key: 'global', ...DEFAULTS, ...patch })
  },
})
