// Доменные типы FRANCHONE ERP

export type Role = 'owner' | 'head' | 'employee'

// Должность — slug из справочника (владелец заводит свои). KPI-модель
// определяется по slug на сервере; известные с моделью — smm/targetolog/sales.
export type Position = string

export interface Employee {
  id: string
  name: string
  role: Role
  position: Position
  positionLabel: string
  department: string
  salary: number // оклад, ₸
  email: string
  phone: string
  avatarColor: string
  initials: string
  status: 'active' | 'archived'
  hiredAt: string
  telegram?: string
}

// ——— SMM KPI ———
export interface SmmMetric {
  id: string
  account: 'FRANCHONE' | 'ANUAR'
  format: 'Рилсы' | 'Сторис' | 'Карусели'
  weight: number // вес
  weekPlans: number[] // план по 5 неделям
  weekFacts: number[] // факт по 5 неделям
}

// ——— Таргетолог KPI ———
export type MoneySource = 'FRANCHONE' | 'Партнёр'

export interface Campaign {
  id: string
  account: string
  // Устарели: их роль выполняет объект продаж (ТЗ таргетолога §2.2).
  category?: string
  brand?: string
  campaign: string
  moneySource: MoneySource
  goal?: string // цель кампании (slug); определяет метрику отчёта
  status: 'Активна' | 'Пауза' | 'Завершена'
  weight: number // вес KPI
  planBudget: number
  planLeads: number
  factBudget: number
  factLeads: number
}

// ——— Задачи (Kanban) ———
export type TaskStatus = 'assigned' | 'in_progress' | 'done'
export type Priority = 'low' | 'medium' | 'high' | 'urgent'

export interface ChecklistItem {
  id: string
  text: string
  done: boolean
}

export interface Task {
  id: string
  title: string
  description?: string
  status: TaskStatus
  priority: Priority
  assigneeId: string
  reporterId: string
  deadline?: string // срок необязателен
  completedAt?: number
  completedOnTime?: boolean
  tags: string[]
  checklist: ChecklistItem[]
  attachments: number
  comments: number
  kpiRef?: string
  // Объект продаж задачи (§4.2 ТЗ Telegram). Необязателен.
  objectId?: string
}

// ——— Ежедневная отчётность (§3) ———
export type ReportPosition = 'smm' | 'targetolog' | 'sales'

export interface SmmRow {
  page: string
  type: string
  count: number
}

// Строка отчёта таргетолога: кампания опознаётся по ID из реестра.
export interface TargetologRow {
  code: string
  budget: number
  leads: number
}

export interface SalesPayload {
  leads: number // обработано заявок
  meetings: number // звонки / встречи
  sales: number // продаж, шт
  revenue: number // сумма продаж, ₸
  note?: string
}
