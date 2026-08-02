// Раздел «Встречи» (ТЗ СИСТЕМА §4).
//
// Работает по логике, близкой к задачам, но проще: это внутренняя
// напоминалка. Создать встречу и пригласить коллег может любой сотрудник
// компании (§4.2). Приглашённый видит встречу у себя как напоминание.
//
// Границы первой версии (§4.8): без статусов, подтверждения участия,
// повторяющихся встреч и интеграции с внешними календарями. Система
// фиксирует факт приглашения, а не присутствие (§4.6).

import { query, mutation } from './_generated/server'
import { v, ConvexError } from 'convex/values'
import type { QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { currentEmployee, requireEmployee, isManager, hiddenEmployeeIds } from './lib'

function businessToday(): string {
  return new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 10)
}

function clean(s: string | undefined): string | undefined {
  const t = s?.trim()
  return t ? t : undefined
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
  return rows.map((m) => ({
    _id: m._id,
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
  },
  handler: async (ctx, { from, to, createdById, participantId, scope }) => {
    const me = await currentEmployee(ctx)
    if (!me) return { rows: [], today: businessToday(), canSeeAll: false, employees: [] }

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
      // §4.3: от ближайшей к более поздней.
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))

    const hidden = await hiddenEmployeeIds(ctx)
    const employees = (await ctx.db.query('employees').collect())
      .filter((e) => e.status === 'active' && (me.role === 'owner' || !hidden.has(e._id)))
      .map((e) => ({
        _id: e._id,
        name: e.name,
        initials: e.initials,
        avatarColor: e.avatarColor,
        positionLabel: e.positionLabel,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'))

    return {
      rows: await decorate(ctx, rows),
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

    return await ctx.db.insert('meetings', {
      title,
      date: args.date,
      time: args.time,
      place: clean(args.place),
      mapUrl: clean(args.mapUrl),
      comment: clean(args.comment),
      createdById: me._id,
      participantIds: [...ids] as Id<'employees'>[],
      createdAt: Date.now(),
    })
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
    // Править встречу может её создатель и администратор.
    if (meeting.createdById !== me._id && me.role !== 'owner') {
      throw new ConvexError('Изменить встречу может её создатель или администратор')
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
    if (participantIds !== undefined) {
      const ids = new Set<string>([
        meeting.createdById as string,
        ...participantIds.map((p) => p as string),
      ])
      next.participantIds = [...ids]
    }
    await ctx.db.patch(id, next)
  },
})

// §4.5 разрешает историю не терять, но заведённую по ошибке встречу должно
// быть можно убрать — это делает её создатель или администратор.
export const remove = mutation({
  args: { id: v.id('meetings') },
  handler: async (ctx, { id }) => {
    const me = await requireEmployee(ctx)
    const meeting = await ctx.db.get(id)
    if (!meeting) return
    if (meeting.createdById !== me._id && me.role !== 'owner') {
      throw new ConvexError('Удалить встречу может её создатель или администратор')
    }
    await ctx.db.delete(id)
  },
})
