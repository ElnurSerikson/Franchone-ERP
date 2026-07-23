import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'
import { authTables } from '@convex-dev/auth/server'

// Модель данных FRANCHONE ERP. Отражает src/types.ts.
// Связи между сущностями — через v.id("employees").

export default defineSchema({
  // Таблицы авторизации Convex Auth (users, authAccounts, authSessions, ...)
  ...authTables,

  employees: defineTable({
    name: v.string(),
    role: v.union(v.literal('owner'), v.literal('head'), v.literal('employee')),
    position: v.union(
      v.literal('smm'),
      v.literal('targetolog'),
      v.literal('sales'),
      v.literal('packer'),
    ),
    positionLabel: v.string(),
    department: v.string(),
    salary: v.number(), // оклад, ₸
    email: v.string(), // хранится в нижнем регистре — это же логин (инвайт)
    phone: v.string(),
    avatarColor: v.string(),
    initials: v.string(),
    status: v.union(v.literal('active'), v.literal('archived')),
    hiredAt: v.string(),
    lastLoginAt: v.optional(v.number()), // время последнего входа
  })
    .index('by_status', ['status'])
    .index('by_email', ['email']),

  // KPI SMM — по одной строке на аккаунт×формат для сотрудника-SMM
  smmMetrics: defineTable({
    employeeId: v.id('employees'),
    account: v.union(v.literal('FRANCHONE'), v.literal('ANUAR')),
    format: v.union(v.literal('Рилсы'), v.literal('Сторис'), v.literal('Карусели')),
    weight: v.number(),
    weekPlans: v.array(v.number()), // 5 недель
    weekFacts: v.array(v.number()), // 5 недель
  }).index('by_employee', ['employeeId']),

  // KPI Таргетолог — рекламные кампании
  campaigns: defineTable({
    code: v.string(), // человеко-читаемый ID, напр. FR-001
    employeeId: v.optional(v.id('employees')),
    account: v.string(),
    category: v.string(),
    brand: v.string(),
    campaign: v.string(),
    moneySource: v.union(v.literal('FRANCHONE'), v.literal('Партнёр')),
    status: v.union(v.literal('Активна'), v.literal('Пауза'), v.literal('Завершена')),
    weight: v.number(),
    planBudget: v.number(),
    planLeads: v.number(),
    factBudget: v.number(),
    factLeads: v.number(),
  }).index('by_code', ['code']),

  // Задачи (Kanban). Статусы по ТЗ: assigned / in_progress / done.
  tasks: defineTable({
    title: v.string(),
    description: v.optional(v.string()),
    status: v.union(
      v.literal('assigned'),
      v.literal('in_progress'),
      v.literal('done'),
    ),
    priority: v.union(
      v.literal('low'),
      v.literal('medium'),
      v.literal('high'),
      v.literal('urgent'),
    ),
    assigneeId: v.id('employees'),
    reporterId: v.id('employees'),
    deadline: v.string(), // срок (YYYY-MM-DD)
    completedAt: v.optional(v.number()), // фактическая дата завершения
    completedOnTime: v.optional(v.boolean()), // в срок / с опозданием
    tags: v.array(v.string()),
    checklist: v.array(v.object({ text: v.string(), done: v.boolean() })),
    attachments: v.number(), // денормализованный счётчик
    comments: v.number(), // денормализованный счётчик
    kpiRef: v.optional(v.string()),
  })
    .index('by_status', ['status'])
    .index('by_assignee', ['assigneeId']),

  // Комментарии к задаче
  taskComments: defineTable({
    taskId: v.id('tasks'),
    authorId: v.id('employees'),
    text: v.string(),
  }).index('by_task', ['taskId']),

  // История изменений задачи (создание, смена статуса, смена исполнителя)
  taskEvents: defineTable({
    taskId: v.id('tasks'),
    type: v.union(v.literal('created'), v.literal('status'), v.literal('assignee')),
    fromStatus: v.optional(v.string()),
    toStatus: v.optional(v.string()),
    note: v.optional(v.string()),
    byId: v.id('employees'),
  }).index('by_task', ['taskId']),

  // Вложения к задаче: ссылки и файлы (Convex storage)
  taskAttachments: defineTable({
    taskId: v.id('tasks'),
    kind: v.union(v.literal('file'), v.literal('link')),
    name: v.string(),
    url: v.optional(v.string()),
    storageId: v.optional(v.id('_storage')),
    byId: v.id('employees'),
  }).index('by_task', ['taskId']),

  // Входы сотрудников (для контроля активности/дисциплины)
  loginEvents: defineTable({
    employeeId: v.id('employees'),
    at: v.number(), // время входа (ms)
  }).index('by_employee', ['employeeId']),

  // Ежедневные отчёты сотрудников (§3). Одна запись = сотрудник × дата.
  // Состав payload зависит от должности; заполнен только соответствующий блок.
  dailyReports: defineTable({
    employeeId: v.id('employees'),
    position: v.union(
      v.literal('smm'),
      v.literal('targetolog'),
      v.literal('sales'),
    ),
    date: v.string(), // календарная дата отчёта (YYYY-MM-DD)
    submittedAt: v.number(), // время первой отправки (ms)
    onTime: v.boolean(), // отправлен ли вовремя (до дедлайна дня)
    editedAt: v.optional(v.number()), // время последней правки после отправки
    editedById: v.optional(v.id('employees')),
    editCount: v.number(),
    // Кто и когда: отправка + все правки
    history: v.array(
      v.object({
        at: v.number(),
        byId: v.id('employees'),
        action: v.union(v.literal('submitted'), v.literal('edited')),
      }),
    ),
    // ——— payload по должности ———
    // SMM: строки «страница × тип контента × количество»
    smm: v.optional(
      v.array(
        v.object({ page: v.string(), type: v.string(), count: v.number() }),
      ),
    ),
    // Таргетолог: строки по активным кампаниям
    targetolog: v.optional(
      v.array(
        v.object({
          project: v.string(),
          campaign: v.string(),
          budget: v.number(),
          leads: v.number(),
        }),
      ),
    ),
    // Отдел продаж: базовый набор метрик (уточняется заказчиком)
    sales: v.optional(
      v.object({
        leads: v.number(), // обработано заявок
        meetings: v.number(), // звонки / встречи
        sales: v.number(), // продаж, шт
        revenue: v.number(), // сумма продаж, ₸
        note: v.optional(v.string()),
      }),
    ),
  })
    .index('by_employee', ['employeeId'])
    .index('by_employee_date', ['employeeId', 'date'])
    .index('by_date', ['date']),

  // Настройки (одна запись-синглтон с key = "global")
  settings: defineTable({
    key: v.string(),
    leadWeight: v.number(), // вес заявок (0.7)
    cplWeight: v.number(), // вес CPL (0.3)
    reportMonth: v.string(),
    reportDeadlineTime: v.optional(v.string()), // дедлайн дневного отчёта, «HH:MM» (Алматы)
  }).index('by_key', ['key']),
})
