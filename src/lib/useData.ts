// Единая точка чтения данных из Convex. Возвращает уже отображённые
// в доменные типы массивы + флаг загрузки. Convex дедуплицирует одинаковые
// запросы, поэтому хук можно звать в нескольких местах без накладных расходов.
import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { mapCampaign, mapEmployee, mapSmm, mapTask } from './mappers'
import { CURRENT_MONTH, formatMonth } from './month'

export function useData() {
  const employeesRaw = useQuery(api.employees.list, {})
  const tasksRaw = useQuery(api.tasks.list, {})
  // Месяц обязателен: без него campaigns.list отдаёт пустой список, а smm.list —
  // сохранённые нули вместо факта, собранного из ежедневных отчётов.
  const campaignsRaw = useQuery(api.campaigns.list, { month: CURRENT_MONTH })
  const smmRaw = useQuery(api.smm.list, { month: CURRENT_MONTH })

  const loading =
    employeesRaw === undefined ||
    tasksRaw === undefined ||
    campaignsRaw === undefined ||
    smmRaw === undefined

  const employees = (employeesRaw ?? []).map(mapEmployee)

  return {
    loading,
    // employees — все (включая деактивированных): нужны для «Команды» и для
    // подстановки имён в старых задачах/статистике.
    employees,
    // activeEmployees — для рабочих мест: дашборд, выплаты, выбор исполнителя.
    activeEmployees: employees.filter((e) => e.status === 'active'),
    tasks: (tasksRaw ?? []).map(mapTask),
    campaigns: (campaignsRaw ?? []).map(mapCampaign),
    smmMetrics: (smmRaw ?? []).map(mapSmm),
    // ТЗ СИСТЕМА §1.1: по умолчанию везде текущий календарный месяц, и с
    // наступлением нового система переключается сама. Строка из настроек
    // больше не используется — она замораживала подпись на одном месяце.
    reportMonth: formatMonth(CURRENT_MONTH),
  }
}
