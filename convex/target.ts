// Модуль отчётности и аналитики таргетолога (отдельное ТЗ).
//
// Отличия от старой модели рекламы, на которых держится весь файл:
//  • кампания привязана к объекту продаж — справочник общий с отделом продаж;
//  • деньги в ДОЛЛАРАХ и хранятся целыми центами (§15 запрещает float);
//  • таргетолог вводит только бюджет и результат, цена всегда производная;
//  • результаты разных целей не складываются: сообщения, лиды, охваты и
//    переходы — разные единицы;
//  • отчёт после отправки блокируется, правит его только администратор и
//    только с указанием причины, в журнал.
import { query, mutation } from './_generated/server'
import { v, ConvexError } from 'convex/values'
import type { QueryCtx, MutationCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { currentEmployee, requireEmployee, isManager, hiddenEmployeeIds } from './lib'
import { notifyReportFilled } from './telegramFlow'
import {
  CAMPAIGN_GOALS,
  CAMPAIGN_GOAL_SLUGS,
  goalMeta,
  normalizeAccount,
  resultCostCents,
} from './campaignGoals'
import { reportDeadlineMs } from './orgTime'

const TZ = '+05:00'

const goalV = v.union(
  v.literal('msg_inst'),
  v.literal('msg_wa'),
  v.literal('reach'),
  v.literal('profile'),
  v.literal('site_leads'),
  v.literal('engagement'),
)
const statusV = v.union(v.literal('Активна'), v.literal('Пауза'), v.literal('Завершена'))

// ТЗ СИСТЕМА §2: отчёт за календарный день заполняется до 14:00 СЛЕДУЮЩЕГО
// дня. После этого сотрудник его не трогает — вносит только администратор,
// и такая запись считается сданной с опозданием (§2.3).
async function deadlineTime(ctx: QueryCtx | MutationCtx): Promise<string> {
  const s = await ctx.db
    .query('settings')
    .withIndex('by_key', (q) => q.eq('key', 'global'))
    .first()
  return s?.reportDeadlineTime ?? '14:00'
}

// §2 + дополнение §3.2: срок — указанное время следующего РАБОЧЕГО дня.
// Формула одна на всю ERP, см. orgTime.reportDeadlineMs.
const deadlineMs = reportDeadlineMs

function businessToday(): string {
  return new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 10)
}

// Конец календарного дня в Алматы — граница для «каким был статус на дату».
function endOfDayMs(date: string): number {
  return Date.parse(`${date}T23:59:59${TZ}`)
}

function assertWholeNonNegative(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0 || Math.floor(value) !== value) {
    throw new ConvexError(`${label}: укажите целое неотрицательное число`)
  }
}

// Бюджет приходит с фронта в центах — целым и неотрицательным. Дроби здесь
// означали бы, что где-то по дороге деньги считали во float.
function assertCents(value: number) {
  if (!Number.isFinite(value) || value < 0 || Math.floor(value) !== value) {
    throw new ConvexError('Бюджет: укажите неотрицательную сумму')
  }
}

// Таргетолог ведёт свои кампании и свой отчёт; администратор видит всё.
// Реестр намеренно доступен и руководителю: он согласует запуски.
async function requireTargetolog(ctx: MutationCtx): Promise<Doc<'employees'>> {
  const me = await requireEmployee(ctx)
  if (!isManager(me) && me.position !== 'targetolog') {
    throw new ConvexError('Недостаточно прав для работы с рекламными кампаниями')
  }
  return me
}

async function requireAdmin(ctx: MutationCtx): Promise<Doc<'employees'>> {
  const me = await requireEmployee(ctx)
  if (me.role !== 'owner') {
    throw new ConvexError('Исправлять отправленные отчёты может только администратор')
  }
  return me
}

// ——— Реестр кампаний ———

// Статус кампании на конкретную дату: берём последний переход, случившийся не
// позже конца этого дня. Истории нет (кампании до её появления) — считаем,
// что текущий статус был всегда.
async function statusOnDate(
  ctx: QueryCtx,
  campaign: Doc<'campaigns'>,
  date: string,
): Promise<string> {
  const history = await ctx.db
    .query('campaignStatusHistory')
    .withIndex('by_campaign', (q) => q.eq('campaignId', campaign._id))
    .collect()
  if (history.length === 0) return campaign.status
  const border = endOfDayMs(date)
  const past = history.filter((h) => h.at <= border).sort((a, b) => a.at - b.at)
  return past.length ? past[past.length - 1].to : campaign.status
}

// Порядок реестра (§7.3): сначала активные, потом пауза, потом завершённые;
// внутри группы — ручной порядок стрелками.
const STATUS_RANK: Record<string, number> = { Активна: 0, Пауза: 1, Завершена: 2 }

function registrySort(a: Doc<'campaigns'>, b: Doc<'campaigns'>) {
  const byStatus = (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9)
  if (byStatus !== 0) return byStatus
  const byOrder = (a.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.sortOrder ?? Number.MAX_SAFE_INTEGER)
  if (byOrder !== 0) return byOrder
  return campaignName(a).localeCompare(campaignName(b), 'ru')
}

// Как кампания называется для пользователя (§2.7). Ручное название —
// единственный видимый идентификатор; у карточек, заведённых до этого
// требования, оно уже заполнено, поэтому запасной вариант нужен только на
// случай пустой строки в старых данных.
function campaignName(c: Doc<'campaigns'>): string {
  return c.campaign?.trim() || c.code || 'Без названия'
}

export const registry = query({
  args: {},
  handler: async (ctx) => {
    const me = await currentEmployee(ctx)
    if (!me) return []
    const campaigns = (await ctx.db.query('campaigns').collect()).filter((c) => !c.archived)
    const objects = await ctx.db.query('salesObjects').collect()
    const objectName = new Map(objects.map((o) => [o._id as string, o.name]))
    return campaigns.sort(registrySort).map((c) => ({
      ...c,
      name: campaignName(c),
      objectName: c.objectId ? (objectName.get(c.objectId) ?? null) : null,
    }))
  },
})

// Есть ли у кампании отчётные данные: после первой строки цель менять нельзя
// (§7.2) — иначе накопленные результаты сменят смысл задним числом.
async function hasReportRows(ctx: QueryCtx | MutationCtx, campaignId: Id<'campaigns'>) {
  const row = await ctx.db
    .query('targetReportRows')
    .withIndex('by_campaign', (q) => q.eq('campaignId', campaignId))
    .first()
  return row !== null
}

export const createCampaign = mutation({
  args: {
    name: v.string(),
    objectId: v.id('salesObjects'),
    goal: goalV,
    account: v.string(),
    moneySource: v.union(v.literal('FRANCHONE'), v.literal('Партнёр')),
    startedAt: v.string(),
    campaign: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const me = await requireTargetolog(ctx)

    const object = await ctx.db.get(args.objectId)
    if (!object) throw new ConvexError('Объект продаж не найден')
    // §6: архивный объект нельзя выбрать для новой кампании.
    if (object.status === 'archived') {
      throw new ConvexError('Объект продаж в архиве — выберите действующий')
    }

    // §2.7: название вводится вручную и обязательно. Уникальность не
    // требуется — две кампании на разные аудитории могут называться похоже,
    // а различает их внутренний id.
    const name = args.name.trim()
    if (!name) throw new ConvexError('Укажите название кампании')

    // Новая кампания встаёт первой среди активных: её только что завели,
    // с ней и будут работать.
    const all = await ctx.db.query('campaigns').collect()
    const minOrder = Math.min(0, ...all.map((c) => c.sortOrder ?? 0))

    const id = await ctx.db.insert('campaigns', {
      objectId: args.objectId,
      goal: args.goal,
      // Приводим написание к канону — иначе в фильтрах заводится
      // «второй» аккаунт, отличающийся только регистром.
      account: normalizeAccount(args.account),
      moneySource: args.moneySource,
      campaign: name,
      status: 'Активна',
      startedAt: args.startedAt,
      note: args.note?.trim() || undefined,
      sortOrder: minOrder - 1,
    })
    await ctx.db.insert('campaignStatusHistory', {
      campaignId: id,
      to: 'Активна',
      at: Date.now(),
      byId: me._id,
    })
    return id
  },
})

export const updateCampaign = mutation({
  args: {
    id: v.id('campaigns'),
    objectId: v.optional(v.id('salesObjects')),
    goal: v.optional(goalV),
    account: v.optional(v.string()),
    moneySource: v.optional(v.union(v.literal('FRANCHONE'), v.literal('Партнёр'))),
    startedAt: v.optional(v.string()),
    name: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { id, name, ...patch }) => {
    await requireTargetolog(ctx)
    const campaign = await ctx.db.get(id)
    if (!campaign) throw new ConvexError('Кампания не найдена')

    // §2.7: переименование разрешено и не рвёт связь с отчётами — они
    // ссылаются на внутренний id. Пустым название стать не может.
    if (name !== undefined && !name.trim()) {
      throw new ConvexError('Название кампании не может быть пустым')
    }

    if (patch.objectId) {
      const object = await ctx.db.get(patch.objectId)
      if (!object) throw new ConvexError('Объект продаж не найден')
      if (object.status === 'archived') {
        throw new ConvexError('Объект продаж в архиве — выберите действующий')
      }
    }
    // §7.2 и §14: цель кампании с историей неизменна. Молча игнорировать
    // нельзя — таргетолог должен понять, что нужна новая кампания.
    if (patch.goal && patch.goal !== campaign.goal && (await hasReportRows(ctx, id))) {
      throw new ConvexError(
        'По кампании уже есть отчёты — цель изменить нельзя. Заведите новую кампанию.',
      )
    }

    const clean = Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    )
    if (typeof clean.account === 'string') clean.account = normalizeAccount(clean.account)
    if (name !== undefined) clean.campaign = name.trim()
    await ctx.db.patch(id, clean)
  },
})

export const setStatus = mutation({
  args: { id: v.id('campaigns'), status: statusV },
  handler: async (ctx, { id, status }) => {
    const me = await requireTargetolog(ctx)
    const campaign = await ctx.db.get(id)
    if (!campaign) throw new ConvexError('Кампания не найдена')
    if (campaign.status === status) return

    await ctx.db.patch(id, {
      status,
      // Дата завершения нужна аналитике: по ней видно, когда кампания
      // перестала откручиваться.
      ...(status === 'Завершена' ? { endedAt: businessToday() } : { endedAt: undefined }),
    })
    await ctx.db.insert('campaignStatusHistory', {
      campaignId: id,
      from: campaign.status,
      to: status,
      at: Date.now(),
      byId: me._id,
    })
  },
})

// Перестановка стрелками внутри статусной группы (§7.3): меняем порядок
// местами с соседом. Нормализуем на лету — у старых кампаний порядка нет.
export const reorder = mutation({
  args: { id: v.id('campaigns'), direction: v.union(v.literal('up'), v.literal('down')) },
  handler: async (ctx, { id, direction }) => {
    await requireTargetolog(ctx)
    const campaign = await ctx.db.get(id)
    if (!campaign) throw new ConvexError('Кампания не найдена')

    const group = (await ctx.db.query('campaigns').collect())
      .filter((c) => !c.archived && c.status === campaign.status)
      .sort(registrySort)
    // Присваиваем плотные позиции: без этого соседи с пустым sortOrder
    // менялись бы местами непредсказуемо.
    for (let i = 0; i < group.length; i++) {
      if (group[i].sortOrder !== i) await ctx.db.patch(group[i]._id, { sortOrder: i })
    }
    const index = group.findIndex((c) => c._id === id)
    const target = direction === 'up' ? index - 1 : index + 1
    if (index < 0 || target < 0 || target >= group.length) return

    await ctx.db.patch(group[index]._id, { sortOrder: target })
    await ctx.db.patch(group[target]._id, { sortOrder: index })
  },
})

// ——— Ежедневный отчёт ———

// Кампании, которые нужно показать в форме за дату (§9.1, дополнение §2.3):
// только активные — «На паузе» и «Завершена» в текущем отчёте не заполняются.
// Статус берём на конец отчётного дня, а не на сегодня: кампанию могли
// поставить на паузу позже, и вчерашняя строка от этого исчезать не должна.
//
// keep — кампании, по которым за эту дату уже есть сохранённые данные. §2.3
// требует, чтобы смена статуса не удаляла показатели из сданных отчётов,
// поэтому такие строки остаются в форме независимо от статуса.
async function campaignsForDate(ctx: QueryCtx, date: string, keep: Set<string> = new Set()) {
  const all = (await ctx.db.query('campaigns').collect()).filter((c) => !c.archived)
  const out: Doc<'campaigns'>[] = []
  for (const c of all) {
    if (keep.has(c._id as string)) {
      out.push(c)
      continue
    }
    if (c.startedAt && c.startedAt > date) continue
    if ((await statusOnDate(ctx, c, date)) !== 'Активна') continue
    out.push(c)
  }
  return out.sort(registrySort)
}

// Строка формы. Тип объявлен явно, иначе пустая ветка вырождает его в
// unknown[] и фронт теряет подсказки по полям.
interface DayRow {
  campaignId: Id<'campaigns'>
  name: string
  goal: string | null
  account: string
  moneySource: string
  objectName: string | null
  budgetCents: number
  result: number
  costCents: number | null
  filled: boolean
}

export const day = query({
  args: { date: v.optional(v.string()) },
  handler: async (ctx, { date }) => {
    const me = await currentEmployee(ctx)
    const target = date ?? businessToday()
    const empty = {
      date: target,
      today: businessToday(),
      submittedAt: null as number | null,
      editable: false,
      comment: '',
      rows: [] as DayRow[],
      totalBudgetCents: 0,
    }
    if (!me) return empty

    const report = await ctx.db
      .query('targetReports')
      .withIndex('by_employee_date', (q) => q.eq('employeeId', me._id).eq('date', target))
      .first()
    const saved = report
      ? await ctx.db
          .query('targetReportRows')
          .withIndex('by_report', (q) => q.eq('reportId', report._id))
          .collect()
      : []
    const byCampaign = new Map(saved.map((r) => [r.campaignId as string, r]))

    const campaigns = await campaignsForDate(ctx, target, new Set(byCampaign.keys()))
    const objects = await ctx.db.query('salesObjects').collect()
    const objectName = new Map(objects.map((o) => [o._id as string, o.name]))

    const rows: DayRow[] = campaigns.map((c) => {
      const row = byCampaign.get(c._id as string)
      const budgetCents = row?.budgetCents ?? 0
      const result = row?.result ?? 0
      return {
        campaignId: c._id,
        name: campaignName(c),
        goal: c.goal ?? null,
        account: c.account,
        moneySource: c.moneySource,
        objectName: c.objectId ? (objectName.get(c.objectId) ?? null) : null,
        budgetCents,
        result,
        costCents: resultCostCents(budgetCents, result, c.goal),
        filled: row !== undefined,
      }
    })

    return {
      date: target,
      today: businessToday(),
      submittedAt: report?.submittedAt ?? null,
      // §9.3: до отправки правим свободно, после — только администратор.
      // Будущую дату не заполняем.
      // §2.2: своё окно — до дедлайна отчётной даты. Отправленный отчёт
      // закрыт и раньше (§9.3 модуля).
      editable:
        !report?.submittedAt &&
        target <= businessToday() &&
        Date.now() <= deadlineMs(target, await deadlineTime(ctx)),
      comment: report?.comment ?? '',
      rows,
      // §9.1: внизу формы суммируется ТОЛЬКО бюджет. Общий результат не
      // показываем — сообщения, лиды и охваты нельзя складывать.
      totalBudgetCents: rows.reduce((s, r) => s + r.budgetCents, 0),
    }
  },
})

export const save = mutation({
  args: {
    date: v.string(),
    comment: v.optional(v.string()),
    submit: v.boolean(),
    rows: v.array(
      v.object({
        campaignId: v.id('campaigns'),
        budgetCents: v.number(),
        result: v.number(),
      }),
    ),
  },
  handler: async (ctx, { date, comment, submit, rows }) => {
    const me = await requireTargetolog(ctx)
    if (date > businessToday()) throw new ConvexError('Отчёт за будущую дату внести нельзя')
    // §2.2: после дедлайна отчёт за этот день вносит только администратор.
    if (Date.now() > deadlineMs(date, await deadlineTime(ctx))) {
      throw new ConvexError(
        'Дедлайн прошёл — отчёт за этот день может внести только администратор',
      )
    }

    for (const r of rows) {
      assertCents(r.budgetCents)
      assertWholeNonNegative(r.result, 'Результат')
    }

    const existing = await ctx.db
      .query('targetReports')
      .withIndex('by_employee_date', (q) => q.eq('employeeId', me._id).eq('date', date))
      .first()
    if (existing?.submittedAt) {
      throw new ConvexError('Отчёт уже отправлен — изменить его может только администратор')
    }

    const reportId =
      existing?._id ??
      (await ctx.db.insert('targetReports', {
        employeeId: me._id,
        date,
        month: date.slice(0, 7),
        comment: comment?.trim() || undefined,
      }))
    await ctx.db.patch(reportId, {
      comment: comment?.trim() || undefined,
      ...(submit ? { submittedAt: Date.now() } : {}),
    })

    // Строки переписываем целиком: форма всегда присылает полный набор
    // кампаний за день, и частичное слияние породило бы призрачные строки
    // от кампаний, завершённых в этот день.
    for (const old of await ctx.db
      .query('targetReportRows')
      .withIndex('by_report', (q) => q.eq('reportId', reportId))
      .collect()) {
      await ctx.db.delete(old._id)
    }
    for (const r of rows) {
      await ctx.db.insert('targetReportRows', {
        reportId,
        campaignId: r.campaignId,
        date,
        budgetCents: r.budgetCents,
        result: r.result,
      })
    }
    // §6 ТЗ Telegram: сводка администратору — только по отправленному отчёту.
    if (submit) {
      const total = rows.reduce((s, r) => s + r.budgetCents, 0)
      await notifyReportFilled(
        ctx,
        me._id,
        date,
        `Реклама: ${rows.length} кампаний, расход $${(total / 100).toFixed(2)}`,
      )
    }
    return { reportId, submitted: submit }
  },
})

// §9.3 и §14: отправленный отчёт правит только администратор и только с
// причиной. Старое и новое значения уходят в журнал аудита.
export const correctRow = mutation({
  args: {
    rowId: v.id('targetReportRows'),
    budgetCents: v.number(),
    result: v.number(),
    reason: v.string(),
  },
  handler: async (ctx, { rowId, budgetCents, result, reason }) => {
    const me = await requireAdmin(ctx)
    const why = reason.trim()
    if (!why) throw new ConvexError('Укажите причину исправления')
    assertCents(budgetCents)
    assertWholeNonNegative(result, 'Результат')

    const row = await ctx.db.get(rowId)
    if (!row) throw new ConvexError('Строка отчёта не найдена')
    if (row.budgetCents === budgetCents && row.result === result) return

    await ctx.db.insert('targetReportAudit', {
      rowId,
      campaignId: row.campaignId,
      at: Date.now(),
      byId: me._id,
      reason: why,
      fromBudgetCents: row.budgetCents,
      toBudgetCents: budgetCents,
      fromResult: row.result,
      toResult: result,
    })
    await ctx.db.patch(rowId, { budgetCents, result })
  },
})

// История отправленных отчётов (§9.3): таргетолог видит свои, руководство —
// все. Скрытые сотрудники в аналитику не попадают.
export const history = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const me = await currentEmployee(ctx)
    if (!me) return []
    const hidden = await hiddenEmployeeIds(ctx)
    const all = await ctx.db.query('targetReports').collect()
    const mine = isManager(me)
      ? all.filter((r) => !hidden.has(r.employeeId) || me.role === 'owner')
      : all.filter((r) => r.employeeId === me._id)

    const employees = await ctx.db.query('employees').collect()
    const nameById = new Map(employees.map((e) => [e._id as string, e.name]))

    return mine
      .filter((r) => r.submittedAt)
      .sort((a, b) => (b.submittedAt ?? 0) - (a.submittedAt ?? 0))
      .slice(0, limit ?? 30)
      .map((r) => ({
        _id: r._id,
        date: r.date,
        submittedAt: r.submittedAt,
        author: nameById.get(r.employeeId as string) ?? '—',
      }))
  },
})

// ——— Дашборд KPI: объекты продаж → рекламные цели → кампании ———
//
// Дополнение §2.8: аналитика строится тремя уровнями. По умолчанию выбраны
// все активные объекты; пользователь включает и отключает цели; когда цель
// остаётся одна, график раскрывает кампании внутри неё по ручным названиям.
//
// §2.8.1: при нескольких объектах или кампаниях цена считается по совокупным
// значениям — сумма бюджетов ÷ сумма результатов (для охвата ещё × 1000), а не
// как среднее уже посчитанных цен. Цели с разными единицами не складываются:
// у каждой своя линия и свой итог.

export const dashboard = query({
  args: {
    from: v.string(),
    to: v.string(),
    // Пусто — все активные объекты (§2.8).
    objectIds: v.optional(v.array(v.id('salesObjects'))),
    // Пусто — все цели справочника. Иначе только включённые пользователем.
    goals: v.optional(v.array(v.string())),
    // Работает только когда оставлена одна цель: отключение отдельных кампаний
    // внутри неё (§3, шаг 5). Передаём именно ОТКЛЮЧЁННЫЕ — так фильтр не
    // зависит от списка кампаний, который сам же приходит из этого запроса.
    excludeCampaignIds: v.optional(v.array(v.id('campaigns'))),
    account: v.optional(v.string()),
    moneySource: v.optional(v.string()),
    status: v.optional(v.string()),
  },
  handler: async (ctx, f) => {
    const me = await currentEmployee(ctx)
    const empty = {
      totalBudgetCents: 0,
      franchoneBudgetCents: 0,
      partnerBudgetCents: 0,
      mode: 'goals' as 'goals' | 'campaigns',
      objects: [] as unknown[],
      goalRows: [] as unknown[],
      campaignRows: [] as unknown[],
      rows: [] as unknown[],
      series: [] as unknown[],
    }
    if (!me || (!isManager(me) && me.position !== 'targetolog')) return empty

    const campaigns = await ctx.db.query('campaigns').collect()
    const byId = new Map(campaigns.map((c) => [c._id as string, c]))
    const objects = await ctx.db.query('salesObjects').collect()
    const objectName = new Map(objects.map((o) => [o._id as string, o.name]))

    // Выбор объектов: пустой список означает «все активные» (§2.8).
    const activeObjectIds = objects.filter((o) => o.status === 'active').map((o) => o._id as string)
    const pickedObjects = new Set(
      f.objectIds?.length ? f.objectIds.map((id) => id as string) : activeObjectIds,
    )
    // Цели: пустой список — весь справочник. 'unset' добавлен намеренно —
    // у кампаний, заведённых до появления целей, цели нет, и без этого ключа
    // их расход молча выпал бы из общей суммы.
    const pickedGoals = new Set<string>(
      f.goals?.length ? f.goals : [...CAMPAIGN_GOAL_SLUGS, 'unset'],
    )
    // §2.8: детализация до кампаний включается ровно на одной цели.
    const soleGoal = pickedGoals.size === 1 ? [...pickedGoals][0] : null
    const offCampaigns = new Set((f.excludeCampaignIds ?? []).map((id) => id as string))

    // Кампания попадает в расчёт, если её объект выбран и прочие фильтры сошлись.
    // Цель здесь НЕ фильтруем: нижний список обязан показывать все цели
    // справочника, включая те, у которых данных нет (§2.9).
    //
    // Кампании без объекта (заведённые до связки со справочником) считаются
    // в сводном режиме: иначе их расход молча исчезал бы из общей суммы. При
    // выборе конкретных объектов они, естественно, выпадают.
    const allObjects = !f.objectIds?.length
    const inScope = (c: Doc<'campaigns'>) =>
      (c.objectId ? pickedObjects.has(c.objectId as string) : allObjects) &&
      (!f.account || c.account === f.account) &&
      (!f.moneySource || c.moneySource === f.moneySource) &&
      (!f.status || c.status === f.status)

    const rows = (await ctx.db.query('targetReportRows').collect()).filter(
      (r) => r.date >= f.from && r.date <= f.to,
    )

    type Agg = { budgetCents: number; result: number }
    const zero = (): Agg => ({ budgetCents: 0, result: 0 })
    // Итог по каждой цели считаем даже для отключённых: иначе, сняв галочку,
    // цель потеряла бы свои цифры и вернуть её было бы не из чего.
    const byGoal = new Map<string, Agg>()
    const goalLine = new Map<string, Map<string, Agg>>()
    const byCampaign = new Map<string, Agg>()
    const campaignLine = new Map<string, Map<string, Agg>>()
    // Сводка §11.3: разрез «объект × цель × аккаунт × источник денег».
    type Bucket = Agg & { goal?: string; label: string[] }
    const buckets = new Map<string, Bucket>()

    let total = 0
    let franchone = 0
    let partner = 0

    const bump = (map: Map<string, Agg>, key: string, r: Agg) => {
      const a = map.get(key) ?? zero()
      a.budgetCents += r.budgetCents
      a.result += r.result
      map.set(key, a)
    }
    const bumpLine = (map: Map<string, Map<string, Agg>>, key: string, date: string, r: Agg) => {
      const line = map.get(key) ?? new Map<string, Agg>()
      const point = line.get(date) ?? zero()
      point.budgetCents += r.budgetCents
      point.result += r.result
      line.set(date, point)
      map.set(key, line)
    }

    for (const r of rows) {
      const c = byId.get(r.campaignId as string)
      if (!c || !inScope(c)) continue
      const goal = c.goal ?? 'unset'

      bump(byGoal, goal, r)

      // Дальше — только включённые цели: деньги и график показывают ровно то,
      // что пользователь оставил на экране.
      if (!pickedGoals.has(goal)) continue

      // Цифры кампаний внутри единственной цели собираем ДО фильтра галочек:
      // отключённая кампания должна показывать в списке свои настоящие
      // показатели, а не выглядеть пустой.
      if (soleGoal && goal === soleGoal) {
        bump(byCampaign, c._id as string, r)
        bumpLine(campaignLine, c._id as string, r.date, r)
      }

      if (soleGoal && offCampaigns.has(c._id as string)) continue

      total += r.budgetCents
      if (c.moneySource === 'FRANCHONE') franchone += r.budgetCents
      else partner += r.budgetCents

      bumpLine(goalLine, goal, r.date, r)

      // Прочерк ни о чём не говорит — пишем прямо, что объект не выбран,
      // чтобы такую карточку было видно и хотелось починить.
      const objName = c.objectId ? (objectName.get(c.objectId) ?? '—') : 'Объект не выбран'
      const key = [objName, goal, c.account, c.moneySource].join('|')
      const b = buckets.get(key) ?? {
        ...zero(),
        goal: c.goal,
        label: [objName, c.account, c.moneySource],
      }
      b.budgetCents += r.budgetCents
      b.result += r.result
      buckets.set(key, b)
    }

    const points = (line: Map<string, Agg> | undefined, goal: string | undefined) =>
      [...(line?.entries() ?? [])]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, p]) => ({
          date,
          budgetCents: p.budgetCents,
          result: p.result,
          costCents: resultCostCents(p.budgetCents, p.result, goal),
        }))

    // §2.9: внизу графика — весь справочник целей, а не только те, что попали
    // в отчёты за период. У цели без данных стоит пометка и нет линии.
    type GoalRow = {
      goal: string
      label: string
      metric: string
      costLabel: string
      hasData: boolean
      budgetCents: number
      result: number
      costCents: number | null
    }
    const goalRows: GoalRow[] = CAMPAIGN_GOALS.map((g) => {
      const a = byGoal.get(g.slug) ?? zero()
      return {
        goal: g.slug,
        label: g.label,
        metric: g.metric,
        costLabel: g.costLabel,
        hasData: a.budgetCents > 0 || a.result > 0,
        budgetCents: a.budgetCents,
        result: a.result,
        costCents: resultCostCents(a.budgetCents, a.result, g.slug),
      }
    })
    // Кампании без цели показываем отдельной строкой — только если по ним
    // реально был расход. Иначе владелец не увидел бы, что часть денег висит
    // на карточке, которую забыли настроить.
    const unset = byGoal.get('unset')
    if (unset && (unset.budgetCents > 0 || unset.result > 0)) {
      const meta = goalMeta(undefined)
      goalRows.push({
        goal: 'unset',
        label: meta.label,
        metric: meta.metric,
        costLabel: meta.costLabel,
        hasData: true,
        budgetCents: unset.budgetCents,
        result: unset.result,
        costCents: resultCostCents(unset.budgetCents, unset.result, undefined),
      })
    }

    // Кампании внутри единственной выбранной цели — нижний список в режиме
    // детализации. Показываем все подходящие, включая пустые.
    const campaignRows = soleGoal
      ? campaigns
          .filter((c) => !c.archived && (c.goal ?? 'unset') === soleGoal && inScope(c))
          .sort(registrySort)
          .map((c) => {
            const a = byCampaign.get(c._id as string) ?? zero()
            return {
              campaignId: c._id,
              name: campaignName(c),
              objectName: c.objectId ? (objectName.get(c.objectId) ?? null) : null,
              status: c.status,
              hasData: a.budgetCents > 0 || a.result > 0,
              budgetCents: a.budgetCents,
              result: a.result,
              costCents: resultCostCents(a.budgetCents, a.result, c.goal),
            }
          })
      : []

    const series = soleGoal
      ? campaignRows
          .filter((c) => c.hasData && !offCampaigns.has(c.campaignId as string))
          .map((c) => ({
            id: c.campaignId as string,
            label: c.name,
            goal: soleGoal,
            points: points(campaignLine.get(c.campaignId as string), soleGoal),
          }))
      : goalRows
          .filter((g) => pickedGoals.has(g.goal) && goalLine.has(g.goal))
          .map((g) => ({
            id: g.goal,
            label: g.label,
            goal: g.goal,
            points: points(goalLine.get(g.goal), g.goal),
          }))

    return {
      totalBudgetCents: total,
      franchoneBudgetCents: franchone,
      partnerBudgetCents: partner,
      mode: (soleGoal ? 'campaigns' : 'goals') as 'goals' | 'campaigns',
      objects: objects
        .filter((o) => o.status === 'active')
        .map((o) => ({ _id: o._id, name: o.name, type: o.type }))
        .sort((a, b) => a.name.localeCompare(b.name, 'ru')),
      goalRows,
      campaignRows,
      rows: [...buckets.values()]
        .map((b) => ({
          objectName: b.label[0],
          goal: b.goal ?? null,
          account: b.label[1],
          moneySource: b.label[2],
          budgetCents: b.budgetCents,
          result: b.result,
          // Итоговая цена — сумма расходов ÷ сумма результатов (§2.8.1),
          // а не среднее дневных цен.
          costCents: resultCostCents(b.budgetCents, b.result, b.goal),
        }))
        .sort((a, b) => b.budgetCents - a.budgetCents),
      series,
    }
  },
})


// Полный отправленный отчёт со строками и журналом правок (§9.3: «по нажатию
// на запись открывается полный отправленный отчёт»). Журнал видит только
// администратор — правки делает он, ему же и отвечать за них.
export const reportDetail = query({
  args: { reportId: v.id('targetReports') },
  handler: async (ctx, { reportId }) => {
    const me = await currentEmployee(ctx)
    if (!me) return null
    const report = await ctx.db.get(reportId)
    if (!report) return null
    if (!isManager(me) && report.employeeId !== me._id) return null

    const employee = await ctx.db.get(report.employeeId)
    const objects = await ctx.db.query('salesObjects').collect()
    const objectName = new Map(objects.map((o) => [o._id as string, o.name]))
    const employees = await ctx.db.query('employees').collect()
    const nameById = new Map(employees.map((e) => [e._id as string, e.name]))

    const rows = await ctx.db
      .query('targetReportRows')
      .withIndex('by_report', (q) => q.eq('reportId', reportId))
      .collect()

    const detailed = []
    for (const r of rows) {
      const campaign = await ctx.db.get(r.campaignId)
      const audit = await ctx.db
        .query('targetReportAudit')
        .withIndex('by_row', (q) => q.eq('rowId', r._id))
        .collect()
      detailed.push({
        rowId: r._id,
        name: campaign ? campaignName(campaign) : '—',
        goal: campaign?.goal ?? null,
        objectName: campaign?.objectId ? (objectName.get(campaign.objectId) ?? null) : null,
        budgetCents: r.budgetCents,
        result: r.result,
        costCents: resultCostCents(r.budgetCents, r.result, campaign?.goal),
        audit: audit
          .sort((a, b) => b.at - a.at)
          .map((a) => ({
            at: a.at,
            by: nameById.get(a.byId as string) ?? '—',
            reason: a.reason,
            fromBudgetCents: a.fromBudgetCents,
            toBudgetCents: a.toBudgetCents,
            fromResult: a.fromResult,
            toResult: a.toResult,
          })),
      })
    }

    return {
      _id: report._id,
      date: report.date,
      submittedAt: report.submittedAt ?? null,
      comment: report.comment ?? '',
      author: employee?.name ?? '—',
      canCorrect: me.role === 'owner',
      rows: detailed,
      totalBudgetCents: rows.reduce((s, r) => s + r.budgetCents, 0),
    }
  },
})

// Связанные кампании и история показателей одного объекта продаж (§6.3:
// администратор должен уметь открыть их из карточки объекта). Период не
// ограничиваем — это именно вся накопленная история, ради которой §10 требует
// не перезаписывать отчёты: «через любой период пользователь сможет открыть
// конкретный объект и восстановить всю маркетинговую активность».
export const objectHistory = query({
  args: { objectId: v.id('salesObjects') },
  handler: async (ctx, { objectId }) => {
    const me = await currentEmployee(ctx)
    const empty = {
      objectName: '',
      campaigns: [] as unknown[],
      series: [] as unknown[],
      totalBudgetCents: 0,
    }
    if (!me || (!isManager(me) && me.position !== 'targetolog')) return empty

    const object = await ctx.db.get(objectId)
    if (!object) return empty

    const campaigns = (
      await ctx.db
        .query('campaigns')
        .withIndex('by_object', (q) => q.eq('objectId', objectId))
        .collect()
    ).sort(registrySort)

    const out = []
    let total = 0
    const series = []
    for (const c of campaigns) {
      const rows = await ctx.db
        .query('targetReportRows')
        .withIndex('by_campaign', (q) => q.eq('campaignId', c._id))
        .collect()
      const budgetCents = rows.reduce((s, r) => s + r.budgetCents, 0)
      const result = rows.reduce((s, r) => s + r.result, 0)
      total += budgetCents

      const statusHistory = await ctx.db
        .query('campaignStatusHistory')
        .withIndex('by_campaign', (q) => q.eq('campaignId', c._id))
        .collect()

      out.push({
        _id: c._id,
        name: campaignName(c),
        goal: c.goal ?? null,
        account: c.account,
        moneySource: c.moneySource,
        status: c.status,
        archived: c.archived === true,
        startedAt: c.startedAt ?? null,
        endedAt: c.endedAt ?? null,
        days: new Set(rows.map((r) => r.date)).size,
        budgetCents,
        result,
        // Итог за всю историю — сумма расходов ÷ сумма результатов (§8.1).
        costCents: resultCostCents(budgetCents, result, c.goal),
        statusHistory: statusHistory
          .sort((a, b) => b.at - a.at)
          .map((h) => ({ from: h.from ?? null, to: h.to, at: h.at })),
      })

      // Дневная динамика цены — те же серии, что на дашборде, но по одному
      // объекту и за всё время.
      const byDate = new Map<string, { budgetCents: number; result: number }>()
      for (const r of rows) {
        const p = byDate.get(r.date) ?? { budgetCents: 0, result: 0 }
        p.budgetCents += r.budgetCents
        p.result += r.result
        byDate.set(r.date, p)
      }
      if (byDate.size > 0) {
        series.push({
          campaignId: c._id,
          name: campaignName(c),
          goal: c.goal ?? null,
          points: [...byDate.entries()]
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([date, p]) => ({
              date,
              budgetCents: p.budgetCents,
              result: p.result,
              costCents: resultCostCents(p.budgetCents, p.result, c.goal),
            })),
        })
      }
    }

    return { objectName: object.name, campaigns: out, series, totalBudgetCents: total }
  },
})

// Справочник целей для фильтров — чтобы фронт не дублировал список слагов.
export const goals = query({
  args: {},
  handler: async () => CAMPAIGN_GOAL_SLUGS,
})

// Объекты продаж для карточки кампании. Отдельный запрос, а не sales.objects:
// тот сужен под менеджеров отдела продаж (свои назначения, свой отдел), а
// таргетологу для привязки кампании нужен весь действующий справочник.
// §6: архивные не показываем — на них новую кампанию завести нельзя.
export const objectOptions = query({
  args: { includeId: v.optional(v.id('salesObjects')) },
  handler: async (ctx, { includeId }) => {
    const me = await currentEmployee(ctx)
    if (!me || (!isManager(me) && me.position !== 'targetolog')) return []
    return (await ctx.db.query('salesObjects').collect())
      .filter((o) => o.status !== 'archived' || o._id === includeId)
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
      .map((o) => ({ _id: o._id, name: o.name, status: o.status }))
  },
})

// ——— Отчёт таргетолога глазами администратора (дополнение §2.5, §2.6) ———

// Отчёт конкретного таргетолога за дату — для модалки графика сдачи. До этого
// администратор смотрел только в legacy-таблицу dailyReports, куда новая форма
// не пишет: сданный отчёт выглядел пропущенным, и система предлагала внести
// его повторно (§2.6).
export async function targetDayForEmployee(
  ctx: QueryCtx,
  employeeId: Id<'employees'>,
  date: string,
) {
  const report = await ctx.db
    .query('targetReports')
    .withIndex('by_employee_date', (q) => q.eq('employeeId', employeeId).eq('date', date))
    .first()

  const saved = report
    ? await ctx.db
        .query('targetReportRows')
        .withIndex('by_report', (q) => q.eq('reportId', report._id))
        .collect()
    : []
  const byCampaign = new Map(saved.map((r) => [r.campaignId as string, r]))

  const objects = await ctx.db.query('salesObjects').collect()
  const objectName = new Map(objects.map((o) => [o._id as string, o.name]))
  // Сданный отчёт показываем как есть; для пустого дня подставляем кампании,
  // активные на эту дату, — администратору есть что заполнить.
  const campaigns = await campaignsForDate(ctx, date, new Set(byCampaign.keys()))

  const rows = campaigns.map((c) => {
    const row = byCampaign.get(c._id as string)
    const budgetCents = row?.budgetCents ?? 0
    const result = row?.result ?? 0
    return {
      campaignId: c._id,
      name: campaignName(c),
      goal: c.goal ?? null,
      account: c.account,
      moneySource: c.moneySource,
      objectName: c.objectId ? (objectName.get(c.objectId) ?? null) : null,
      budgetCents,
      result,
      costCents: resultCostCents(budgetCents, result, c.goal),
      filled: row !== undefined,
    }
  })

  return {
    date,
    submittedAt: report?.submittedAt ?? null,
    comment: report?.comment ?? '',
    rows,
    totalBudgetCents: rows.reduce((s, r) => s + r.budgetCents, 0),
  }
}

// §2.5: за пропущенную дату отчёт вносит администратор — и такой отчёт
// автоматически считается сданным с опозданием. Здесь же он правит уже
// сданный: правка отражается в журнале аудита построчно.
export const adminSetDay = mutation({
  args: {
    employeeId: v.id('employees'),
    date: v.string(),
    comment: v.optional(v.string()),
    reason: v.optional(v.string()),
    rows: v.array(
      v.object({
        campaignId: v.id('campaigns'),
        budgetCents: v.number(),
        result: v.number(),
      }),
    ),
  },
  handler: async (ctx, { employeeId, date, comment, reason, rows }) => {
    const me = await requireAdmin(ctx)
    const employee = await ctx.db.get(employeeId)
    if (!employee) throw new ConvexError('Сотрудник не найден')
    if (employee.position !== 'targetolog') {
      throw new ConvexError('Эта форма отчёта только для таргетолога')
    }
    if (date > businessToday()) throw new ConvexError('Отчёт за будущую дату внести нельзя')
    for (const r of rows) {
      assertCents(r.budgetCents)
      assertWholeNonNegative(r.result, 'Результат')
    }

    const existing = await ctx.db
      .query('targetReports')
      .withIndex('by_employee_date', (q) => q.eq('employeeId', employeeId).eq('date', date))
      .first()

    // Правка уже сданного отчёта требует причины (§9.3) — вносить с чистого
    // листа можно молча, это восстановление пропуска, а не подмена цифр.
    const why = reason?.trim()
    if (existing?.submittedAt && !why) {
      throw new ConvexError('Укажите причину исправления отправленного отчёта')
    }

    const reportId =
      existing?._id ??
      (await ctx.db.insert('targetReports', {
        employeeId,
        date,
        month: date.slice(0, 7),
      }))
    await ctx.db.patch(reportId, {
      comment: comment?.trim() || undefined,
      // Отчёт, внесённый администратором, считается сданным сейчас — а значит
      // после дедлайна своей даты. Дисциплина пометит его как опоздание.
      submittedAt: existing?.submittedAt ?? Date.now(),
    })

    const old = await ctx.db
      .query('targetReportRows')
      .withIndex('by_report', (q) => q.eq('reportId', reportId))
      .collect()
    const oldByCampaign = new Map(old.map((r) => [r.campaignId as string, r]))

    for (const r of rows) {
      const prev = oldByCampaign.get(r.campaignId as string)
      if (prev) {
        if (prev.budgetCents !== r.budgetCents || prev.result !== r.result) {
          if (why) {
            await ctx.db.insert('targetReportAudit', {
              rowId: prev._id,
              campaignId: prev.campaignId,
              at: Date.now(),
              byId: me._id,
              reason: why,
              fromBudgetCents: prev.budgetCents,
              toBudgetCents: r.budgetCents,
              fromResult: prev.result,
              toResult: r.result,
            })
          }
          await ctx.db.patch(prev._id, { budgetCents: r.budgetCents, result: r.result })
        }
        oldByCampaign.delete(r.campaignId as string)
        continue
      }
      await ctx.db.insert('targetReportRows', {
        reportId,
        campaignId: r.campaignId,
        date,
        budgetCents: r.budgetCents,
        result: r.result,
      })
    }
    // Строки кампаний, которых в присланном наборе нет, удаляем: форма всегда
    // отдаёт полный список за день.
    for (const [, row] of oldByCampaign) await ctx.db.delete(row._id)

    return { reportId }
  },
})
