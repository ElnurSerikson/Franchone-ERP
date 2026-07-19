// Движок расчёта KPI — формулы воспроизведены дословно из Excel-файлов
// KPI_SMM.xlsx и KPI_TARGETOLOG.xlsx (см. docs/ТЗ-Админ-панель.md §6.3).
// Базовое правило обеих моделей: Выплата = Оклад × Итоговый KPI (KPI ≤ 100%).

import type { Campaign, SmmMetric } from '@/types'

const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
const sum = (a: number[]) => a.reduce((s, x) => s + x, 0)

// ————————————————————————————————————————————————
// SMM
// ————————————————————————————————————————————————

export interface SmmMetricResult {
  metric: SmmMetric
  plan: number // Планᵢ (месяц) = Σ недельных планов
  fact: number // Фактᵢ (месяц) = Σ недельных фактов
  ratio: number // МИН(Факт/План; 1)
  contribution: number // Вкладᵢ = ratio × вес
}

export interface SmmResult {
  rows: SmmMetricResult[]
  totalKpi: number // Итоговый KPI = Σ Вклад
  weekKpi: number[] // KPI по неделям (нормированный)
  kpiFranchone: number
  kpiAnuar: number
  totalPlan: number
  totalFact: number
}

export function computeSmm(metrics: SmmMetric[]): SmmResult {
  const rows: SmmMetricResult[] = metrics.map((m) => {
    const plan = sum(m.weekPlans)
    const fact = sum(m.weekFacts)
    const ratio = plan === 0 ? 0 : clamp01(fact / plan)
    return { metric: m, plan, fact, ratio, contribution: ratio * m.weight }
  })

  const totalKpi = sum(rows.map((r) => r.contribution))

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

  const block = (acc: 'FRANCHONE' | 'ANUAR') => {
    const rs = rows.filter((r) => r.metric.account === acc)
    const w = sum(rs.map((r) => r.metric.weight))
    return w === 0 ? 0 : sum(rs.map((r) => r.contribution)) / w
  }

  return {
    rows,
    totalKpi,
    weekKpi,
    kpiFranchone: block('FRANCHONE'),
    kpiAnuar: block('ANUAR'),
    totalPlan: sum(rows.map((r) => r.plan)),
    totalFact: sum(rows.map((r) => r.fact)),
  }
}

// ————————————————————————————————————————————————
// Таргетолог
// ————————————————————————————————————————————————

export const LEAD_WEIGHT = 0.7 // Вес заявок
export const CPL_WEIGHT = 0.3 // Вес CPL

export interface CampaignResult {
  campaign: Campaign
  planCpl: number
  factCpl: number
  budgetPct: number // Факт/План бюджета (информативно)
  leadsPct: number // МИН(Факт заявок/План заявок; 1)
  cplEff: number // МИН(План CPL/Факт CPL; 1)
  kpi: number // KPI кампании = заявки%×0.7 + CPLэфф×0.3
  contribution: number // Вклад = kpi × вес
  counts: boolean // участвует в итоге (план.бюджет>0 и план.заявки>0)
}

export interface TargetologResult {
  rows: CampaignResult[]
  totalKpi: number
  totalSpend: number
  totalLeads: number
  avgCpl: number
}

export function computeTargetolog(campaigns: Campaign[]): TargetologResult {
  const rows: CampaignResult[] = campaigns.map((c) => {
    const planCpl = c.planLeads === 0 ? 0 : c.planBudget / c.planLeads
    const factCpl = c.factLeads === 0 ? 0 : c.factBudget / c.factLeads
    const budgetPct = c.planBudget === 0 ? 0 : c.factBudget / c.planBudget
    const leadsPct = c.planLeads === 0 ? 0 : clamp01(c.factLeads / c.planLeads)
    const cplEff = planCpl === 0 || factCpl === 0 ? 0 : clamp01(planCpl / factCpl)
    const kpi = leadsPct * LEAD_WEIGHT + cplEff * CPL_WEIGHT
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
  const avgCpl = totalLeads === 0 ? 0 : totalSpend / totalLeads

  return { rows, totalKpi, totalSpend, totalLeads, avgCpl }
}

// Разрез по источнику денег (FRANCHONE / Партнёр)
export function spendBySource(campaigns: Campaign[]) {
  const src = (s: Campaign['moneySource']) => {
    const list = campaigns.filter((c) => c.moneySource === s)
    const spend = sum(list.map((c) => c.factBudget))
    const leads = sum(list.map((c) => c.factLeads))
    return { spend, leads, cpl: leads === 0 ? 0 : spend / leads }
  }
  return { FRANCHONE: src('FRANCHONE'), Партнёр: src('Партнёр') }
}

// Выплата = Оклад × Итоговый KPI
export const payout = (salary: number, kpi: number) => Math.round(salary * kpi)
