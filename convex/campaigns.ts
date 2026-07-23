import { query, mutation } from './_generated/server'
import { v } from 'convex/values'
import { requireEmployee } from './lib'

const MONEY = v.union(v.literal('FRANCHONE'), v.literal('Партнёр'))
const STATUS = v.union(v.literal('Активна'), v.literal('Пауза'), v.literal('Завершена'))

// Реестр ведут владелец/руководитель и сам таргетолог — иначе он заблокирован
// до тех пор, пока владелец не заведёт запущенную им кампанию.
async function requireRegistryAccess(ctx: Parameters<typeof requireEmployee>[0]) {
  const me = await requireEmployee(ctx)
  const ok = me.role === 'owner' || me.role === 'head' || me.position === 'targetolog'
  if (!ok) throw new Error('Нет доступа к реестру кампаний')
  return me
}

// Планы и веса — только руководство: это «жёлтые ячейки» из Excel.
async function requirePlanAccess(ctx: Parameters<typeof requireEmployee>[0]) {
  const me = await requireEmployee(ctx)
  if (me.role !== 'owner' && me.role !== 'head') throw new Error('Планы задаёт руководитель')
  return me
}

// ——— Реестр ———

export const registry = query({
  args: { activeOnly: v.optional(v.boolean()) },
  handler: async (ctx, { activeOnly }) => {
    const rows = await ctx.db.query('campaigns').collect()
    const list = activeOnly ? rows.filter((c) => c.status === 'Активна') : rows
    return list.sort((a, b) => a.code.localeCompare(b.code))
  },
})

export const create = mutation({
  args: {
    code: v.string(),
    account: v.string(),
    category: v.string(),
    brand: v.string(),
    campaign: v.string(),
    moneySource: MONEY,
    status: STATUS,
    startedAt: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireRegistryAccess(ctx)
    const code = args.code.trim().toUpperCase()
    if (!code) throw new Error('Укажите ID кампании')
    const dup = await ctx.db
      .query('campaigns')
      .withIndex('by_code', (q) => q.eq('code', code))
      .first()
    if (dup) throw new Error(`Кампания ${code} уже есть в реестре`)
    return await ctx.db.insert('campaigns', { ...args, code })
  },
})

export const update = mutation({
  args: {
    id: v.id('campaigns'),
    account: v.optional(v.string()),
    category: v.optional(v.string()),
    brand: v.optional(v.string()),
    campaign: v.optional(v.string()),
    moneySource: v.optional(MONEY),
    status: v.optional(STATUS),
    startedAt: v.optional(v.string()),
    endedAt: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...patch }) => {
    await requireRegistryAccess(ctx)
    await ctx.db.patch(id, patch)
  },
})

// ——— Месячный план ———

export const plans = query({
  args: { month: v.string() },
  handler: async (ctx, { month }) => {
    return await ctx.db
      .query('campaignPlans')
      .withIndex('by_month', (q) => q.eq('month', month))
      .collect()
  },
})

export const setPlan = mutation({
  args: {
    campaignId: v.id('campaigns'),
    month: v.string(),
    planBudget: v.number(),
    planLeads: v.number(),
    weight: v.number(),
  },
  handler: async (ctx, { campaignId, month, ...vals }) => {
    await requirePlanAccess(ctx)
    const existing = await ctx.db
      .query('campaignPlans')
      .withIndex('by_campaign', (q) => q.eq('campaignId', campaignId))
      .collect()
    const row = existing.find((p) => p.month === month)
    if (row) await ctx.db.patch(row._id, vals)
    else await ctx.db.insert('campaignPlans', { campaignId, month, ...vals })
  },
})

// ——— Кампании месяца: план + факт ———

// Отдаёт форму, которую ждёт computeTargetolog. Факт нигде не хранится —
// он собирается из ежедневных отчётов, как свод AI:AL на листе месяца в Excel.
// Считаем на чтении, поэтому правка отчёта задним числом сразу видна в KPI.
export const list = query({
  args: { month: v.optional(v.string()) },
  handler: async (ctx, { month }) => {
    if (!month) return []
    const monthPlans = await ctx.db
      .query('campaignPlans')
      .withIndex('by_month', (q) => q.eq('month', month))
      .collect()
    if (monthPlans.length === 0) return []

    const facts = new Map<string, { budget: number; leads: number }>()
    for (const r of await ctx.db.query('dailyReports').collect()) {
      if (r.position !== 'targetolog' || !r.targetolog) continue
      if (r.date.slice(0, 7) !== month) continue
      for (const line of r.targetolog) {
        const acc = facts.get(line.code) ?? { budget: 0, leads: 0 }
        acc.budget += line.budget
        acc.leads += line.leads
        facts.set(line.code, acc)
      }
    }

    const out = []
    for (const p of monthPlans) {
      const c = await ctx.db.get(p.campaignId)
      if (!c) continue
      const f = facts.get(c.code) ?? { budget: 0, leads: 0 }
      out.push({
        _id: c._id,
        code: c.code,
        account: c.account,
        category: c.category,
        brand: c.brand,
        campaign: c.campaign,
        moneySource: c.moneySource,
        status: c.status,
        weight: p.weight,
        planBudget: p.planBudget,
        planLeads: p.planLeads,
        factBudget: f.budget,
        factLeads: f.leads,
        month,
      })
    }
    return out.sort((a, b) => a.code.localeCompare(b.code))
  },
})
