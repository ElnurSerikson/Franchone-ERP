import { query, mutation } from './_generated/server'
import { v } from 'convex/values'
import { requireEmployee, hiddenEmployeeIds } from './lib'
import { requireCan, inScope } from './permissions'
import { ConvexError } from 'convex/values'

const MONEY = v.union(v.literal('FRANCHONE'), v.literal('Партнёр'))
const STATUS = v.union(v.literal('Активна'), v.literal('Пауза'), v.literal('Завершена'))
const GOAL = v.union(
  v.literal('msg_inst'),
  v.literal('msg_wa'),
  v.literal('reach'),
  v.literal('profile'),
  v.literal('site_leads'),
)

// Реестр ведут владелец/руководитель и сам таргетолог — иначе он заблокирован
// до тех пор, пока владелец не заведёт запущенную им кампанию.
async function requireRegistryAccess(ctx: Parameters<typeof requireEmployee>[0]) {
  const me = await requireEmployee(ctx)
  const ok = me.role === 'owner' || me.role === 'head' || me.position === 'targetolog'
  if (!ok) throw new Error('Нет доступа к реестру кампаний')
  return me
}

// ——— Реестр ———

export const registry = query({
  args: { activeOnly: v.optional(v.boolean()) },
  handler: async (ctx, { activeOnly }) => {
    const rows = (await ctx.db.query('campaigns').collect()).filter((c) => !c.archived)
    const list = activeOnly ? rows.filter((c) => c.status === 'Активна') : rows
    return list.sort((a, b) => a.code.localeCompare(b.code))
  },
})

// Софт-делит: убираем из интерфейса, запись и отчёты по ней остаются в базе.
export const archive = mutation({
  args: { id: v.id('campaigns'), archived: v.optional(v.boolean()) },
  handler: async (ctx, { id, archived }) => {
    await requireRegistryAccess(ctx)
    await ctx.db.patch(id, { archived: archived ?? true })
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
    goal: v.optional(GOAL), // цель кампании (§3.2); задаётся при создании
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
    goal: v.optional(GOAL),
    status: v.optional(STATUS),
    startedAt: v.optional(v.string()),
    endedAt: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...patch }) => {
    await requireRegistryAccess(ctx)
    const existing = await ctx.db.get(id)
    if (!existing) throw new Error('Кампания не найдена')
    // Цель неизменяема: задать можно только у кампании без цели (старой).
    if (patch.goal !== undefined && existing.goal) delete patch.goal
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
    // План кампании персональный: KPI считается по человеку, поэтому план без
    // владельца до начислений не доходит (payroll.computeMonth пропускает его).
    // Пустым он остаётся только у кампаний, заведённых до найма таргетолога.
    employeeId: v.optional(v.id('employees')),
    campaignId: v.id('campaigns'),
    month: v.string(),
    planBudget: v.number(),
    planLeads: v.number(),
    weight: v.number(),
  },
  handler: async (ctx, { employeeId, campaignId, month, ...vals }) => {
    const me = await requireCan(ctx, 'kpi', 'edit')
    if (employeeId) {
      const emp = await ctx.db.get(employeeId)
      if (emp && !inScope(me, emp)) throw new ConvexError('Можно менять планы только в вашем доступе')
    }
    const existing = await ctx.db
      .query('campaignPlans')
      .withIndex('by_campaign', (q) => q.eq('campaignId', campaignId))
      .collect()
    const sameMonth = existing.filter((p) => p.month === month)
    const row = sameMonth.find((p) => p.employeeId === employeeId)
    if (row) {
      await ctx.db.patch(row._id, vals)
      return
    }
    // Смена ответственного — это правка существующей строки, а не новый план:
    // вторая строка на ту же кампанию и месяц ничего бы не начисляла, но
    // осталась бы в реестре и путала. Подхватываем ту, что уже есть:
    // назначая владельца — бесхозную (такие остались от кампаний, заведённых
    // до найма таргетолога); снимая — единственную имеющуюся.
    const reuse = employeeId
      ? sameMonth.find((p) => !p.employeeId)
      : sameMonth.length === 1
        ? sameMonth[0]
        : undefined
    if (reuse) {
      await ctx.db.patch(reuse._id, { ...vals, employeeId })
      return
    }
    await ctx.db.insert('campaignPlans', { employeeId, campaignId, month, ...vals })
  },
})

// Факт по кампаниям за произвольный период (§3.2: «показатели должны
// собираться за день, за выбранный период, за месяц, по каждой кампании
// и суммарно»). Плана здесь нет — он задаётся на месяц и к отрезку дат
// неприменим; отдаём расход, заявки и CPL.
export const factsForPeriod = query({
  args: { from: v.string(), to: v.string() },
  handler: async (ctx, { from, to }) => {
    const registry = (await ctx.db.query('campaigns').collect()).filter((c) => !c.archived)
    const hidden = await hiddenEmployeeIds(ctx)
    const facts = new Map<string, { budget: number; leads: number; days: Set<string> }>()
    for (const r of await ctx.db.query('dailyReports').collect()) {
      if (hidden.has(r.employeeId)) continue // тестовый/скрытый не в KPI
      if (r.position !== 'targetolog' || !r.targetolog) continue
      if (r.date < from || r.date > to) continue
      for (const line of r.targetolog) {
        const acc = facts.get(line.code) ?? { budget: 0, leads: 0, days: new Set<string>() }
        acc.budget += line.budget
        acc.leads += line.leads
        acc.days.add(r.date)
        facts.set(line.code, acc)
      }
    }

    const rows = registry.map((c) => {
      const f = facts.get(c.code) ?? { budget: 0, leads: 0, days: new Set<string>() }
      return {
        code: c.code,
        campaign: c.campaign,
        brand: c.brand,
        moneySource: c.moneySource,
        status: c.status,
        budget: f.budget,
        leads: f.leads,
        cpl: f.leads ? f.budget / f.leads : 0,
        days: f.days.size,
      }
    })
    // Кампании без данных за период не показываем — иначе таблица забита нулями.
    const active = rows.filter((r) => r.days > 0).sort((a, b) => b.budget - a.budget)
    const budget = active.reduce((s, r) => s + r.budget, 0)
    const leads = active.reduce((s, r) => s + r.leads, 0)
    return { from, to, rows: active, budget, leads, cpl: leads ? budget / leads : 0 }
  },
})

// ——— Кампании месяца: план + факт ———

// Отдаёт форму, которую ждёт computeTargetolog. Факт нигде не хранится —
// он собирается из ежедневных отчётов, как свод AI:AL на листе месяца в Excel.
// Считаем на чтении, поэтому правка отчёта задним числом сразу видна в KPI.
export const list = query({
  args: { month: v.optional(v.string()), employeeId: v.optional(v.id('employees')) },
  handler: async (ctx, { month, employeeId }) => {
    if (!month) return []
    let monthPlans = await ctx.db
      .query('campaignPlans')
      .withIndex('by_month', (q) => q.eq('month', month))
      .collect()
    // KPI персональный: план кампании принадлежит таргетологу.
    if (employeeId) monthPlans = monthPlans.filter((p) => p.employeeId === employeeId)
    if (monthPlans.length === 0) return []

    const hidden = await hiddenEmployeeIds(ctx)
    const facts = new Map<string, { budget: number; leads: number }>()
    for (const r of await ctx.db.query('dailyReports').collect()) {
      if (hidden.has(r.employeeId)) continue // тестовый/скрытый не в KPI
      if (r.position !== 'targetolog' || !r.targetolog) continue
      if (r.date.slice(0, 7) !== month) continue
      if (employeeId && r.employeeId !== employeeId) continue // только его факт
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
      if (!c || c.archived) continue
      const f = facts.get(c.code) ?? { budget: 0, leads: 0 }
      out.push({
        _id: c._id,
        code: c.code,
        account: c.account,
        category: c.category,
        brand: c.brand,
        campaign: c.campaign,
        moneySource: c.moneySource,
        goal: c.goal,
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
