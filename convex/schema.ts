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
    // УСТАРЕЛО. Видимый ID вида FR-001 убран из интерфейса (дополнение
    // «Модуль таргетолога» §2.7): кампанию опознают по ручному названию, а
    // связь с отчётами держит внутренний _id. У старых карточек поле осталось
    // — стирать его незачем, но новым он не присваивается.
    code: v.optional(v.string()),
    account: v.string(),
    // Объект продаж, который рекламирует кампания. Справочник общий с отделом
    // продаж (ТЗ таргетолога §6, §13) — так одна франшиза видна и в рекламных,
    // и в продажных отчётах. optional: у кампаний, заведённых до связки, его
    // ещё нет, и историю за прошлые месяцы терять нельзя.
    objectId: v.optional(v.id('salesObjects')),
    // Позиция внутри статусной группы реестра: таргетолог двигает кампании
    // стрелками (§7.3). Меньше — выше.
    sortOrder: v.optional(v.number()),
    // УСТАРЕЛО. Свободные «Категория» и «Бренд / услуга» заменены объектом
    // продаж (§2.2 — прямо исключены из первой версии). Оставлены
    // необязательными ради старых карточек; в новых не заполняются.
    category: v.optional(v.string()),
    brand: v.optional(v.string()),
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
        v.literal('engagement'),
      ),
    ),
    status: v.union(v.literal('Активна'), v.literal('Пауза'), v.literal('Завершена')),
    startedAt: v.optional(v.string()), // YYYY-MM-DD
    endedAt: v.optional(v.string()),
    note: v.optional(v.string()),
    // Софт-делит: кампания исчезает из всех списков, но запись и связанные
    // отчёты остаются в базе — чтобы расчёты прошлых месяцев не разъехались.
    archived: v.optional(v.boolean()),
  })
    .index('by_code', ['code'])
    .index('by_object', ['objectId']),

  // История статусов кампании (§5, §10.1): для каждого перехода Активна →
  // Пауза → Завершена хранится дата и время. Нужна, чтобы через месяцы можно
  // было восстановить, когда именно кампания работала.
  campaignStatusHistory: defineTable({
    campaignId: v.id('campaigns'),
    from: v.optional(v.string()), // пусто — это первая запись при создании
    to: v.string(),
    at: v.number(),
    byId: v.id('employees'),
  }).index('by_campaign', ['campaignId']),

  // Заголовок ежедневного отчёта таргетолога (§16: target_daily_reports).
  // Отдельная сущность, а не блок внутри dailyReports: у отчёта своя
  // блокировка после отправки и свой журнал административных правок.
  targetReports: defineTable({
    employeeId: v.id('employees'),
    date: v.string(), // YYYY-MM-DD
    month: v.string(), // YYYY-MM
    submittedAt: v.optional(v.number()), // пусто — черновик, ещё не отправлен
    comment: v.optional(v.string()),
  })
    .index('by_employee_date', ['employeeId', 'date'])
    .index('by_month', ['month']),

  // Строка отчёта: одна кампания за одну дату (§16: target_daily_report_rows).
  // Бюджет — в ЦЕЛЫХ ЦЕНТАХ: §15 запрещает float для денег, а в Convex других
  // числовых типов нет. Цена результата не хранится — она производная и
  // считается из бюджета и результата, чтобы не разъехаться с ними.
  targetReportRows: defineTable({
    reportId: v.id('targetReports'),
    campaignId: v.id('campaigns'),
    date: v.string(), // дублируем для выборок по периоду без джойна
    budgetCents: v.number(),
    result: v.number(), // целое неотрицательное; единица зависит от цели
  })
    .index('by_report', ['reportId'])
    .index('by_campaign', ['campaignId'])
    .index('by_date', ['date']),

  // Журнал административных исправлений (§9.3, §16). Отправленный отчёт
  // правит только администратор и только с указанием причины; старое и новое
  // значения сохраняются.
  targetReportAudit: defineTable({
    rowId: v.id('targetReportRows'),
    campaignId: v.id('campaigns'),
    at: v.number(),
    byId: v.id('employees'),
    reason: v.string(),
    fromBudgetCents: v.number(),
    toBudgetCents: v.number(),
    fromResult: v.number(),
    toResult: v.number(),
  }).index('by_row', ['rowId']),

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
    // Кто завёл объект (§6.2 ТЗ таргетолога). optional: у объектов, созданных
    // до появления поля, автора уже не восстановить.
    createdBy: v.optional(v.id('employees')),
    comment: v.optional(v.string()),
  }).index('by_status', ['status']),

  // Настройка месяца продаж: продаётся ли объект в выбранном месяце, кто за
  // него отвечает, какой у него статус в этом месяце и какой план сделок у
  // каждого назначенного менеджера.
  salesObjectMonths: defineTable({
    objectId: v.id('salesObjects'),
    month: v.string(), // YYYY-MM
    objectStatus: v.optional(v.union(v.literal('active'), v.literal('paused'), v.literal('archived'))),
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
    // Ручной ввод «Обработано новых заявок» отменён (дополнение 1.4, п.6):
    // разрыв теперь считается как заявки − консультации. Поле оставлено
    // опциональным — у старых отчётов значение есть, и стирать его нельзя.
    processedLeads: v.optional(v.number()),
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
    // Диапазон дат для Live-воронки: ТЗ разрешает выбирать не только месяц,
    // но и «последние 7/14 дней», конкретный день и произвольный период.
    .index('by_date', ['date'])
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
    // §9 ТЗ Telegram: откуда создана запись. Для аудита; на поведение не влияет.
    source: v.optional(v.string()),
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

  // ——— Планы и заявки таргетолога (ТАРГЕТ 1.6) ———
  //
  // Ключевой принцип дополнения: рекламные кампании оцениваются по своим
  // техническим результатам, а эффективность маркетинга объекта — по общему
  // расходу и общему числу новых заявок за тот же период. Поэтому заявки
  // живут отдельным слоем и НЕ распределяются по кампаниям, целям и
  // объявлениям (§2, §14: это исключает ложную атрибуцию).

  // План заявок на «таргетолог × объект продаж × месяц» (§3). Для этой тройки
  // может существовать только один активный план. Планы можно заводить
  // заранее на будущие месяцы.
  targetLeadPlans: defineTable({
    employeeId: v.id('employees'),
    objectId: v.id('salesObjects'),
    month: v.string(), // YYYY-MM
    planLeads: v.number(), // целое положительное
    // §4: плановый бюджет необязателен. Без него KPI по заявкам продолжает
    // работать, не показывается только плановая цена заявки и план-факт денег.
    // В ЦЕНТАХ — как и весь рекламный бюджет (§15 основного ТЗ).
    planBudgetCents: v.optional(v.number()),
  })
    .index('by_month', ['month'])
    .index('by_employee_month', ['employeeId', 'month'])
    .index('by_object_month', ['objectId', 'month']),

  // Второй ежедневный отчёт таргетолога: сколько новых заявок пришло по
  // каждому активному объекту за день (§6, §7). Уровень хранения —
  // «дата → таргетолог → объект продаж», без каналов, источников, целей и
  // кампаний: это и исключает двойной учёт.
  targetLeadReports: defineTable({
    employeeId: v.id('employees'),
    objectId: v.id('salesObjects'),
    date: v.string(), // YYYY-MM-DD
    month: v.string(), // YYYY-MM
    leads: v.number(), // целое неотрицательное; 0 — «отчёт заполнен, заявок не было»
    // §7: система сама фиксирует, когда и кто менял значение.
    updatedAt: v.number(),
    updatedById: v.id('employees'),
  })
    .index('by_date', ['date'])
    .index('by_month', ['month'])
    .index('by_employee_date', ['employeeId', 'date'])
    .index('by_employee_date_object', ['employeeId', 'date', 'objectId'])
    .index('by_object', ['objectId']),

  // Журнал изменений планов и фактических заявок (§15): старое значение, новое
  // значение, дата, время и пользователь.
  targetLeadAudit: defineTable({
    kind: v.union(v.literal('plan'), v.literal('leads')),
    employeeId: v.id('employees'),
    objectId: v.id('salesObjects'),
    // Месяц для плана, конкретная дата для заявок.
    period: v.string(),
    at: v.number(),
    byId: v.id('employees'),
    fromLeads: v.optional(v.number()),
    toLeads: v.optional(v.number()),
    fromBudgetCents: v.optional(v.number()),
    toBudgetCents: v.optional(v.number()),
  })
    .index('by_kind_period', ['kind', 'period'])
    .index('by_object', ['objectId']),

  // ——— Встречи (ТЗ СИСТЕМА §4) ———
  //
  // Внутренняя напоминалка коллектива: любой сотрудник создаёт встречу и
  // приглашает коллег, встреча появляется в их разделе. История хранится
  // бессрочно и после наступления даты не удаляется (§4.5).
  //
  // §4.8 — границы первой версии: статусов встречи нет, подтверждения и
  // отклонения участия нет, повторяющихся встреч нет, внешних календарей нет.
  // Система фиксирует ФАКТ ПРИГЛАШЕНИЯ, а не присутствие (§4.6).
  meetings: defineTable({
    title: v.string(),
    date: v.string(), // YYYY-MM-DD
    time: v.string(), // HH:MM, время начала
    place: v.optional(v.string()),
    // Ссылка на адрес или геолокацию 2GIS.
    mapUrl: v.optional(v.string()),
    comment: v.optional(v.string()),
    createdById: v.id('employees'),
    // Создатель автоматически считается участником (§4.2) и всегда входит
    // в этот список — по нему строится выборка «мои встречи».
    participantIds: v.array(v.id('employees')),
    createdAt: v.number(),
    // §9 ТЗ Telegram: откуда создана запись.
    source: v.optional(v.string()),
  })
    .index('by_date', ['date'])
    .index('by_creator', ['createdById']),

  // ——— Telegram-модуль (ТЗ Telegram §3, §9, §10) ———
  //
  // Ключевая концепция ТЗ: Telegram — не отдельная система учёта, а второй
  // интерфейс к ERP. Здесь не хранятся задачи, встречи и KPI: только привязка
  // аккаунтов, черновики подтверждения, журнал и реестр отправленного.

  // Привязка сотрудника к Telegram (§3). Основной идентификатор — chatId
  // (Telegram user ID); @username хранится справочно, его можно сменить.
  telegramLinks: defineTable({
    employeeId: v.id('employees'),
    // §3.4: шесть состояний подключения.
    status: v.union(
      v.literal('invited'), // приглашение создано, бот ещё не запущен
      v.literal('pending'), // user ID получен, ждём решения администратора
      v.literal('connected'), // подключён
      v.literal('disabled'), // отключён администратором
      v.literal('failed'), // ошибка доставки: бот заблокирован пользователем
    ),
    inviteCode: v.optional(v.string()),
    inviteExpiresAt: v.optional(v.number()),
    inviteCreatedById: v.optional(v.id('employees')),
    chatId: v.optional(v.number()),
    username: v.optional(v.string()),
    tgName: v.optional(v.string()),
    connectedAt: v.optional(v.number()),
    connectedById: v.optional(v.id('employees')),
    lastDeliveryAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    // §6.1: категории уведомлений выключаются точечно, не трогая права в ERP.
    mutedCategories: v.optional(v.array(v.string())),
  })
    .index('by_employee', ['employeeId'])
    .index('by_chat', ['chatId'])
    .index('by_code', ['inviteCode'])
    .index('by_status', ['status']),

  // Идемпотентность webhook (§11): повторная доставка одного update не должна
  // создавать вторую задачу, встречу или уведомление.
  telegramUpdates: defineTable({
    updateId: v.number(),
    at: v.number(),
  }).index('by_update', ['updateId']),

  // Реестр отправленного. Ключ уникален для события: по нему уведомление
  // отправляется ровно один раз — сюда же ложатся пороги KPI (§7.1).
  telegramSent: defineTable({
    key: v.string(),
    employeeId: v.optional(v.id('employees')),
    category: v.string(),
    at: v.number(),
    status: v.union(v.literal('ok'), v.literal('error')),
    error: v.optional(v.string()),
  })
    .index('by_key', ['key'])
    .index('by_employee', ['employeeId']),

  // Карточка предварительного подтверждения (§4.1, §5.1). Задача и встреча
  // создаются ТОЛЬКО после нажатия «Создать» — до этого данные живут здесь.
  telegramDrafts: defineTable({
    chatId: v.number(),
    employeeId: v.id('employees'),
    kind: v.union(v.literal('task'), v.literal('meeting')),
    // Извлечённые поля, JSON. Схема полей своя у задачи и встречи.
    payload: v.string(),
    transcript: v.string(),
    messageId: v.optional(v.number()),
    // Какое поле сейчас уточняем: бот обязан спросить, а не угадывать (§4.3).
    awaiting: v.optional(v.string()),
    state: v.union(
      v.literal('preview'),
      v.literal('editing'),
      v.literal('done'),
      v.literal('cancelled'),
    ),
    createdAt: v.number(),
  }).index('by_chat', ['chatId']),

  // Журнал (§10). Доступен администратору, обычный сотрудник его не видит.
  telegramAudit: defineTable({
    at: v.number(),
    kind: v.string(), // invite | confirm | reject | disable | reconnect | command | notify | error
    employeeId: v.optional(v.id('employees')),
    byId: v.optional(v.id('employees')),
    chatId: v.optional(v.number()),
    updateId: v.optional(v.number()),
    text: v.optional(v.string()), // распознанный текст голосового
    fields: v.optional(v.string()), // извлечённые поля до подтверждения
    result: v.optional(v.string()),
    objectRef: v.optional(v.string()), // id созданной задачи или встречи
    status: v.optional(v.string()),
    error: v.optional(v.string()),
  })
    .index('by_at', ['at'])
    .index('by_employee', ['employeeId']),

  // Настройки (одна запись-синглтон с key = "global")
  settings: defineTable({
    key: v.string(),
    leadWeight: v.number(), // вес заявок (0.7)
    cplWeight: v.number(), // вес CPL (0.3)
    // УСТАРЕЛО. Оклады по должностям — из времён, когда KPI считался по отделу.
    // Теперь оклад персональный (employees.salary), и payroll читает только его.
    // Поля оставлены, чтобы не ломать старые записи и миграции в setup.ts;
    // писать в них нельзя — расчёт их не видит, и правка «сохранится» вхолостую.
    salarySmm: v.optional(v.number()),
    salaryTargetolog: v.optional(v.number()),
    salarySales: v.optional(v.number()),
    // УСТАРЕЛО вместе с ними: план выручки продаж теперь в salesPlans (на
    // сотрудника и месяц), см. sales.setPlan.
    planRevenueSales: v.optional(v.number()),
    reportMonth: v.string(),
    reportDeadlineTime: v.optional(v.string()), // дедлайн дневного отчёта, «HH:MM» (Алматы)
    // §11 ТАРГЕТ 1.6: вес показателя «Выполнение плана по количеству заявок»
    // в общем KPI таргетолога, в процентах. Пока это единственный его
    // показатель, поэтому вес равен 100.
    targetLeadWeight: v.optional(v.number()),
    // ——— Telegram-модуль, §8.2 ———
    // Имя бота без @: из него собирается ссылка-приглашение. Токен здесь НЕ
    // хранится — он лежит в защищённых настройках окружения (§8.2).
    tgBotUsername: v.optional(v.string()),
    // §4.3, §8.2: часовой пояс организации. Относительные выражения из
    // голосовых команд («завтра», «через два часа») считаются в нём.
    tgTimezone: v.optional(v.string()),
    tgInviteTtlHours: v.optional(v.number()), // срок жизни приглашения, часов
    tgMeetingRemindMin: v.optional(v.number()), // напоминание до встречи, минут
    tgReportRemindMin: v.optional(v.number()), // напоминание до срока отчёта, минут
    // §8.2, правила по задачам: в котором часу напоминать в день срока и
    // сообщать ли автору о просрочке.
    tgTaskRemindAt: v.optional(v.string()), // «HH:MM»
    tgTaskEscalateAuthor: v.optional(v.boolean()),
    // §9: сколько дней хранить расшифровки голосовых в журнале.
    tgTranscriptKeepDays: v.optional(v.number()),
    // Кто получает «отчёт заполнен» и «отчёт просрочен» (§6).
    tgReportRecipients: v.optional(v.array(v.id('employees'))),
    // Глобально выключенные категории уведомлений (§6.1).
    tgDisabledCategories: v.optional(v.array(v.string())),
    // Тексты мотивационных сообщений KPI — редактируются без правки кода (§7.2).
    tgKpiTexts: v.optional(v.array(v.object({ threshold: v.number(), text: v.string() }))),
    // §7.1: режим перевыполнения — пороги выше 100%.
    tgKpiOverachieve: v.optional(v.boolean()),
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
