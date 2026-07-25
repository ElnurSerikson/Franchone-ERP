import { query, mutation, internalMutation } from './_generated/server'
import { v, ConvexError } from 'convex/values'
import type { QueryCtx, MutationCtx } from './_generated/server'
import { currentEmployee, isManager, requireEmployee, hiddenEmployeeIds } from './lib'
import {
  computeSmmMath,
  computeTargetologMath,
  computeSalesMath,
  payoutOf,
  DEFAULT_WEIGHTS,
} from './kpiMath'

// Месяц в часовом поясе Алматы (YYYY-MM).
function businessMonth(at = Date.now()): string {
  return new Date(at + 5 * 3600 * 1000).toISOString().slice(0, 7)
}

export function prevMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 2, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

// Закрыт ли месяц. Общая проверка: ей же пользуется reports.submit,
// чтобы в закрытый период нельзя было дозаполнить отчёт.
export async function isMonthClosed(ctx: QueryCtx | MutationCtx, month: string): Promise<boolean> {
  const row = await ctx.db
    .query('monthClosures')
    .withIndex('by_month', (q) => q.eq('month', month))
    .first()
  return row?.closed === true
}

// ——— Расчёт начислений за месяц ———
// Живой расчёт по текущим данным. Для закрытого месяца им не пользуемся —
// там показываем снапшот, иначе смысл фиксации теряется.
async function computeMonth(ctx: QueryCtx | MutationCtx, month: string) {
  const s = await ctx.db
    .query('settings')
    .withIndex('by_key', (q) => q.eq('key', 'global'))
    .first()
  const weights = {
    leadWeight: s?.leadWeight ?? DEFAULT_WEIGHTS.leadWeight,
    cplWeight: s?.cplWeight ?? DEFAULT_WEIGHTS.cplWeight,
  }

  // Скрытые аккаунты (тестовые) не участвуют в KPI/начислениях: их отчёты не
  // должны попадать в общий факт роли.
  const hidden = await hiddenEmployeeIds(ctx)
  const reports = (await ctx.db.query('dailyReports').collect()).filter(
    (r) => r.date.slice(0, 7) === month && !hidden.has(r.employeeId),
  )

  // SMM: факт из ежедневных отчётов, разложенный по неделям — как SUMIFS в Excel.
  const smmPlans = (await ctx.db.query('smmMetrics').collect()).filter((m) => m.month === month)
  const facts = new Map<string, number[]>()
  for (const r of reports) {
    if (r.position !== 'smm' || !r.smm) continue
    const w = Math.min(5, Math.ceil(Number(r.date.slice(8, 10)) / 7)) - 1
    for (const line of r.smm) {
      const key = `${line.page}|${line.type}`
      const arr = facts.get(key) ?? [0, 0, 0, 0, 0]
      arr[w] += line.count
      facts.set(key, arr)
    }
  }
  const smm = computeSmmMath(
    smmPlans.map((m) => ({
      account: m.account,
      format: m.format,
      weight: m.weight,
      weekPlans: m.weekPlans,
      weekFacts: facts.get(`${m.account}|${m.format}`) ?? [0, 0, 0, 0, 0],
    })),
  )

  // Таргетолог: план месяца по кампаниям + факт из отчётов.
  const plans = await ctx.db
    .query('campaignPlans')
    .withIndex('by_month', (q) => q.eq('month', month))
    .collect()
  const adFacts = new Map<string, { budget: number; leads: number }>()
  for (const r of reports) {
    if (r.position !== 'targetolog' || !r.targetolog) continue
    for (const line of r.targetolog) {
      const acc = adFacts.get(line.code) ?? { budget: 0, leads: 0 }
      acc.budget += line.budget
      acc.leads += line.leads
      adFacts.set(line.code, acc)
    }
  }
  const campaigns = []
  for (const p of plans) {
    const c = await ctx.db.get(p.campaignId)
    if (!c || c.archived) continue
    const f = adFacts.get(c.code) ?? { budget: 0, leads: 0 }
    campaigns.push({
      moneySource: c.moneySource,
      weight: p.weight,
      planBudget: p.planBudget,
      planLeads: p.planLeads,
      factBudget: f.budget,
      factLeads: f.leads,
    })
  }
  const targetolog = computeTargetologMath(campaigns, weights)

  // Продажи: KPI по выручке.
  const revenue = reports.reduce((sum, r) => sum + (r.sales?.revenue ?? 0), 0)
  const sales = computeSalesMath(revenue, s?.planRevenueSales ?? 0)

  const emps = (await ctx.db.query('employees').collect()).filter(
    (e) => !e.hidden && e.role !== 'owner',
  )

  const rows = []
  for (const e of emps) {
    let kpi: number | null = null
    let salary = 0
    let planTotal: number | undefined
    let factTotal: number | undefined
    if (e.position === 'smm' && smmPlans.length > 0) {
      kpi = smm.totalKpi
      salary = s?.salarySmm ?? 0
      planTotal = smm.totalPlan
      factTotal = smm.totalFact
    } else if (e.position === 'targetolog' && campaigns.length > 0) {
      kpi = targetolog.totalKpi
      salary = s?.salaryTargetolog ?? 0
      planTotal = campaigns.reduce((x, c) => x + c.planLeads, 0)
      factTotal = targetolog.totalLeads
    } else if (e.position === 'sales' && (s?.planRevenueSales ?? 0) > 0) {
      kpi = sales.totalKpi
      salary = s?.salarySales ?? 0
      planTotal = sales.planRevenue
      factTotal = sales.factRevenue
    }
    if (kpi === null) continue // модели KPI для должности нет — начислять нечего
    rows.push({
      employeeId: e._id,
      name: e.name,
      positionLabel: e.positionLabel,
      position: e.position,
      kpi,
      salary,
      payout: payoutOf(salary, kpi),
      planTotal,
      factTotal,
    })
  }
  return rows
}

// ——— Запросы ———

// Состояние месяца: закрыт или нет, кем, и строки начислений.
// Для закрытого месяца — из снапшота, для открытого — живой предварительный
// расчёт, чтобы владелец видел, что именно зафиксируется.
export const month = query({
  args: { month: v.string() },
  handler: async (ctx, { month: ym }) => {
    const me = await currentEmployee(ctx)
    if (!me) return null

    const closure = await ctx.db
      .query('monthClosures')
      .withIndex('by_month', (q) => q.eq('month', ym))
      .first()
    const closed = closure?.closed === true

    const rows = closed
      ? (
          await ctx.db
            .query('payrollSnapshots')
            .withIndex('by_month', (q) => q.eq('month', ym))
            .collect()
        ).map((r) => ({
          employeeId: r.employeeId,
          name: r.name,
          positionLabel: r.positionLabel,
          position: r.position,
          kpi: r.kpi,
          salary: r.salary,
          payout: r.payout,
          planTotal: r.planTotal,
          factTotal: r.factTotal,
        }))
      : await computeMonth(ctx, ym)

    // Сотрудник видит только свою строку: чужие оклады его не касаются.
    const visible = isManager(me) ? rows : rows.filter((r) => r.employeeId === me._id)

    return {
      month: ym,
      closed,
      closedAt: closure?.closedAt ?? null,
      auto: closure ? !closure.byId : false,
      history: closure?.history ?? [],
      canManage: me.role === 'owner',
      rows: visible,
      total: visible.reduce((s, r) => s + r.payout, 0),
    }
  },
})

// ——— Мутации ———

async function writeSnapshot(ctx: MutationCtx, ym: string) {
  for (const old of await ctx.db
    .query('payrollSnapshots')
    .withIndex('by_month', (q) => q.eq('month', ym))
    .collect()) {
    await ctx.db.delete(old._id)
  }
  const rows = await computeMonth(ctx, ym)
  for (const r of rows) await ctx.db.insert('payrollSnapshots', { month: ym, ...r })
  return rows.length
}

async function closeMonth(
  ctx: MutationCtx,
  ym: string,
  byId: undefined | Awaited<ReturnType<typeof requireEmployee>>['_id'],
) {
  const now = Date.now()
  const count = await writeSnapshot(ctx, ym)
  const existing = await ctx.db
    .query('monthClosures')
    .withIndex('by_month', (q) => q.eq('month', ym))
    .first()
  const entry = { at: now, action: 'closed' as const, byId, auto: !byId }
  if (existing) {
    await ctx.db.patch(existing._id, {
      closed: true,
      closedAt: now,
      byId,
      history: [...existing.history, entry],
    })
  } else {
    await ctx.db.insert('monthClosures', {
      month: ym,
      closed: true,
      closedAt: now,
      byId,
      history: [entry],
    })
  }
  return count
}

export const close = mutation({
  args: { month: v.string() },
  handler: async (ctx, { month: ym }) => {
    const me = await requireEmployee(ctx)
    if (me.role !== 'owner') throw new ConvexError('Закрыть месяц может только владелец')
    if (ym >= businessMonth()) throw new ConvexError('Текущий месяц закрывать рано')
    if (await isMonthClosed(ctx, ym)) throw new ConvexError('Месяц уже закрыт')
    return { rows: await closeMonth(ctx, ym, me._id) }
  },
})

export const reopen = mutation({
  args: { month: v.string() },
  handler: async (ctx, { month: ym }) => {
    const me = await requireEmployee(ctx)
    if (me.role !== 'owner') throw new ConvexError('Переоткрыть месяц может только владелец')
    const row = await ctx.db
      .query('monthClosures')
      .withIndex('by_month', (q) => q.eq('month', ym))
      .first()
    if (!row?.closed) throw new ConvexError('Месяц не закрыт')
    await ctx.db.patch(row._id, {
      closed: false,
      history: [
        ...row.history,
        { at: Date.now(), action: 'reopened' as const, byId: me._id, auto: false },
      ],
    })
  },
})

// Пересчёт снапшота без переоткрытия — если правили оклад или веса.
export const recalculate = mutation({
  args: { month: v.string() },
  handler: async (ctx, { month: ym }) => {
    const me = await requireEmployee(ctx)
    if (me.role !== 'owner') throw new ConvexError('Пересчитать может только владелец')
    const row = await ctx.db
      .query('monthClosures')
      .withIndex('by_month', (q) => q.eq('month', ym))
      .first()
    if (!row?.closed) throw new ConvexError('Месяц не закрыт')
    const count = await writeSnapshot(ctx, ym)
    await ctx.db.patch(row._id, {
      history: [
        ...row.history,
        { at: Date.now(), action: 'recalculated' as const, byId: me._id, auto: false },
      ],
    })
    return { rows: count }
  },
})

// Планировщик 1-го числа закрывает предыдущий месяц.
export const autoClosePreviousMonth = internalMutation({
  args: {},
  handler: async (ctx) => {
    const target = prevMonth(businessMonth())
    if (await isMonthClosed(ctx, target)) return { skipped: target }
    const rows = await closeMonth(ctx, target, undefined)
    return { closed: target, rows }
  },
})
