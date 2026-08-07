// Раздел «Встречи» (ТЗ СИСТЕМА §4).
//
// Работает по логике, близкой к задачам, но проще: это внутренняя
// напоминалка. Создать встречу и пригласить коллег может любой сотрудник
// компании (§4.2). Приглашённый видит встречу у себя как напоминание.
//
// Дополнение «Встречи: перенос, отмена, фиксация результата» добавило три
// состояния (§2), перенос без создания новой записи (§3), отмену с
// сохранением записи (§4) и бессрочный журнал действий (§6). Ограничение
// §4.8 базового ТЗ про «без статусов» этим дополнением снято.
//
// Подтверждения участия по-прежнему нет: «Состоялась» означает, что встреча
// была проведена, но не доказывает присутствие конкретного приглашённого
// (§7.2).

import { query, mutation } from './_generated/server'
import { v, ConvexError } from 'convex/values'
import type { QueryCtx, MutationCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { currentEmployee, requireEmployee, isManager, hiddenEmployeeIds, isStaff } from './lib'
import { notifyMeetingEvent } from './telegramFlow'

function businessToday(): string {
  return new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 10)
}

function clean(s: string | undefined): string | undefined {
  const t = s?.trim()
  return t ? t : undefined
}

const TZ = '+05:00'

// Момент начала встречи в часовом поясе компании.
function startsAt(m: Doc<'meetings'>): number {
  return Date.parse(`${m.date}T${m.time}:00${TZ}`)
}

// §2: у встреч, заведённых до появления состояний, поля нет — они
// запланированы.
export function meetingStatus(m: Doc<'meetings'>): 'planned' | 'held' | 'cancelled' {
  return m.status ?? 'planned'
}

// §2.2: служебный признак, а не состояние. Время прошло, результат не выбран.
// Снимается после любого из трёх действий.
export function awaitingResult(m: Doc<'meetings'>, now = Date.now()): boolean {
  return meetingStatus(m) === 'planned' && startsAt(m) < now
}

// §5: изменять, переносить, отменять и подтверждать результат может
// организатор своей встречи и администратор — любой. Участник только смотрит.
function mayManage(m: Doc<'meetings'>, me: Doc<'employees'>): boolean {
  return m.createdById === me._id || me.role === 'owner'
}

async function logEvent(
  ctx: MutationCtx,
  meetingId: Id<'meetings'>,
  row: {
    type: 'created' | 'rescheduled' | 'updated' | 'participants' | 'held' | 'cancelled'
    byId: Id<'employees'>
    fromDate?: string
    fromTime?: string
    toDate?: string
    toTime?: string
    changes?: string
  },
) {
  await ctx.db.insert('meetingEvents', { meetingId, at: Date.now(), ...row })
}

async function decorate(ctx: QueryCtx, rows: Doc<'meetings'>[]) {
  const employees = await ctx.db.query('employees').collect()
  const byId = new Map(employees.map((e) => [e._id as string, e]))
  const person = (id: Id<'employees'>) => {
    const e = byId.get(id as string)
    return {
      _id: id,
      name: e?.name ?? 'Сотрудник',
      initials: e?.initials ?? '—',
      avatarColor: e?.avatarColor ?? '#9498a1',
      positionLabel: e?.positionLabel ?? '',
    }
  }
  const now = Date.now()
  return rows.map((m) => ({
    _id: m._id,
    status: meetingStatus(m),
    // §2.2: признак «время прошло, результат не выбран».
    awaiting: awaitingResult(m, now),
    originalDate: m.originalDate ?? null,
    originalTime: m.originalTime ?? null,
    rescheduleCount: m.rescheduleCount ?? 0,
    resolvedAt: m.resolvedAt ?? null,
    title: m.title,
    date: m.date,
    time: m.time,
    place: m.place ?? null,
    mapUrl: m.mapUrl ?? null,
    comment: m.comment ?? null,
    createdAt: m.createdAt,
    createdBy: person(m.createdById),
    participants: m.participantIds.map(person),
  }))
}

// §4.3: сотрудник видит свои встречи и те, на которые его пригласили.
// §4.7: администратор видит все встречи компании и может фильтровать их по
// создателю, участнику и датам.
export const list = query({
  args: {
    from: v.optional(v.string()),
    to: v.optional(v.string()),
    // Только для администратора; сотруднику эти фильтры не нужны — он и так
    // видит лишь свои встречи.
    createdById: v.optional(v.id('employees')),
    participantId: v.optional(v.id('employees')),
    scope: v.optional(v.union(v.literal('mine'), v.literal('all'))),
    // §4: отменённая встреча исчезает из предстоящих, но остаётся в истории —
    // показываем её только когда смотрят период.
    includeCancelled: v.optional(v.boolean()),
  },
  handler: async (ctx, { from, to, createdById, participantId, scope, includeCancelled }) => {
    const me = await currentEmployee(ctx)
    if (!me) {
      return { rows: [], awaiting: [], today: businessToday(), canSeeAll: false, employees: [] }
    }

    const canSeeAll = isManager(me)
    const all = await ctx.db.query('meetings').collect()

    const rows = all
      .filter((m) => (!from || m.date >= from) && (!to || m.date <= to))
      .filter((m) => {
        // Сотруднику — только свои и те, куда его пригласили. Руководство
        // может смотреть всё, но по умолчанию тоже видит свои.
        const mine =
          m.createdById === me._id || m.participantIds.some((p) => p === me._id)
        if (!canSeeAll || scope !== 'all') return mine
        return true
      })
      .filter((m) => !createdById || m.createdById === createdById)
      .filter((m) => !participantId || m.participantIds.some((p) => p === participantId))
      .filter((m) => includeCancelled || meetingStatus(m) !== 'cancelled')
      // §4.3: от ближайшей к более поздней.
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))

    const hidden = await hiddenEmployeeIds(ctx)
    const employees = (await ctx.db.query('employees').collect())
      // Внутренняя встреча — дело команды: заказчика упаковки в список
      // приглашаемых не подставляем (ТЗ Упаковка §3).
      .filter(
        (e) =>
          e.status === 'active' &&
          isStaff(e) &&
          (me.role === 'owner' || !hidden.has(e._id)),
      )
      .map((e) => ({
        _id: e._id,
        name: e.name,
        initials: e.initials,
        avatarColor: e.avatarColor,
        positionLabel: e.positionLabel,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'))

    // §2.2: встречи организатора, время которых прошло, а результат не
    // выбран, выводятся ему отдельно.
    const now = Date.now()
    const awaiting = all.filter((m) => m.createdById === me._id && awaitingResult(m, now))

    return {
      rows: await decorate(ctx, rows),
      awaiting: await decorate(ctx, awaiting),
      today: businessToday(),
      canSeeAll,
      employees,
    }
  },
})

// §4.6: статистика по сотруднику — сколько встреч он создал и на сколько был
// приглашён. Формулировка «был приглашён» НЕ означает «посетил».
export const stats = query({
  args: { employeeId: v.optional(v.id('employees')), from: v.optional(v.string()), to: v.optional(v.string()) },
  handler: async (ctx, { employeeId, from, to }) => {
    const me = await currentEmployee(ctx)
    if (!me) return null
    const who = employeeId ?? me._id
    if (who !== me._id && !isManager(me)) return null

    const rows = (await ctx.db.query('meetings').collect()).filter(
      (m) => (!from || m.date >= from) && (!to || m.date <= to),
    )
    const created = rows.filter((m) => m.createdById === who)
    // Приглашённым считаем участие без авторства — иначе своя встреча
    // засчиталась бы дважды.
    const invited = rows.filter(
      (m) => m.createdById !== who && m.participantIds.some((p) => p === who),
    )
    return {
      created: created.length,
      invited: invited.length,
      createdRows: await decorate(ctx, created),
      invitedRows: await decorate(ctx, invited),
    }
  },
})

export const create = mutation({
  args: {
    title: v.string(),
    date: v.string(),
    time: v.string(),
    place: v.optional(v.string()),
    mapUrl: v.optional(v.string()),
    comment: v.optional(v.string()),
    participantIds: v.array(v.id('employees')),
  },
  handler: async (ctx, args) => {
    // §4.2: создавать встречи и приглашать коллег могут все сотрудники.
    const me = await requireEmployee(ctx)

    const title = args.title.trim()
    if (!title) throw new ConvexError('Укажите название встречи')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) throw new ConvexError('Укажите дату встречи')
    if (!/^\d{2}:\d{2}$/.test(args.time)) throw new ConvexError('Укажите время встречи')

    // §4.2: создатель автоматически участник — держим его в списке, чтобы
    // выборка «мои встречи» была одним условием.
    const ids = new Set<string>([me._id as string, ...args.participantIds.map((p) => p as string)])
    for (const id of ids) {
      const e = await ctx.db.get(id as Id<'employees'>)
      if (!e) throw new ConvexError('Участник не найден')
    }

    const id = await ctx.db.insert('meetings', {
      title,
      date: args.date,
      time: args.time,
      place: clean(args.place),
      mapUrl: clean(args.mapUrl),
      comment: clean(args.comment),
      createdById: me._id,
      participantIds: [...ids] as Id<'employees'>[],
      createdAt: Date.now(),
      status: 'planned',
      // §6: исходная договорённость сохраняется рядом с актуальной.
      originalDate: args.date,
      originalTime: args.time,
      rescheduleCount: 0,
    })
    await logEvent(ctx, id, { type: 'created', byId: me._id })
    // §5.3 ТЗ Telegram: все приглашённые получают уведомление о назначении.
    const created = await ctx.db.get(id)
    if (created) await notifyMeetingEvent(ctx, created, 'Новая встреча', [], me._id)
    return id
  },
})

export const update = mutation({
  args: {
    id: v.id('meetings'),
    title: v.optional(v.string()),
    date: v.optional(v.string()),
    time: v.optional(v.string()),
    place: v.optional(v.string()),
    mapUrl: v.optional(v.string()),
    comment: v.optional(v.string()),
    participantIds: v.optional(v.array(v.id('employees'))),
  },
  handler: async (ctx, { id, participantIds, ...patch }) => {
    const me = await requireEmployee(ctx)
    const meeting = await ctx.db.get(id)
    if (!meeting) throw new ConvexError('Встреча не найдена')
    // §5: изменяет организатор своей встречи или администратор — любой.
    if (!mayManage(meeting, me)) {
      throw new ConvexError('Изменить встречу может её организатор или администратор')
    }
    if (meetingStatus(meeting) === 'cancelled') {
      throw new ConvexError('Встреча отменена — изменить её нельзя')
    }
    if (patch.title !== undefined && !patch.title.trim()) {
      throw new ConvexError('Название встречи не может быть пустым')
    }

    const next: Record<string, unknown> = {}
    if (patch.title !== undefined) next.title = patch.title.trim()
    if (patch.date !== undefined) next.date = patch.date
    if (patch.time !== undefined) next.time = patch.time
    if (patch.place !== undefined) next.place = clean(patch.place)
    if (patch.mapUrl !== undefined) next.mapUrl = clean(patch.mapUrl)
    if (patch.comment !== undefined) next.comment = clean(patch.comment)
    // §5.3: показываем, ЧТО именно изменилось, со старым и новым значением.
    const changes: string[] = []
    if (next.title && next.title !== meeting.title) {
      changes.push(`тема: «${meeting.title}» → «${next.title}»`)
    }
    if ((next.date && next.date !== meeting.date) || (next.time && next.time !== meeting.time)) {
      changes.push(
        `перенос: ${meeting.date} ${meeting.time} → ${next.date ?? meeting.date} ${next.time ?? meeting.time}`,
      )
    }
    if (next.place !== undefined && next.place !== meeting.place) {
      changes.push(`место: ${meeting.place ?? '—'} → ${next.place ?? '—'}`)
    }
    if (next.mapUrl !== undefined && next.mapUrl !== meeting.mapUrl) {
      changes.push('изменена ссылка')
    }
    if (next.comment !== undefined && next.comment !== meeting.comment) {
      changes.push('изменён комментарий')
    }

    let added: Id<'employees'>[] = []
    let removed: Id<'employees'>[] = []
    if (participantIds !== undefined) {
      const ids = new Set<string>([
        meeting.createdById as string,
        ...participantIds.map((p) => p as string),
      ])
      const before = new Set(meeting.participantIds.map((p) => p as string))
      added = [...ids].filter((i) => !before.has(i)) as Id<'employees'>[]
      removed = [...before].filter((i) => !ids.has(i)) as Id<'employees'>[]
      next.participantIds = [...ids]
    }
    await ctx.db.patch(id, next)

    const after = await ctx.db.get(id)
    if (after) {
      if (changes.length > 0) {
        // Прежним участникам — что изменилось.
        const stayed = after.participantIds.filter((p) => !added.includes(p))
        await notifyMeetingEvent(
          ctx,
          { ...after, participantIds: stayed },
          'Встреча изменена',
          changes,
          me._id,
        )
      }
      // §5.3: новый участник получает полную карточку приглашения.
      if (added.length > 0) {
        await notifyMeetingEvent(
          ctx,
          { ...after, participantIds: added },
          'Вас пригласили на встречу',
          [],
          me._id,
        )
      }
      // §6: изменения параметров и состава уходят в журнал.
      if (changes.length > 0) {
        await logEvent(ctx, id, { type: 'updated', byId: me._id, changes: changes.join('; ') })
      }
      if (added.length > 0 || removed.length > 0) {
        await logEvent(ctx, id, {
          type: 'participants',
          byId: me._id,
          changes: `добавлено ${added.length}, удалено ${removed.length}`,
        })
      }
      // Удалённый участник получает сообщение о прекращении участия.
      if (removed.length > 0) {
        await notifyMeetingEvent(
          ctx,
          { ...after, participantIds: removed },
          'Вы больше не участник встречи',
          [],
          me._id,
        )
      }
    }
  },
})

// ——— §2.1: три действия после наступления времени встречи ———

// §3: перенос правит СУЩЕСТВУЮЩУЮ запись. Идентификатор, организатор и состав
// участников сохраняются, новая встреча не создаётся, а общее число встреч от
// переноса не растёт — для переносов отдельный счётчик.
export const reschedule = mutation({
  args: {
    id: v.id('meetings'),
    date: v.string(),
    time: v.string(),
    place: v.optional(v.string()),
    mapUrl: v.optional(v.string()),
    comment: v.optional(v.string()),
  },
  handler: async (ctx, { id, date, time, place, mapUrl, comment }) => {
    const me = await requireEmployee(ctx)
    const meeting = await ctx.db.get(id)
    if (!meeting) throw new ConvexError('Встреча не найдена')
    if (!mayManage(meeting, me)) {
      throw new ConvexError('Перенести встречу может её организатор или администратор')
    }
    if (meetingStatus(meeting) === 'cancelled') {
      throw new ConvexError('Встреча отменена — переносить её нечего')
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ConvexError('Укажите новую дату')
    if (!/^\d{2}:\d{2}$/.test(time)) throw new ConvexError('Укажите новое время')

    const extra: string[] = []
    if (place !== undefined && clean(place) !== meeting.place) {
      extra.push(`место: ${meeting.place ?? '—'} → ${clean(place) ?? '—'}`)
    }
    if (mapUrl !== undefined && clean(mapUrl) !== meeting.mapUrl) extra.push('изменена ссылка')
    if (comment !== undefined && clean(comment) !== meeting.comment) {
      extra.push('изменён комментарий')
    }

    await ctx.db.patch(id, {
      date,
      time,
      ...(place !== undefined ? { place: clean(place) } : {}),
      ...(mapUrl !== undefined ? { mapUrl: clean(mapUrl) } : {}),
      ...(comment !== undefined ? { comment: clean(comment) } : {}),
      // §2.2: признак «ожидает подтверждения» снимается — у встречи снова
      // есть будущее время.
      status: 'planned',
      resolvedAt: undefined,
      resolvedById: undefined,
      rescheduleCount: (meeting.rescheduleCount ?? 0) + 1,
    })

    // §6: в истории остаются прежние и новые параметры, время и автор.
    await logEvent(ctx, id, {
      type: 'rescheduled',
      byId: me._id,
      fromDate: meeting.date,
      fromTime: meeting.time,
      toDate: date,
      toTime: time,
      changes: extra.join('; ') || undefined,
    })

    // §3: все участники получают уведомление с прежними и новыми параметрами.
    const after = await ctx.db.get(id)
    if (after) {
      await notifyMeetingEvent(
        ctx,
        after,
        'Встреча перенесена',
        [`было: ${meeting.date}, ${meeting.time}`, `стало: ${date}, ${time}`, ...extra],
        me._id,
      )
    }
  },
})

// §2.1: организатор подтверждает ФАКТ проведения. Оценку успешности система
// не запрашивает.
export const markHeld = mutation({
  args: { id: v.id('meetings') },
  handler: async (ctx, { id }) => {
    const me = await requireEmployee(ctx)
    const meeting = await ctx.db.get(id)
    if (!meeting) throw new ConvexError('Встреча не найдена')
    if (!mayManage(meeting, me)) {
      throw new ConvexError('Подтвердить проведение может организатор или администратор')
    }
    if (meetingStatus(meeting) === 'held') return
    await ctx.db.patch(id, { status: 'held', resolvedAt: Date.now(), resolvedById: me._id })
    await logEvent(ctx, id, { type: 'held', byId: me._id })
  },
})

// §4: отмена. Встреча исчезает из предстоящих, но НЕ удаляется — остаётся в
// календаре и истории с состоянием «Отменена».
export const cancel = mutation({
  args: { id: v.id('meetings') },
  handler: async (ctx, { id }) => {
    const me = await requireEmployee(ctx)
    const meeting = await ctx.db.get(id)
    if (!meeting) throw new ConvexError('Встреча не найдена')
    if (!mayManage(meeting, me)) {
      throw new ConvexError('Отменить встречу может её организатор или администратор')
    }
    if (meetingStatus(meeting) === 'cancelled') return

    await ctx.db.patch(id, { status: 'cancelled', resolvedAt: Date.now(), resolvedById: me._id })
    await logEvent(ctx, id, { type: 'cancelled', byId: me._id })
    // §4: все участники уведомляются об отмене.
    await notifyMeetingEvent(ctx, meeting, 'Встреча отменена', [], me._id)
  },
})

// §6: журнал действий по встрече.
export const history = query({
  args: { id: v.id('meetings') },
  handler: async (ctx, { id }) => {
    const me = await currentEmployee(ctx)
    if (!me) return null
    const meeting = await ctx.db.get(id)
    if (!meeting) return null
    const mine =
      meeting.createdById === me._id || meeting.participantIds.some((p) => p === me._id)
    if (!mine && !isManager(me)) return null

    const names = new Map(
      (await ctx.db.query('employees').collect()).map((e) => [e._id as string, e.name]),
    )
    const rows = await ctx.db
      .query('meetingEvents')
      .withIndex('by_meeting', (q) => q.eq('meetingId', id))
      .collect()
    return {
      status: meetingStatus(meeting),
      original:
        meeting.originalDate && meeting.originalTime
          ? `${meeting.originalDate}, ${meeting.originalTime}`
          : null,
      current: `${meeting.date}, ${meeting.time}`,
      rescheduleCount: meeting.rescheduleCount ?? 0,
      events: rows
        .sort((a, b) => b.at - a.at)
        .map((e) => ({
          _id: e._id,
          type: e.type,
          at: e.at,
          by: names.get(e.byId as string) ?? '—',
          from: e.fromDate ? `${e.fromDate}, ${e.fromTime ?? ''}`.trim() : null,
          to: e.toDate ? `${e.toDate}, ${e.toTime ?? ''}`.trim() : null,
          changes: e.changes ?? null,
        })),
    }
  },
})

// Полное удаление — только администратору и только для встреч, заведённых по
// ошибке. Обычный путь закрытия встречи — отмена: §4 требует сохранять запись.
export const remove = mutation({
  args: { id: v.id('meetings') },
  handler: async (ctx, { id }) => {
    const me = await requireEmployee(ctx)
    if (me.role !== 'owner') {
      throw new ConvexError('Удалить встречу может только администратор — обычно её отменяют')
    }
    const meeting = await ctx.db.get(id)
    if (!meeting) return
    for (const e of await ctx.db
      .query('meetingEvents')
      .withIndex('by_meeting', (q) => q.eq('meetingId', id))
      .collect()) {
      await ctx.db.delete(e._id)
    }
    await ctx.db.delete(id)
  },
})
