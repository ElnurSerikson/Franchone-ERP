import { query, mutation } from './_generated/server'
import { v } from 'convex/values'
import { currentEmployee, isManager, requireEmployee } from './lib'

// Значения по умолчанию — из дашбордов KPI_SMM.xlsx и KPI_TARGETOLOG.xlsx.
const DEFAULTS = {
  leadWeight: 0.7,
  cplWeight: 0.3,
  salarySmm: 600000,
  salaryTargetolog: 200000,
  salarySales: 0,
  planRevenueSales: 0,
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
    const all = { ...DEFAULTS, ...(row ?? {}) }

    const me = await currentEmployee(ctx)
    if (isManager(me)) return all
    // Сотруднику — только база его собственной должности: своя выплата в KPI
    // считаться должна, а чужой оклад его не касается.
    return {
      ...all,
      salarySmm: me?.position === 'smm' ? all.salarySmm : 0,
      salaryTargetolog: me?.position === 'targetolog' ? all.salaryTargetolog : 0,
      salarySales: me?.position === 'sales' ? all.salarySales : 0,
    }
  },
})

export const update = mutation({
  args: {
    leadWeight: v.optional(v.number()),
    cplWeight: v.optional(v.number()),
    salarySmm: v.optional(v.number()),
    salaryTargetolog: v.optional(v.number()),
    salarySales: v.optional(v.number()),
    planRevenueSales: v.optional(v.number()),
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
