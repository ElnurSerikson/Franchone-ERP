// Формулы KPI — единственный источник правды, общий для фронта и сервера.
// Раньше они жили только в src/lib/kpi.ts, но закрытие месяца считает выплаты
// на сервере: две копии формул неизбежно разъехались бы, а расходятся они
// в деньгах. Файл чистый — никаких обращений к базе, только арифметика.
//
// Воспроизводит KPI_SMM.xlsx и KPI_TARGETOLOG.xlsx дословно.
// Базовое правило обеих моделей: Выплата = Оклад × Итоговый KPI (KPI ≤ 100%).

export const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
const sum = (a: number[]) => a.reduce((s, x) => s + x, 0)

// ——— SMM ———

export interface SmmMetricLike {
  account: string
  format: string
  weight: number
  weekPlans: number[]
  weekFacts: number[]
}

export function computeSmmMath<T extends SmmMetricLike>(metrics: T[]) {
  const rows = metrics.map((m) => {
    const plan = sum(m.weekPlans)
    const fact = sum(m.weekFacts)
    const ratio = plan === 0 ? 0 : clamp01(fact / plan)
    return { metric: m, plan, fact, ratio, contribution: ratio * m.weight }
  })

  // Недельный KPI: Σ[min(факт/план;1)×вес] / Σ[вес где план>0]
  const weekKpi = [0, 1, 2, 3, 4].map((w) => {
    let num = 0
    let den = 0
    for (const m of metrics) {
      const p = m.weekPlans[w]
      const f = m.weekFacts[w]
      if (p > 0) {
        num += clamp01(f / p) * m.weight
        den += m.weight
      }
    }
    return den === 0 ? 0 : num / den
  })

  const block = (acc: string) => {
    const rs = rows.filter((r) => r.metric.account === acc)
    const w = sum(rs.map((r) => r.metric.weight))
    return w === 0 ? 0 : sum(rs.map((r) => r.contribution)) / w
  }

  return {
    rows,
    totalKpi: sum(rows.map((r) => r.contribution)),
    weekKpi,
    kpiFranchone: block('FRANCHONE'),
    kpiAnuar: block('ANUAR'),
    totalPlan: sum(rows.map((r) => r.plan)),
    totalFact: sum(rows.map((r) => r.fact)),
  }
}

// ——— Таргетолог ———

export interface KpiWeights {
  leadWeight: number
  cplWeight: number
}
export const DEFAULT_WEIGHTS: KpiWeights = { leadWeight: 0.7, cplWeight: 0.3 }

export interface CampaignLike {
  moneySource: string
  weight: number
  planBudget: number
  planLeads: number
  factBudget: number
  factLeads: number
}

export function computeTargetologMath<T extends CampaignLike>(
  campaigns: T[],
  weights: KpiWeights = DEFAULT_WEIGHTS,
) {
  const rows = campaigns.map((c) => {
    const planCpl = c.planLeads === 0 ? 0 : c.planBudget / c.planLeads
    const factCpl = c.factLeads === 0 ? 0 : c.factBudget / c.factLeads
    const budgetPct = c.planBudget === 0 ? 0 : c.factBudget / c.planBudget
    const leadsPct = c.planLeads === 0 ? 0 : clamp01(c.factLeads / c.planLeads)
    const cplEff = planCpl === 0 || factCpl === 0 ? 0 : clamp01(planCpl / factCpl)
    const kpi = leadsPct * weights.leadWeight + cplEff * weights.cplWeight
    // В итог идут только кампании с заданным планом — как в Excel.
    const counts = c.planBudget > 0 && c.planLeads > 0
    return {
      campaign: c,
      planCpl,
      factCpl,
      budgetPct,
      leadsPct,
      cplEff,
      kpi,
      contribution: kpi * c.weight,
      counts,
    }
  })

  const counted = rows.filter((r) => r.counts)
  const weightSum = sum(counted.map((r) => r.campaign.weight))
  const totalKpi = weightSum === 0 ? 0 : sum(counted.map((r) => r.contribution)) / weightSum

  const totalSpend = sum(campaigns.map((c) => c.factBudget))
  const totalLeads = sum(campaigns.map((c) => c.factLeads))

  return {
    rows,
    totalKpi,
    totalSpend,
    totalLeads,
    avgCpl: totalLeads === 0 ? 0 : totalSpend / totalLeads,
  }
}

// ——— Отдел продаж ———
// KPI по выручке: МИН(факт / план; 1) — та же отсечка, что у SMM.

export function computeSalesMath(factRevenue: number, planRevenue: number) {
  const ratio = planRevenue > 0 ? factRevenue / planRevenue : 0
  return { ratio, totalKpi: clamp01(ratio), planRevenue, factRevenue }
}

// Выплата = Оклад × Итоговый KPI
export const payoutOf = (salary: number, kpi: number) => Math.round(salary * kpi)
