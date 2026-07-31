import type { Employee, Task } from '@/types'
import { TODAY } from './constants'

// Задача без срока не бывает просроченной, срочной или «на сегодня» —
// её просто не по чему сравнивать с датой.
export const isOverdue = (t: Task) => t.status !== 'done' && !!t.deadline && t.deadline < TODAY

// Срок наступает в ближайшие `days` дней (не считая просроченных и сегодняшних).
export function isDueSoon(t: Task, days: number): boolean {
  if (t.status === 'done' || !t.deadline) return false
  const limit = new Date(Date.parse(`${TODAY}T00:00:00Z`) + days * 86400000)
    .toISOString()
    .slice(0, 10)
  return t.deadline > TODAY && t.deadline <= limit
}

export const isDueToday = (t: Task) => t.status !== 'done' && t.deadline === TODAY

// Успеваемость за месяц — все семь показателей §1 ТЗ по одному набору задач.
// Набор — задачи со сроком в этом месяце, то есть «что нужно было закрыть».
// Общий знаменатель важен: иначе «поставлено» и «выполнено» считались бы по
// разным множествам и процент выполнения ничего бы не значил.
export function monthTaskStats(tasks: Task[], month: string) {
  // Задачи без срока в набор месяца не попадают — их не с чем соотнести.
  const scope = tasks.filter((t) => t.deadline?.slice(0, 7) === month)
  const done = scope.filter((t) => t.status === 'done')
  const onTime = done.filter((t) => t.completedOnTime).length
  const late = done.filter((t) => t.completedOnTime === false).length
  return {
    total: scope.length, // поставлено
    done: done.length, // выполнено
    onTime, // выполнено в срок
    late, // выполнено с опозданием
    overdue: scope.filter(isOverdue).length, // просрочено и не выполнено
    completionPct: scope.length ? done.length / scope.length : 0,
    onTimePct: done.length ? onTime / done.length : 0,
  }
}

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

// Личный план месяца из авторитетного расчёта начислений (одна строка
// сотрудника). null — модели/плана KPI нет, блоки не показываем.
export function personalPlan(
  me: Employee,
  row?: { kpi: number; payout: number; salary: number; planTotal?: number; factTotal?: number },
) {
  if (!row) return null
  const target = row.planTotal ?? 0
  const fact = row.factTotal ?? 0
  const caption =
    me.position === 'smm'
      ? 'публикаций по плану месяца'
      : me.position === 'targetolog'
        ? 'заявок по плану месяца'
        : me.position === 'sales'
          ? 'выручка по плану месяца, ₸'
          : 'план месяца'
  return {
    kpi: row.kpi,
    ratio: target ? Math.min(fact / target, 1) : 0,
    fact,
    target,
    caption,
    salary: row.salary,
    earned: row.payout,
  }
}
