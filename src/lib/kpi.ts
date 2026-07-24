// Типизированные обёртки над общими формулами KPI.
//
// Сама арифметика лежит в convex/kpiMath.ts — её же использует сервер при
// закрытии месяца. Здесь только доменные типы фронта: держать вторую копию
// формул нельзя, расхождение выразилось бы в деньгах.

import type { Campaign, SmmMetric } from '@/types'
import {
  computeSmmMath,
  computeTargetologMath,
  computeSalesMath,
  payoutOf,
  DEFAULT_WEIGHTS,
  type KpiWeights,
} from '../../convex/kpiMath'

export { DEFAULT_WEIGHTS, computeSalesMath }
export type { KpiWeights }

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
  return computeSmmMath(metrics)
}

// ————————————————————————————————————————————————
// Таргетолог
// ————————————————————————————————————————————————

export interface CampaignResult {
  campaign: Campaign
  planCpl: number
  factCpl: number
  budgetPct: number // Факт/План бюджета (информативно)
  leadsPct: number // МИН(Факт заявок/План заявок; 1)
  cplEff: number // МИН(План CPL/Факт CPL; 1)
  kpi: number // KPI кампании = заявки%×вес + CPLэфф×вес
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

export function computeTargetolog(
  campaigns: Campaign[],
  weights: KpiWeights = DEFAULT_WEIGHTS,
): TargetologResult {
  return computeTargetologMath(campaigns, weights)
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
export const payout = payoutOf
