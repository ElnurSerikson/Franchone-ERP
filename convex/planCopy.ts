// Перенос плановых значений из прошедшего месяца в текущий.
//
// Каждый месяц планы заводятся заново, а меняются они от месяца к месяцу редко.
// Здесь — один общий механизм для всех четырёх разделов настроек, чтобы не
// перебивать руками одно и то же.
//
// Два правила, которые держатся на сервере, а не только в интерфейсе:
//  • приёмник — ВСЕГДА текущий календарный месяц; клиент его не задаёт;
//  • источник — строго более ранний месяц.
// Иначе переносом можно было бы задним числом переписать закрытый период.

import { query, mutation } from './_generated/server'
import { v, ConvexError } from 'convex/values'
import type { MutationCtx } from './_generated/server'
import type { Id } from './_generated/dataModel'
import { currentEmployee, requireEmployee, isManager } from './lib'
import { isMonthClosed } from './payroll'

function businessMonth(): string {
  return new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 7)
}

// Правило переноса, вынесенное отдельно: приёмник — только текущий месяц,
// источник — строго более ранний. Держится на сервере, потому что интерфейс
// можно обойти, а закрытый период переписывать нельзя.
export function assertCopyable(from: string, to: string) {
  if (!/^\d{4}-\d{2}$/.test(from)) throw new ConvexError('Неверный месяц-источник')
  if (from >= to) throw new ConvexError('Переносить можно только из более раннего месяца')
}

const sectionV = v.union(
  v.literal('smm'), // KPI · SMM: веса и недельные планы
  v.literal('salesRevenue'), // KPI · Отдел продаж: план выручки менеджера
  v.literal('salesObjects'), // Объекты продаж: статус месяца и планы менеджеров
  v.literal('targetLeads'), // Планы таргетолога: заявки и бюджет по объектам
)
type Section = 'smm' | 'salesRevenue' | 'salesObjects' | 'targetLeads'

// Месяцы, из которых есть что переносить: строго раньше текущего и с данными.
// Пустые месяцы в выборе не показываем — незачем предлагать перенести ничего.
export const sourceMonths = query({
  args: { section: sectionV, employeeId: v.optional(v.id('employees')) },
  handler: async (ctx, { section, employeeId }) => {
    const me = await currentEmployee(ctx)
    if (!me || !isManager(me)) return { current: businessMonth(), months: [] as string[] }
    const current = businessMonth()

    const months = new Set<string>()
    const add = (m: string) => {
      if (m < current) months.add(m)
    }

    if (section === 'smm') {
      for (const r of await ctx.db.query('smmMetrics').collect()) {
        if (employeeId && r.employeeId !== employeeId) continue
        if (r.month) add(r.month)
      }
    } else if (section === 'salesRevenue') {
      for (const r of await ctx.db.query('salesPlans').collect()) {
        if (employeeId && r.employeeId !== employeeId) continue
        add(r.month)
      }
    } else if (section === 'salesObjects') {
      for (const r of await ctx.db.query('salesObjectMonths').collect()) add(r.month)
    } else {
      for (const r of await ctx.db.query('targetLeadPlans').collect()) add(r.month)
    }

    // Свежие сверху: почти всегда переносят из прошлого месяца.
    return { current, months: [...months].sort().reverse() }
  },
})

export const copy = mutation({
  args: {
    section: sectionV,
    from: v.string(),
    // Разделы SMM и плана выручки настраиваются по одному сотруднику —
    // переносим ровно то, что человек видит на экране.
    employeeId: v.optional(v.id('employees')),
  },
  handler: async (ctx, { section, from, employeeId }) => {
    const me = await requireEmployee(ctx)
    // Планы задают чужую выплату: перенос доступен тому же кругу, что и
    // ручная правка. Объекты продаж по действующему правилу — владельцу.
    if (me.role !== 'owner') {
      throw new ConvexError('Перенос плановых значений доступен владельцу')
    }

    const to = businessMonth()
    assertCopyable(from, to)
    if (await isMonthClosed(ctx, to)) {
      throw new ConvexError('Текущий месяц закрыт — планы за него больше не меняются')
    }

    const done = await copyPlanMonth(ctx, section as Section, from, to, employeeId)
    return { from, to, ...done }
  },
})

// Экспортируется под именем copyPlanMonth для dev-проверки: сверять надо
// боевую логику переноса, а не её копию.
export async function copyPlanMonth(
  ctx: MutationCtx,
  section: Section,
  from: string,
  to: string,
  employeeId?: Id<'employees'>,
): Promise<{ copied: number; replaced: number }> {
  if (section === 'smm') {
    const all = await ctx.db.query('smmMetrics').collect()
    const mine = (m: (typeof all)[number]) => !employeeId || m.employeeId === employeeId
    const source = all.filter((m) => m.month === from && mine(m))
    const target = all.filter((m) => m.month === to && mine(m))
    // Перезаписываем целиком: месяц становится копией выбранного.
    for (const r of target) await ctx.db.delete(r._id)
    for (const r of source) {
      await ctx.db.insert('smmMetrics', {
        employeeId: r.employeeId,
        month: to,
        account: r.account,
        format: r.format,
        weight: r.weight,
        weekPlans: r.weekPlans,
        // Факт — производное от ежедневных отчётов нового месяца. Копировать
        // его означало бы перенести чужие результаты.
        weekFacts: [0, 0, 0, 0, 0],
      })
    }
    return { copied: source.length, replaced: target.length }
  }

  if (section === 'salesRevenue') {
    const all = await ctx.db.query('salesPlans').collect()
    const mine = (p: (typeof all)[number]) => !employeeId || p.employeeId === employeeId
    const source = all.filter((p) => p.month === from && mine(p))
    const target = all.filter((p) => p.month === to && mine(p))
    for (const r of target) await ctx.db.delete(r._id)
    for (const r of source) {
      await ctx.db.insert('salesPlans', {
        employeeId: r.employeeId,
        month: to,
        planRevenue: r.planRevenue,
      })
    }
    return { copied: source.length, replaced: target.length }
  }

  if (section === 'salesObjects') {
    const objects = await ctx.db.query('salesObjects').collect()
    const alive = new Set(objects.filter((o) => o.status !== 'archived').map((o) => o._id as string))
    const source = (
      await ctx.db
        .query('salesObjectMonths')
        .withIndex('by_month', (q) => q.eq('month', from))
        .collect()
      // Удалённый или заархивированный объект переносить некуда.
    ).filter((r) => alive.has(r.objectId as string))
    const target = await ctx.db
      .query('salesObjectMonths')
      .withIndex('by_month', (q) => q.eq('month', to))
      .collect()
    for (const r of target) await ctx.db.delete(r._id)
    for (const r of source) {
      await ctx.db.insert('salesObjectMonths', {
        objectId: r.objectId,
        month: to,
        objectStatus: r.objectStatus,
        status: r.status,
        managerPlans: r.managerPlans,
      })
    }
    return { copied: source.length, replaced: target.length }
  }

  const objects = await ctx.db.query('salesObjects').collect()
  const active = new Set(objects.filter((o) => o.status === 'active').map((o) => o._id as string))
  const source = (
    await ctx.db
      .query('targetLeadPlans')
      .withIndex('by_month', (q) => q.eq('month', from))
      .collect()
  ).filter((p) => active.has(p.objectId as string))
  const target = await ctx.db
    .query('targetLeadPlans')
    .withIndex('by_month', (q) => q.eq('month', to))
    .collect()
  for (const r of target) await ctx.db.delete(r._id)
  for (const r of source) {
    await ctx.db.insert('targetLeadPlans', {
      employeeId: r.employeeId,
      objectId: r.objectId,
      month: to,
      planLeads: r.planLeads,
      planBudgetCents: r.planBudgetCents,
    })
  }
  return { copied: source.length, replaced: target.length }
}
