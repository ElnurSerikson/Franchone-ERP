import type { Campaign, Employee, SmmMetric, Task } from '@/types'
import { computeSmm, computeTargetolog, payout } from './kpi'
import { TODAY } from './constants'

export interface EmployeeKpi {
  employee: Employee
  kpi: number | null // null = модель KPI ещё не настроена
  payout: number | null
}

export function employeeKpi(
  emp: Employee,
  smmMetrics: SmmMetric[],
  campaigns: Campaign[],
): EmployeeKpi {
  if (emp.role === 'owner') return { employee: emp, kpi: null, payout: null }
  if (emp.position === 'smm') {
    const kpi = computeSmm(smmMetrics).totalKpi
    return { employee: emp, kpi, payout: payout(emp.salary, kpi) }
  }
  if (emp.position === 'targetolog') {
    const kpi = computeTargetolog(campaigns).totalKpi
    return { employee: emp, kpi, payout: payout(emp.salary, kpi) }
  }
  // Продажи / Упаковка — KPI-модель в разработке
  return { employee: emp, kpi: null, payout: null }
}

export const isOverdue = (t: Task) => t.status !== 'done' && t.deadline < TODAY

export function taskCounts(list: Task[]) {
  return {
    total: list.length,
    active: list.filter((t) => t.status !== 'done').length,
    done: list.filter((t) => t.status === 'done').length,
    overdue: list.filter(isOverdue).length,
  }
}
