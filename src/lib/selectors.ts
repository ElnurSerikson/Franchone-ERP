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

// Статистика задач по сотруднику (§1 ТЗ).
export interface TaskStats {
  employee: Employee
  total: number // поставлено (назначено сотруднику)
  active: number // не завершено
  done: number // выполнено
  onTime: number // в срок
  late: number // с опозданием
  overdue: number // просрочено и не выполнено
  completionPct: number // выполнено / поставлено
  onTimePct: number // в срок / выполнено
}

export function taskStatsByEmployee(tasks: Task[], employees: Employee[]): TaskStats[] {
  return employees
    .map((e) => {
      const mine = tasks.filter((t) => t.assigneeId === e.id)
      const done = mine.filter((t) => t.status === 'done')
      const onTime = done.filter((t) => t.completedOnTime).length
      const late = done.filter((t) => t.completedOnTime === false).length
      return {
        employee: e,
        total: mine.length,
        active: mine.filter((t) => t.status !== 'done').length,
        done: done.length,
        onTime,
        late,
        overdue: mine.filter(isOverdue).length,
        completionPct: mine.length ? done.length / mine.length : 0,
        onTimePct: done.length ? onTime / done.length : 0,
      }
    })
    .filter((s) => s.total > 0)
}
