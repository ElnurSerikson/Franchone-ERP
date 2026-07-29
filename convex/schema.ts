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
    // slug должности из справочника positions. Свободная строка (не union),
    // т.к. владелец заводит свои должности; KPI-модель определяется по slug.
    position: v.string(),
    positionLabel: v.string(),
    department: v.string(), // название отдела из справочника departments
    salary: v.number(), // оклад, ₸
    email: v.string(), // хранится в нижнем регистре — это же логин (инвайт)
    phone: v.string(),
    avatarColor: v.string(),
    initials: v.string(),
    status: v.union(v.literal('active'), v.literal('archived')),
    hiredAt: v.string(),
    // Telegram для уведомлений (§11/§2). Пока хранится; заработает с модулем №2.
    telegram: v.optional(v.string()),
    lastLoginAt: v.optional(v.number()), // время последнего входа
    // Скрытый служебный аккаунт (напр. разработчик): имеет доступ по роли,
    // но не показывается ни в одном списке фронта (Команда/KPI/Активность/…).
    hidden: v.optional(v.boolean()),
  })
    .index('by_status', ['status'])
    .index('by_email', ['email']),

  // Справочник отделов (§11: «управлять отделами»). Название — то, что
  // хранится в employees.department. Владелец ведёт список в Настройках.
  departments: defineTable({
    name: v.string(),
  }),

  // Матрица прав (§9): что разрешено роли head/employee. Владелец не хранится —
  // у него всегда всё. Нет строки для роли — действуют дефолты из permModel.
  rolePermissions: defineTable({
    role: v.union(v.literal('head'), v.literal('employee')),
    allowed: v.array(v.string()), // ключи «section:action»
  }).index('by_role', ['role']),

  // Справочник должностей (§11: «управлять должностями»). slug кладётся в
  // employees.position; kpiModel определяет формулу KPI. У новых должностей
  // модели нет ('none') — её добавляют кодом. Встроенные (smm/targetolog/sales)
  // защищены от удаления: на них завязан расчёт KPI.
  positions: defineTable({
    slug: v.string(),
    label: v.string(),
    kpiModel: v.union(
      v.literal('smm'),
      v.literal('targetolog'),
      v.literal('sales'),
      v.literal('none'),
    ),
    builtin: v.optional(v.boolean()),
  }).index('by_slug', ['slug']),

  // KPI SMM — по одной строке на аккаунт×формат для сотрудника-SMM
  // Строка плана SMM «аккаунт × формат» на месяц (лист «Недельные планы»).
  // employeeId необязателен: план задан на должность, а не на человека —
  // факт собирается из отчётов всех SMM за месяц, см. smm.list.
  smmMetrics: defineTable({
    employeeId: v.optional(v.id('employees')),
    account: v.union(v.literal('FRANCHONE'), v.literal('ANUAR')),
    format: v.union(v.literal('Рилсы'), v.literal('Сторис'), v.literal('Карусели')),
    weight: v.number(),
    weekPlans: v.array(v.number()), // 5 недель
    weekFacts: v.array(v.number()), // 5 недель, производные — не источник правды
    month: v.optional(v.string()), // месяц данных, YYYY-MM
  }).index('by_employee', ['employeeId']),

  // KPI Таргетолог — рекламные кампании
  // Реестр рекламных кампаний (лист «Реестр кампаний»): карточка заводится
  // один раз и живёт месяцами. Месячные план и вес — в campaignPlans,
  // факт нигде не хранится: он собирается из ежедневных отчётов.
  campaigns: defineTable({
    code: v.string(), // человеко-читаемый ID, напр. FR-001
    account: v.string(),
    category: v.string(),
    brand: v.string(),
    campaign: v.string(),
    moneySource: v.union(v.literal('FRANCHONE'), v.literal('Партнёр')),
    // Цель кампании — задаётся при создании и неизменна; определяет метрику
    // отчёта (§3.2). optional: у кампаний, созданных до доработки, ещё не задана.
    goal: v.optional(
      v.union(
        v.literal('msg_inst'),
        v.literal('msg_wa'),
        v.literal('reach'),
        v.literal('profile'),
        v.literal('site_leads'),
      ),
    ),
    status: v.union(v.literal('Активна'), v.literal('Пауза'), v.literal('Завершена')),
    startedAt: v.optional(v.string()), // YYYY-MM-DD
    endedAt: v.optional(v.string()),
    note: v.optional(v.string()),
    // Софт-делит: кампания исчезает из всех списков, но запись и связанные
    // отчёты остаются в базе — чтобы расчёты прошлых месяцев не разъехались.
    archived: v.optional(v.boolean()),
  }).index('by_code', ['code']),

  // План на месяц по кампании (лист «Планы по месяцам»): план бюджета,
  // план заявок и вес в KPI. План CPL — производный, план/заявки.
  campaignPlans: defineTable({
    campaignId: v.id('campaigns'),
    // Владелец кампании-плана: KPI персональный, план принадлежит таргетологу.
    employeeId: v.optional(v.id('employees')),
    month: v.string(), // YYYY-MM
    planBudget: v.number(),
    planLeads: v.number(),
    weight: v.number(),
  })
    .index('by_month', ['month'])
    .index('by_campaign', ['campaignId'])
    .index('by_employee', ['employeeId']),

  // План выручки отдела продаж — персональный, на сотрудника и месяц.
  // KPI продаж = МИН(факт выручки / план; 1). Факт берётся из его отчётов.
  salesPlans: defineTable({
    employeeId: v.id('employees'),
    month: v.string(), // YYYY-MM
    planRevenue: v.number(),
  })
    .index('by_month', ['month'])
    .index('by_employee', ['employeeId']),

  // Справочник объектов продаж: франшизы, услуги и другие продукты, по которым
  // отдел продаж ведёт отдельные планы, отчёты и LIVE-воронки.
  salesObjects: defineTable({
    name: v.string(),
    type: v.union(
      v.literal('franchise'),
      v.literal('service'),
      v.literal('product'),
    ),
    status: v.union(v.literal('active'), v.literal('paused'), v.literal('archived')),
    managerIds: v.array(v.id('employees')),
    createdAt: v.number(),
    comment: v.optional(v.string()),
  }).index('by_status', ['status']),

  // Настройка месяца продаж: продаётся ли объект в выбранном месяце, кто за
  // него отвечает и какой план сделок у каждого назначенного менеджера.
  salesObjectMonths: defineTable({
    objectId: v.id('salesObjects'),
    month: v.string(), // YYYY-MM
    status: v.union(v.literal('selling'), v.literal('not_selling')),
    managerPlans: v.array(
      v.object({
        managerId: v.id('employees'),
        planDeals: v.number(),
      }),
    ),
  })
    .index('by_month', ['month'])
    .index('by_object', ['objectId'])
    .index('by_object_month', ['objectId', 'month']),

  // Дневные агрегированные показатели отдела продаж по связке
  // дата × менеджер × объект продаж. Один объект в один день сохраняется
  // повторно как правка, без дублей.
  salesObjectReports: defineTable({
    employeeId: v.id('employees'),
    objectId: v.id('salesObjects'),
    date: v.string(), // YYYY-MM-DD
    month: v.string(), // YYYY-MM
    newLeads: v.number(),
    processedLeads: v.number(),
    newConsultations: v.number(),
    repeatConsultations: v.number(),
    newMeetings: v.number(),
    repeatMeetings: v.number(),
    newPrepayments: v.number(),
    newDeals: v.number(),
    revenue: v.number(),
    comment: v.optional(v.string()),
    submittedAt: v.number(),
    editedAt: v.optional(v.number()),
    editCount: v.number(),
  })
    .index('by_month', ['month'])
    .index('by_employee', ['employeeId'])
    .index('by_object', ['objectId'])
    .index('by_employee_date_object', ['employeeId', 'date', 'objectId']),

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
    deadline: v.optional(v.string()), // срок (YYYY-MM-DD); может отсутствовать
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
    // Владелец удалил отчёт и переоткрыл день: цифры очищены, сотрудник
    // дозаполняет заново — повторная сдача пойдёт «с опозданием».
    reopened: v.optional(v.boolean()),
    deletedAt: v.optional(v.number()),
    deletedById: v.optional(v.id('employees')),
    // Кто и когда: отправка, правки, создание владельцем, удаление
    history: v.array(
      v.object({
        at: v.number(),
        byId: v.id('employees'),
        action: v.union(
          v.literal('submitted'),
          v.literal('edited'),
          v.literal('created'), // владелец внёс за пропущенный день
          v.literal('deleted'), // владелец удалил, день переоткрыт
        ),
      }),
    ),
    // Свободный комментарий к отчёту: ссылка на опубликованное, пояснение.
    note: v.optional(v.string()),
    // ——— payload по должности ———
    // SMM: строки «страница × тип контента × количество»
    smm: v.optional(
      v.array(
        v.object({ page: v.string(), type: v.string(), count: v.number() }),
      ),
    ),
    // Таргетолог: строка на каждую активную кампанию из реестра.
    // Кампания опознаётся по code — свободный текст не сматчить с планом.
    targetolog: v.optional(
      v.array(
        v.object({
          code: v.string(),
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
    // Базы выплат — ячейка «Оклад» на дашбордах KPI_SMM / KPI_TARGETOLOG.
    // Оклад привязан к должности, а не к человеку: KPI считается по отделу.
    salarySmm: v.optional(v.number()),
    salaryTargetolog: v.optional(v.number()),
    salarySales: v.optional(v.number()),
    // План выручки отдела продаж на месяц: KPI = МИН(факт/план; 1).
    planRevenueSales: v.optional(v.number()),
    reportMonth: v.string(),
    reportDeadlineTime: v.optional(v.string()), // дедлайн дневного отчёта, «HH:MM» (Алматы)
  }).index('by_key', ['key']),

  // ——— Закрытие месяца (§5: «сохранять итоговые показатели и начисления в архиве») ———
  // Пока месяц открыт, KPI и выплата пересчитываются из живых данных. После
  // закрытия цифры фиксируются снапшотом: правка старого отчёта или смена
  // оклада задним числом больше не меняют уже начисленное.
  monthClosures: defineTable({
    month: v.string(), // YYYY-MM
    closed: v.boolean(), // false — месяц переоткрыт
    closedAt: v.number(),
    // Кто закрыл. Пусто — закрыл планировщик 1-го числа.
    byId: v.optional(v.id('employees')),
    history: v.array(
      v.object({
        at: v.number(),
        action: v.union(
          v.literal('closed'),
          v.literal('reopened'),
          v.literal('recalculated'),
        ),
        byId: v.optional(v.id('employees')),
        auto: v.boolean(),
      }),
    ),
  }).index('by_month', ['month']),

  // Начисления на момент закрытия. Имя и должность копируем в строку:
  // сотрудник может уволиться или сменить должность, а архив обязан
  // остаться читаемым в том виде, в каком его закрывали.
  payrollSnapshots: defineTable({
    month: v.string(),
    employeeId: v.id('employees'),
    name: v.string(),
    positionLabel: v.string(),
    position: v.string(),
    kpi: v.number(),
    salary: v.number(),
    payout: v.number(),
    planTotal: v.optional(v.number()), // план месяца в единицах должности
    factTotal: v.optional(v.number()),
  }).index('by_month', ['month']),
})
