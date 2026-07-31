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
import { CAMPAIGN_GOAL_SLUGS, resultCostCents } from './campaignGoals'

const TZ = '+05:00'

const goalV = v.union(
  v.literal('msg_inst'),
  v.literal('msg_wa'),
  v.literal('reach'),
  v.literal('profile'),
  v.literal('site_leads'),
)
const statusV = v.union(v.literal('Активна'), v.literal('Пауза'), v.literal('Завершена'))

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
  return a.code.localeCompare(b.code)
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
    code: v.string(),
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

    const code = args.code.trim().toUpperCase()
    if (!code) throw new ConvexError('Укажите ID кампании')
    const dup = await ctx.db
      .query('campaigns')
      .withIndex('by_code', (q) => q.eq('code', code))
      .first()
    if (dup) throw new ConvexError(`Кампания с ID ${code} уже есть`)

    // Новая кампания встаёт первой среди активных: её только что завели,
    // с ней и будут работать.
    const all = await ctx.db.query('campaigns').collect()
    const minOrder = Math.min(0, ...all.map((c) => c.sortOrder ?? 0))

    const id = await ctx.db.insert('campaigns', {
      code,
      objectId: args.objectId,
      goal: args.goal,
      account: args.account.trim(),
      moneySource: args.moneySource,
      // Название необязательно: кампанию опознают по объекту и цели.
      campaign: args.campaign?.trim() || object.name,
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
    campaign: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...patch }) => {
    await requireTargetolog(ctx)
    const campaign = await ctx.db.get(id)
    if (!campaign) throw new ConvexError('Кампания не найдена')

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

// Кампании, которые нужно показать в форме за дату (§9.1): те, что уже
// стартовали и на конец этого дня не были завершены.
async function campaignsForDate(ctx: QueryCtx, date: string) {
  const all = (await ctx.db.query('campaigns').collect()).filter((c) => !c.archived)
  const out: Doc<'campaigns'>[] = []
  for (const c of all) {
    if (c.startedAt && c.startedAt > date) continue
    const status = await statusOnDate(ctx, c, date)
    if (status === 'Завершена') continue
    out.push(c)
  }
  return out.sort(registrySort)
}

// Строка формы. Тип объявлен явно, иначе пустая ветка вырождает его в
// unknown[] и фронт теряет подсказки по полям.
interface DayRow {
  campaignId: Id<'campaigns'>
  code: string
  campaign: string
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

    const campaigns = await campaignsForDate(ctx, target)
    const objects = await ctx.db.query('salesObjects').collect()
    const objectName = new Map(objects.map((o) => [o._id as string, o.name]))

    const rows: DayRow[] = campaigns.map((c) => {
      const row = byCampaign.get(c._id as string)
      const budgetCents = row?.budgetCents ?? 0
      const result = row?.result ?? 0
      return {
        campaignId: c._id,
        code: c.code,
        campaign: c.campaign,
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
      editable: !report?.submittedAt && target <= businessToday(),
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

// ——— Дашборд администратора (§11, §12) ———

export const dashboard = query({
  args: {
    from: v.string(),
    to: v.string(),
    objectId: v.optional(v.id('salesObjects')),
    campaignId: v.optional(v.id('campaigns')),
    goal: v.optional(v.string()),
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
      rows: [] as unknown[],
      series: [] as unknown[],
    }
    if (!me || (!isManager(me) && me.position !== 'targetolog')) return empty

    const campaigns = await ctx.db.query('campaigns').collect()
    const byId = new Map(campaigns.map((c) => [c._id as string, c]))
    const objects = await ctx.db.query('salesObjects').collect()
    const objectName = new Map(objects.map((o) => [o._id as string, o.name]))

    const keep = (c: Doc<'campaigns'>) =>
      (!f.objectId || c.objectId === f.objectId) &&
      (!f.campaignId || c._id === f.campaignId) &&
      (!f.goal || c.goal === f.goal) &&
      (!f.account || c.account === f.account) &&
      (!f.moneySource || c.moneySource === f.moneySource) &&
      (!f.status || c.status === f.status)

    const rows = (await ctx.db.query('targetReportRows').collect()).filter(
      (r) => r.date >= f.from && r.date <= f.to,
    )

    // Сводка §11.3: разрез «объект × цель × аккаунт × источник денег».
    // Результаты складываются только внутри одной цели — ключ это гарантирует.
    type Bucket = { budgetCents: number; result: number; goal?: string; label: string[] }
    const buckets = new Map<string, Bucket>()
    let total = 0
    let franchone = 0
    let partner = 0
    // Серии для графика §12: цена по дням, отдельная линия на кампанию.
    const seriesMap = new Map<string, Map<string, { budgetCents: number; result: number }>>()

    for (const r of rows) {
      const c = byId.get(r.campaignId as string)
      if (!c || !keep(c)) continue

      total += r.budgetCents
      if (c.moneySource === 'FRANCHONE') franchone += r.budgetCents
      else partner += r.budgetCents

      const objName = c.objectId ? (objectName.get(c.objectId) ?? '—') : '—'
      const key = [objName, c.goal ?? 'unset', c.account, c.moneySource].join('|')
      const b = buckets.get(key) ?? {
        budgetCents: 0,
        result: 0,
        goal: c.goal,
        label: [objName, c.account, c.moneySource],
      }
      b.budgetCents += r.budgetCents
      b.result += r.result
      buckets.set(key, b)

      const line = seriesMap.get(c._id as string) ?? new Map()
      const point = line.get(r.date) ?? { budgetCents: 0, result: 0 }
      point.budgetCents += r.budgetCents
      point.result += r.result
      line.set(r.date, point)
      seriesMap.set(c._id as string, line)
    }

    return {
      totalBudgetCents: total,
      franchoneBudgetCents: franchone,
      partnerBudgetCents: partner,
      rows: [...buckets.entries()]
        .map(([, b]) => ({
          objectName: b.label[0],
          goal: b.goal ?? null,
          account: b.label[1],
          moneySource: b.label[2],
          budgetCents: b.budgetCents,
          result: b.result,
          // Итоговая цена — сумма расходов ÷ сумма результатов (§8.1),
          // а не среднее дневных цен.
          costCents: resultCostCents(b.budgetCents, b.result, b.goal),
        }))
        .sort((a, b) => b.budgetCents - a.budgetCents),
      series: [...seriesMap.entries()].map(([campaignId, line]) => {
        const c = byId.get(campaignId)!
        return {
          campaignId,
          code: c.code,
          campaign: c.campaign,
          goal: c.goal ?? null,
          points: [...line.entries()]
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([date, p]) => ({
              date,
              budgetCents: p.budgetCents,
              result: p.result,
              costCents: resultCostCents(p.budgetCents, p.result, c.goal),
            })),
        }
      }),
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
        code: campaign?.code ?? '—',
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
        code: c.code,
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
          code: c.code,
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
