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
    // 'client' — заказчик упаковки франшизы (ТЗ «Производство и запуск
    // франшизы» §3). Он входит в ERP тем же способом, что и сотрудник, но
    // видит только собственный кабинет: матрица прав его не описывает, а
    // requireCan/viewScope роль 'client' не пропускают ни в один раздел.
    role: v.union(
      v.literal('owner'),
      v.literal('head'),
      v.literal('employee'),
      v.literal('client'),
    ),
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
    // Дополнение «заявки и выходные» §2.1.4: системный объект «Другое» —
    // сюда таргетолог относит обращения, которые нельзя привязать к
    // конкретному активному объекту. Переименовать и удалить его нельзя.
    system: v.optional(v.boolean()),
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
    // §2.3 дополнения: заявками владеет таргетолог, менеджер их не вводит.
    // Поле осталось у старых отчётов — оно больше не читается расчётами и у
    // новых записей равно нулю. Стирать историю нельзя.
    // §2.2: обращения из каналов, которых таргетолог не видит. Это ИСХОДНАЯ
    // информация для него, а не показатель: ни один расчёт её не суммирует,
    // иначе получился бы двойной учёт.
    leadsHint: v.optional(v.number()),
    leadsHintNote: v.optional(v.string()),
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
    // §4.2 ТЗ Telegram: объект продаж, к которому относится задача. Общий
    // справочник с рекламой и продажами — по нему видно, сколько работы идёт
    // на каждую франшизу. Необязателен: у задачи может не быть объекта.
    objectId: v.optional(v.id('salesObjects')),
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

  // Посещения ERP.
  //
  // Вход по коду и посещение — разные вещи. Сессия живёт неделю и сама
  // продлевается, поэтому человек может открывать панель каждый день, ни разу
  // не авторизуясь: в разделе «Активность» он при этом выглядел пропавшим.
  //
  // Пока вкладка открыта и человек за компьютером, фронт отмечается раз в пять
  // минут. Отметки не копятся строками: одна запись — один сеанс, у него есть
  // начало и время последней отметки. Перерыв больше получаса начинает новый.
  visits: defineTable({
    employeeId: v.id('employees'),
    startedAt: v.number(),
    lastAt: v.number(),
  })
    .index('by_employee', ['employeeId'])
    .index('by_last', ['lastAt']),

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

    // ——— Дополнение «Встречи: перенос, отмена, фиксация результата» ———
    //
    // §2: три состояния встречи. Поле необязательное: у встреч, заведённых до
    // этой доработки, состояния нет — они считаются запланированными.
    //
    // «Ожидает подтверждения» (§2.2) состоянием НЕ является и не хранится:
    // это признак «время прошло, результат не выбран», он вычисляется.
    status: v.optional(
      v.union(v.literal('planned'), v.literal('held'), v.literal('cancelled')),
    ),
    // §2.1: кто и когда зафиксировал результат — проведение либо отмену.
    resolvedAt: v.optional(v.number()),
    resolvedById: v.optional(v.id('employees')),
    // §6: исходные дата и время, чтобы рядом с актуальными была видна
    // первоначальная договорённость.
    originalDate: v.optional(v.string()),
    originalTime: v.optional(v.string()),
    // §3: сколько раз встречу переносили. Само число встреч перенос не
    // увеличивает — для переносов отдельный счётчик.
    rescheduleCount: v.optional(v.number()),
  })
    .index('by_date', ['date'])
    .index('by_creator', ['createdById']),

  // §6: журнал действий по встрече. Хранится бессрочно.
  meetingEvents: defineTable({
    meetingId: v.id('meetings'),
    type: v.union(
      v.literal('created'),
      v.literal('rescheduled'),
      v.literal('updated'),
      v.literal('participants'),
      v.literal('held'),
      v.literal('cancelled'),
    ),
    at: v.number(),
    byId: v.id('employees'),
    // Прежние и новые дата и время — для событий переноса.
    fromDate: v.optional(v.string()),
    fromTime: v.optional(v.string()),
    toDate: v.optional(v.string()),
    toTime: v.optional(v.string()),
    // Человекочитаемое описание изменения: «место: офис → Zoom».
    changes: v.optional(v.string()),
  })
    .index('by_meeting', ['meetingId'])
    .index('by_at', ['at'])
    .index('by_type_at', ['type', 'at']),

  // ——— Telegram-модуль (ТЗ Telegram §3, §9, §10) ———
  //
  // Ключевая концепция ТЗ: Telegram — не отдельная система учёта, а второй
  // интерфейс к ERP. Здесь не хранятся задачи, встречи и KPI: только привязка
  // аккаунтов, черновики подтверждения, журнал и реестр отправленного.

  // Привязка сотрудника к Telegram (§3). Основной идентификатор — chatId
  // (Telegram user ID); @username хранится справочно, его можно сменить.
  telegramLinks: defineTable({
    employeeId: v.id('employees'),
    // Состояния подключения. 'invited' и 'pending' остались от прежнего
    // порядка с приглашением от администратора: новых таких записей не
    // появляется, но старые должны читаться.
    status: v.union(
      v.literal('invited'),
      v.literal('pending'),
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
    // Индекс остался от прежних приглашений: новые записи его не заполняют,
    // но старые строки по нему лежат, а снос индекса на боевом деплойменте
    // требует прав, которых у ключа выката нет.
    .index('by_code', ['inviteCode'])
    .index('by_status', ['status']),

  // Память разговора с ботом.
  //
  // Без неё каждая реплика висит в пустоте: на «а когда?» бот не знает, о чём
  // шла речь. Держим последние несколько реплик на чат — этого хватает, чтобы
  // поддержать нить, и не превращает переписку в архив.
  //
  // Текст личный, поэтому живёт столько же, сколько расшифровки голосовых
  // (§9): срок задаётся в настройках, дальше крон стирает.
  telegramMessages: defineTable({
    chatId: v.number(),
    employeeId: v.id('employees'),
    role: v.union(v.literal('user'), v.literal('bot')),
    text: v.string(),
    at: v.number(),
  })
    .index('by_chat', ['chatId'])
    .index('by_at', ['at']),

  // Код подтверждения для входа в бота.
  //
  // Сотрудник подключается сам: вводит в боте свой рабочий email из ERP и
  // шестизначный код, который приходит на почту — тот же способ, которым он
  // входит в саму ERP. Доступ к почте и есть доказательство личности.
  //
  // Код короткоживущий и хранится как есть: таблица служебная, наружу не
  // отдаётся, а живёт запись минуты.
  telegramAuthCodes: defineTable({
    chatId: v.number(),
    employeeId: v.id('employees'),
    email: v.string(),
    code: v.string(),
    expiresAt: v.number(),
    // Ограничение попыток: перебор шестизначного кода должен упираться в стену.
    attempts: v.number(),
    createdAt: v.number(),
  })
    .index('by_chat', ['chatId'])
    .index('by_employee', ['employeeId']),

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
    // Что человек просит сделать. Создание было первым, остальное добавлено
    // позже: закрыть задачу, перенести или отменить встречу, сдвинуть срок.
    // Любое из этих действий проходит через карточку с подтверждением.
    kind: v.union(
      v.literal('task'),
      v.literal('meeting'),
      v.literal('task_done'),
      v.literal('task_reopen'),
      v.literal('task_deadline'),
      v.literal('meeting_move'),
      v.literal('meeting_cancel'),
    ),
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
    // Утренняя сводка: бот сам пишет первым в начале рабочего дня.
    tgDigestAt: v.optional(v.string()), // «HH:MM», по умолчанию 09:00
    tgDigestOn: v.optional(v.boolean()),
    // Окно, в котором допустимы «мягкие» сообщения — сводка, напоминания,
    // пороги KPI. Событие, которое человек ждёт прямо сейчас (ему поставили
    // задачу, назначили встречу), уходит немедленно и в это окно не смотрит.
    tgQuietFrom: v.optional(v.string()), // «HH:MM», начало окна, по умолчанию 09:00
    tgQuietTo: v.optional(v.string()), // «HH:MM», конец окна, по умолчанию 20:00
    // Вечерний итог дня владельцу и предупреждение о проседании KPI.
    tgEveningAt: v.optional(v.string()), // «HH:MM», по умолчанию 19:00
    tgEveningOn: v.optional(v.boolean()),
    tgKpiRiskOn: v.optional(v.boolean()),

    // ——— Модуль «Производство и запуск франшизы» ———
    // §6.3: «до дедлайна остаётся настраиваемый короткий период» — сколько
    // часов до срока индикатор здоровья становится жёлтым.
    packWarnHours: v.optional(v.number()),
    // §6.1: сроки по умолчанию для новых этапов, в днях.
    packReviewDays: v.optional(v.number()), // первичная проверка клиентом
    packRereviewDays: v.optional(v.number()), // повторная проверка
    packFixDays: v.optional(v.number()), // доработка со стороны FRANCHONE
    // §8.1: сколько дней без событий считать проектом «без активности».
    packIdleDays: v.optional(v.number()),
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

  // ——— Модуль «Производство и запуск франшизы» (ТЗ Упаковка v1.0) ———
  //
  // Ключевой результат (шапка ТЗ): показать движение каждой упаковки от старта
  // до передачи франшизы, разделить ответственность сторон, посчитать
  // производственный и финансовый KPI упаковщика и дать клиенту прозрачный
  // кабинет без единого внутреннего финансового поля (§3.1, BR-05).

  // Проект производства франшизы для конкретного клиента (§2, §4.1).
  packs: defineTable({
    title: v.string(),
    // §4.1: клиент обязателен перед публикацией, но не в черновике.
    clientId: v.optional(v.id('employees')),
    packerId: v.id('employees'), // ответственный упаковщик
    memberIds: v.array(v.id('employees')), // дополнительные участники
    startDate: v.string(), // YYYY-MM-DD
    dueDate: v.string(), // общий срок проекта, YYYY-MM-DD
    // §7.1: экономика задаётся отдельно для каждого проекта. Тенге целыми —
    // как оклад сотрудника; дробных тенге в расчётах нет.
    price: v.number(),
    packerPercent: v.number(), // 0–100
    description: v.optional(v.string()),
    // §4.1: черновик → активен → приостановлен → завершён → архив.
    status: v.union(
      v.literal('draft'),
      v.literal('active'),
      v.literal('paused'),
      v.literal('done'),
      v.literal('archived'),
    ),
    // §6.1: считать сроки в календарных или рабочих днях.
    workingDays: v.optional(v.boolean()),
    // §4.4: до запуска проект живёт как внутренний черновик и клиенту не виден.
    launchedAt: v.optional(v.number()),
    launchedById: v.optional(v.id('employees')),
    finishedAt: v.optional(v.number()),
    // §5.2: пауза останавливает таймеры и требует причину. pausedMs копит
    // суммарную длительность простоя, чтобы после снятия паузы дедлайны
    // сдвинулись ровно на неё.
    pausedAt: v.optional(v.number()),
    pausedReason: v.optional(v.string()),
    pausedMs: v.optional(v.number()),
    // §4.1: «Шаблон упаковки» — из такого проекта копируется структура этапов.
    isTemplate: v.optional(v.boolean()),
    // §13.1: после 100% проект переходит в постоянный итоговый хаб.
    hubOpenedAt: v.optional(v.number()),
    hubNote: v.optional(v.string()),
    // ТЗ v1.1 §7.2, §7.3: гарантированный персональный подарок за полный
    // пазл. Заказчик видит только право на него — содержание не раскрывается,
    // внутренний статус и описание остаются администратору.
    giftEarnedAt: v.optional(v.number()),
    giftStatus: v.optional(
      v.union(
        v.literal('none'),
        v.literal('chosen'),
        v.literal('prepared'),
        v.literal('sent'),
      ),
    ),
    giftNote: v.optional(v.string()),
    createdById: v.id('employees'),
    createdAt: v.number(),
    // Денормализованное время последнего события — §8.1 «проекты без активности».
    lastActivityAt: v.number(),
  })
    .index('by_status', ['status'])
    .index('by_client', ['clientId'])
    .index('by_packer', ['packerId']),

  // Этап проекта (§2, §5.1). Нулевой этап (kind='zero') не влияет ни на
  // прогресс клиента, ни на KPI упаковщика (BR-03).
  packStages: defineTable({
    packId: v.id('packs'),
    order: v.number(), // 0 — нулевой этап, дальше 1..N
    kind: v.union(v.literal('zero'), v.literal('main')),
    title: v.string(),
    clientNote: v.optional(v.string()), // описание для клиента
    internalNote: v.optional(v.string()), // внутренний комментарий команды
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    weight: v.number(), // §4.3: сумма весов основных этапов ровно 100
    // §6.1: сроки реакции сторон, в днях.
    reviewDays: v.number(),
    rereviewDays: v.number(),
    fixDays: v.number(),
    doneCondition: v.optional(v.string()), // условия завершения этапа
    // §5.2: девять состояний этапа.
    status: v.union(
      v.literal('locked'),
      v.literal('planned'),
      v.literal('in_progress'),
      v.literal('ready'),
      v.literal('review'),
      v.literal('rework'),
      v.literal('rereview'),
      v.literal('approved'),
      v.literal('paused'),
    ),
    // §5.2/§6.3: активный таймер. dueAt — момент, к которому ждём действие;
    // side — от кого ждём. Пусто — таймера нет.
    dueAt: v.optional(v.number()),
    awaiting: v.optional(v.union(v.literal('client'), v.literal('franchone'))),
    // BR-06: клиентский таймер стартует только после официальной передачи.
    handedAt: v.optional(v.number()),
    handoverCount: v.optional(v.number()),
    approvedAt: v.optional(v.number()),
    approvedById: v.optional(v.id('employees')),
    // §7.4: сколько раз этап возвращали и сколько суммарно шла доработка.
    returnCount: v.number(),
    reworkStartedAt: v.optional(v.number()),
    reworkMs: v.optional(v.number()),
    startedAt: v.optional(v.number()),
    // §7.4 «процент этапов, завершённых в срок»: успел ли этап к своему
    // плановому концу. Фиксируем в момент утверждения — потом дата может
    // сдвинуться, а факт должен остаться.
    approvedOnTime: v.optional(v.boolean()),
    // Состояние, из которого этап ушёл на паузу (§5.2).
    pausedFrom: v.optional(v.string()),

    // ——— ТЗ v1.1 ———
    // §7.1: часть пазла за этап. Открывается при приёмке в пределах срока,
    // настроенного для этого этапа; нулевой этап части не открывает (§4.2).
    // Повторное открытие страницы начислить её второй раз не может — факт
    // хранится здесь, а не считается на лету (§7.1, §15.1).
    puzzleAwarded: v.optional(v.boolean()),
    puzzleAwardedAt: v.optional(v.number()),
    // §7.3, §11.3: администратор может вручную сохранить или восстановить
    // право на часть в исключительной ситуации — с обязательной причиной.
    puzzleManual: v.optional(v.boolean()),
    puzzleReason: v.optional(v.string()),
    // §15.1: фактический срок приёмки этапа — с ним сравнивается дата решения.
    acceptDueAt: v.optional(v.number()),
    // §15: этап нельзя активировать без обязательных материалов, если
    // администратор явно не разрешил этап без документов.
    allowNoDocs: v.optional(v.boolean()),
  })
    .index('by_pack', ['packId'])
    .index('by_pack_order', ['packId', 'order'])
    .index('by_due', ['dueAt']),

  // Материал этапа (§2, §11): файл, ссылка, документ, макет, сайт.
  packMaterials: defineTable({
    packId: v.id('packs'),
    stageId: v.id('packStages'),
    title: v.string(),
    description: v.optional(v.string()),
    // §11.2 «тип и формат».
    kind: v.union(
      v.literal('file'),
      v.literal('link'),
      v.literal('doc'),
      v.literal('design'),
      v.literal('site'),
      v.literal('other'),
    ),
    required: v.boolean(), // входит ли в обязательные элементы этапа
    // §11.1: шесть состояний материала.
    status: v.union(
      v.literal('planned'),
      v.literal('in_progress'),
      v.literal('ready'),
      v.literal('rework'),
      v.literal('reworked'),
      v.literal('approved'),
    ),
    ownerId: v.optional(v.id('employees')),
    dueDate: v.optional(v.string()),
    version: v.number(), // номер последней версии; 0 — версий ещё нет
    approvedAt: v.optional(v.number()),
    // ——— ТЗ v1.1 ———
    // §6.3: оценка заказчика от 1 до 5 звёзд. Не заменяет «Принять» и на
    // статус не влияет; нужна упаковщику, администратору и сводной аналитике.
    rating: v.optional(v.number()),
    ratedAt: v.optional(v.number()),
    // §15.1: минимально необходимые системные данные. Журнал пользователю не
    // показывается, но эти отметки нужны логике и расчётам.
    // Дата перевода в «Готов к проверке» — по ней считается своевременность
    // упаковщика (§10), а не по дате решения заказчика.
    readyAt: v.optional(v.number()),
    readyOnTime: v.optional(v.boolean()),
    // Дата и автор решения «Принять» или «На доработку».
    decidedAt: v.optional(v.number()),
    decidedById: v.optional(v.id('employees')),
    returnCount: v.optional(v.number()),
    // §3: клиент грузит свои исходники и вложения — это его материалы.
    side: v.union(v.literal('team'), v.literal('client')),
    createdAt: v.number(),
    createdById: v.id('employees'),
  })
    .index('by_pack', ['packId'])
    .index('by_stage', ['stageId']),

  // §11.2: история версий материала. Версия не перезаписывается — добавляется.
  packMaterialVersions: defineTable({
    materialId: v.id('packMaterials'),
    packId: v.id('packs'),
    version: v.number(),
    kind: v.union(v.literal('file'), v.literal('link')),
    name: v.string(),
    url: v.optional(v.string()),
    storageId: v.optional(v.id('_storage')),
    note: v.optional(v.string()),
    byId: v.id('employees'),
    at: v.number(),
  })
    .index('by_material', ['materialId'])
    .index('by_pack', ['packId']),

  // §11.3: комментарии этапа, материала или версии. Внутренние обсуждения
  // команды клиент не видит НИКОГДА (BR-12).
  packComments: defineTable({
    packId: v.id('packs'),
    stageId: v.optional(v.id('packStages')),
    materialId: v.optional(v.id('packMaterials')),
    versionId: v.optional(v.id('packMaterialVersions')),
    authorId: v.id('employees'),
    scope: v.union(v.literal('internal'), v.literal('client')),
    text: v.string(),
    // §11.3: отметка «вопрос решён».
    resolved: v.boolean(),
    resolvedAt: v.optional(v.number()),
    resolvedById: v.optional(v.id('employees')),
    attachments: v.array(
      v.object({
        kind: v.union(v.literal('file'), v.literal('link')),
        name: v.string(),
        url: v.optional(v.string()),
        storageId: v.optional(v.id('_storage')),
      }),
    ),
    at: v.number(),
  })
    .index('by_pack', ['packId'])
    .index('by_stage', ['stageId'])
    .index('by_material', ['materialId']),

  // §14.2: журнал действий. Пользователь, действие, объект, дата и время,
  // старое и новое значение, причина.
  packEvents: defineTable({
    packId: v.id('packs'),
    stageId: v.optional(v.id('packStages')),
    materialId: v.optional(v.id('packMaterials')),
    type: v.string(), // created | launched | stage_handover | approve | …
    at: v.number(),
    byId: v.id('employees'),
    field: v.optional(v.string()),
    from: v.optional(v.string()),
    to: v.optional(v.string()),
    reason: v.optional(v.string()),
    note: v.optional(v.string()),
    // §3.1: строки журнала с финансовыми полями клиенту не отдаются.
    financial: v.optional(v.boolean()),
  })
    .index('by_pack', ['packId'])
    .index('by_at', ['at']),

  // §7.3, §7.4: выплаты вознаграждения упаковщику. Начисление (A = W × K/100)
  // производное и считается из утверждённых этапов, а выплата — факт: её
  // фиксирует владелец. Держим списком, а не одним числом, чтобы «выплачено»
  // имело историю и дату, как того требует §7.3 («видеть отдельно»).
  packPayouts: defineTable({
    packId: v.id('packs'),
    amount: v.number(), // ₸
    paidAt: v.string(), // YYYY-MM-DD — дата фактической выплаты
    note: v.optional(v.string()),
    byId: v.id('employees'),
    at: v.number(),
  }).index('by_pack', ['packId']),

  // §6.1, §6.2: «платежные и иные контрольные даты» проекта и «платежные
  // события» в календаре. Сумма — внутреннее поле: клиенту она не уходит
  // никогда, а сама дата платежа ему как раз нужна (§3.1).
  packMilestones: defineTable({
    packId: v.id('packs'),
    title: v.string(),
    date: v.string(), // YYYY-MM-DD
    kind: v.union(v.literal('payment'), v.literal('control')),
    amount: v.optional(v.number()), // ₸ — ВНУТРЕННЕЕ
    note: v.optional(v.string()),
    // Точку можно оставить внутренней целиком — например, дату внутренней
    // сверки, о которой клиенту знать незачем.
    clientVisible: v.boolean(),
    done: v.boolean(),
    doneAt: v.optional(v.number()),
    createdById: v.id('employees'),
    createdAt: v.number(),
  }).index('by_pack', ['packId']),

  // §12: награда за этап. Содержание определяется позднее — архитектура
  // допускает цифровые материалы, услуги, скидки и любые иные бонусы.
  packRewards: defineTable({
    packId: v.id('packs'),
    stageId: v.optional(v.id('packStages')),
    title: v.string(),
    description: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    condition: v.optional(v.string()), // условие получения
    dueAt: v.optional(v.number()), // срок выполнения условия
    status: v.union(
      v.literal('locked'),
      v.literal('available'),
      v.literal('earned'),
      v.literal('granted'),
      v.literal('missed'),
      v.literal('restored'),
    ),
    earnedAt: v.optional(v.number()),
    grantedAt: v.optional(v.number()),
    decidedById: v.optional(v.id('employees')), // ручное решение владельца
    createdById: v.id('employees'),
    createdAt: v.number(),
  })
    .index('by_pack', ['packId'])
    .index('by_stage', ['stageId']),

  // §13.3: статьи, видео, тесты, инструкции, чек-листы, шаблоны, рекомендации
  // и предложения. Содержание в первой итерации не детализируется — важна
  // возможность создать, опубликовать, назначить и отключить.
  packContent: defineTable({
    title: v.string(),
    kind: v.union(
      v.literal('article'),
      v.literal('video'),
      v.literal('test'),
      v.literal('guide'),
      v.literal('checklist'),
      v.literal('template'),
      v.literal('offer'),
    ),
    body: v.optional(v.string()),
    url: v.optional(v.string()),
    // ТЗ v1.1 §8: короткое описание и обложка. Обложка — файл в хранилище
    // ERP (JPG/JPEG, PNG, WebP в пределах общих лимитов).
    summary: v.optional(v.string()),
    coverId: v.optional(v.id('_storage')),
    // §8.1: минимальный конструктор тестов. Вопросы лежат в самой карточке —
    // отдельная таблица здесь только усложнила бы редактирование: тест
    // всегда правится целиком.
    questions: v.optional(
      v.array(
        v.object({
          text: v.string(),
          imageId: v.optional(v.id('_storage')),
          // Несколько правильных ответов допускаются (§8.1).
          multiple: v.boolean(),
          options: v.array(
            v.object({
              text: v.string(),
              imageId: v.optional(v.id('_storage')),
              correct: v.boolean(),
            }),
          ),
        }),
      ),
    ),
    // §8.1: тест можно назначить конкретному проекту или этапу.
    stageOrder: v.optional(v.number()),
    published: v.boolean(),
    // Когда материал доступен клиенту: сразу, после этапа N, либо только
    // после завершения проекта.
    availability: v.union(
      v.literal('always'),
      v.literal('after_stage'),
      v.literal('post_project'),
    ),
    afterStageOrder: v.optional(v.number()),
    // Пусто — виден всем клиентам; иначе только назначенным проектам.
    packIds: v.optional(v.array(v.id('packs'))),
    createdById: v.id('employees'),
    createdAt: v.number(),
  }).index('by_published', ['published']),

  // §8.1: результат прохождения теста заказчиком. Подсчёт после завершения;
  // на прогресс, KPI и пазл тесты не влияют (§8).
  packTestResults: defineTable({
    contentId: v.id('packContent'),
    packId: v.id('packs'),
    employeeId: v.id('employees'),
    correct: v.number(),
    total: v.number(),
    at: v.number(),
  })
    .index('by_content', ['contentId'])
    .index('by_pack', ['packId'])
    .index('by_employee', ['employeeId']),

  // §13.2: постпроектный сценарий. Владелец задаёт условие запуска и действие,
  // не привязываясь к заранее определённому содержанию.
  packScenarios: defineTable({
    title: v.string(),
    trigger: v.union(
      v.literal('days_after_finish'),
      v.literal('client_action'),
      v.literal('no_activity'),
      v.literal('test_result'),
      v.literal('manual'),
    ),
    triggerDays: v.optional(v.number()),
    action: v.union(
      v.literal('notify'),
      v.literal('material'),
      v.literal('recommendation'),
      v.literal('test'),
      v.literal('invite'),
      v.literal('offer'),
    ),
    contentId: v.optional(v.id('packContent')),
    message: v.optional(v.string()),
    active: v.boolean(),
    packIds: v.optional(v.array(v.id('packs'))), // индивидуальное назначение
    createdById: v.id('employees'),
    createdAt: v.number(),
  }).index('by_active', ['active']),

  // Что и когда сценарий отправил: повторно одному проекту он не срабатывает.
  packScenarioRuns: defineTable({
    scenarioId: v.id('packScenarios'),
    packId: v.id('packs'),
    at: v.number(),
    status: v.union(v.literal('sent'), v.literal('skipped'), v.literal('error')),
    note: v.optional(v.string()),
  })
    .index('by_scenario', ['scenarioId'])
    .index('by_pack', ['packId'])
    .index('by_scenario_pack', ['scenarioId', 'packId']),

  // §14.1: уведомления внутри ERP. Telegram уходит через общую интеграцию,
  // а эти строки — лента в кабинете клиента и блок «срочные уведомления»
  // на панели упаковщика.
  packNotifications: defineTable({
    employeeId: v.id('employees'),
    packId: v.id('packs'),
    kind: v.string(),
    title: v.string(),
    text: v.optional(v.string()),
    link: v.optional(v.string()),
    at: v.number(),
    readAt: v.optional(v.number()),
  })
    .index('by_employee', ['employeeId'])
    .index('by_pack', ['packId']),

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
