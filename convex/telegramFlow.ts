// Telegram-модуль — карточка подтверждения и запись в ERP (§4, §5).
//
// Главное правило ТЗ: задача и встреча создаются ТОЛЬКО после нажатия
// «Создать». До этого извлечённые поля живут в черновике, а бот уточняет
// недостающее — угадывать он не должен (§4.3).
//
// Записи создаются в существующих таблицах ERP и по функциональности не
// отличаются от созданных в интерфейсе (§9).

import { internalMutation, internalQuery } from './_generated/server'
import { v, ConvexError } from 'convex/values'
import type { MutationCtx, QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { isOnTime } from './lib'
import { notify, notifyMany, audit } from './telegram'

type Parsed = {
  intent?: string
  title?: string | null
  description?: string | null
  people?: string[] | null
  date?: string | null
  time?: string | null
  priority?: 'low' | 'medium' | 'high' | 'urgent' | null
  place?: string | null
  url?: string | null
  object?: string | null
  note?: string | null
}

// Разобранные поля плюс уже сопоставленные сотрудники.
type Draft = Parsed & {
  resolved?: string[] // id сотрудников
  unresolved?: string[] // имена, которых не нашли
}

const PRIORITY_LABEL: Record<string, string> = {
  low: 'низкий',
  medium: 'обычный',
  high: 'высокий',
  urgent: 'срочный',
}

function fmtDate(iso: string): string {
  return new Date(`${iso}T12:00:00+05:00`)
    .toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', timeZone: 'Asia/Almaty' })
}

// Совпадают ли слова имени с поправкой на склонение: «Арману» → «Арман»,
// «Жумабаевой» → «Жумабаева».
//
// Порог намеренно жёсткий. При коротком общем начале «Нурай» ловилось на
// «Нуркен», и бот молча ставил задачу не тому человеку — а §4.3 требует
// обратного: если названного сотрудника нет среди доступных, задача не
// создаётся и бот об этом сообщает.
function sameName(a: string, b: string): boolean {
  if (a === b) return true
  const short = a.length <= b.length ? a : b
  const long = a.length <= b.length ? b : a
  // Склонение меняет хвост, а не корень: разрешаем расхождение в два символа.
  if (long.length - short.length > 2) return false
  let common = 0
  while (common < short.length && short[common] === long[common]) common++
  return common >= 4 && common === short.length
}

// Сопоставление произнесённого имени с сотрудниками, доступными автору.
// Возвращает всех подходящих: выбор при неоднозначности — за человеком (§4.3).
function matchPeople(query: string, people: { _id: string; name: string }[]) {
  const q = query.toLowerCase().trim()
  if (!q) return []
  const exact = people.filter((p) => p.name.toLowerCase() === q)
  if (exact.length) return exact
  const parts = q.split(/\s+/).filter(Boolean)
  return people.filter((p) => {
    const words = p.name.toLowerCase().split(/\s+/)
    return parts.some((part) => words.some((w) => sameName(part, w)))
  })
}

async function visibleTo(ctx: QueryCtx | MutationCtx, employeeId: Id<'employees'>) {
  const me = await ctx.db.get(employeeId)
  if (!me) return []
  const all = (await ctx.db.query('employees').collect()).filter((e) => e.status === 'active')
  if (me.role === 'owner') return all
  if (me.role === 'head') return all.filter((e) => e.department === me.department)
  return all.filter((e) => e._id === me._id)
}

// ——— Черновики ———

export const openDraft = internalQuery({
  args: { chatId: v.number() },
  handler: async (ctx, { chatId }) => {
    const rows = await ctx.db
      .query('telegramDrafts')
      .withIndex('by_chat', (q) => q.eq('chatId', chatId))
      .collect()
    const open = rows
      .filter((r) => r.state === 'preview' || r.state === 'editing')
      .sort((a, b) => b.createdAt - a.createdAt)[0]
    return open ? { _id: open._id, kind: open.kind, state: open.state } : null
  },
})

export const upsertDraft = internalMutation({
  args: {
    chatId: v.number(),
    employeeId: v.id('employees'),
    kind: v.union(v.literal('task'), v.literal('meeting')),
    transcript: v.string(),
    parsed: v.string(),
    mergeWith: v.optional(v.id('telegramDrafts')),
  },
  handler: async (ctx, { chatId, employeeId, kind, transcript, parsed, mergeWith }) => {
    const incoming = JSON.parse(parsed) as Parsed
    const people = await visibleTo(ctx, employeeId)
    const simple = people.map((p) => ({ _id: p._id as string, name: p.name }))

    let draft: Draft = {}
    if (mergeWith) {
      const prev = await ctx.db.get(mergeWith)
      // Уточнение дополняет карточку, а не начинает её заново.
      if (prev) draft = JSON.parse(prev.payload) as Draft
    }

    for (const [k, val] of Object.entries(incoming)) {
      if (val === null || val === undefined || val === '' || k === 'intent') continue
      if (k === 'people') continue
      ;(draft as Record<string, unknown>)[k] = val
    }

    // Имена сопоставляем только с доступными по правам ERP (§4.3).
    if (incoming.people?.length) {
      const resolved: string[] = []
      const unresolved: string[] = []
      for (const name of incoming.people) {
        const hits = matchPeople(name, simple)
        if (hits.length === 1) resolved.push(hits[0]._id)
        else unresolved.push(name)
      }
      draft.resolved = [...new Set([...(draft.resolved ?? []), ...resolved])]
      draft.unresolved = unresolved
    }

    const payload = JSON.stringify(draft)
    if (mergeWith) {
      await ctx.db.patch(mergeWith, { payload, transcript, state: 'preview' })
      return { _id: mergeWith }
    }
    // Прежние незакрытые черновики закрываем: активным остаётся один.
    for (const r of await ctx.db
      .query('telegramDrafts')
      .withIndex('by_chat', (q) => q.eq('chatId', chatId))
      .collect()) {
      if (r.state === 'preview' || r.state === 'editing') {
        await ctx.db.patch(r._id, { state: 'cancelled' })
      }
    }
    const _id = await ctx.db.insert('telegramDrafts', {
      chatId,
      employeeId,
      kind,
      payload,
      transcript,
      state: 'preview',
      createdAt: Date.now(),
    })
    return { _id }
  },
})

export const setEditing = internalMutation({
  args: { draftId: v.id('telegramDrafts') },
  handler: async (ctx, { draftId }) => {
    await ctx.db.patch(draftId, { state: 'editing' })
  },
})

export const cancelDraft = internalMutation({
  args: { draftId: v.id('telegramDrafts') },
  handler: async (ctx, { draftId }) => {
    await ctx.db.patch(draftId, { state: 'cancelled' })
  },
})

export const resolvePerson = internalMutation({
  args: { draftId: v.id('telegramDrafts'), employeeId: v.id('employees') },
  handler: async (ctx, { draftId, employeeId }) => {
    const row = await ctx.db.get(draftId)
    if (!row) return
    const draft = JSON.parse(row.payload) as Draft
    draft.resolved = [...new Set([...(draft.resolved ?? []), employeeId as string])]
    // Первое неоднозначное имя считаем разобранным.
    draft.unresolved = (draft.unresolved ?? []).slice(1)
    await ctx.db.patch(draftId, { payload: JSON.stringify(draft) })
  },
})

// Карточка предпросмотра и список того, чего не хватает.
export const draftView = internalQuery({
  args: { draftId: v.id('telegramDrafts') },
  handler: async (ctx, { draftId }) => {
    const row = await ctx.db.get(draftId)
    if (!row) return null
    const draft = JSON.parse(row.payload) as Draft
    const people = await visibleTo(ctx, row.employeeId)
    const simple = people.map((p) => ({ _id: p._id as string, name: p.name }))
    const nameById = new Map(simple.map((p) => [p._id, p.name]))
    const author = await ctx.db.get(row.employeeId)

    // Неоднозначное имя: показываем только разрешённых кандидатов.
    const firstUnresolved = (draft.unresolved ?? [])[0]
    if (firstUnresolved) {
      const options = matchPeople(firstUnresolved, simple)
      if (options.length > 1) {
        return {
          kind: row.kind,
          card: '',
          missing: [],
          ambiguous: {
            query: firstUnresolved,
            options: options.slice(0, 6).map((o) => ({ id: o._id, name: o.name })),
          },
        }
      }
    }

    const chosen = (draft.resolved ?? []).map((id) => nameById.get(id)).filter(Boolean) as string[]
    const missing: string[] = []

    if (row.kind === 'task') {
      if (!draft.title) missing.push('название')
      if (chosen.length === 0) missing.push('ответственный')
      if (!draft.date) missing.push('срок')
      if (firstUnresolved && chosen.length === 0) {
        // Имени нет среди доступных — по §4.3 задача не создаётся.
        missing.push(`сотрудник «${firstUnresolved}» вам недоступен`)
      }
      const card = [
        '<b>Новая задача</b>',
        '',
        `<b>Что:</b> ${draft.title ?? '—'}`,
        `<b>Кому:</b> ${chosen.join(', ') || '—'}`,
        `<b>Срок:</b> ${draft.date ? fmtDate(draft.date) + (draft.time ? `, ${draft.time}` : '') : '—'}`,
        `<b>Приоритет:</b> ${PRIORITY_LABEL[draft.priority ?? 'medium']}`,
        draft.object ? `<b>Объект:</b> ${draft.object}` : '',
        draft.description ? `<b>Комментарий:</b> ${draft.description}` : '',
        '',
        `<i>Автор: ${author?.name ?? '—'}</i>`,
      ]
        .filter(Boolean)
        .join('\n')
      return { kind: row.kind, card, missing, ambiguous: null }
    }

    if (!draft.title) missing.push('тема')
    if (!draft.date) missing.push('дата')
    if (!draft.time) missing.push('время')
    const card = [
      '<b>Новая встреча</b>',
      '',
      `<b>Тема:</b> ${draft.title ?? '—'}`,
      `<b>Когда:</b> ${draft.date ? fmtDate(draft.date) : '—'}${draft.time ? `, ${draft.time}` : ''}`,
      `<b>Участники:</b> ${[author?.name, ...chosen].filter(Boolean).join(', ')}`,
      draft.place ? `<b>Место:</b> ${draft.place}` : '',
      draft.url ? `<b>Ссылка:</b> ${draft.url}` : '',
      draft.note || draft.description ? `<b>Комментарий:</b> ${draft.note ?? draft.description}` : '',
      '',
      `<i>Организатор: ${author?.name ?? '—'}</i>`,
    ]
      .filter(Boolean)
      .join('\n')
    return { kind: row.kind, card, missing, ambiguous: null }
  },
})

// ——— Запись в ERP ———

export const commitDraft = internalMutation({
  args: { draftId: v.id('telegramDrafts') },
  handler: async (ctx, { draftId }) => {
    const row = await ctx.db.get(draftId)
    if (!row) throw new ConvexError('Черновик не найден')
    if (row.state === 'done') throw new ConvexError('Уже создано')
    const draft = JSON.parse(row.payload) as Draft
    const author = await ctx.db.get(row.employeeId)
    if (!author) throw new ConvexError('Автор не найден')

    const people = await visibleTo(ctx, row.employeeId)
    const allowed = new Set(people.map((p) => p._id as string))
    const chosen = (draft.resolved ?? []).filter((id) => allowed.has(id)) as string[]

    if (row.kind === 'task') {
      if (!draft.title) throw new ConvexError('не хватает названия')
      if (chosen.length === 0) throw new ConvexError('не выбран ответственный')

      // §4.2: объект заполняется, если назван и доступен. Сопоставляем с
      // активным справочником; не нашли — просто не заполняем.
      let objectId: Id<'salesObjects'> | undefined
      if (draft.object) {
        const q = draft.object.toLowerCase().trim()
        const hit = (await ctx.db.query('salesObjects').collect()).find(
          (o) => o.status !== 'archived' && o.name.toLowerCase() === q,
        )
        objectId = hit?._id
      }

      const created: string[] = []
      for (const assignee of chosen) {
        const id = await ctx.db.insert('tasks', {
          title: draft.title,
          description: draft.description ?? undefined,
          status: 'assigned',
          priority: draft.priority ?? 'medium',
          assigneeId: assignee as Id<'employees'>,
          reporterId: author._id,
          deadline: draft.date ?? undefined,
          tags: [],
          checklist: [],
          attachments: 0,
          comments: 0,
          // §9: признак источника создания для аудита.
          kpiRef: undefined,
          objectId,
          source: 'telegram',
        })
        await ctx.db.insert('taskEvents', { taskId: id, type: 'created', byId: author._id })
        created.push(id as string)

        // §6: ответственный получает уведомление о новой задаче.
        await notify(ctx, {
          employeeId: assignee as Id<'employees'>,
          category: 'task',
          text:
            `<b>Новая задача</b>\n\n${draft.title}\n\n` +
            `Автор: ${author.name}\n` +
            `Срок: ${draft.date ? fmtDate(draft.date) : 'не задан'}\n` +
            `Приоритет: ${PRIORITY_LABEL[draft.priority ?? 'medium']}`,
          link: '/tasks',
        })
      }
      await ctx.db.patch(draftId, { state: 'done' })
      return {
        ok: true,
        message: `✅ Задача создана: «${draft.title}»`,
        ref: created.join(','),
        link: '/tasks',
      }
    }

    if (!draft.title) throw new ConvexError('не хватает темы')
    if (!draft.date) throw new ConvexError('не хватает даты')
    if (!draft.time) throw new ConvexError('не хватает времени')

    // §4.2 модуля встреч: организатор автоматически участник.
    const participantIds = [
      ...new Set([author._id as string, ...chosen]),
    ] as Id<'employees'>[]

    const meetingId = await ctx.db.insert('meetings', {
      title: draft.title,
      date: draft.date,
      time: draft.time,
      place: draft.place ?? undefined,
      mapUrl: draft.url ?? undefined,
      comment: draft.note ?? draft.description ?? undefined,
      createdById: author._id,
      participantIds,
      createdAt: Date.now(),
      source: 'telegram',
    })

    // §5.3: все приглашённые получают уведомление о назначении.
    await notifyMany(
      ctx,
      participantIds.filter((p) => p !== author._id),
      {
        category: 'meeting',
        text:
          `<b>Новая встреча</b>\n\n${draft.title}\n\n` +
          `Когда: ${fmtDate(draft.date)}, ${draft.time}\n` +
          (draft.place ? `Место: ${draft.place}\n` : '') +
          `Организатор: ${author.name}`,
        link: '/meetings',
      },
    )

    await ctx.db.patch(draftId, { state: 'done' })
    return {
      ok: true,
      message: `✅ Встреча назначена: «${draft.title}» — ${fmtDate(draft.date)}, ${draft.time}`,
      ref: meetingId as string,
      link: '/meetings',
    }
  },
})

// ——— Уведомления по событиям ERP (§6, §9) ———
//
// §9: изменение записи через ERP запускает те же уведомления, что и через
// бота. Поэтому эти помощники вызываются из мутаций задач и встреч.

export async function notifyTaskCreated(ctx: MutationCtx, task: Doc<'tasks'>) {
  const author = await ctx.db.get(task.reporterId)
  await notify(ctx, {
    employeeId: task.assigneeId,
    category: 'task',
    text:
      `<b>Новая задача</b>\n\n${task.title}\n\n` +
      `Автор: ${author?.name ?? '—'}\n` +
      `Срок: ${task.deadline ? fmtDate(task.deadline) : 'не задан'}\n` +
      `Приоритет: ${PRIORITY_LABEL[task.priority]}`,
    link: '/tasks',
  })
}

export async function notifyTaskChanged(
  ctx: MutationCtx,
  task: Doc<'tasks'>,
  changes: string[],
  byId: Id<'employees'>,
) {
  if (changes.length === 0) return
  const by = await ctx.db.get(byId)
  const text =
    `<b>Задача изменена</b>\n\n${task.title}\n\n` +
    changes.map((c) => `• ${c}`).join('\n') +
    `\n\nИзменил: ${by?.name ?? '—'}`
  await notifyMany(ctx, [task.assigneeId, task.reporterId].filter((i) => i !== byId), {
    category: 'task',
    text,
    link: '/tasks',
  })
}

export async function notifyTaskStatus(
  ctx: MutationCtx,
  task: Doc<'tasks'>,
  status: string,
  byId: Id<'employees'>,
) {
  const label =
    status === 'done' ? 'выполнена' : status === 'in_progress' ? 'взята в работу' : 'возвращена'
  const by = await ctx.db.get(byId)
  // §6: автор и ответственные получают новый статус.
  await notifyMany(ctx, [task.reporterId, task.assigneeId].filter((i) => i !== byId), {
    category: 'task',
    text: `<b>Задача ${label}</b>\n\n${task.title}\n\n${by?.name ?? '—'}`,
    link: '/tasks',
  })
}

export async function notifyMeetingEvent(
  ctx: MutationCtx,
  meeting: Doc<'meetings'>,
  headline: string,
  details: string[],
  byId: Id<'employees'>,
  skipAuthor = true,
) {
  const by = await ctx.db.get(byId)
  const text =
    `<b>${headline}</b>\n\n${meeting.title}\n\n` +
    `Когда: ${fmtDate(meeting.date)}, ${meeting.time}\n` +
    (details.length ? details.map((d) => `• ${d}`).join('\n') + '\n' : '') +
    `\n${by?.name ?? '—'}`
  await notifyMany(
    ctx,
    meeting.participantIds.filter((p) => !skipAuthor || p !== byId),
    { category: 'meeting', text, link: '/meetings' },
  )
}

// §6: администратору уходит сводка о заполненном отчёте.
export async function notifyReportFilled(
  ctx: MutationCtx,
  employeeId: Id<'employees'>,
  date: string,
  summary: string,
) {
  const employee = await ctx.db.get(employeeId)
  if (!employee) return
  const s = await ctx.db
    .query('settings')
    .withIndex('by_key', (q) => q.eq('key', 'global'))
    .first()
  const explicit = s?.tgReportRecipients ?? []
  const recipients = explicit.length
    ? explicit
    : (await ctx.db.query('employees').collect())
        .filter((e) => e.role === 'owner' && e.status === 'active')
        .map((e) => e._id)

  await notifyMany(ctx, recipients, {
    category: 'report',
    text:
      `<b>Отчёт заполнен</b>\n\n` +
      `${employee.name} · ${employee.department}\n` +
      `Отчётная дата: ${fmtDate(date)}\n\n${summary}`,
    link: '/reports',
    key: `report_filled:${employeeId}:${date}`,
  })
}

// §6: сотруднику — о создании или изменении его личного плана, целевого
// значения или периода.
export async function notifyPlanChanged(
  ctx: MutationCtx,
  employeeId: Id<'employees'>,
  what: string,
  period: string,
  value: string,
) {
  await notify(ctx, {
    employeeId,
    category: 'plan',
    text: `<b>Изменён ваш план</b>\n\n${what}\nПериод: ${period}\n${value}`,
    link: '/kpi',
  })
}

// §7: мотивационные уведомления при первом пересечении каждого порога.
export async function notifyKpi(
  ctx: MutationCtx,
  employeeId: Id<'employees'>,
  period: string,
  ratio: number,
) {
  const s = await ctx.db
    .query('settings')
    .withIndex('by_key', (q) => q.eq('key', 'global'))
    .first()
  const overachieve = s?.tgKpiOverachieve === true
  const capped = overachieve ? ratio : Math.min(ratio, 1)
  const reached = Math.floor(capped * 10) * 10
  if (reached < 10) return

  // §7.1: пройденные пороги повторно не отправляются, даже если показатель
  // проседал и снова рос.
  const sent = await ctx.db
    .query('telegramSent')
    .withIndex('by_employee', (q) => q.eq('employeeId', employeeId))
    .collect()
  const already = sent
    .filter((r) => r.key.startsWith(`kpi:${employeeId}:${period}:`))
    .map((r) => Number(r.key.split(':').pop()))
  const top = already.length ? Math.max(...already) : 0
  if (reached <= top) return

  // §7.1: прыжок через несколько порогов даёт ОДНО сообщение о наибольшем.
  const employee = await ctx.db.get(employeeId)
  if (!employee) return
  const texts = s?.tgKpiTexts?.length ? s.tgKpiTexts : null
  const tpl =
    texts?.find((t) => t.threshold === reached)?.text ??
    `{name}, KPI выполнен на ${reached}%.`
  const [y, m] = period.split('-').map(Number)
  const months = [
    'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
    'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
  ]
  const sentNow = await notify(ctx, {
    employeeId,
    category: 'kpi',
    text: `${tpl.replace('{name}', employee.name)}\n\nПериод: ${months[m - 1]} ${y}`,
    link: '/kpi',
    key: `kpi:${employeeId}:${period}:${reached}`,
  })
  // Пишем в журнал только фактическую отправку: иначе запись утверждала бы,
  // что сотрудника поздравили, хотя он к боту не подключён.
  if (sentNow) {
    await audit(ctx, { kind: 'notify', employeeId, result: `KPI ${reached}% за ${period}` })
  }
}

export { isOnTime }
