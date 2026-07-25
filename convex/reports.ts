import { query, mutation } from './_generated/server'
import { v, ConvexError } from 'convex/values'
import type { QueryCtx, MutationCtx } from './_generated/server'
import type { Doc } from './_generated/dataModel'
import { currentEmployee, isManager, requireEmployee } from './lib'
import { isMonthClosed } from './payroll'

// Бизнес-часовой пояс компании — Asia/Almaty (UTC+5, без перехода на летнее время).
const TZ = '+05:00'
const DEFAULT_DEADLINE = '20:00'
const REPORTING = new Set(['smm', 'targetolog', 'sales'])

// Сегодняшняя календарная дата в часовом поясе Алматы.
function businessToday(): string {
  return new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 10)
}

// Сдвиг календарной даты на целое число дней (без дрейфа по TZ).
function addDays(date: string, delta: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + delta * 86400000)
    .toISOString()
    .slice(0, 10)
}

// Момент дедлайна для даты в часовом поясе Алматы (ms).
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

// ——— Payload-валидаторы (общие для мутации) ———
const smmRows = v.array(
  v.object({ page: v.string(), type: v.string(), count: v.number() }),
)
const targetologRows = v.array(
  v.object({
    code: v.string(), // ID кампании из реестра
    budget: v.number(),
    leads: v.number(),
  }),
)
const salesPayload = v.object({
  leads: v.number(),
  meetings: v.number(),
  sales: v.number(),
  revenue: v.number(),
  note: v.optional(v.string()),
})

// Самая ранняя дата, за которую сотрудник может дозаполнить отчёт: начало
// текущего месяца, но не раньше даты найма. Месяц — естественная граница:
// по нему считается KPI и выплата, и закрытый месяц пересобирать нельзя.
function earliestReportDate(me: Doc<'employees'>, today: string): string {
  const monthStart = `${today.slice(0, 7)}-01`
  return me.hiredAt > monthStart ? me.hiredAt : monthStart
}

// Мой отчёт за дату (по умолчанию сегодня) + короткая история.
export const mine = query({
  args: { date: v.optional(v.string()) },
  handler: async (ctx, { date }) => {
    const me = await currentEmployee(ctx)
    if (!me) return null
    const time = await deadlineTime(ctx)
    const today = businessToday()
    const target = date ?? today

    const all = await ctx.db
      .query('dailyReports')
      .withIndex('by_employee', (q) => q.eq('employeeId', me._id))
      .collect()
    all.sort((a, b) => (a.date < b.date ? 1 : -1)) // по дате, свежие сверху

    return {
      today,
      date: target,
      earliestDate: earliestReportDate(me, today),
      deadlineTime: time,
      position: me.position,
      report: all.find((r) => r.date === target) ?? null,
      history: all.slice(0, 21),
    }
  },
})

// Отправка / правка отчёта за дату (по умолчанию — за сегодня).
export const submit = mutation({
  args: {
    date: v.optional(v.string()),
    note: v.optional(v.string()),
    smm: v.optional(smmRows),
    targetolog: v.optional(targetologRows),
    sales: v.optional(salesPayload),
  },
  handler: async (ctx, args) => {
    const me = await requireEmployee(ctx)
    if (me.role === 'owner' || !REPORTING.has(me.position)) {
      throw new Error('Для вашей роли ежедневный отчёт не предусмотрен')
    }
    const position = me.position as 'smm' | 'targetolog' | 'sales'
    const today = businessToday()
    const date = args.date ?? today
    // Дозаполнить прошлый день можно, выдумать будущий — нет. Нижняя граница —
    // начало месяца: KPI и выплата считаются по месяцу, и задним числом
    // переписывать уже посчитанный период нельзя.
    if (date > today) throw new ConvexError('Отчёт за будущую дату сдать нельзя')
    if (date < earliestReportDate(me, today)) {
      throw new ConvexError('Отчёт за эту дату уже нельзя изменить')
    }
    // Закрытый месяц — это уже начисленная зарплата. Иначе правку можно было бы
    // протащить в переоткрытый месяц и разойтись со снапшотом.
    if (await isMonthClosed(ctx, date.slice(0, 7))) {
      throw new ConvexError('Месяц закрыт — отчёты за него больше не принимаются')
    }
    const now = Date.now()
    const payload = {
      smm: args.smm,
      targetolog: args.targetolog,
      sales: args.sales,
      note: args.note,
    }

    const existing = await ctx.db
      .query('dailyReports')
      .withIndex('by_employee_date', (q) =>
        q.eq('employeeId', me._id).eq('date', date),
      )
      .first()

    if (existing) {
      await ctx.db.patch(existing._id, {
        ...payload,
        editedAt: now,
        editedById: me._id,
        editCount: existing.editCount + 1,
        history: [...existing.history, { at: now, byId: me._id, action: 'edited' as const }],
      })
      return existing._id
    }

    const time = await deadlineTime(ctx)
    const onTime = now <= deadlineMs(date, time)
    return await ctx.db.insert('dailyReports', {
      employeeId: me._id,
      position,
      date,
      submittedAt: now,
      onTime,
      editCount: 0,
      history: [{ at: now, byId: me._id, action: 'submitted' as const }],
      ...payload,
    })
  },
})

// Строка дисциплины одного сотрудника за окно дат. Общая для сводки
// руководителя и личного дашборда — правило пропуска должно быть одно.
async function disciplineRow(
  ctx: QueryCtx,
  e: Doc<'employees'>,
  dates: string[],
  today: string,
  deadlinePassedToday: boolean,
) {
  const reps = await ctx.db
    .query('dailyReports')
    .withIndex('by_employee', (q) => q.eq('employeeId', e._id))
    .collect()
  const byDate = new Map(reps.map((r) => [r.date, r]))

  let onTime = 0
  let late = 0
  let missed = 0
  const cells = dates.map((d) => {
    // До даты найма сотрудника в компании не было — отчёта не могло быть
    // в принципе. Такие дни не пропуск и в знаменатель заполняемости
    // не идут, иначе новичок стартует со 100% нарушений.
    if (d < e.hiredAt) return { date: d, status: 'na' as const }
    const r = byDate.get(d)
    if (r) {
      if (r.onTime) onTime++
      else late++
      return {
        date: d,
        status: r.onTime ? ('onTime' as const) : ('late' as const),
        submittedAt: r.submittedAt,
        edited: (r.editCount ?? 0) > 0,
      }
    }
    if (d < today || (d === today && deadlinePassedToday)) {
      missed++
      return { date: d, status: 'missed' as const }
    }
    return { date: d, status: 'pending' as const }
  })

  const required = onTime + late + missed
  return {
    cells,
    onTime,
    late,
    missed,
    fillRate: required ? (onTime + late) / required : 0,
  }
}

// Окно дат для сетки: N дней по сегодняшний включительно.
function windowDates(today: string, n: number): string[] {
  const dates: string[] = []
  for (let i = n - 1; i >= 0; i--) dates.push(addDays(today, -i))
  return dates
}

// Личная дисциплина отчётности — для дашборда сотрудника (§4 ТЗ).
// Возвращает пустое окно тем, кто отчёты не сдаёт: владельцу и должностям
// без формы отчётности.
export const myDiscipline = query({
  args: { days: v.optional(v.number()) },
  handler: async (ctx, { days }) => {
    const time = await deadlineTime(ctx)
    const today = businessToday()
    const me = await currentEmployee(ctx)
    const empty = { today, deadlineTime: time, dates: [], cells: [], onTime: 0, late: 0, missed: 0, fillRate: 0, reporting: false }
    if (!me) return empty
    if (me.role === 'owner' || !REPORTING.has(me.position)) return empty

    const dates = windowDates(today, days ?? 14)
    const row = await disciplineRow(ctx, me, dates, today, Date.now() > deadlineMs(today, time))
    return { today, deadlineTime: time, dates, ...row, reporting: true }
  },
})

export const discipline = query({
  args: { days: v.optional(v.number()) },
  handler: async (ctx, { days }) => {
    const N = days ?? 14
    const time = await deadlineTime(ctx)
    const today = businessToday()
    // Надзорная сводка по всей команде — только руководству. Экран и так
    // спрятан роутером, но сам запрос доступен любому авторизованному.
    const viewer = await currentEmployee(ctx)
    if (!isManager(viewer)) return { today, deadlineTime: time, dates: [], rows: [] }
    const deadlinePassedToday = Date.now() > deadlineMs(today, time)
    const dates = windowDates(today, N)

    const emps = (
      await ctx.db
        .query('employees')
        .withIndex('by_status', (q) => q.eq('status', 'active'))
        .collect()
    ).filter((e) => !e.hidden && e.role !== 'owner' && REPORTING.has(e.position))

    const rows = []
    for (const e of emps) {
      const { cells, onTime, late, missed, fillRate } = await disciplineRow(
        ctx,
        e,
        dates,
        today,
        deadlinePassedToday,
      )
      rows.push({
        employeeId: e._id,
        name: e.name,
        initials: e.initials,
        avatarColor: e.avatarColor,
        positionLabel: e.positionLabel,
        position: e.position,
        cells,
        onTime,
        late,
        missed,
        fillRate,
      })
    }

    return { today, deadlineTime: time, dates, rows }
  },
})

// Конкретный отчёт + развёрнутая история правок (для модалки при клике по
// ячейке). История хранит только id автора — имена резолвим здесь.
export const reportFor = query({
  args: { employeeId: v.id('employees'), date: v.string() },
  handler: async (ctx, { employeeId, date }) => {
    // Чужой отчёт открывает только руководство; свой — сам сотрудник.
    const viewer = await currentEmployee(ctx)
    if (!viewer) return null
    if (!isManager(viewer) && viewer._id !== employeeId) return null

    const report = await ctx.db
      .query('dailyReports')
      .withIndex('by_employee_date', (q) =>
        q.eq('employeeId', employeeId).eq('date', date),
      )
      .first()
    if (!report) return null

    const history = await Promise.all(
      report.history.map(async (h) => {
        const by = await ctx.db.get(h.byId)
        return {
          at: h.at,
          action: h.action,
          byName: by?.name ?? 'Сотрудник',
          byInitials: by?.initials ?? '—',
          byColor: by?.avatarColor ?? '#9498a1',
        }
      }),
    )

    // Править может автор или руководство, и только пока месяц не закрыт.
    const canEdit =
      (isManager(viewer) || viewer._id === employeeId) &&
      !(await isMonthClosed(ctx, date.slice(0, 7)))

    return { report, history, canEdit }
  },
})

// Правка чужого/своего отчёта (§3: изменения фиксируются с автором и временем).
// В отличие от submit не создаёт отчёт и не меняет статус «в срок/опоздал» —
// он определяется первой отправкой и правкой не сдвигается.
export const edit = mutation({
  args: {
    reportId: v.id('dailyReports'),
    note: v.optional(v.string()),
    smm: v.optional(smmRows),
    targetolog: v.optional(targetologRows),
    sales: v.optional(salesPayload),
  },
  handler: async (ctx, args) => {
    const me = await requireEmployee(ctx)
    const report = await ctx.db.get(args.reportId)
    if (!report) throw new ConvexError('Отчёт не найден')

    if (!isManager(me) && me._id !== report.employeeId) {
      throw new ConvexError('Отчёт может править его автор или руководитель')
    }
    if (await isMonthClosed(ctx, report.date.slice(0, 7))) {
      throw new ConvexError('Месяц закрыт — отчёты за него больше не изменяются')
    }

    const now = Date.now()
    await ctx.db.patch(args.reportId, {
      // Меняем только присланный раздел, чужие поля не трогаем.
      ...(args.smm !== undefined ? { smm: args.smm } : {}),
      ...(args.targetolog !== undefined ? { targetolog: args.targetolog } : {}),
      ...(args.sales !== undefined ? { sales: args.sales } : {}),
      ...(args.note !== undefined ? { note: args.note } : {}),
      editedAt: now,
      editedById: me._id,
      editCount: report.editCount + 1,
      history: [...report.history, { at: now, byId: me._id, action: 'edited' as const }],
    })
    return args.reportId
  },
})
