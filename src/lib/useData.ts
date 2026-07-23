// Единая точка чтения данных из Convex. Возвращает уже отображённые
// в доменные типы массивы + флаг загрузки. Convex дедуплицирует одинаковые
// запросы, поэтому хук можно звать в нескольких местах без накладных расходов.
import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { mapCampaign, mapEmployee, mapSmm, mapTask } from './mappers'
import { REPORT_MONTH_FALLBACK } from './constants'

export function useData() {
  const employeesRaw = useQuery(api.employees.list, {})
  const tasksRaw = useQuery(api.tasks.list, {})
  const campaignsRaw = useQuery(api.campaigns.list, {})
  const smmRaw = useQuery(api.smm.list, {})
  const settings = useQuery(api.settings.get, {})

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
    reportMonth: settings?.reportMonth ?? REPORT_MONTH_FALLBACK,
  }
}
