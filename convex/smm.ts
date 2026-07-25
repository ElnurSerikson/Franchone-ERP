import { query, mutation } from './_generated/server'
import { v, ConvexError } from 'convex/values'
import { hiddenEmployeeIds } from './lib'
import { requireCan, inScope } from './permissions'

// Оси модели SMM — те же, что в KPI_SMM.xlsx.
const ACCOUNT = v.union(v.literal('FRANCHONE'), v.literal('ANUAR'))
const FORMAT = v.union(v.literal('Рилсы'), v.literal('Сторис'), v.literal('Карусели'))

// Номер недели внутри месяца — как в KPI_SMM.xlsx: MIN(5; ROUNDUP(день/7)).
// Возвращает 0-based индекс для weekPlans/weekFacts.
function weekIndex(date: string): number {
  const day = Number(date.slice(8, 10))
  return Math.min(5, Math.ceil(day / 7)) - 1
}

export const list = query({
  args: { month: v.optional(v.string()), employeeId: v.optional(v.id('employees')) },
  handler: async (ctx, { month, employeeId }) => {
    const all = await ctx.db.query('smmMetrics').collect()
    let metrics = month ? all.filter((r) => r.month === month) : all
    // KPI персональный: план принадлежит сотруднику. Если сотрудник задан —
    // отдаём только его строки.
    if (employeeId) metrics = metrics.filter((m) => m.employeeId === employeeId)
    if (!month) return metrics

    // Факт — из ежедневных отчётов сотрудника (SUMIFS по неделе, как в Excel).
    // Считаем на чтении, чтобы правка отчёта сразу отражалась в KPI.
    const hidden = await hiddenEmployeeIds(ctx)
    const facts = new Map<string, number[]>()
    for (const r of await ctx.db.query('dailyReports').collect()) {
      if (hidden.has(r.employeeId)) continue // тестовый/скрытый не в KPI
      if (r.position !== 'smm' || !r.smm) continue
      if (r.date.slice(0, 7) !== month) continue
      if (employeeId && r.employeeId !== employeeId) continue // только его факт
      const w = weekIndex(r.date)
      for (const line of r.smm) {
        const key = `${line.page}|${line.type}`
        const arr = facts.get(key) ?? [0, 0, 0, 0, 0]
        arr[w] += line.count
        facts.set(key, arr)
      }
    }

    return metrics.map((m) => ({
      ...m,
      weekFacts: facts.get(`${m.account}|${m.format}`) ?? [0, 0, 0, 0, 0],
    }))
  },
})

// Обновить план по неделям и вес (настройки руководителя).
// Факта здесь нет намеренно: он производный от ежедневных отчётов, см. list.
export const setPlan = mutation({
  args: {
    id: v.id('smmMetrics'),
    weekPlans: v.array(v.number()),
    weight: v.number(),
  },
  handler: async (ctx, { id, weekPlans, weight }) => {
    // План и вес задают чужую выплату — право «KPI: редактирование» + скоуп.
    const me = await requireCan(ctx, 'kpi', 'edit')
    const metric = await ctx.db.get(id)
    if (metric?.employeeId) {
      const emp = await ctx.db.get(metric.employeeId)
      if (emp && !inScope(me, emp)) throw new ConvexError('Можно менять планы только в вашем доступе')
    }
    await ctx.db.patch(id, { weekPlans, weight })
  },
})

// ——— Набор метрик KPI (§5: «набор KPI настраивается для каждой должности») ———
// Строка «аккаунт × формат» — единица модели SMM. Пары фиксированы моделью,
// но какие именно пары считаются в этом месяце, решает руководитель.

export const addMetric = mutation({
  args: {
    // Владелец плана. Если не передан — привязываем к единственному
    // действующему SMM-специалисту (пока в команде один).
    employeeId: v.optional(v.id('employees')),
    month: v.string(),
    account: ACCOUNT,
    format: FORMAT,
    weight: v.number(),
  },
  handler: async (ctx, { employeeId, month, account, format, weight }) => {
    const me = await requireCan(ctx, 'kpi', 'edit')
    const ownerId =
      employeeId ??
      (await ctx.db.query('employees').collect()).find(
        (e) => e.position === 'smm' && !e.hidden && e.status === 'active' && e.role !== 'owner',
      )?._id
    if (!ownerId) throw new ConvexError('Нет действующего SMM-специалиста для плана')
    const owner = await ctx.db.get(ownerId)
    if (owner && !inScope(me, owner)) throw new ConvexError('Можно менять планы только в вашем доступе')
    // Набор строк персональный: одна пара «аккаунт × формат» на сотрудника в месяц.
    const existing = (await ctx.db.query('smmMetrics').collect()).find(
      (m) => m.employeeId === ownerId && m.month === month && m.account === account && m.format === format,
    )
    if (existing) throw new ConvexError(`${account} · ${format} уже есть в наборе`)
    return await ctx.db.insert('smmMetrics', {
      employeeId: ownerId,
      month,
      account,
      format,
      weight,
      weekPlans: [0, 0, 0, 0, 0],
      weekFacts: [0, 0, 0, 0, 0],
    })
  },
})

export const removeMetric = mutation({
  args: { id: v.id('smmMetrics') },
  handler: async (ctx, { id }) => {
    const me = await requireCan(ctx, 'kpi', 'edit')
    const metric = await ctx.db.get(id)
    if (metric?.employeeId) {
      const emp = await ctx.db.get(metric.employeeId)
      if (emp && !inScope(me, emp)) throw new ConvexError('Можно менять планы только в вашем доступе')
    }
    // Факт метрики живёт в ежедневных отчётах и никуда не денется: убираем
    // строку только из расчёта текущего месяца.
    await ctx.db.delete(id)
  },
})
