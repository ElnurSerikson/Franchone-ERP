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
import { isOnTime, isStaff } from './lib'
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
  // Для действий над существующей записью — что именно правим. Название
  // храним рядом с id: карточка должна читаться и после того, как запись
  // изменят или удалят из ERP.
  targetId?: string
  targetTitle?: string
  targetMissing?: boolean
  candidates?: { id: string; title: string }[]
}

// Действия над уже существующей записью. Отличаются от создания тем, что
// сначала надо найти, о чём речь: человек говорит «закрой задачу про смету»,
// а не называет её точным заголовком.
const ACTION_KINDS = new Set([
  'task_done',
  'task_reopen',
  'task_deadline',
  'meeting_move',
  'meeting_cancel',
])

// Совпадение по названию: человек редко произносит заголовок дословно.
//
// Сравнивать подстроками нельзя — русский падеж всё ломает: «смета» не входит
// в «подготовить смету». Поэтому слова сводим к основе, отбрасывая окончание,
// и сверяем основы. «Смета», «сметы», «смету» дают одно и то же «смет».
//
// Слишком общие слова выкидываем: во фразе «перенеси встречу с Алиной» слово
// «встреча» не про заголовок, оно про тип записи.
const GENERIC = new Set([
  'задача', 'задачу', 'задачи', 'задачей',
  'встреча', 'встречу', 'встречи', 'встречей',
  'дело', 'срок', 'сроки', 'дедлайн',
])

function stem(word: string): string {
  return word.length >= 5 ? word.slice(0, 4) : word
}

function keywords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-zа-яё0-9]+/i)
    .filter((w) => w.length >= 4 && !GENERIC.has(w))
    .map(stem)
}

function titleHit(query: string, title: string): boolean {
  const q = query.toLowerCase().trim()
  if (!q) return false
  const t = title.toLowerCase()
  if (t.includes(q) || q.includes(t)) return true
  const want = keywords(q)
  if (!want.length) return false
  const have = new Set(keywords(title))
  // Хватает одного совпавшего слова: если под описание подойдёт несколько
  // записей, бот всё равно переспросит кнопками, а не выберет наугад.
  return want.some((w) => have.has(w))
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
  const all = (await ctx.db
    .query('employees')
    .collect()).filter((e) => e.status === 'active' && isStaff(e))
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
    kind: v.union(
      v.literal('task'),
      v.literal('meeting'),
      v.literal('task_done'),
      v.literal('task_reopen'),
      v.literal('task_deadline'),
      v.literal('meeting_move'),
      v.literal('meeting_cancel'),
    ),
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

    // Для действия над записью ищем, о чём речь. Кандидаты — только те, что
    // человек вправе менять: свои задачи (или им же поставленные) и встречи,
    // где он участник. Нашли одну — берём; несколько — спросим кнопками.
    if (ACTION_KINDS.has(kind) && !draft.targetId) {
      const found = await findTarget(ctx, employeeId, kind, draft.title ?? '')
      if (found.length === 1) {
        draft.targetId = found[0].id
        draft.targetTitle = found[0].title
        draft.targetMissing = false
      } else if (found.length === 0) {
        draft.targetMissing = true
      } else {
        draft.targetMissing = false
        draft.candidates = found
      }
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

// Кого можно тронуть этим действием.
//
// Задачу закрывает и двигает тот, на ком она висит, либо тот, кто её поставил:
// в ERP правило то же. Встречу двигает и отменяет её участник.
async function findTarget(
  ctx: MutationCtx,
  employeeId: Id<'employees'>,
  kind: string,
  query: string,
): Promise<{ id: string; title: string }[]> {
  const shifted = new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 10)

  if (kind === 'task_done' || kind === 'task_deadline' || kind === 'task_reopen') {
    // Вернуть в работу можно только закрытую задачу, всё остальное — только
    // открытую. Иначе «закрой смету» находило бы уже закрытую и спотыкалось.
    const wantDone = kind === 'task_reopen'
    const rows = (await ctx.db.query('tasks').collect()).filter(
      (t) =>
        (t.status === 'done') === wantDone &&
        (t.assigneeId === employeeId || t.reporterId === employeeId),
    )
    const hits = query ? rows.filter((t) => titleHit(query, t.title)) : rows
    // Без названия и с единственной задачей выбор очевиден; иначе спросим.
    return hits.map((t) => ({ id: t._id as string, title: t.title }))
  }

  const rows = (await ctx.db.query('meetings').collect()).filter(
    (m) =>
      m.participantIds.includes(employeeId) &&
      m.date >= shifted &&
      (m.status ?? 'planned') === 'planned',
  )
  // Встречу чаще называют по человеку, а не по теме: «перенеси встречу с
  // Алиной». Поэтому ищем и по именам участников.
  const nameById = new Map(
    (await ctx.db.query('employees').collect()).map((e) => [e._id as string, e.name]),
  )
  const hits = query
    ? rows.filter(
        (m) =>
          titleHit(query, m.title) ||
          m.participantIds.some((p) => {
            const n = nameById.get(p as string)
            return !!n && p !== employeeId && titleHit(query, n)
          }),
      )
    : rows
  return hits
    .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`))
    .map((m) => ({ id: m._id as string, title: `${m.title} · ${fmtDate(m.date)}, ${m.time}` }))
}

// Человек выбрал запись кнопкой из списка похожих.
export const pickTarget = internalMutation({
  args: { draftId: v.id('telegramDrafts'), targetId: v.string() },
  handler: async (ctx, { draftId, targetId }) => {
    const row = await ctx.db.get(draftId)
    if (!row) return
    const draft = JSON.parse(row.payload) as Draft
    const hit = (draft.candidates ?? []).find((c) => c.id === targetId)
    if (!hit) return
    draft.targetId = hit.id
    draft.targetTitle = hit.title
    draft.candidates = undefined
    await ctx.db.patch(draftId, { payload: JSON.stringify(draft) })
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
            what: 'person' as const,
            options: options.slice(0, 6).map((o) => ({ id: o._id, name: o.name })),
          },
        }
      }
    }

    // Действия над существующей записью. Сначала надо понять, о какой речь.
    if (ACTION_KINDS.has(row.kind)) {
      if ((draft.candidates ?? []).length > 1) {
        return {
          kind: row.kind,
          card: '',
          missing: [],
          ambiguous: {
            query: draft.title ?? '',
            what: 'target' as const,
            options: (draft.candidates ?? [])
              .slice(0, 6)
              .map((c) => ({ id: c.id, name: c.title })),
          },
        }
      }
      const what =
        row.kind === 'task_reopen'
          ? 'закрытую задачу'
          : row.kind.startsWith('task')
            ? 'задачу'
            : 'встречу'
      if (draft.targetMissing || !draft.targetId) {
        return {
          kind: row.kind,
          card: '',
          missing: [`не нашёл ${what} по описанию «${draft.title ?? ''}»`],
          ambiguous: null,
        }
      }

      const head: Record<string, string> = {
        task_done: '✅ <b>Закрыть задачу</b>',
        task_reopen: '↩️ <b>Вернуть задачу в работу</b>',
        task_deadline: '📌 <b>Сдвинуть срок задачи</b>',
        meeting_move: '📅 <b>Перенести встречу</b>',
        meeting_cancel: '✖️ <b>Отменить встречу</b>',
      }
      const need: string[] = []
      if (row.kind === 'task_deadline' && !draft.date) need.push('новый срок')
      if (row.kind === 'meeting_move' && !draft.date) need.push('новая дата')
      if (row.kind === 'meeting_move' && !draft.time) need.push('новое время')

      const card = [
        head[row.kind],
        '',
        `<b>${draft.targetTitle}</b>`,
        row.kind === 'task_deadline' && draft.date ? `\nНовый срок: ${fmtDate(draft.date)}` : '',
        row.kind === 'meeting_move' && draft.date
          ? `\nНовое время: ${fmtDate(draft.date)}${draft.time ? `, ${draft.time}` : ''}`
          : '',
        row.kind === 'meeting_move' && draft.place ? `Место: ${draft.place}` : '',
        row.kind === 'meeting_cancel' ? '\nУчастники получат уведомление.' : '',
        '',
        `<i>${author?.name ?? '—'}</i>`,
      ]
        .filter(Boolean)
        .join('\n')
      return { kind: row.kind, card, missing: need, ambiguous: null }
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

    // ——— Действия над существующей записью ———
    //
    // Права проверяются заново, а не берутся из карточки: между показом и
    // нажатием запись могли передать другому человеку.
    if (ACTION_KINDS.has(row.kind)) {
      if (!draft.targetId) throw new ConvexError('не понял, о какой записи речь')

      if (
        row.kind === 'task_done' ||
        row.kind === 'task_reopen' ||
        row.kind === 'task_deadline'
      ) {
        const task = await ctx.db.get(draft.targetId as Id<'tasks'>)
        if (!task) throw new ConvexError('задача не найдена')
        if (task.assigneeId !== author._id && task.reporterId !== author._id) {
          throw new ConvexError('эта задача не ваша')
        }

        if (row.kind === 'task_done') {
          if (task.status === 'done') throw new ConvexError('задача уже закрыта')
          await ctx.db.patch(task._id, {
            status: 'done',
            completedAt: Date.now(),
            completedOnTime: task.deadline ? isOnTime(Date.now(), task.deadline) : true,
          })
          await ctx.db.insert('taskEvents', {
            taskId: task._id,
            type: 'status',
            byId: author._id,
            fromStatus: task.status,
            toStatus: 'done',
          })
          // Автор задачи узнаёт, что её закрыли — он этого ждёт.
          if (task.reporterId !== author._id) {
            await notify(ctx, {
              employeeId: task.reporterId,
              category: 'task',
              text: `<b>Задача выполнена</b>\n\n${task.title}\n\nЗакрыл: ${author.name}`,
              link: '/tasks',
            })
          }
          await ctx.db.patch(draftId, { state: 'done' })
          await audit(ctx, {
            kind: 'command',
            employeeId: author._id,
            chatId: row.chatId,
            result: 'задача закрыта',
            objectRef: task._id as string,
            status: 'ok',
          })
          return {
            ok: true,
            message: `✅ Задача закрыта: «${task.title}»`,
            ref: task._id as string,
            link: '/tasks',
          }
        }

        if (row.kind === 'task_reopen') {
          if (task.status !== 'done') throw new ConvexError('задача и так в работе')
          await ctx.db.patch(task._id, {
            status: 'assigned',
            completedAt: undefined,
            completedOnTime: undefined,
          })
          await ctx.db.insert('taskEvents', {
            taskId: task._id,
            type: 'status',
            byId: author._id,
            fromStatus: 'done',
            toStatus: 'assigned',
            note: 'возвращена в работу из Telegram',
          })
          if (task.assigneeId !== author._id) {
            await notify(ctx, {
              employeeId: task.assigneeId,
              category: 'task',
              text:
                `<b>Задача возвращена в работу</b>\n\n${task.title}\n\n` +
                `Вернул: ${author.name}`,
              link: '/tasks',
            })
          }
          await ctx.db.patch(draftId, { state: 'done' })
          await audit(ctx, {
            kind: 'command',
            employeeId: author._id,
            chatId: row.chatId,
            result: 'задача возвращена в работу',
            objectRef: task._id as string,
            status: 'ok',
          })
          return {
            ok: true,
            message: `↩️ Задача снова в работе: «${task.title}»`,
            ref: task._id as string,
            link: '/tasks',
          }
        }

        if (!draft.date) throw new ConvexError('не указан новый срок')
        const was = task.deadline
        await ctx.db.patch(task._id, { deadline: draft.date })
        // Отдельного типа события для срока в журнале задач нет, а заводить
        // его ради Telegram неправильно: запись должна читаться теми же
        // экранами ERP. Пишем как изменение с человекочитаемой пометкой.
        await ctx.db.insert('taskEvents', {
          taskId: task._id,
          type: 'status',
          byId: author._id,
          fromStatus: task.status,
          toStatus: task.status,
          note: `срок: ${was ? fmtDate(was) : 'без срока'} → ${fmtDate(draft.date)}`,
        })
        if (task.assigneeId !== author._id) {
          await notify(ctx, {
            employeeId: task.assigneeId,
            category: 'task',
            text:
              `<b>Срок задачи изменён</b>\n\n${task.title}\n\n` +
              `Было: ${was ? fmtDate(was) : 'без срока'}\nСтало: ${fmtDate(draft.date)}\n` +
              `Изменил: ${author.name}`,
            link: '/tasks',
          })
        }
        await ctx.db.patch(draftId, { state: 'done' })
        await audit(ctx, {
          kind: 'command',
          employeeId: author._id,
          chatId: row.chatId,
          result: `срок задачи → ${draft.date}`,
          objectRef: task._id as string,
          status: 'ok',
        })
        return {
          ok: true,
          message: `📌 Новый срок задачи «${task.title}» — ${fmtDate(draft.date)}`,
          ref: task._id as string,
          link: '/tasks',
        }
      }

      const meeting = await ctx.db.get(draft.targetId as Id<'meetings'>)
      if (!meeting) throw new ConvexError('встреча не найдена')
      if (!meeting.participantIds.includes(author._id)) {
        throw new ConvexError('вы не участник этой встречи')
      }
      if ((meeting.status ?? 'planned') !== 'planned') {
        throw new ConvexError('встреча уже проведена или отменена')
      }

      if (row.kind === 'meeting_cancel') {
        await ctx.db.patch(meeting._id, {
          status: 'cancelled',
          resolvedAt: Date.now(),
          resolvedById: author._id,
        })
        await ctx.db.insert('meetingEvents', {
          meetingId: meeting._id,
          type: 'cancelled',
          byId: author._id,
          at: Date.now(),
        })
        await notifyMany(
          ctx,
          meeting.participantIds.filter((p) => p !== author._id),
          {
            category: 'meeting',
            text:
              `<b>Встреча отменена</b>\n\n${meeting.title}\n\n` +
              `Была назначена на ${fmtDate(meeting.date)}, ${meeting.time}\n` +
              `Отменил: ${author.name}`,
            link: '/meetings',
          },
        )
        await ctx.db.patch(draftId, { state: 'done' })
        await audit(ctx, {
          kind: 'command',
          employeeId: author._id,
          chatId: row.chatId,
          result: 'встреча отменена',
          objectRef: meeting._id as string,
          status: 'ok',
        })
        return {
          ok: true,
          message: `✖️ Встреча отменена: «${meeting.title}»`,
          ref: meeting._id as string,
          link: '/meetings',
        }
      }

      if (!draft.date || !draft.time) throw new ConvexError('не указаны новые дата и время')
      const wasDate = meeting.date
      const wasTime = meeting.time
      await ctx.db.patch(meeting._id, {
        date: draft.date,
        time: draft.time,
        place: draft.place ?? meeting.place,
        // Первоначальная договорённость должна остаться видимой.
        originalDate: meeting.originalDate ?? wasDate,
        originalTime: meeting.originalTime ?? wasTime,
        rescheduleCount: (meeting.rescheduleCount ?? 0) + 1,
      })
      await ctx.db.insert('meetingEvents', {
        meetingId: meeting._id,
        type: 'rescheduled',
        byId: author._id,
        at: Date.now(),
        fromDate: wasDate,
        fromTime: wasTime,
        toDate: draft.date,
        toTime: draft.time,
      })
      await notifyMany(
        ctx,
        meeting.participantIds.filter((p) => p !== author._id),
        {
          category: 'meeting',
          text:
            `<b>Встреча перенесена</b>\n\n${meeting.title}\n\n` +
            `Было: ${fmtDate(wasDate)}, ${wasTime}\n` +
            `Стало: ${fmtDate(draft.date)}, ${draft.time}\n` +
            `Перенёс: ${author.name}`,
          link: '/meetings',
        },
      )
      await ctx.db.patch(draftId, { state: 'done' })
      await audit(ctx, {
        kind: 'command',
        employeeId: author._id,
        chatId: row.chatId,
        result: `встреча → ${draft.date} ${draft.time}`,
        objectRef: meeting._id as string,
        status: 'ok',
      })
      return {
        ok: true,
        message: `📅 Встреча перенесена: «${meeting.title}» — ${fmtDate(draft.date)}, ${draft.time}`,
        ref: meeting._id as string,
        link: '/meetings',
      }
    }

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
    // План правят когда угодно, в том числе поздно вечером. Сотруднику это
    // читать утром, а не среди ночи.
    instant: false,
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
    instant: false,
  })
  // Пишем в журнал только фактическую отправку: иначе запись утверждала бы,
  // что сотрудника поздравили, хотя он к боту не подключён.
  if (sentNow) {
    await audit(ctx, { kind: 'notify', employeeId, result: `KPI ${reached}% за ${period}` })
  }
}

export { isOnTime }
