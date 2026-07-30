import { query, mutation } from './_generated/server'
import { v, ConvexError } from 'convex/values'
import type { QueryCtx, MutationCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { currentEmployee, requireEmployee, isManager, hiddenEmployeeIds } from './lib'
import { can, requireCan, inScope } from './permissions'
import { isMonthClosed } from './payroll'

const TZ = '+05:00'
const DEFAULT_DEADLINE = '23:50'

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

const salesReportArgs = {
  date: v.string(),
  objectId: v.id('salesObjects'),
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
}

type SalesReportFields = Pick<
  Doc<'salesObjectReports'>,
  | 'newLeads'
  | 'processedLeads'
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
  processedLeads: 0,
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

function deadlineMs(date: string, time: string): number {
  return Date.parse(`${date}T${time}:00${TZ}`)
}

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

function ratio(num: number, den: number): number | null {
  return den === 0 ? null : num / den
}

function buildAnalytics(t: SalesTotals, planDeals: number) {
  const totalConsultations = t.newConsultations + t.repeatConsultations
  const totalMeetings = t.newMeetings + t.repeatMeetings
  const totalInteractions = totalConsultations + totalMeetings
  return {
    ...t,
    planDeals,
    planCompletion: ratio(t.newDeals, planDeals),
    unprocessedLeads: t.newLeads - t.processedLeads,
    conversions: {
      consultation: ratio(t.newConsultations, t.newLeads),
      meeting: ratio(t.newMeetings, t.newConsultations),
      prepayment: ratio(t.newPrepayments, t.newMeetings),
      deal: ratio(t.newDeals, t.newPrepayments),
      total: ratio(t.newDeals, t.newLeads),
    },
    activity: {
      totalConsultations,
      avgConsultationsPerClient: ratio(totalConsultations, t.newConsultations),
      repeatConsultationShare: ratio(t.repeatConsultations, totalConsultations),
      totalMeetings,
      avgMeetingsPerClient: ratio(totalMeetings, t.newMeetings),
      repeatMeetingShare: ratio(t.repeatMeetings, totalMeetings),
      totalInteractions,
      interactionsPerDeal: ratio(totalInteractions, t.newDeals),
    },
  }
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
    setting.status !== 'selling' ||
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
    const cleanManagers = managerIds.filter((mid) => salesIds.has(mid))
    if (id) {
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
    })
    if (month) {
      await ctx.db.insert('salesObjectMonths', {
        objectId,
        month,
        objectStatus: status,
        status: 'not_selling',
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
    const out = []
    for (const row of rows) {
      if (row.status !== 'selling') continue
      const plan = row.managerPlans.find((p) => p.managerId === me._id)
      if (!plan) continue
      const object = await ctx.db.get(row.objectId)
      if (!object || (row.objectStatus ?? object.status) !== 'active') continue
      out.push({ ...object, planDeals: plan.planDeals })
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
      if (
        row.status === 'selling' &&
        row.managerPlans.some((p) => p.managerId === employeeId)
      ) {
        objectIds.add(row.objectId)
      }
    }

    const closed = await isMonthClosed(ctx, month)
    const canEdit =
      !closed &&
      (viewer.role === 'owner' ||
        (isManager(viewer) && inScope(viewer, employee) && (await can(ctx, 'reports', 'edit'))))

    const out = []
    for (const objectId of objectIds) {
      const object = await ctx.db.get(objectId)
      if (!object) continue
      const setting = monthRows.find((r) => r.objectId === objectId)
      const planDeals = planForEmployee(setting, employeeId)
      const report = reports.find((r) => r.objectId === objectId) ?? null
      const effectiveObjectStatus = setting?.objectStatus ?? object.status
      if (!report && (effectiveObjectStatus !== 'active' || setting?.status !== 'selling')) continue
      out.push({ object, report, planDeals })
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
      throw new ConvexError('Дедлайн прошёл — отчёт за этот день может изменить только владелец')
    }
    const month = args.date.slice(0, 7)
    if (await isMonthClosed(ctx, month)) {
      throw new ConvexError('Месяц закрыт — отчёты за него больше не принимаются')
    }
    await ensureAssignedObject(ctx, me._id, args.objectId, month)

    assertWholeNonNegative(args.newLeads, 'Новые заявки')
    assertWholeNonNegative(args.processedLeads, 'Обработано новых заявок')
    assertWholeNonNegative(args.newConsultations, 'Новые консультации')
    assertWholeNonNegative(args.repeatConsultations, 'Повторные консультации')
    assertWholeNonNegative(args.newMeetings, 'Новые встречи / Zoom')
    assertWholeNonNegative(args.repeatMeetings, 'Повторные встречи / Zoom')
    assertWholeNonNegative(args.newPrepayments, 'Новые предоплаты')
    assertWholeNonNegative(args.newDeals, 'Новые сделки')
    assertMoney(args.revenue)

    const existing = await ctx.db
      .query('salesObjectReports')
      .withIndex('by_employee_date_object', (q) =>
        q.eq('employeeId', me._id).eq('date', args.date).eq('objectId', args.objectId),
      )
      .first()
    const now = Date.now()
    const payload = {
      newLeads: args.newLeads,
      processedLeads: args.processedLeads,
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

    assertWholeNonNegative(args.newLeads, 'Новые заявки')
    assertWholeNonNegative(args.processedLeads, 'Обработано новых заявок')
    assertWholeNonNegative(args.newConsultations, 'Новые консультации')
    assertWholeNonNegative(args.repeatConsultations, 'Повторные консультации')
    assertWholeNonNegative(args.newMeetings, 'Новые встречи / Zoom')
    assertWholeNonNegative(args.repeatMeetings, 'Повторные встречи / Zoom')
    assertWholeNonNegative(args.newPrepayments, 'Новые предоплаты')
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
      newLeads: args.newLeads,
      processedLeads: args.processedLeads,
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

export const summary = query({
  args: {
    month: v.optional(v.string()),
    employeeId: v.optional(v.id('employees')),
    objectId: v.optional(v.id('salesObjects')),
  },
  handler: async (ctx, { month: arg, employeeId, objectId }) => {
    const month = arg ?? businessMonth()
    const me = await currentEmployee(ctx)
    const empty = {
      leads: 0,
      meetings: 0,
      deals: 0,
      revenue: 0,
      days: 0,
      planRevenue: 0,
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
    const monthRows = await ctx.db
      .query('salesObjectMonths')
      .withIndex('by_month', (q) => q.eq('month', month))
      .collect()
    const settingByObject = new Map(monthRows.map((r) => [r.objectId, r]))

    const objectOptions = objects
      .filter((o) => {
        const setting = settingByObject.get(o._id)
        const effectiveObjectStatus = setting?.objectStatus ?? o.status
        if (setting?.status === 'selling') {
          return effectiveObjectStatus === 'active' && setting.managerPlans.some((p) => visibleEmployeeIds.has(p.managerId))
        }
        return effectiveObjectStatus === 'active'
      })
      .map((o) => ({
        _id: o._id,
        name: o.name,
        type: o.type,
        status: o.status,
        selling: settingByObject.get(o._id)?.status === 'selling',
      }))

    const reports = (
      await ctx.db
        .query('salesObjectReports')
        .withIndex('by_month', (q) => q.eq('month', month))
        .collect()
    ).filter(
      (r) =>
        visibleEmployeeIds.has(r.employeeId) &&
        (!objectId || r.objectId === objectId) &&
        objectById.has(r.objectId),
    )

    const totals = zeroTotals()
    const days = new Set(reports.map((r) => `${r.employeeId}:${r.date}`))
    const totalsByObject = new Map<string, SalesTotals>()
    const totalsByManager = new Map<string, SalesTotals>()
    for (const r of reports) {
      addTotals(totals, r)
      const objectTotals = totalsByObject.get(r.objectId) ?? zeroTotals()
      addTotals(objectTotals, r)
      totalsByObject.set(r.objectId, objectTotals)
      const managerTotals = totalsByManager.get(r.employeeId) ?? zeroTotals()
      addTotals(managerTotals, r)
      totalsByManager.set(r.employeeId, managerTotals)
    }

    const planDealsForObject = (oid: Id<'salesObjects'>) =>
      (settingByObject.get(oid)?.managerPlans ?? [])
        .filter((p) => visibleEmployeeIds.has(p.managerId))
        .reduce((sum, p) => sum + p.planDeals, 0)
    const totalPlanDeals = monthRows.reduce(
      (sum, row) =>
        sum +
        (objectId && row.objectId !== objectId
          ? 0
          : row.managerPlans
              .filter((p) => visibleEmployeeIds.has(p.managerId))
              .reduce((s, p) => s + p.planDeals, 0)),
      0,
    )

    const objectIds = new Set<Id<'salesObjects'>>([
      ...reports.map((r) => r.objectId),
      ...monthRows
        .filter((r) => !objectId || r.objectId === objectId)
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
        const planDeals = monthRows.reduce(
          (sum, row) =>
            sum +
            (objectId && row.objectId !== objectId
              ? 0
              : planForEmployee(row, eid)),
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
    if (employeeId) {
      const plan = (
        await ctx.db
          .query('salesPlans')
          .withIndex('by_employee', (q) => q.eq('employeeId', employeeId))
          .collect()
      ).find((p) => p.month === month)
      planRevenue = plan?.planRevenue ?? 0
    }

    return {
      leads: totals.newLeads,
      meetings: totals.newMeetings,
      deals: totals.newDeals,
      revenue: totals.revenue,
      days: days.size,
      planRevenue,
      totals: buildAnalytics(totals, totalPlanDeals),
      objectRows,
      managerRows,
      objects: objectOptions,
    }
  },
})

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
  },
})
