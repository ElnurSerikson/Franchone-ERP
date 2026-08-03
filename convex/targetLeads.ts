// Планы и KPI таргетолога по объектам продаж (ТАРГЕТ 1.6).
//
// Ключевой принцип дополнения (§1): рекламные кампании оцениваются по своим
// техническим результатам, а эффективность маркетинга объекта продаж — по
// ОБЩЕМУ рекламному расходу и ОБЩЕМУ количеству новых заявок за тот же период.
//
// Отсюда два независимых слоя данных (§2):
//  • рекламная аналитика — targetReportRows, расход и технический результат
//    каждой кампании (модуль target.ts);
//  • бизнес-результат — targetLeadReports, одно число заявок на объект за день.
//
// Заявки НИКОГДА не распределяются по кампаниям, целям и объявлениям (§14):
// на этих уровнях считается только расход и технический результат. Это и
// исключает ложную атрибуцию.

import { query, mutation } from './_generated/server'
import { v, ConvexError } from 'convex/values'
import type { QueryCtx, MutationCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { currentEmployee, requireEmployee, isManager, hiddenEmployeeIds } from './lib'
import { resultCostCents } from './campaignGoals'

function businessToday(): string {
  return new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 10)
}

function businessMonth(): string {
  return businessToday().slice(0, 7)
}

// ТЗ СИСТЕМА §2: отчёт за календарный день заполняется до 14:00 СЛЕДУЮЩЕГО
// дня; после этого его вносит и правит только администратор (§2.3, §15).
async function deadlineTime(ctx: QueryCtx | MutationCtx): Promise<string> {
  const s = await ctx.db
    .query('settings')
    .withIndex('by_key', (q) => q.eq('key', 'global'))
    .first()
  return s?.reportDeadlineTime ?? '14:00'
}

function deadlineMs(date: string, time: string): number {
  const next = new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10)
  return Date.parse(`${next}T${time}:00+05:00`)
}

function assertWholeNonNegative(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0 || Math.floor(value) !== value) {
    throw new ConvexError(`${label}: укажите целое неотрицательное число`)
  }
}

async function requireAdmin(ctx: MutationCtx): Promise<Doc<'employees'>> {
  const me = await requireEmployee(ctx)
  // §15: планы и веса KPI создаёт и меняет только администратор.
  if (me.role !== 'owner') throw new ConvexError('Планы таргетолога ведёт администратор')
  return me
}

// ——— Календарь периода ———

export function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}

export function daysInMonth(month: string): number {
  return Number(monthEnd(month).slice(8))
}

export function monthsBetween(from: string, to: string): string[] {
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

// Сколько календарных дней месяца попало в период (§13.3).
export function daysOfMonthInPeriod(month: string, from: string, to: string): number {
  const start = from > `${month}-01` ? from : `${month}-01`
  const end = to < monthEnd(month) ? to : monthEnd(month)
  if (start > end) return 0
  return Number(end.slice(8)) - Number(start.slice(8)) + 1
}

// §13.3: план на неполный период считается пропорционально календарным дням.
// Если период задевает несколько месяцев, доля каждого считается отдельно и
// затем суммируется. Целый месяц даёт ровно месячный план.
export function proratePlan(planForMonth: number, month: string, from: string, to: string): number {
  const inPeriod = daysOfMonthInPeriod(month, from, to)
  if (inPeriod === 0) return 0
  const total = daysInMonth(month)
  if (inPeriod === total) return planForMonth
  return (planForMonth * inPeriod) / total
}

// ——— Права видимости ———

// Каких таргетологов видит смотрящий. Администратор — всех, таргетолог —
// только себя (§15).
async function visibleTargetologs(
  ctx: QueryCtx,
  me: Doc<'employees'>,
  only?: Id<'employees'>,
): Promise<Set<string>> {
  const hidden = await hiddenEmployeeIds(ctx)
  const out = new Set<string>()
  if (!isManager(me)) {
    if (me.position === 'targetolog' && (!only || only === me._id)) out.add(me._id as string)
    return out
  }
  for (const e of await ctx.db.query('employees').collect()) {
    if (e.role === 'owner' || e.position !== 'targetolog' || e.status !== 'active') continue
    if (hidden.has(e._id) && me.role !== 'owner') continue
    if (only && e._id !== only) continue
    out.add(e._id as string)
  }
  return out
}

// ——— §3, §4: планы администратора ———

export const plans = query({
  args: { month: v.optional(v.string()) },
  handler: async (ctx, { month: arg }) => {
    const month = arg ?? businessMonth()
    const me = await currentEmployee(ctx)
    if (!me) return { month, rows: [], objects: [], targetologs: [] }

    const visible = await visibleTargetologs(ctx, me)
    const objects = (await ctx.db.query('salesObjects').collect()).filter(
      (o) => o.status === 'active',
    )
    const objectName = new Map(objects.map((o) => [o._id as string, o.name]))
    const employees = await ctx.db.query('employees').collect()
    const empById = new Map(employees.map((e) => [e._id as string, e]))

    const rows = (
      await ctx.db
        .query('targetLeadPlans')
        .withIndex('by_month', (q) => q.eq('month', month))
        .collect()
    )
      .filter((p) => visible.has(p.employeeId as string))
      .map((p) => ({
        _id: p._id,
        employeeId: p.employeeId,
        employeeName: empById.get(p.employeeId as string)?.name ?? '—',
        objectId: p.objectId,
        objectName: objectName.get(p.objectId as string) ?? 'Объект удалён',
        month: p.month,
        planLeads: p.planLeads,
        planBudgetCents: p.planBudgetCents ?? null,
        // §4: плановая стоимость заявки считается только когда задан бюджет.
        planCostCents:
          p.planBudgetCents !== undefined && p.planLeads > 0
            ? p.planBudgetCents / p.planLeads
            : null,
      }))
      .sort((a, b) => a.employeeName.localeCompare(b.employeeName, 'ru') || a.objectName.localeCompare(b.objectName, 'ru'))

    return {
      month,
      rows,
      objects: objects.map((o) => ({ _id: o._id, name: o.name })),
      targetologs: [...visible]
        .map((id) => empById.get(id))
        .filter((e): e is Doc<'employees'> => !!e)
        .map((e) => ({ _id: e._id, name: e.name }))
        .sort((a, b) => a.name.localeCompare(b.name, 'ru')),
    }
  },
})

export const setPlan = mutation({
  args: {
    employeeId: v.id('employees'),
    objectId: v.id('salesObjects'),
    month: v.string(),
    planLeads: v.number(),
    // null стирает бюджет, undefined оставляет как есть (§4: поле необязательное).
    planBudgetCents: v.optional(v.union(v.number(), v.null())),
  },
  handler: async (ctx, { employeeId, objectId, month, planLeads, planBudgetCents }) => {
    const me = await requireAdmin(ctx)

    const employee = await ctx.db.get(employeeId)
    if (!employee || employee.position !== 'targetolog') {
      throw new ConvexError('План заявок ставится таргетологу')
    }
    const object = await ctx.db.get(objectId)
    if (!object) throw new ConvexError('Объект продаж не найден')
    if (object.status !== 'active') throw new ConvexError('Объект продаж не активен')
    if (!/^\d{4}-\d{2}$/.test(month)) throw new ConvexError('Неверный месяц')

    // §3: план заявок — обязательное целое положительное число.
    assertWholeNonNegative(planLeads, 'План заявок')
    if (planLeads <= 0) throw new ConvexError('План заявок должен быть больше нуля')
    if (planBudgetCents !== undefined && planBudgetCents !== null) {
      if (!Number.isFinite(planBudgetCents) || planBudgetCents < 0) {
        throw new ConvexError('Плановый бюджет должен быть неотрицательным')
      }
    }

    // §3: для тройки «таргетолог + объект + месяц» план может быть только один.
    const existing = (
      await ctx.db
        .query('targetLeadPlans')
        .withIndex('by_employee_month', (q) => q.eq('employeeId', employeeId).eq('month', month))
        .collect()
    ).find((p) => p.objectId === objectId)

    const nextBudget =
      planBudgetCents === undefined
        ? existing?.planBudgetCents
        : planBudgetCents === null
          ? undefined
          : Math.round(planBudgetCents)

    if (existing) {
      const changed =
        existing.planLeads !== planLeads || (existing.planBudgetCents ?? null) !== (nextBudget ?? null)
      if (!changed) return existing._id
      // §15: изменения плана уходят в журнал со старым и новым значением.
      await ctx.db.insert('targetLeadAudit', {
        kind: 'plan',
        employeeId,
        objectId,
        period: month,
        at: Date.now(),
        byId: me._id,
        fromLeads: existing.planLeads,
        toLeads: planLeads,
        fromBudgetCents: existing.planBudgetCents,
        toBudgetCents: nextBudget,
      })
      await ctx.db.patch(existing._id, { planLeads, planBudgetCents: nextBudget })
      return existing._id
    }

    const id = await ctx.db.insert('targetLeadPlans', {
      employeeId,
      objectId,
      month,
      planLeads,
      planBudgetCents: nextBudget,
    })
    await ctx.db.insert('targetLeadAudit', {
      kind: 'plan',
      employeeId,
      objectId,
      period: month,
      at: Date.now(),
      byId: me._id,
      toLeads: planLeads,
      toBudgetCents: nextBudget,
    })
    return id
  },
})

export const removePlan = mutation({
  args: { planId: v.id('targetLeadPlans') },
  handler: async (ctx, { planId }) => {
    const me = await requireAdmin(ctx)
    const plan = await ctx.db.get(planId)
    if (!plan) return
    await ctx.db.insert('targetLeadAudit', {
      kind: 'plan',
      employeeId: plan.employeeId,
      objectId: plan.objectId,
      period: plan.month,
      at: Date.now(),
      byId: me._id,
      fromLeads: plan.planLeads,
      fromBudgetCents: plan.planBudgetCents,
    })
    await ctx.db.delete(planId)
  },
})

// ——— §6: второй ежедневный отчёт «Количество заявок по объектам продаж» ———

export const day = query({
  args: { date: v.optional(v.string()), employeeId: v.optional(v.id('employees')) },
  handler: async (ctx, { date, employeeId }) => {
    const me = await currentEmployee(ctx)
    const target = date ?? businessToday()
    const empty = {
      date: target,
      today: businessToday(),
      editable: false,
      rows: [] as unknown[],
      filled: 0,
      total: 0,
      totalLeads: 0,
      complete: false,
    }
    if (!me) return empty

    // Смотреть чужой отчёт может только администратор (§15).
    const owner = employeeId ?? me._id
    if (owner !== me._id && !isManager(me)) return empty
    const employee = await ctx.db.get(owner)
    if (!employee || employee.position !== 'targetolog') return empty

    // §6.1: поле показывается по каждому активному объекту продаж.
    const objects = (await ctx.db.query('salesObjects').collect())
      .filter((o) => o.status === 'active')
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'))

    const saved = (
      await ctx.db
        .query('targetLeadReports')
        .withIndex('by_employee_date', (q) => q.eq('employeeId', owner).eq('date', target))
        .collect()
    )
    const byObject = new Map(saved.map((r) => [r.objectId as string, r]))

    const rows = objects.map((o) => {
      const row = byObject.get(o._id as string)
      return {
        objectId: o._id,
        name: o.name,
        type: o.type,
        // null — поле не заполнено. 0 — заполнено, заявок не было (§6.1).
        leads: row ? row.leads : null,
        updatedAt: row?.updatedAt ?? null,
      }
    })

    const filled = rows.filter((r) => r.leads !== null).length
    return {
      date: target,
      today: businessToday(),
      // Свой отчёт таргетолог правит сам до дедлайна (ТЗ СИСТЕМА §2.2);
      // после — только администратор, и он же правит чужой (§15).
      editable:
        target <= businessToday() &&
        (owner === me._id
          ? me.position === 'targetolog' &&
            Date.now() <= deadlineMs(target, await deadlineTime(ctx))
          : isManager(me)),
      rows,
      filled,
      total: rows.length,
      totalLeads: rows.reduce((s, r) => s + (r.leads ?? 0), 0),
      complete: rows.length > 0 && filled === rows.length,
    }
  },
})

export const saveDay = mutation({
  args: {
    date: v.string(),
    employeeId: v.optional(v.id('employees')),
    rows: v.array(
      v.object({
        objectId: v.id('salesObjects'),
        // null стирает значение — поле снова считается незаполненным (§6.1).
        leads: v.union(v.number(), v.null()),
      }),
    ),
  },
  handler: async (ctx, { date, employeeId, rows }) => {
    const me = await requireEmployee(ctx)
    const owner = employeeId ?? me._id
    if (owner !== me._id && me.role !== 'owner') {
      throw new ConvexError('Чужой отчёт по заявкам правит администратор')
    }
    const employee = await ctx.db.get(owner)
    if (!employee || employee.position !== 'targetolog') {
      throw new ConvexError('Отчёт по заявкам ведёт таргетолог')
    }
    if (date > businessToday()) throw new ConvexError('Отчёт за будущую дату внести нельзя')
    // §2.2: сотрудник не может внести или изменить отчёт после дедлайна.
    // Администратору это разрешено (§2.3).
    if (
      owner === me._id &&
      me.role !== 'owner' &&
      Date.now() > deadlineMs(date, await deadlineTime(ctx))
    ) {
      throw new ConvexError(
        'Дедлайн прошёл — заявки за этот день может внести только администратор',
      )
    }

    const now = Date.now()
    for (const r of rows) {
      if (r.leads !== null) assertWholeNonNegative(r.leads, 'Количество заявок')

      const existing = (
        await ctx.db
          .query('targetLeadReports')
          .withIndex('by_employee_date_object', (q) =>
            q.eq('employeeId', owner).eq('date', date).eq('objectId', r.objectId),
          )
          .first()
      )

      if (r.leads === null) {
        if (!existing) continue
        await ctx.db.insert('targetLeadAudit', {
          kind: 'leads',
          employeeId: owner,
          objectId: r.objectId,
          period: date,
          at: now,
          byId: me._id,
          fromLeads: existing.leads,
        })
        await ctx.db.delete(existing._id)
        continue
      }

      if (existing) {
        if (existing.leads === r.leads) continue
        // §15: правка факта тоже уходит в журнал.
        await ctx.db.insert('targetLeadAudit', {
          kind: 'leads',
          employeeId: owner,
          objectId: r.objectId,
          period: date,
          at: now,
          byId: me._id,
          fromLeads: existing.leads,
          toLeads: r.leads,
        })
        await ctx.db.patch(existing._id, { leads: r.leads, updatedAt: now, updatedById: me._id })
        continue
      }

      await ctx.db.insert('targetLeadReports', {
        employeeId: owner,
        objectId: r.objectId,
        date,
        month: date.slice(0, 7),
        leads: r.leads,
        updatedAt: now,
        updatedById: me._id,
      })
      await ctx.db.insert('targetLeadAudit', {
        kind: 'leads',
        employeeId: owner,
        objectId: r.objectId,
        period: date,
        at: now,
        byId: me._id,
        toLeads: r.leads,
      })
    }
  },
})

// ——— §8–§10, §13: расчёт план-факта ———

export type ObjectStat = {
  objectId: Id<'salesObjects'>
  name: string
  planLeads: number | null
  factLeads: number
  completion: number | null
  planBudgetCents: number | null
  factBudgetCents: number
  planCostCents: number | null
  factCostCents: number | null
  status: 'done' | 'risk' | 'fail' | 'noplan'
}

// Общий сборщик показателей за период. Используется и разделом KPI, и обоими
// дашбордами — чтобы цифры на экранах не разъезжались.
// Экспортируется для dev-проверки: сверять надо боевой расчёт, а не копию.
export async function collect(
  ctx: QueryCtx,
  me: Doc<'employees'>,
  from: string,
  to: string,
  filter: { employeeId?: Id<'employees'>; objectId?: Id<'salesObjects'> },
) {
  const visible = await visibleTargetologs(ctx, me, filter.employeeId)
  const objects = await ctx.db.query('salesObjects').collect()
  const objectById = new Map(objects.map((o) => [o._id as string, o]))
  const months = monthsBetween(from, to)
  // Полный ли это календарный месяц: только по нему считается официальный KPI
  // (§13.4). Для дня, 7/14 дней и произвольного диапазона показывается
  // пропорциональный аналитический план.
  const wholeMonth =
    months.length === 1 && from === `${months[0]}-01` && to === monthEnd(months[0])

  // Планы всех задетых месяцев.
  const planRows = (
    await Promise.all(
      months.map((m) =>
        ctx.db
          .query('targetLeadPlans')
          .withIndex('by_month', (q) => q.eq('month', m))
          .collect(),
      ),
    )
  )
    .flat()
    .filter((p) => visible.has(p.employeeId as string))
    .filter((p) => !filter.objectId || p.objectId === filter.objectId)

  // §13.3: доли месячных планов, попавшие в период.
  const planLeadsByObject = new Map<string, number>()
  const planBudgetByObject = new Map<string, number>()
  let anyBudgetPlan = false
  for (const p of planRows) {
    const leads = proratePlan(p.planLeads, p.month, from, to)
    planLeadsByObject.set(
      p.objectId as string,
      (planLeadsByObject.get(p.objectId as string) ?? 0) + leads,
    )
    if (p.planBudgetCents !== undefined) {
      anyBudgetPlan = true
      const budget = proratePlan(p.planBudgetCents, p.month, from, to)
      planBudgetByObject.set(
        p.objectId as string,
        (planBudgetByObject.get(p.objectId as string) ?? 0) + budget,
      )
    }
  }

  // §8: фактические заявки — сумма ежедневных значений по объекту за период.
  const leadRows = (await ctx.db.query('targetLeadReports').collect()).filter(
    (r) =>
      r.date >= from &&
      r.date <= to &&
      visible.has(r.employeeId as string) &&
      (!filter.objectId || r.objectId === filter.objectId),
  )
  const factLeadsByObject = new Map<string, number>()
  const leadsByDate = new Map<string, number>()
  for (const r of leadRows) {
    factLeadsByObject.set(
      r.objectId as string,
      (factLeadsByObject.get(r.objectId as string) ?? 0) + r.leads,
    )
    leadsByDate.set(r.date, (leadsByDate.get(r.date) ?? 0) + r.leads)
  }

  // §8: фактический расход — сумма расходов всех кампаний объекта за период.
  // Заявки к кампаниям не привязываются (§14), связь только через объект.
  const campaigns = await ctx.db.query('campaigns').collect()
  const campaignById = new Map(campaigns.map((c) => [c._id as string, c]))
  const reportRows = (await ctx.db.query('targetReportRows').collect()).filter(
    (r) => r.date >= from && r.date <= to,
  )
  const factBudgetByObject = new Map<string, number>()
  const budgetByDate = new Map<string, number>()
  for (const r of reportRows) {
    const c = campaignById.get(r.campaignId as string)
    if (!c?.objectId) continue
    if (filter.objectId && c.objectId !== filter.objectId) continue
    factBudgetByObject.set(
      c.objectId as string,
      (factBudgetByObject.get(c.objectId as string) ?? 0) + r.budgetCents,
    )
    budgetByDate.set(r.date, (budgetByDate.get(r.date) ?? 0) + r.budgetCents)
  }

  // В KPI попадают только объекты, на которые выставлен план. Объекты без
  // плана не показываются и в итоги не входят — иначе цифры над таблицей не
  // сходились бы с её строками.
  //
  // Это решение владельца от 03.08.2026. Оно заменяет §9 и §16 ТАРГЕТ 1.6,
  // где такие объекты просили оставлять в аналитике без участия в KPI.
  const ids = new Set<string>(planLeadsByObject.keys())

  // Доля прошедших дней периода — по ней определяется «риск невыполнения».
  const today = businessToday()
  const elapsed = (() => {
    if (today >= to) return 1
    if (today < from) return 0
    const all = months.reduce((s, m) => s + daysOfMonthInPeriod(m, from, to), 0)
    const past = months.reduce((s, m) => s + daysOfMonthInPeriod(m, from, today), 0)
    return all > 0 ? past / all : 1
  })()

  const rows: ObjectStat[] = [...ids]
    .map((id) => {
      const o = objectById.get(id)
      const planLeads = planLeadsByObject.get(id) ?? null
      const factLeads = factLeadsByObject.get(id) ?? 0
      const planBudgetCents = planBudgetByObject.get(id) ?? null
      const factBudgetCents = factBudgetByObject.get(id) ?? 0
      // §8: цена заявки — расход ÷ заявки. Ноль заявок — цены нет.
      const factCostCents = factLeads > 0 ? factBudgetCents / factLeads : null
      const completion = planLeads && planLeads > 0 ? factLeads / planLeads : null
      return {
        objectId: id as Id<'salesObjects'>,
        name: o?.name ?? 'Объект удалён',
        planLeads,
        factLeads,
        completion,
        planBudgetCents,
        factBudgetCents,
        // §4: плановая цена заявки — только если задан плановый бюджет.
        planCostCents:
          planBudgetCents !== null && planLeads && planLeads > 0 ? planBudgetCents / planLeads : null,
        factCostCents,
        // §13.1: «Выполнено / риск невыполнения / не выполнено». Порог риска —
        // отставание факта от прошедшей доли периода: к середине месяца должна
        // быть примерно половина плана. Вариант «без плана» сюда больше не
        // доходит: такие объекты отфильтрованы выше.
        status: (completion === null
          ? 'noplan'
          : completion >= 1
            ? 'done'
            : elapsed >= 1
              ? 'fail'
              : completion < elapsed
                ? 'risk'
                : 'done') as ObjectStat['status'],
      }
    })
    .sort((a, b) => b.factLeads - a.factLeads || a.name.localeCompare(b.name, 'ru'))

  // §10: общее выполнение с ограничением вклада каждого объекта его планом.
  // Перевыполнение одного объекта не компенсирует недобор другого.
  const planned = rows.filter((r) => r.planLeads !== null && r.planLeads > 0)
  const sumPlan = planned.reduce((s, r) => s + (r.planLeads ?? 0), 0)
  const sumCapped = planned.reduce((s, r) => s + Math.min(r.factLeads, r.planLeads ?? 0), 0)

  const totalFactLeads = rows.reduce((s, r) => s + r.factLeads, 0)
  const totalFactBudget = rows.reduce((s, r) => s + r.factBudgetCents, 0)
  const totalPlanBudget = anyBudgetPlan
    ? rows.reduce((s, r) => s + (r.planBudgetCents ?? 0), 0)
    : null

  return {
    period: { from, to, wholeMonth },
    rows,
    totals: {
      planLeads: sumPlan,
      factLeads: totalFactLeads,
      // Общий процент по компании — по объектам с планом (§10, §13.5).
      completion: sumPlan > 0 ? sumCapped / sumPlan : null,
      // Простое «факт ÷ план» для сводной строки таблицы (§13.5) — без
      // ограничения, чтобы было видно фактическое соотношение.
      rawCompletion: sumPlan > 0 ? planned.reduce((s, r) => s + r.factLeads, 0) / sumPlan : null,
      planBudgetCents: totalPlanBudget,
      factBudgetCents: totalFactBudget,
      // §13.5: общая цена заявки по компании — общий расход ÷ все заявки.
      factCostCents: totalFactLeads > 0 ? totalFactBudget / totalFactLeads : null,
      planCostCents:
        totalPlanBudget !== null && sumPlan > 0 ? totalPlanBudget / sumPlan : null,
    },
    daily: { leadsByDate, budgetByDate },
  }
}

// §10: официальный месячный KPI по заявкам. Отдельная функция — её же читает
// расчёт зарплаты.
export async function leadPlanKpi(
  ctx: QueryCtx,
  employeeId: Id<'employees'>,
  month: string,
): Promise<{ completion: number | null; planLeads: number; factLeads: number }> {
  const plans = (
    await ctx.db
      .query('targetLeadPlans')
      .withIndex('by_employee_month', (q) => q.eq('employeeId', employeeId).eq('month', month))
      .collect()
  ).filter((p) => p.planLeads > 0)
  if (plans.length === 0) return { completion: null, planLeads: 0, factLeads: 0 }

  const leadRows = (
    await ctx.db
      .query('targetLeadReports')
      .withIndex('by_month', (q) => q.eq('month', month))
      .collect()
  ).filter((r) => r.employeeId === employeeId)

  const factByObject = new Map<string, number>()
  for (const r of leadRows) {
    factByObject.set(r.objectId as string, (factByObject.get(r.objectId as string) ?? 0) + r.leads)
  }

  let sumPlan = 0
  let sumCapped = 0
  let sumFact = 0
  for (const p of plans) {
    const fact = factByObject.get(p.objectId as string) ?? 0
    sumPlan += p.planLeads
    sumFact += fact
    // §10: вклад объекта ограничен его планом.
    sumCapped += Math.min(fact, p.planLeads)
  }
  return {
    completion: sumPlan > 0 ? sumCapped / sumPlan : null,
    planLeads: sumPlan,
    factLeads: sumFact,
  }
}

// Вес показателя в общем KPI таргетолога (§11). Пока показатель один,
// поэтому вес по умолчанию 100%.
export async function leadWeight(ctx: QueryCtx): Promise<number> {
  const s = await ctx.db
    .query('settings')
    .withIndex('by_key', (q) => q.eq('key', 'global'))
    .first()
  const pct = s?.targetLeadWeight ?? 100
  return Math.min(100, Math.max(0, pct)) / 100
}

// ——— Экраны ———

// §9, §13: план-факт по объектам за выбранный период.
export const overview = query({
  args: {
    from: v.optional(v.string()),
    to: v.optional(v.string()),
    month: v.optional(v.string()),
    employeeId: v.optional(v.id('employees')),
    objectId: v.optional(v.id('salesObjects')),
  },
  handler: async (ctx, { from: fromArg, to: toArg, month: monthArg, employeeId, objectId }) => {
    const month = monthArg ?? businessMonth()
    const a = fromArg ?? `${month}-01`
    const b = toArg ?? monthEnd(month)
    const from = a <= b ? a : b
    const to = a <= b ? b : a

    const me = await currentEmployee(ctx)
    const emptyTotals = {
      planLeads: 0,
      factLeads: 0,
      completion: null,
      rawCompletion: null,
      planBudgetCents: null,
      factBudgetCents: 0,
      factCostCents: null,
      planCostCents: null,
    }
    if (!me || (!isManager(me) && me.position !== 'targetolog')) {
      return {
        period: { from, to, wholeMonth: false },
        rows: [] as ObjectStat[],
        totals: emptyTotals,
        weight: 1,
        kpi: null as number | null,
        targetologs: [] as { _id: Id<'employees'>; name: string }[],
        objects: [] as { _id: Id<'salesObjects'>; name: string }[],
      }
    }

    const data = await collect(ctx, me, from, to, { employeeId, objectId })
    const weight = await leadWeight(ctx)

    const employees = await ctx.db.query('employees').collect()
    const hidden = await hiddenEmployeeIds(ctx)
    const visible = await visibleTargetologs(ctx, me)

    return {
      period: data.period,
      rows: data.rows,
      totals: data.totals,
      weight,
      // §13.4: официальный KPI считается только по полному календарному
      // месяцу. За день, 7/14 дней и произвольный диапазон — только аналитика.
      kpi:
        data.period.wholeMonth && data.totals.completion !== null
          ? data.totals.completion * weight
          : null,
      targetologs: employees
        .filter(
          (e) =>
            e.position === 'targetolog' &&
            e.role !== 'owner' &&
            e.status === 'active' &&
            visible.has(e._id as string) &&
            (me.role === 'owner' || !hidden.has(e._id)),
        )
        .map((e) => ({ _id: e._id, name: e.name }))
        .sort((a2, b2) => a2.name.localeCompare(b2.name, 'ru')),
      objects: (await ctx.db.query('salesObjects').collect())
        .filter((o) => o.status === 'active')
        .map((o) => ({ _id: o._id, name: o.name }))
        .sort((a2, b2) => a2.name.localeCompare(b2.name, 'ru')),
    }
  },
})

// §12: компактный KPI-блок на личном дашборде таргетолога — всегда за текущий
// календарный месяц, потому что именно он идёт в мотивацию.
export const myMonth = query({
  args: { month: v.optional(v.string()) },
  handler: async (ctx, { month: arg }) => {
    const me = await currentEmployee(ctx)
    if (!me || me.position !== 'targetolog') return null
    const month = arg ?? businessMonth()
    const data = await collect(ctx, me, `${month}-01`, monthEnd(month), { employeeId: me._id })
    const weight = await leadWeight(ctx)
    return {
      month,
      planLeads: data.totals.planLeads,
      factLeads: data.totals.factLeads,
      completion: data.totals.completion,
      planBudgetCents: data.totals.planBudgetCents,
      factBudgetCents: data.totals.factBudgetCents,
      factCostCents: data.totals.factCostCents,
      weight,
      kpi: data.totals.completion === null ? null : data.totals.completion * weight,
      objects: data.rows.length,
    }
  },
})

// §14: расширенная аналитика по одному объекту продаж — динамика заявок,
// расхода и средней цены заявки по дням плюс связанные кампании с их
// собственными рекламными результатами.
//
// Заявки здесь НЕ разносятся по целям и кампаниям: на этих уровнях показаны
// только расход и технический результат (§14, запрет ложной атрибуции).
export const objectDetail = query({
  args: {
    objectId: v.id('salesObjects'),
    from: v.string(),
    to: v.string(),
    employeeId: v.optional(v.id('employees')),
  },
  handler: async (ctx, { objectId, from, to, employeeId }) => {
    const me = await currentEmployee(ctx)
    if (!me || (!isManager(me) && me.position !== 'targetolog')) return null
    const object = await ctx.db.get(objectId)
    if (!object) return null

    const data = await collect(ctx, me, from, to, { employeeId, objectId })
    const row = data.rows.find((r) => r.objectId === objectId) ?? null

    // Ряд по дням: заявки, расход и производная цена заявки.
    const dates = [
      ...new Set([...data.daily.leadsByDate.keys(), ...data.daily.budgetByDate.keys()]),
    ].sort()
    const daily = dates.map((date) => {
      const leads = data.daily.leadsByDate.get(date) ?? 0
      const budgetCents = data.daily.budgetByDate.get(date) ?? 0
      return {
        date,
        leads,
        budgetCents,
        costCents: leads > 0 ? budgetCents / leads : null,
      }
    })

    // Кампании объекта и их собственные результаты по своим целям.
    const campaigns = (await ctx.db.query('campaigns').collect()).filter(
      (c) => !c.archived && c.objectId === objectId,
    )
    const rowsByCampaign = new Map<string, { budgetCents: number; result: number }>()
    for (const r of (await ctx.db.query('targetReportRows').collect()).filter(
      (r) => r.date >= from && r.date <= to,
    )) {
      const agg = rowsByCampaign.get(r.campaignId as string) ?? { budgetCents: 0, result: 0 }
      agg.budgetCents += r.budgetCents
      agg.result += r.result
      rowsByCampaign.set(r.campaignId as string, agg)
    }

    return {
      objectId,
      objectName: object.name,
      period: data.period,
      summary: row,
      daily,
      campaigns: campaigns
        .map((c) => {
          const agg = rowsByCampaign.get(c._id as string) ?? { budgetCents: 0, result: 0 }
          return {
            campaignId: c._id,
            name: c.campaign?.trim() || c.code || 'Без названия',
            goal: c.goal ?? null,
            status: c.status,
            budgetCents: agg.budgetCents,
            result: agg.result,
            costCents: resultCostCents(agg.budgetCents, agg.result, c.goal),
          }
        })
        .sort((a, b) => b.budgetCents - a.budgetCents),
    }
  },
})

// §15: журнал изменений плана и фактических заявок по объекту.
export const auditLog = query({
  args: { objectId: v.id('salesObjects'), limit: v.optional(v.number()) },
  handler: async (ctx, { objectId, limit }) => {
    const me = await currentEmployee(ctx)
    if (!me || !isManager(me)) return []
    const employees = await ctx.db.query('employees').collect()
    const nameById = new Map(employees.map((e) => [e._id as string, e.name]))
    return (
      await ctx.db
        .query('targetLeadAudit')
        .withIndex('by_object', (q) => q.eq('objectId', objectId))
        .collect()
    )
      .sort((a, b) => b.at - a.at)
      .slice(0, limit ?? 50)
      .map((a) => ({
        kind: a.kind,
        period: a.period,
        at: a.at,
        by: nameById.get(a.byId as string) ?? '—',
        employee: nameById.get(a.employeeId as string) ?? '—',
        fromLeads: a.fromLeads ?? null,
        toLeads: a.toLeads ?? null,
        fromBudgetCents: a.fromBudgetCents ?? null,
        toBudgetCents: a.toBudgetCents ?? null,
      }))
  },
})
