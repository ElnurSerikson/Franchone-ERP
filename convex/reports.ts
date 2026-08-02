import { query, mutation } from './_generated/server'
import { v, ConvexError } from 'convex/values'
import type { QueryCtx, MutationCtx } from './_generated/server'
import type { Doc } from './_generated/dataModel'
import { currentEmployee, requireEmployee } from './lib'
import { isMonthClosed } from './payroll'
import { targetDayForEmployee } from './target'
import { can, requireCan, inScope, viewScope } from './permissions'

// Бизнес-часовой пояс компании — Asia/Almaty (UTC+5, без перехода на летнее время).
const TZ = '+05:00'
// ТЗ СИСТЕМА §2: отчёт за календарный день заполняется до 14:00 СЛЕДУЮЩЕГО
// дня по Asia/Almaty. Значение настраивается, меняется только час — правило
// «на следующий день» зашито в deadlineMs.
const DEFAULT_DEADLINE = '14:00'
export const REPORTING = new Set(['smm', 'targetolog', 'sales'])

// Отчёт «переоткрыт»: владелец удалил его, день ждёт повторной сдачи. Цифры
// очищены, а повторная отправка пойдёт «с опозданием».
function isReopened(r: Doc<'dailyReports'> | null | undefined): boolean {
  return r?.reopened === true
}

// Может ли сотрудник (автор) сам править отчёт прямо сейчас.
// ТЗ СИСТЕМА §2: отчёт за день заполняется до 14:00 следующего календарного
// дня. Значит открыты сегодняшний день и вчерашний — пока не пробило 14:00.
// Более ранние даты сотрудник уже не трогает, будущие в форму не попадают.
function authorCanEdit(
  date: string,
  today: string,
  nowMs: number,
  time: string,
): boolean {
  // §2.2: сотрудник заполняет сегодняшний день и вчерашний — пока не наступил
  // дедлайн вчерашнего. После него правит только администратор, и такая
  // запись считается сданной с опозданием (§2.3).
  return date <= today && nowMs <= deadlineMs(date, time)
}

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

// Момент дедлайна для отчётной даты (ms). §2: срок наступает в указанное
// время СЛЕДУЮЩЕГО календарного дня — отчёт за 1 августа заполняется до
// 2 августа 14:00 и в 14:00 блокируется.
export function deadlineMs(date: string, time: string): number {
  return Date.parse(`${addDays(date, 1)}T${time}:00${TZ}`)
}

function effectiveOnTime(r: Doc<'dailyReports'>, time: string): boolean {
  return r.onTime && r.submittedAt <= deadlineMs(r.date, time)
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
// Самая ранняя дата, за которую сотрудник ещё может сдать отчёт сам. §2: это
// вчерашний день, и только пока не пробило 14:00. Раньше — уже только
// администратор.
function earliestReportDate(me: Doc<'employees'>, today: string, nowMs: number, time: string): string {
  const yesterday = addDays(today, -1)
  const open = nowMs <= deadlineMs(yesterday, time) ? yesterday : today
  return me.hiredAt > open ? me.hiredAt : open
}

// Мой отчёт за дату (по умолчанию сегодня) + короткая история.
// Факт сдачи в едином виде — то, что нужно шапке, истории и сетке дисциплины.
// Полный документ отчёта им не нужен, а форма его берёт отдельно.
export type Submission = {
  date: string
  submittedAt: number
  onTime: boolean
  editCount: number
  editedAt?: number
  reopened?: boolean
}

// Отчёты таргетолога переехали в собственные таблицы модуля (targetReports) и
// в dailyReports больше не пишутся. Без этой подмены он выглядел бы вечным
// прогульщиком: шапка твердила бы «отчёт не заполнен» поверх отправленного,
// история оставалась бы пустой, а заполняемость считалась бы по нулям.
// Экспортируется под именем submissionsFor: раздел «Эффективность» считает
// дисциплину по тем же данным, что и сетка отчётности — двух источников
// правды тут быть не должно.
export async function submissionsFor(
  ctx: QueryCtx,
  e: Doc<'employees'>,
  time: string,
): Promise<Submission[]> {
  if (e.position === 'targetolog') {
    const rows = await ctx.db
      .query('targetReports')
      .withIndex('by_employee_date', (q) => q.eq('employeeId', e._id))
      .collect()
    return rows
      .filter((r): r is typeof r & { submittedAt: number } => r.submittedAt !== undefined)
      .map((r) => ({
        date: r.date,
        submittedAt: r.submittedAt,
        onTime: r.submittedAt <= deadlineMs(r.date, time),
        // Отправленный отчёт правит только администратор, и правка уходит в
        // журнал аудита — счётчика правок у самой записи нет.
        editCount: 0,
      }))
      .sort((a, b) => (a.date < b.date ? 1 : -1))
  }
  const rows = await ctx.db
    .query('dailyReports')
    .withIndex('by_employee', (q) => q.eq('employeeId', e._id))
    .collect()
  return rows
    .map((r) => ({
      date: r.date,
      submittedAt: r.submittedAt,
      onTime: effectiveOnTime(r, time),
      editCount: r.editCount ?? 0,
      editedAt: r.editedAt,
      reopened: isReopened(r),
    }))
    .sort((a, b) => (a.date < b.date ? 1 : -1))
}

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
    const normalizedAll = all.map((r) => ({ ...r, onTime: effectiveOnTime(r, time) }))

    const sent = await submissionsFor(ctx, me, time)
    const report = normalizedAll.find((r) => r.date === target) ?? null
    const reporting = me.role !== 'owner' && REPORTING.has(me.position)
    const closed = await isMonthClosed(ctx, target.slice(0, 7))
    const editable =
      reporting &&
      !closed &&
      authorCanEdit(target, today, Date.now(), time)
    // Почему поле закрыто — чтобы форма показала верное сообщение.
    const lockReason = editable
      ? null
      : closed
        ? ('closed' as const)
        : ('past' as const)

    return {
      today,
      date: target,
      earliestDate: earliestReportDate(me, today, Date.now(), time),
      deadlineTime: time,
      position: me.position,
      report,
      // Факт сдачи за выбранный день и история — из единого источника, чтобы
      // отчёты таргетолога не выпадали (см. submissions).
      submission: sent.find((s) => s.date === target) ?? null,
      reopened: isReopened(report),
      editable,
      lockReason,
      history: sent.slice(0, 21),
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
    const time = await deadlineTime(ctx)
    const now = Date.now()

    if (date > today) throw new ConvexError('Отчёт за будущую дату сдать нельзя')
    // Закрытый месяц — это уже начисленная зарплата. Иначе правку можно было бы
    // протащить в переоткрытый месяц и разойтись со снапшотом.
    if (await isMonthClosed(ctx, date.slice(0, 7))) {
      throw new ConvexError('Месяц закрыт — отчёты за него больше не принимаются')
    }

    const existing = await ctx.db
      .query('dailyReports')
      .withIndex('by_employee_date', (q) =>
        q.eq('employeeId', me._id).eq('date', date),
      )
      .first()

    const reopened = isReopened(existing)
    // §2.2: своё окно — до 14:00 следующего дня. После дедлайна отчёт за этот
    // день вносит и правит только администратор, и запись помечается как
    // сданная с опозданием (§2.3).
    if (now > deadlineMs(date, time)) {
      throw new ConvexError(
        'Дедлайн прошёл — отчёт за этот день может изменить только владелец',
      )
    }

    const payload = {
      smm: args.smm,
      targetolog: args.targetolog,
      sales: args.sales,
      note: args.note,
    }

    // Должность отчёта берём по фактически присланному разделу, а не только по
    // текущей должности сотрудника: тогда position всегда совпадает с payload,
    // и цифры не «прячутся» под чужим разделом, если человек сменил должность.
    const submittedPosition: 'smm' | 'targetolog' | 'sales' =
      args.smm !== undefined
        ? 'smm'
        : args.targetolog !== undefined
          ? 'targetolog'
          : args.sales !== undefined
            ? 'sales'
            : (existing?.position ?? position)

    if (existing) {
      await ctx.db.patch(existing._id, {
        ...payload,
        position: submittedPosition,
        // Переоткрытый день закрываем повторной сдачей: снимаем флаг и метки
        // удаления, статус фиксируем «с опозданием».
        ...(reopened
          ? { onTime: false, reopened: false, deletedAt: undefined, deletedById: undefined }
          : {}),
        editedAt: now,
        editedById: me._id,
        editCount: existing.editCount + 1,
        history: [
          ...existing.history,
          { at: now, byId: me._id, action: reopened ? ('submitted' as const) : ('edited' as const) },
        ],
      })
      return existing._id
    }

    // Свежая отправка сюда попадает только в пределах дедлайна (иначе отсекли
    // выше), значит она всегда «в срок».
    return await ctx.db.insert('dailyReports', {
      employeeId: me._id,
      position: submittedPosition,
      date,
      submittedAt: now,
      onTime: true,
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
  nowMs: number,
  time: string,
) {
  const byDate = new Map((await submissionsFor(ctx, e, time)).map((r) => [r.date, r]))

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
      // Переоткрытый день — отчёт удалён владельцем и ещё не пересдан: цифр
      // нет, засчитываем как пропуск, пока сотрудник (или владелец) не заполнит.
      if (r.reopened) {
        missed++
        return { date: d, status: 'missed' as const, reopened: true }
      }
      if (r.onTime) onTime++
      else late++
      return {
        date: d,
        status: r.onTime ? ('onTime' as const) : ('late' as const),
        submittedAt: r.submittedAt,
        edited: r.editCount > 0,
      }
    }
    // §2: день считается пропущенным только когда истёк его дедлайн —
    // 14:00 следующего календарного дня. До этого он ещё «в работе».
    if (nowMs > deadlineMs(d, time)) {
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
    const row = await disciplineRow(ctx, me, dates, Date.now(), time)
    return { today, deadlineTime: time, dates, ...row, reporting: true }
  },
})

export const discipline = query({
  args: { days: v.optional(v.number()) },
  handler: async (ctx, { days }) => {
    const N = days ?? 14
    const time = await deadlineTime(ctx)
    const today = businessToday()
    // Надзорная сводка — по праву «Отчёты: просмотр». Скоуп: владелец — вся
    // команда, руководитель — свой отдел. Сам запрос доступен любому
    // авторизованному, поэтому фильтруем на сервере.
    const viewer = await currentEmployee(ctx)
    const scope = await viewScope(ctx, 'reports')
    if (!viewer || scope === 'none') {
      return { today, deadlineTime: time, dates: [], rows: [] }
    }
    const nowMs = Date.now()
    const dates = windowDates(today, N)

    const emps = (
      await ctx.db
        .query('employees')
        .withIndex('by_status', (q) => q.eq('status', 'active'))
        .collect()
    ).filter(
      (e) =>
        !e.hidden &&
        e.role !== 'owner' &&
        REPORTING.has(e.position) &&
        // «Все» — вся команда; «Только свои» — свой отдел (руководитель) / сам.
        (scope === 'all'
          ? true
          : viewer.role === 'head'
            ? e.department === viewer.department
            : e._id === viewer._id),
    )

    const rows = []
    for (const e of emps) {
      const { cells, onTime, late, missed, fillRate } = await disciplineRow(
        ctx,
        e,
        dates,
        nowMs,
        time,
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
    // Свой отчёт открывает сам сотрудник; чужой — по праву «Отчёты: просмотр»
    // и только в своём скоупе (руководитель — свой отдел).
    const viewer = await currentEmployee(ctx)
    if (!viewer) return null
    const emp = await ctx.db.get(employeeId)
    const isSelf = viewer._id === employeeId
    const mayView =
      isSelf ||
      viewer.role === 'owner' ||
      (!!emp && inScope(viewer, emp) && (await can(ctx, 'reports', 'view')))
    if (!mayView) return null
    const rawReport = await ctx.db
      .query('dailyReports')
      .withIndex('by_employee_date', (q) =>
        q.eq('employeeId', employeeId).eq('date', date),
      )
      .first()
    const time = await deadlineTime(ctx)
    const report = rawReport ? { ...rawReport, onTime: effectiveOnTime(rawReport, time) } : null

    const history = rawReport
      ? await Promise.all(
          rawReport.history.map(async (h) => {
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
      : []

    const closed = await isMonthClosed(ctx, date.slice(0, 7))
    const reopened = isReopened(report)
    const reporting = !!emp && emp.role !== 'owner' && REPORTING.has(emp.position)

    // §2.6: отчёт таргетолога живёт в собственных таблицах модуля. Раньше сюда
    // смотрела только legacy-таблица dailyReports, и сданный отчёт открывался
    // как пропущенный, с предложением внести его заново.
    const target =
      emp?.position === 'targetolog' ? await targetDayForEmployee(ctx, employeeId, date) : null

    // Отчёт с содержимым: не переоткрытая пустышка. Такой можно править и удалять.
    const hasContent = target ? target.submittedAt !== null : !!report && !reopened
    // Права правки/удаления — по матрице и в скоупе, только в открытом месяце.
    const scoped = !!emp && inScope(viewer, emp)
    const mayEdit = scoped && !closed && (await can(ctx, 'reports', 'edit'))
    const mayDelete = scoped && !closed && (await can(ctx, 'reports', 'delete'))

    return {
      report,
      target,
      history,
      reopened,
      position: emp?.position ?? null,
      canEdit: mayEdit && hasContent,
      // Отчёт таргетолога не удаляется целиком: он состоит из строк кампаний,
      // и правки по нему идут через журнал аудита модуля.
      canDelete: mayDelete && hasContent && !target,
      // Пропущенный/переоткрытый день вносит заново тот, кто может править.
      canCreate: mayEdit && reporting && !hasContent,
    }
  },
})

// Владелец вносит или правит цифры отчёта после дедлайна (§3: правки
// фиксируются с автором и временем). Любая запись после дедлайна становится
// «с опозданием» (жёлтой). Только владелец и только в открытом месяце.
export const ownerSet = mutation({
  args: {
    employeeId: v.id('employees'),
    date: v.string(),
    note: v.optional(v.string()),
    smm: v.optional(smmRows),
    targetolog: v.optional(targetologRows),
    sales: v.optional(salesPayload),
  },
  handler: async (ctx, args) => {
    const me = await requireCan(ctx, 'reports', 'edit')
    const emp = await ctx.db.get(args.employeeId)
    if (!emp) throw new ConvexError('Сотрудник не найден')
    if (!inScope(me, emp)) {
      throw new ConvexError('Можно править отчёты только сотрудников в вашем доступе')
    }
    if (emp.role === 'owner' || !REPORTING.has(emp.position)) {
      throw new ConvexError('Для этой должности отчётность не предусмотрена')
    }
    if (args.date > businessToday()) {
      throw new ConvexError('Отчёт за будущую дату внести нельзя')
    }
    if (await isMonthClosed(ctx, args.date.slice(0, 7))) {
      throw new ConvexError('Месяц закрыт — отчёты за него больше не изменяются')
    }

    const now = Date.now()
    const time = await deadlineTime(ctx)
    const lateOwnerWrite = now > deadlineMs(args.date, time)
    const existing = await ctx.db
      .query('dailyReports')
      .withIndex('by_employee_date', (q) =>
        q.eq('employeeId', args.employeeId).eq('date', args.date),
      )
      .first()

    if (existing) {
      const reopened = isReopened(existing)
      await ctx.db.patch(existing._id, {
        // Меняем только присланный раздел, чужие поля не трогаем.
        ...(args.smm !== undefined ? { smm: args.smm } : {}),
        ...(args.targetolog !== undefined ? { targetolog: args.targetolog } : {}),
        ...(args.sales !== undefined ? { sales: args.sales } : {}),
        ...(args.note !== undefined ? { note: args.note } : {}),
        // position держим в паре с присланным разделом.
        ...(args.smm !== undefined
          ? { position: 'smm' as const }
          : args.targetolog !== undefined
            ? { position: 'targetolog' as const }
            : args.sales !== undefined
              ? { position: 'sales' as const }
              : {}),
        // Правка после дедлайна и дозаполнение переоткрытого дня — «с
        // опозданием», флаг снимаем.
        ...(lateOwnerWrite ? { onTime: false } : {}),
        ...(reopened
          ? { reopened: false, deletedAt: undefined, deletedById: undefined }
          : {}),
        editedAt: now,
        editedById: me._id,
        editCount: existing.editCount + 1,
        history: [
          ...existing.history,
          { at: now, byId: me._id, action: reopened ? ('created' as const) : ('edited' as const) },
        ],
      })
      return existing._id
    }

    // Пропущенный день: отчёта не было, владелец вносит за сотрудника —
    // всегда «с опозданием».
    return await ctx.db.insert('dailyReports', {
      employeeId: args.employeeId,
      position: emp.position as 'smm' | 'targetolog' | 'sales',
      date: args.date,
      submittedAt: now,
      onTime: false,
      editedAt: now,
      editedById: me._id,
      editCount: 0,
      history: [{ at: now, byId: me._id, action: 'created' as const }],
      smm: args.smm,
      targetolog: args.targetolog,
      sales: args.sales,
      note: args.note,
    })
  },
})

// Владелец удаляет отчёт за любую дату (открытый месяц). Мягкое удаление:
// цифры очищаем, день переоткрываем сотруднику, но в истории остаётся, что
// владелец удалил отчёт. Повторная сдача пойдёт «с опозданием».
export const remove = mutation({
  args: { reportId: v.id('dailyReports') },
  handler: async (ctx, { reportId }) => {
    const me = await requireCan(ctx, 'reports', 'delete')
    const report = await ctx.db.get(reportId)
    if (!report) throw new ConvexError('Отчёт не найден')
    const author = await ctx.db.get(report.employeeId)
    if (author && !inScope(me, author)) {
      throw new ConvexError('Можно удалять отчёты только сотрудников в вашем доступе')
    }
    if (await isMonthClosed(ctx, report.date.slice(0, 7))) {
      throw new ConvexError('Месяц закрыт — отчёты за него удалять нельзя')
    }

    const now = Date.now()
    if (report.position === 'sales') {
      const rows = (
        await ctx.db
          .query('salesObjectReports')
          .withIndex('by_employee', (q) => q.eq('employeeId', report.employeeId))
          .collect()
      ).filter((r) => r.date === report.date)
      for (const row of rows) await ctx.db.delete(row._id)
    }
    await ctx.db.patch(reportId, {
      smm: undefined,
      targetolog: undefined,
      sales: undefined,
      note: undefined,
      onTime: false,
      reopened: true,
      deletedAt: now,
      deletedById: me._id,
      editedAt: now,
      editedById: me._id,
      editCount: report.editCount + 1,
      history: [...report.history, { at: now, byId: me._id, action: 'deleted' as const }],
    })
    return reportId
  },
})
