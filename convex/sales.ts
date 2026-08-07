import { query, mutation } from './_generated/server'
import { v, ConvexError } from 'convex/values'
import type { QueryCtx, MutationCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { currentEmployee, requireEmployee, isManager, hiddenEmployeeIds } from './lib'
import { can, requireCan, inScope } from './permissions'
import { isMonthClosed } from './payroll'
import { notifyReportFilled, notifyPlanChanged } from './telegramFlow'
import { reportDeadlineMs } from './orgTime'

// ТЗ СИСТЕМА §2: до 14:00 следующего календарного дня.
const DEFAULT_DEADLINE = '14:00'

const objectTypeV = v.union(
  v.literal('franchise'),
  v.literal('service'),
  v.literal('product'),
)
const objectStatusV = v.union(
  v.literal('active'),
  v.literal('paused'),
  v.literal('archived'),
)
const monthStatusV = v.union(v.literal('selling'), v.literal('not_selling'))
const managerPlansV = v.array(
  v.object({
    managerId: v.id('employees'),
    planDeals: v.number(),
  }),
)

// «Обработано новых заявок» убрано (дополнение 1.4, п.6): ручной ввод отменён,
// разрыв считается как «Не доведено до консультации» = заявки − консультации.
// В схеме поле осталось опциональным — стирать историю нельзя.
// Дополнение «заявки и выходные» §2.3: «Количество заявок» из аргументов
// убрано — менеджер этот показатель не вводит и не редактирует. Значение
// приходит из отчёта таргетолога по связке «дата + объект продаж».
const salesReportArgs = {
  date: v.string(),
  objectId: v.id('salesObjects'),
  newConsultations: v.number(),
  repeatConsultations: v.number(),
  newMeetings: v.number(),
  repeatMeetings: v.number(),
  newPrepayments: v.number(),
  newDeals: v.number(),
  revenue: v.number(),
  comment: v.optional(v.string()),
  // §2.2: обращения из каналов, недоступных таргетологу. Это исходная
  // информация для него, а не показатель — ни один расчёт её не суммирует.
  leadsHint: v.optional(v.number()),
  leadsHintNote: v.optional(v.string()),
}

type SalesReportFields = Pick<
  Doc<'salesObjectReports'>,
  | 'newLeads'
  | 'newConsultations'
  | 'repeatConsultations'
  | 'newMeetings'
  | 'repeatMeetings'
  | 'newPrepayments'
  | 'newDeals'
  | 'revenue'
>

type SalesTotals = SalesReportFields

const zeroTotals = (): SalesTotals => ({
  newLeads: 0,
  newConsultations: 0,
  repeatConsultations: 0,
  newMeetings: 0,
  repeatMeetings: 0,
  newPrepayments: 0,
  newDeals: 0,
  revenue: 0,
})

const FIELD_KEYS = Object.keys(zeroTotals()) as (keyof SalesTotals)[]

function businessMonth(at = Date.now()): string {
  return new Date(at + 5 * 3600 * 1000).toISOString().slice(0, 7)
}

function assertWritableSalesMonth(month: string) {
  if (month < businessMonth()) {
    throw new ConvexError('Прошлый период закрыт для настройки объектов продаж')
  }
}

function businessToday(): string {
  return new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 10)
}

// ——— Период Live-воронки (дополнение «Live-воронка», §8) ———
// Все пять вариантов выбора (месяц, последние 7/14 дней, конкретный день,
// произвольный период) сводятся к паре дат включительно и отличаются только
// границами — считает их фронт, сюда приходит уже готовый отрезок.

function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number)
  // Нулевой день следующего месяца — это последний день текущего.
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}

// Месяцы, которые задевает период: «последние 7 дней» на стыке месяцев
// попадают сразу в два, и настройки объектов нужно брать из обоих.
function monthsBetween(from: string, to: string): string[] {
  const out: string[] = []
  let cur = from.slice(0, 7)
  const last = to.slice(0, 7)
  while (cur <= last && out.length < 120) {
    out.push(cur)
    const [y, m] = cur.split('-').map(Number)
    cur = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
  }
  return out
}

// §2: срок наступает в указанное время следующего календарного дня, а по
// дополнению §3.2 — следующего РАБОЧЕГО. Формула одна на всю ERP.
const deadlineMs = reportDeadlineMs

async function deadlineTime(ctx: QueryCtx | MutationCtx): Promise<string> {
  const s = await ctx.db
    .query('settings')
    .withIndex('by_key', (q) => q.eq('key', 'global'))
    .first()
  return s?.reportDeadlineTime ?? DEFAULT_DEADLINE
}

function assertWholeNonNegative(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0 || Math.floor(value) !== value) {
    throw new ConvexError(`${label}: укажите целое неотрицательное число`)
  }
}

function assertMoney(value: number) {
  if (!Number.isFinite(value) || value < 0) {
    throw new ConvexError('Фактически полученная сумма должна быть неотрицательной')
  }
}

function cleanComment(comment: string | undefined) {
  const s = comment?.trim()
  return s ? s : undefined
}

function addTotals(into: SalesTotals, row: SalesReportFields) {
  for (const key of FIELD_KEYS) into[key] += row[key]
}

// Прочерк там, где делить не на что: «выполнение плана» без плана — это
// «не задано», а не «ноль процентов».
function ratio(num: number, den: number): number | null {
  return den === 0 ? null : num / den
}

// В LIVE-воронке правило другое (дополнение 1.4, п.3): при нулевом знаменателе
// показываем 0%, а не прочерк. Только здесь — в остальных местах модуля
// продаж прочерк сохраняется.
function funnelRatio(num: number, den: number): number {
  return den === 0 ? 0 : num / den
}

function buildAnalytics(t: SalesTotals, planDeals: number) {
  // Блок активности — ровно четыре цифры (дополнение 1.4, п.7). Заявки,
  // договоры и сделки взаимодействиями не считаются и в сумму не входят.
  const totalRepeatTouches = t.repeatConsultations + t.repeatMeetings
  const totalInteractions =
    t.newConsultations + t.newMeetings + t.repeatConsultations + t.repeatMeetings
  return {
    ...t,
    planDeals,
    planCompletion: ratio(t.newDeals, planDeals),
    // Первая измеримая ступень после заявки — консультация; разрыв между ними
    // и есть недоведённые заявки. Отдельного ручного ввода больше нет.
    notReachedConsultation: Math.max(0, t.newLeads - t.newConsultations),
    conversions: {
      consultation: funnelRatio(t.newConsultations, t.newLeads),
      meeting: funnelRatio(t.newMeetings, t.newConsultations),
      contract: funnelRatio(t.newPrepayments, t.newMeetings),
      deal: funnelRatio(t.newDeals, t.newPrepayments),
      total: funnelRatio(t.newDeals, t.newLeads),
    },
    activity: {
      repeatConsultations: t.repeatConsultations,
      repeatMeetings: t.repeatMeetings,
      totalRepeatTouches,
      totalInteractions,
    },
  }
}

// ——— §2 дополнения: единый учёт количества заявок ———
//
// Официальный владелец показателя — таргетолог. Значение хранится на уровне
// уникальной комбинации «дата + объект продаж» и не разделяется по каналам
// и источникам (§2.1). Здесь оно собирается один раз и дальше используется
// всеми расчётами, чтобы одно и то же число не сложилось дважды (§2.3.6).
async function targetLeadsByObjectDate(
  ctx: QueryCtx,
  from: string,
  to: string,
): Promise<Map<string, number>> {
  const rows = await ctx.db
    .query('targetLeadReports')
    .withIndex('by_date', (q) => q.gte('date', from).lte('date', to))
    .collect()
  const out = new Map<string, number>()
  for (const r of rows) {
    const key = `${r.objectId}|${r.date}`
    out.set(key, (out.get(key) ?? 0) + r.leads)
  }
  return out
}

// §2.1.5: у объекта ровно один ответственный менеджер, и все заявки по нему
// автоматически относятся к этому менеджеру (§2.1.6). Берём его из настройки
// месяца, а если её нет — из карточки объекта.
function responsibleManager(
  setting: Doc<'salesObjectMonths'> | null | undefined,
  object: Doc<'salesObjects'> | null | undefined,
): Id<'employees'> | null {
  return setting?.managerPlans[0]?.managerId ?? object?.managerIds[0] ?? null
}

// Заявки таргетолога за конкретный день и объект. Пусто — таргетолог ещё не
// заполнил отчёт за этот день.
export async function leadsFor(
  ctx: QueryCtx | MutationCtx,
  objectId: Id<'salesObjects'>,
  date: string,
): Promise<number | null> {
  const rows = (
    await ctx.db
      .query('targetLeadReports')
      .withIndex('by_date', (q) => q.eq('date', date))
      .collect()
  ).filter((r) => r.objectId === objectId)
  if (rows.length === 0) return null
  return rows.reduce((sum, r) => sum + r.leads, 0)
}

async function salesEmployees(ctx: QueryCtx | MutationCtx, includeHidden = false) {
  const hidden = await hiddenEmployeeIds(ctx)
  return (await ctx.db.query('employees').collect()).filter(
    (e) =>
      (includeHidden || !hidden.has(e._id)) &&
      e.role !== 'owner' &&
      e.status === 'active' &&
      e.position === 'sales',
  )
}

async function maySeeEmployee(
  viewer: Doc<'employees'>,
  employeeId: Id<'employees'>,
  ctx: QueryCtx | MutationCtx,
) {
  if (viewer._id === employeeId) return true
  const employee = await ctx.db.get(employeeId)
  return !!employee && isManager(viewer) && inScope(viewer, employee)
}

async function monthSetting(
  ctx: QueryCtx | MutationCtx,
  objectId: Id<'salesObjects'>,
  month: string,
) {
  return await ctx.db
    .query('salesObjectMonths')
    .withIndex('by_object_month', (q) => q.eq('objectId', objectId).eq('month', month))
    .first()
}

function planForEmployee(
  setting: Doc<'salesObjectMonths'> | null | undefined,
  employeeId: Id<'employees'>,
) {
  return setting?.managerPlans.find((p) => p.managerId === employeeId)?.planDeals ?? 0
}

async function ensureAssignedObject(
  ctx: QueryCtx | MutationCtx,
  employeeId: Id<'employees'>,
  objectId: Id<'salesObjects'>,
  month: string,
) {
  const object = await ctx.db.get(objectId)
  const setting = await monthSetting(ctx, objectId, month)
  const effectiveObjectStatus = setting?.objectStatus ?? object?.status
  if (!object || effectiveObjectStatus !== 'active') {
    throw new ConvexError('Объект продаж не активен')
  }
  if (
    !setting ||
    !setting.managerPlans.some((p) => p.managerId === employeeId)
  ) {
    throw new ConvexError('Этот объект продаж не назначен вам в выбранном месяце')
  }
  return { object, setting }
}

async function syncLegacyDailyReport(
  ctx: MutationCtx,
  employeeId: Id<'employees'>,
  date: string,
  byId: Id<'employees'>,
  action: 'submitted' | 'edited',
) {
  const rows = (
    await ctx.db
      .query('salesObjectReports')
      .withIndex('by_employee', (q) => q.eq('employeeId', employeeId))
      .collect()
  ).filter((r) => r.date === date)
  const totals = zeroTotals()
  for (const r of rows) addTotals(totals, r)

  const existing = await ctx.db
    .query('dailyReports')
    .withIndex('by_employee_date', (q) => q.eq('employeeId', employeeId).eq('date', date))
    .first()
  const sales = {
    leads: totals.newLeads,
    meetings: totals.newMeetings,
    sales: totals.newDeals,
    revenue: totals.revenue,
    note: 'Синхронизировано из объектных отчётов продаж',
  }
  const now = Date.now()
  const time = await deadlineTime(ctx)
  const onTime = now <= deadlineMs(date, time)

  if (existing) {
    await ctx.db.patch(existing._id, {
      position: 'sales',
      sales,
      onTime: onTime ? existing.onTime : false,
      note: existing.note,
      reopened: false,
      deletedAt: undefined,
      deletedById: undefined,
      editedAt: action === 'edited' ? now : existing.editedAt,
      editedById: action === 'edited' ? byId : existing.editedById,
      editCount: action === 'edited' ? existing.editCount + 1 : existing.editCount,
      history: [...existing.history, { at: now, byId, action }],
    })
    return existing._id
  }

  await ctx.db.insert('dailyReports', {
    employeeId,
    position: 'sales',
    date,
    submittedAt: now,
    onTime,
    editCount: 0,
    history: [{ at: now, byId, action: 'submitted' }],
    sales,
  })
}

// ——— Справочник и настройка месяца ———

export const objects = query({
  args: {},
  handler: async (ctx) => {
    const me = await currentEmployee(ctx)
    if (!me) return []
    const all = await ctx.db.query('salesObjects').collect()
    if (me.role === 'owner') return all
    if (me.role === 'head') {
      const emps = await ctx.db.query('employees').collect()
      const deptIds = new Set(emps.filter((e) => e.department === me.department).map((e) => e._id))
      return all.filter((o) => o.managerIds.some((id) => deptIds.has(id)))
    }
    return all.filter((o) => o.managerIds.includes(me._id) && o.status !== 'archived')
  },
})

export const monthSettings = query({
  args: { month: v.string() },
  handler: async (ctx, { month }) => {
    const me = await currentEmployee(ctx)
    if (!me) return []
    const objects = await ctx.db.query('salesObjects').collect()
    const byObject = new Map(objects.map((o) => [o._id, o]))
    const rows = await ctx.db
      .query('salesObjectMonths')
      .withIndex('by_month', (q) => q.eq('month', month))
      .collect()

    const visibleRows =
      me.role === 'owner'
        ? rows
        : rows.filter((r) => {
            const object = byObject.get(r.objectId)
            if (!object) return false
            if (me.role === 'head') return object.managerIds.includes(me._id)
            return r.managerPlans.some((p) => p.managerId === me._id)
          })

    return visibleRows.map((r) => ({ ...r, object: byObject.get(r.objectId) ?? null }))
  },
})

export const managers = query({
  args: {},
  handler: async (ctx) => {
    const me = await currentEmployee(ctx)
    if (!me || !isManager(me)) return []
    const hidden = await hiddenEmployeeIds(ctx)
    const includeHidden = me.role === 'owner'
    return (await ctx.db.query('employees').collect())
      .filter(
        (e) =>
          e.role !== 'owner' &&
          e.status === 'active' &&
          e.position === 'sales' &&
          (includeHidden || !hidden.has(e._id)) &&
          (me.role === 'owner' || e.department === me.department),
      )
      .map((e) => ({
        id: e._id,
        name: e.name,
        initials: e.initials,
        avatarColor: e.avatarColor,
        salary: e.salary,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  },
})

export const upsertObject = mutation({
  args: {
    id: v.optional(v.id('salesObjects')),
    name: v.string(),
    type: objectTypeV,
    status: objectStatusV,
    managerIds: v.array(v.id('employees')),
    comment: v.optional(v.string()),
    month: v.optional(v.string()),
  },
  handler: async (ctx, { id, name, type, status, managerIds, comment, month }) => {
    const me = await requireEmployee(ctx)
    if (me.role !== 'owner') throw new ConvexError('Объекты продаж настраивает только владелец')
    if (month) assertWritableSalesMonth(month)
    const cleanName = name.trim()
    if (!cleanName) throw new ConvexError('Название объекта продаж обязательно')
    const salesIds = new Set((await salesEmployees(ctx, me.role === 'owner')).map((e) => e._id))
    // §2.1.5 дополнения: пересечение ответственности между менеджерами по
    // одному объекту в текущей версии не предусматривается.
    const cleanManagers = managerIds.filter((mid) => salesIds.has(mid))
    if (cleanManagers.length > 1) {
      throw new ConvexError('У объекта продаж может быть только один ответственный менеджер')
    }
    if (id) {
      const current = await ctx.db.get(id)
      // §2.1.4: «Другое» — системный объект. Переименовать или отключить его
      // нельзя: без него обращения вне активных объектов некуда относить.
      if (current?.system) {
        await ctx.db.patch(id, { managerIds: cleanManagers, comment: cleanComment(comment) })
        return id
      }
      await ctx.db.patch(id, {
        name: cleanName,
        type,
        status,
        managerIds: cleanManagers,
        comment: cleanComment(comment),
      })
      return id
    }
    const objectId = await ctx.db.insert('salesObjects', {
      name: cleanName,
      type,
      status,
      managerIds: cleanManagers,
      comment: cleanComment(comment),
      createdAt: Date.now(),
      // Автор объекта (§6.2 ТЗ таргетолога): справочник общий, и по истории
      // должно быть видно, кто его завёл.
      createdBy: me._id,
    })
    if (month) {
      const monthStatus = status === 'active' ? 'selling' : 'not_selling'
      await ctx.db.insert('salesObjectMonths', {
        objectId,
        month,
        objectStatus: status,
        status: monthStatus,
        managerPlans: cleanManagers.map((managerId) => ({ managerId, planDeals: 0 })),
      })
    }
    return objectId
  },
})

export const upsertMonth = mutation({
  args: {
    objectId: v.id('salesObjects'),
    month: v.string(),
    objectStatus: v.optional(objectStatusV),
    status: monthStatusV,
    managerPlans: managerPlansV,
  },
  handler: async (ctx, { objectId, month, objectStatus, status, managerPlans }) => {
    const me = await requireEmployee(ctx)
    if (me.role !== 'owner') throw new ConvexError('Месяц продаж настраивает только владелец')
    assertWritableSalesMonth(month)
    const object = await ctx.db.get(objectId)
    if (!object) throw new ConvexError('Объект продаж не найден')
    const effectiveObjectStatus = objectStatus ?? object.status
    const effectiveMonthStatus = effectiveObjectStatus === 'active' ? status : 'not_selling'
    const salesIds = new Set((await salesEmployees(ctx, me.role === 'owner')).map((e) => e._id))
    const clean = managerPlans
      .filter((p) => salesIds.has(p.managerId))
      .map((p) => ({
        managerId: p.managerId,
        planDeals: Math.max(0, Math.floor(p.planDeals || 0)),
      }))
    // §2.1.5: один объект — один ответственный менеджер и в настройке месяца.
    if (clean.length > 1) {
      throw new ConvexError('У объекта продаж может быть только один ответственный менеджер')
    }
    const existing = await monthSetting(ctx, objectId, month)
    if (existing) {
      await ctx.db.patch(existing._id, { objectStatus: effectiveObjectStatus, status: effectiveMonthStatus, managerPlans: clean })
    } else {
      await ctx.db.insert('salesObjectMonths', {
        objectId,
        month,
        objectStatus: effectiveObjectStatus,
        status: effectiveMonthStatus,
        managerPlans: clean,
      })
    }
  },
})

// §2.1.4 дополнения: системный объект «Другое». Сюда таргетолог относит
// обращения, которые нельзя привязать к конкретному активному объекту продаж.
// Создаётся один раз и дальше живёт как обычный объект, только защищён от
// переименования и удаления.
export const OTHER_OBJECT_NAME = 'Другое'

export const ensureOther = mutation({
  args: { month: v.optional(v.string()) },
  handler: async (ctx, { month }) => {
    const me = await requireEmployee(ctx)
    if (me.role !== 'owner') throw new ConvexError('Системный объект заводит владелец')
    const existing = (await ctx.db.query('salesObjects').collect()).find(
      (o) => o.system || o.name.trim().toLowerCase() === OTHER_OBJECT_NAME.toLowerCase(),
    )
    if (existing) {
      if (!existing.system) await ctx.db.patch(existing._id, { system: true })
      if (existing.status !== 'active') await ctx.db.patch(existing._id, { status: 'active' })
      return existing._id
    }
    const objectId = await ctx.db.insert('salesObjects', {
      name: OTHER_OBJECT_NAME,
      type: 'service',
      status: 'active',
      system: true,
      managerIds: [],
      comment: 'Обращения, которые нельзя отнести к конкретному объекту продаж',
      createdAt: Date.now(),
      createdBy: me._id,
    })
    const m = month ?? businessMonth()
    await ctx.db.insert('salesObjectMonths', {
      objectId,
      month: m,
      objectStatus: 'active',
      status: 'selling',
      managerPlans: [],
    })
    return objectId
  },
})

// Есть ли системный объект — чтобы интерфейс мог предложить его завести.
export const otherObject = query({
  args: {},
  handler: async (ctx) => {
    const me = await currentEmployee(ctx)
    if (!me) return null
    const row = (await ctx.db.query('salesObjects').collect()).find(
      (o) => o.system || o.name.trim().toLowerCase() === OTHER_OBJECT_NAME.toLowerCase(),
    )
    return row ? { _id: row._id, name: row.name, status: row.status } : null
  },
})

// ——— Ежедневный отчёт менеджера ———

export const assignedObjects = query({
  args: { date: v.string() },
  handler: async (ctx, { date }) => {
    const me = await currentEmployee(ctx)
    if (!me || me.role === 'owner' || me.position !== 'sales') return []
    const month = date.slice(0, 7)
    const rows = await ctx.db
      .query('salesObjectMonths')
      .withIndex('by_month', (q) => q.eq('month', month))
      .collect()
    // Какие объекты за эту дату уже сданы — по ним в форме рисуется галочка
    // и считается счётчик «Сдано отчётов: X из Y» (дополнение 1.4, п.8).
    const submitted = new Set(
      (
        await ctx.db
          .query('salesObjectReports')
          .withIndex('by_employee', (q) => q.eq('employeeId', me._id))
          .collect()
      )
        .filter((r) => r.date === date)
        .map((r) => r.objectId as string),
    )

    // §2.3.1: сохранённое таргетологом количество заявок показывается
    // менеджеру в его отчёте — только для просмотра.
    const leads = await targetLeadsByObjectDate(ctx, date, date)

    const out = []
    for (const row of rows) {
      const plan = row.managerPlans.find((p) => p.managerId === me._id)
      if (!plan) continue
      const object = await ctx.db.get(row.objectId)
      if (!object || (row.objectStatus ?? object.status) !== 'active') continue
      out.push({
        ...object,
        planDeals: plan.planDeals,
        submitted: submitted.has(object._id),
        // null — таргетолог ещё не заполнил отчёт за этот день.
        leads: leads.get(`${object._id}|${date}`) ?? null,
      })
    }
    out.sort((a, b) => a.name.localeCompare(b.name, 'ru'))
    return out
  },
})

export const daily = query({
  args: { date: v.string(), objectId: v.id('salesObjects') },
  handler: async (ctx, { date, objectId }) => {
    const me = await currentEmployee(ctx)
    if (!me) return null
    return await ctx.db
      .query('salesObjectReports')
      .withIndex('by_employee_date_object', (q) =>
        q.eq('employeeId', me._id).eq('date', date).eq('objectId', objectId),
      )
      .first()
  },
})

export const dayForEmployee = query({
  args: { employeeId: v.id('employees'), date: v.string() },
  handler: async (ctx, { employeeId, date }) => {
    const viewer = await currentEmployee(ctx)
    if (!viewer) return null
    const employee = await ctx.db.get(employeeId)
    if (!employee || employee.position !== 'sales') return null
    const isSelf = viewer._id === employeeId
    const mayView =
      isSelf ||
      viewer.role === 'owner' ||
      (isManager(viewer) && inScope(viewer, employee) && (await can(ctx, 'reports', 'view')))
    if (!mayView) return null

    const month = date.slice(0, 7)
    const reports = (
      await ctx.db
        .query('salesObjectReports')
        .withIndex('by_employee', (q) => q.eq('employeeId', employeeId))
        .collect()
    ).filter((r) => r.date === date)
    const objectIds = new Set<Id<'salesObjects'>>(reports.map((r) => r.objectId))
    const monthRows = await ctx.db
      .query('salesObjectMonths')
      .withIndex('by_month', (q) => q.eq('month', month))
      .collect()
    for (const row of monthRows) {
      const object = await ctx.db.get(row.objectId)
      if (!object || (row.objectStatus ?? object.status) !== 'active') continue
      if (row.managerPlans.some((p) => p.managerId === employeeId)) objectIds.add(row.objectId)
    }

    const closed = await isMonthClosed(ctx, month)
    const canEdit =
      !closed &&
      (viewer.role === 'owner' ||
        (isManager(viewer) && inScope(viewer, employee) && (await can(ctx, 'reports', 'edit'))))

    const leads = await targetLeadsByObjectDate(ctx, date, date)

    const out = []
    for (const objectId of objectIds) {
      const object = await ctx.db.get(objectId)
      if (!object) continue
      const setting = monthRows.find((r) => r.objectId === objectId)
      const planDeals = planForEmployee(setting, employeeId)
      const report = reports.find((r) => r.objectId === objectId) ?? null
      const effectiveObjectStatus = setting?.objectStatus ?? object.status
      if (!report && (effectiveObjectStatus !== 'active' || !setting)) continue
      // §2.3: заявки приходят из отчёта таргетолога и здесь тоже только
      // для просмотра.
      out.push({ object, report, planDeals, leads: leads.get(`${objectId}|${date}`) ?? null })
    }
    out.sort((a, b) => a.object.name.localeCompare(b.object.name, 'ru'))
    return { rows: out, canEdit, closed }
  },
})

export const submitDaily = mutation({
  args: salesReportArgs,
  handler: async (ctx, args) => {
    const me = await requireEmployee(ctx)
    if (me.role === 'owner' || me.position !== 'sales') {
      throw new ConvexError('Объектный отчёт продаж доступен менеджерам отдела продаж')
    }
    const today = businessToday()
    if (args.date > today) throw new ConvexError('Отчёт за будущую дату сдать нельзя')
    const time = await deadlineTime(ctx)
    if (Date.now() > deadlineMs(args.date, time)) {
      throw new ConvexError('Дедлайн прошёл — отчёт за этот день может изменить только администратор')
    }
    const month = args.date.slice(0, 7)
    if (await isMonthClosed(ctx, month)) {
      throw new ConvexError('Месяц закрыт — отчёты за него больше не принимаются')
    }
    await ensureAssignedObject(ctx, me._id, args.objectId, month)

    assertWholeNonNegative(args.newConsultations, 'Новые консультации')
    assertWholeNonNegative(args.repeatConsultations, 'Повторные консультации')
    assertWholeNonNegative(args.newMeetings, 'Новые встречи / Zoom')
    assertWholeNonNegative(args.repeatMeetings, 'Повторные встречи / Zoom')
    assertWholeNonNegative(args.newPrepayments, 'Новые подписанные договоры')
    assertWholeNonNegative(args.newDeals, 'Новые сделки')
    assertMoney(args.revenue)
    if (args.leadsHint !== undefined) {
      assertWholeNonNegative(args.leadsHint, 'Заявки, недоступные таргетологу')
    }

    const existing = await ctx.db
      .query('salesObjectReports')
      .withIndex('by_employee_date_object', (q) =>
        q.eq('employeeId', me._id).eq('date', args.date).eq('objectId', args.objectId),
      )
      .first()
    const now = Date.now()
    const payload = {
      // §2.3: показатель принадлежит таргетологу. У новых записей поле
      // нулевое, у старых сохраняется как есть — история не переписывается.
      newLeads: existing?.newLeads ?? 0,
      leadsHint: args.leadsHint,
      leadsHintNote: cleanComment(args.leadsHintNote),
      newConsultations: args.newConsultations,
      repeatConsultations: args.repeatConsultations,
      newMeetings: args.newMeetings,
      repeatMeetings: args.repeatMeetings,
      newPrepayments: args.newPrepayments,
      newDeals: args.newDeals,
      revenue: args.revenue,
      comment: cleanComment(args.comment),
    }

    if (existing) {
      await ctx.db.patch(existing._id, { ...payload, editedAt: now, editCount: existing.editCount + 1 })
    } else {
      await ctx.db.insert('salesObjectReports', {
        employeeId: me._id,
        objectId: args.objectId,
        date: args.date,
        month,
        ...payload,
        submittedAt: now,
        editCount: 0,
      })
    }
    await syncLegacyDailyReport(ctx, me._id, args.date, me._id, existing ? 'edited' : 'submitted')
    // §6 ТЗ Telegram: администратору уходит сводка по заполненному отчёту.
    // Ключ уведомления привязан к дате, поэтому правка второго объекта за тот
    // же день второго сообщения не создаёт.
    const object = await ctx.db.get(args.objectId)
    await notifyReportFilled(
      ctx,
      me._id,
      args.date,
      `Продажи · ${object?.name ?? 'объект'}: консультаций ${args.newConsultations}, ` +
        `встреч ${args.newMeetings}, сделок ${args.newDeals}`,
    )
  },
})

export const ownerSetDaily = mutation({
  args: {
    employeeId: v.id('employees'),
    ...salesReportArgs,
  },
  handler: async (ctx, args) => {
    const me = await requireCan(ctx, 'reports', 'edit')
    const employee = await ctx.db.get(args.employeeId)
    if (!employee || employee.position !== 'sales') {
      throw new ConvexError('Сотрудник отдела продаж не найден')
    }
    if (!inScope(me, employee)) {
      throw new ConvexError('Можно править отчёты только сотрудников в вашем доступе')
    }
    if (args.date > businessToday()) throw new ConvexError('Отчёт за будущую дату внести нельзя')
    const month = args.date.slice(0, 7)
    if (await isMonthClosed(ctx, month)) {
      throw new ConvexError('Месяц закрыт — отчёты за него больше не изменяются')
    }

    assertWholeNonNegative(args.newConsultations, 'Новые консультации')
    assertWholeNonNegative(args.repeatConsultations, 'Повторные консультации')
    assertWholeNonNegative(args.newMeetings, 'Новые встречи / Zoom')
    assertWholeNonNegative(args.repeatMeetings, 'Повторные встречи / Zoom')
    assertWholeNonNegative(args.newPrepayments, 'Новые подписанные договоры')
    assertWholeNonNegative(args.newDeals, 'Новые сделки')
    assertMoney(args.revenue)

    const existing = await ctx.db
      .query('salesObjectReports')
      .withIndex('by_employee_date_object', (q) =>
        q.eq('employeeId', args.employeeId).eq('date', args.date).eq('objectId', args.objectId),
      )
      .first()
    if (!existing) await ensureAssignedObject(ctx, args.employeeId, args.objectId, month)

    const now = Date.now()
    const payload = {
      // §2.3: заявки правит таргетолог в своём отчёте, даже администратору
      // они здесь не принадлежат.
      newLeads: existing?.newLeads ?? 0,
      leadsHint: args.leadsHint ?? existing?.leadsHint,
      leadsHintNote: cleanComment(args.leadsHintNote) ?? existing?.leadsHintNote,
      newConsultations: args.newConsultations,
      repeatConsultations: args.repeatConsultations,
      newMeetings: args.newMeetings,
      repeatMeetings: args.repeatMeetings,
      newPrepayments: args.newPrepayments,
      newDeals: args.newDeals,
      revenue: args.revenue,
      comment: cleanComment(args.comment),
    }
    if (existing) {
      await ctx.db.patch(existing._id, { ...payload, editedAt: now, editCount: existing.editCount + 1 })
    } else {
      await ctx.db.insert('salesObjectReports', {
        employeeId: args.employeeId,
        objectId: args.objectId,
        date: args.date,
        month,
        ...payload,
        submittedAt: now,
        editedAt: now,
        editCount: 0,
      })
    }
    await syncLegacyDailyReport(ctx, args.employeeId, args.date, me._id, existing ? 'edited' : 'submitted')
  },
})

// ——— LIVE-воронка и дашборды ———

const summaryArgs = {
  month: v.optional(v.string()),
  // Границы периода включительно (§8). Без них берётся весь календарный
  // месяц — прежнее поведение сохраняется как вариант «Выбранный месяц».
  from: v.optional(v.string()),
  to: v.optional(v.string()),
  employeeId: v.optional(v.id('employees')),
  objectId: v.optional(v.id('salesObjects')),
}

type SummaryArgs = {
  month?: string
  from?: string
  to?: string
  employeeId?: Id<'employees'>
  objectId?: Id<'salesObjects'>
}

export const summary = query({
  args: summaryArgs,
  handler: (ctx, args) => salesSummary(ctx, args, () => currentEmployee(ctx)),
})

// Тело вынесено из query, чтобы dev-проверка могла прогнать тот же расчёт от
// имени конкретного сотрудника: в CLI личности нет, а сверять надо именно
// боевую логику, а не её копию.
export async function salesSummary(
  ctx: QueryCtx,
  { month: arg, from: fromArg, to: toArg, employeeId, objectId }: SummaryArgs,
  viewer: () => Promise<Doc<'employees'> | null>,
) {
  {
    const month = arg ?? businessMonth()
    // Перепутанные местами даты не должны давать пустой отчёт.
    const a = fromArg ?? `${month}-01`
    const b = toArg ?? monthEnd(month)
    const from = a <= b ? a : b
    const to = a <= b ? b : a
    const months = monthsBetween(from, to)
    // План задаётся на календарный месяц. Если период — не целый месяц,
    // сравнивать факт не с чем: план не показываем, а не делим его на глаз.
    const planMonth =
      months.length === 1 && from === `${months[0]}-01` && to === monthEnd(months[0])
        ? months[0]
        : null
    const period = { from, to, planApplies: planMonth !== null }
    const me = await viewer()
    const empty = {
      leads: 0,
      meetings: 0,
      deals: 0,
      revenue: 0,
      days: 0,
      planRevenue: 0,
      period,
      totals: buildAnalytics(zeroTotals(), 0),
      objectRows: [] as unknown[],
      managerRows: [] as unknown[],
      objects: [] as unknown[],
    }
    if (!me || (!isManager(me) && me.position !== 'sales')) return empty

    const allEmployees = await ctx.db.query('employees').collect()
    const employeeById = new Map(allEmployees.map((e) => [e._id, e]))
    const hidden = await hiddenEmployeeIds(ctx)
    const ownerCanSeeHidden = me.role === 'owner'

    let visibleEmployeeIds = new Set<Id<'employees'>>()
    if (employeeId) {
      if (!(await maySeeEmployee(me, employeeId, ctx))) return empty
      if (ownerCanSeeHidden || !hidden.has(employeeId)) visibleEmployeeIds.add(employeeId)
    } else if (me.role === 'owner') {
      for (const e of allEmployees) {
        if (e.status === 'active' && e.role !== 'owner' && e.position === 'sales') visibleEmployeeIds.add(e._id)
      }
    } else if (me.role === 'head') {
      for (const e of allEmployees) {
        if (!hidden.has(e._id) && e.role !== 'owner' && e.position === 'sales' && e.department === me.department) {
          visibleEmployeeIds.add(e._id)
        }
      }
    } else {
      visibleEmployeeIds.add(me._id)
    }

    const objects = await ctx.db.query('salesObjects').collect()
    const objectById = new Map(objects.map((o) => [o._id, o]))
    // Настройки берём по всем месяцам периода — период может пересечь границу
    // месяца. Месяцы идут по возрастанию, поэтому в settingByObject остаётся
    // самая свежая строка: статус объекта — это его состояние к концу периода.
    const monthRows = (
      await Promise.all(
        months.map((m) =>
          ctx.db
            .query('salesObjectMonths')
            .withIndex('by_month', (q) => q.eq('month', m))
            .collect(),
        ),
      )
    ).flat()
    const settingByObject = new Map<Id<'salesObjects'>, Doc<'salesObjectMonths'>>()
    const assignedByObject = new Map<Id<'salesObjects'>, Set<Id<'employees'>>>()
    for (const row of monthRows) {
      settingByObject.set(row.objectId, row)
      const assigned = assignedByObject.get(row.objectId) ?? new Set<Id<'employees'>>()
      for (const p of row.managerPlans) assigned.add(p.managerId)
      assignedByObject.set(row.objectId, assigned)
    }

    // §5: «Все активные объекты продаж» — именно активные. Приостановленные и
    // архивные в общий итог не входят ни количествами, ни конверсиями.
    const activeObjectIds = new Set(
      objects
        .filter((o) => (settingByObject.get(o._id)?.objectStatus ?? o.status) === 'active')
        .map((o) => o._id),
    )

    const objectOptions = objects
      .filter((o) => {
        if (!activeObjectIds.has(o._id)) return false
        const assigned = assignedByObject.get(o._id)
        return !assigned || [...assigned].some((id) => visibleEmployeeIds.has(id))
      })
      .map((o) => ({
        _id: o._id,
        name: o.name,
        type: o.type,
        status: o.status,
        selling: true,
      }))

    const reports = (
      await ctx.db
        .query('salesObjectReports')
        .withIndex('by_date', (q) => q.gte('date', from).lte('date', to))
        .collect()
    ).filter(
      (r) =>
        visibleEmployeeIds.has(r.employeeId) &&
        objectById.has(r.objectId) &&
        // Выбранный вручную объект показываем как есть; в сводном режиме —
        // только активные.
        (objectId ? r.objectId === objectId : activeObjectIds.has(r.objectId)),
    )
    // Строки планов — только целого месяца: за неделю плана не существует.
    const planRows = planMonth ? monthRows.filter((r) => r.month === planMonth) : []

    const totals = zeroTotals()
    const days = new Set(reports.map((r) => `${r.employeeId}:${r.date}`))
    const totalsByObject = new Map<string, SalesTotals>()
    const totalsByManager = new Map<string, SalesTotals>()
    for (const r of reports) {
      // §2.3: заявки из отчёта менеджера не берутся — они приходят слоем ниже,
      // из отчёта таргетолога. Всё остальное (консультации, встречи, договоры,
      // сделки, выручка) по-прежнему его.
      const withoutLeads = { ...r, newLeads: 0 }
      addTotals(totals, withoutLeads)
      const objectTotals = totalsByObject.get(r.objectId) ?? zeroTotals()
      addTotals(objectTotals, withoutLeads)
      totalsByObject.set(r.objectId, objectTotals)
      const managerTotals = totalsByManager.get(r.employeeId) ?? zeroTotals()
      addTotals(managerTotals, withoutLeads)
      totalsByManager.set(r.employeeId, managerTotals)
    }

    // §2.1, §2.3: количество заявок — показатель таргетолога, ключ «дата +
    // объект». Каждое значение попадает в расчёт РОВНО ОДИН РАЗ и относится к
    // единственному ответственному менеджеру объекта (§2.1.5, §2.1.6).
    const leadMap = await targetLeadsByObjectDate(ctx, from, to)
    // Переходный период: пока таргетолог не завёл день, показываем то, что
    // менеджеры вводили руками до этого дополнения. Это не суммирование —
    // запасное значение берётся только при полном отсутствии записи.
    const legacyLeads = new Map<string, number>()
    for (const r of reports) {
      if (r.newLeads > 0) legacyLeads.set(`${r.objectId}|${r.date}`, r.newLeads)
    }
    const inScopeObjectId = (oid: Id<'salesObjects'>) =>
      objectId ? oid === objectId : activeObjectIds.has(oid)
    // Объект без ответственного менеджера (например системный «Другое»)
    // виден в сводке команды, но не приписывается никому лично.
    const seesUnassigned = isManager(me) && !employeeId
    const leadObjectIds = new Set<Id<'salesObjects'>>()

    for (const key of new Set([...leadMap.keys(), ...legacyLeads.keys()])) {
      const sep = key.lastIndexOf('|')
      const oid = key.slice(0, sep) as Id<'salesObjects'>
      if (!objectById.has(oid) || !inScopeObjectId(oid)) continue
      const owner = responsibleManager(settingByObject.get(oid), objectById.get(oid))
      if (owner ? !visibleEmployeeIds.has(owner) : !seesUnassigned) continue
      const value = leadMap.get(key) ?? legacyLeads.get(key) ?? 0
      if (value <= 0) continue

      totals.newLeads += value
      const objectTotals = totalsByObject.get(oid) ?? zeroTotals()
      objectTotals.newLeads += value
      totalsByObject.set(oid, objectTotals)
      leadObjectIds.add(oid)
      if (owner) {
        const managerTotals = totalsByManager.get(owner) ?? zeroTotals()
        managerTotals.newLeads += value
        totalsByManager.set(owner, managerTotals)
      }
    }

    const planByObject = new Map(planRows.map((r) => [r.objectId, r]))
    const planDealsForObject = (oid: Id<'salesObjects'>) =>
      (planByObject.get(oid)?.managerPlans ?? [])
        .filter((p) => visibleEmployeeIds.has(p.managerId))
        .reduce((sum, p) => sum + p.planDeals, 0)
    // Сводный план — по тем же объектам, что и сводный факт (§5): иначе план
    // приостановленного объекта требовал бы сделок, которых уже никто не ждёт.
    const inScopeObject = inScopeObjectId
    const totalPlanDeals = planRows.reduce(
      (sum, row) =>
        sum +
        (inScopeObject(row.objectId)
          ? row.managerPlans
              .filter((p) => visibleEmployeeIds.has(p.managerId))
              .reduce((s, p) => s + p.planDeals, 0)
          : 0),
      0,
    )

    const objectIds = new Set<Id<'salesObjects'>>([
      ...reports.map((r) => r.objectId),
      // Объект, по которому за период есть только заявки таргетолога, тоже
      // строка воронки: без него «Другое» из §2.4 не появилось бы вовсе.
      ...leadObjectIds,
      ...planRows
        .filter((r) => inScopeObject(r.objectId))
        .filter((r) => r.managerPlans.some((p) => visibleEmployeeIds.has(p.managerId)))
        .map((r) => r.objectId),
    ])
    const objectRows = [...objectIds]
      .map((oid) => {
        const o = objectById.get(oid)
        if (!o) return null
        return {
          objectId: oid,
          name: o.name,
          type: o.type,
          status: o.status,
          ...buildAnalytics(totalsByObject.get(oid) ?? zeroTotals(), planDealsForObject(oid)),
        }
      })
      .filter((r): r is NonNullable<typeof r> => !!r)
      .sort((a, b) => b.newDeals - a.newDeals || a.name.localeCompare(b.name, 'ru'))

    const managerRows = [...visibleEmployeeIds]
      .map((eid) => {
        const e = employeeById.get(eid)
        if (!e) return null
        const planDeals = planRows.reduce(
          (sum, row) => sum + (inScopeObject(row.objectId) ? planForEmployee(row, eid) : 0),
          0,
        )
        return {
          employeeId: eid,
          name: e.name,
          initials: e.initials,
          avatarColor: e.avatarColor,
          positionLabel: e.positionLabel,
          ...buildAnalytics(totalsByManager.get(eid) ?? zeroTotals(), planDeals),
        }
      })
      .filter((r): r is NonNullable<typeof r> => !!r)
      .sort((a, b) => b.newDeals - a.newDeals || a.name.localeCompare(b.name, 'ru'))

    let planRevenue = 0
    if (employeeId && planMonth) {
      const plan = (
        await ctx.db
          .query('salesPlans')
          .withIndex('by_employee', (q) => q.eq('employeeId', employeeId))
          .collect()
      ).find((p) => p.month === planMonth)
      planRevenue = plan?.planRevenue ?? 0
    }

    return {
      leads: totals.newLeads,
      meetings: totals.newMeetings,
      deals: totals.newDeals,
      revenue: totals.revenue,
      days: days.size,
      planRevenue,
      period,
      totals: buildAnalytics(totals, totalPlanDeals),
      objectRows,
      managerRows,
      objects: objectOptions,
    }
  }
}

// Установить персональный план выручки на месяц (старый KPI продаж).
export const setPlan = mutation({
  args: { employeeId: v.id('employees'), month: v.string(), planRevenue: v.number() },
  handler: async (ctx, { employeeId, month, planRevenue }) => {
    const me = await requireCan(ctx, 'kpi', 'edit')
    const emp = await ctx.db.get(employeeId)
    if (emp && !inScope(me, emp)) throw new ConvexError('Можно менять планы только в вашем доступе')
    const row = (
      await ctx.db
        .query('salesPlans')
        .withIndex('by_employee', (q) => q.eq('employeeId', employeeId))
        .collect()
    ).find((p) => p.month === month)
    if (row) await ctx.db.patch(row._id, { planRevenue })
    else await ctx.db.insert('salesPlans', { employeeId, month, planRevenue })
    // §6 ТЗ Telegram: сотрудник узнаёт об изменении своего плана.
    await notifyPlanChanged(
      ctx,
      employeeId,
      'План выручки · отдел продаж',
      month,
      `Новое значение: ${planRevenue.toLocaleString('ru-RU')} ₸`,
    )
  },
})
