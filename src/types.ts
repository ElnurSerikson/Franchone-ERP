// Доменные типы FRANCHONE ERP

export type Role = 'owner' | 'head' | 'employee'

export type Position = 'smm' | 'targetolog' | 'sales' | 'packer' | 'developer'

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
  category: string
  brand: string
  campaign: string
  moneySource: MoneySource
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
  deadline: string
  completedAt?: number
  completedOnTime?: boolean
  tags: string[]
  checklist: ChecklistItem[]
  attachments: number
  comments: number
  kpiRef?: string
}

// ——— Ежедневная отчётность (§3) ———
export type ReportPosition = 'smm' | 'targetolog' | 'sales'

export interface SmmRow {
  page: string
  type: string
  count: number
}

export interface TargetologRow {
  project: string
  campaign: string
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
