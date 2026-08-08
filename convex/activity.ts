import { query, mutation } from './_generated/server'
import { v } from 'convex/values'
import { currentEmployee, isManager, isStaff } from './lib'
import { viewScope } from './permissions'
import { LOGIN_WINDOW_MS } from './auth'

// Перерыв, после которого следующее открытие считается новым посещением.
// Полчаса: обед и совещание разрывают работу, а переход между разделами —
// нет.
const VISIT_GAP_MS = 30 * 60 * 1000

// Как часто фронт отмечается, пока вкладка открыта. Отметку чаще этого
// игнорируем: она ничего не добавляет, а запись в базу стоит.
const PING_MIN_MS = 60 * 1000

const DAY = 24 * 60 * 60 * 1000

// Схлопывает всплески: события внутри окна визита — это один вход.
// Нужно и для уже накопленных дублей, которые записались до правки в auth.
function visits(times: number[]): number[] {
  const desc = [...times].sort((a, b) => b - a)
  const out: number[] = []
  for (const t of desc) {
    if (out.length === 0 || out[out.length - 1] - t > LOGIN_WINDOW_MS) out.push(t)
  }
  return out
}

// Дата в поясе организации: сутки в отчётах и статусах считаются по Алматы,
// а не по UTC, иначе вечерний заход попадал бы во «вчера».
function localDate(ms: number): string {
  return new Date(ms + 5 * 3600 * 1000).toISOString().slice(0, 10)
}

function isWeekend(date: string): boolean {
  const d = new Date(`${date}T12:00:00Z`).getUTCDay()
  return d === 0 || d === 6
}

function addDays(date: string, delta: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + delta * DAY).toISOString().slice(0, 10)
}

// Сколько рабочих дней прошло без человека. Сегодняшний день не считаем: он
// ещё идёт, и до вечера рано делать выводы.
function missedWorkdays(lastVisit: number | null, now: number): number {
  const today = localDate(now)
  if (!lastVisit) return 99
  let day = addDays(localDate(lastVisit), 1)
  let missed = 0
  while (day < today) {
    if (!isWeekend(day)) missed++
    day = addDays(day, 1)
  }
  return missed
}

// ——— Отметка присутствия ———
//
// Вызывается фронтом, пока вкладка открыта и видима. Тихая: никаких прав,
// кроме собственной авторизации, — человек отмечает сам себя.
export const ping = mutation({
  args: {},
  handler: async (ctx) => {
    const me = await currentEmployee(ctx)
    if (!me) return
    const now = Date.now()

    const last = (
      await ctx.db
        .query('visits')
        .withIndex('by_employee', (q) => q.eq('employeeId', me._id))
        .collect()
    ).sort((a, b) => b.lastAt - a.lastAt)[0]

    if (last && now - last.lastAt < PING_MIN_MS) return
    if (last && now - last.lastAt <= VISIT_GAP_MS) {
      await ctx.db.patch(last._id, { lastAt: now })
      return
    }
    await ctx.db.insert('visits', { employeeId: me._id, startedAt: now, lastAt: now })
  },
})

// Посещения одного сотрудника: сеансы со временем начала и длительностью.
// Надзорные данные — только руководству; свою историю сотрудник видит сам.
export const loginHistory = query({
  args: { employeeId: v.id('employees'), limit: v.optional(v.number()) },
  handler: async (ctx, { employeeId, limit }) => {
    const me = await currentEmployee(ctx)
    if (!me) return []
    if (!isManager(me) && me._id !== employeeId) return []

    const sessions = await ctx.db
      .query('visits')
      .withIndex('by_employee', (q) => q.eq('employeeId', employeeId))
      .collect()

    // Входы по коду — тоже посещения, и до появления отметок это была
    // единственная запись о человеке. Без них история за прошлые месяцы
    // опустела бы.
    const logins = await ctx.db
      .query('loginEvents')
      .withIndex('by_employee', (q) => q.eq('employeeId', employeeId))
      .collect()
    const covered = (t: number) => sessions.some((s) => t >= s.startedAt && t <= s.lastAt)

    // Визит отдаём целиком, началом и концом: в таблице стоит время
    // последней отметки, и если в истории показать только начало, одно и то же
    // посещение выглядит двумя разными числами.
    const rows = [
      ...sessions.map((s) => ({
        at: s.startedAt,
        to: s.lastAt,
        minutes: Math.round((s.lastAt - s.startedAt) / 60000),
      })),
      // Входы по коду измеренной длительности не имеют: до появления отметок
      // о человеке было известно только то, что он в этот момент вошёл.
      ...visits(logins.map((l) => l.at))
        .filter((t) => !covered(t))
        .map((t) => ({ at: t, to: t, minutes: 0 })),
    ]
    return rows.sort((a, b) => b.at - a.at).slice(0, limit ?? 50)
  },
})

// Сводка посещений по активным сотрудникам (для контроля активности §10).
// Это надзорные данные — отдаём только руководству. Роутер прячет экран,
// но сам запрос доступен любому авторизованному, поэтому проверяем здесь.
export const overview = query({
  args: {},
  handler: async (ctx) => {
    const me = await currentEmployee(ctx)
    // Раздел «Активность» — по режиму просмотра: «Все» → вся команда,
    // «Только свои» → свой отдел (руководитель) / сам.
    const scope = await viewScope(ctx, 'activity')
    if (!me || scope === 'none') return []

    const emps = await ctx.db.query('employees').collect()
    const now = Date.now()
    const active = emps.filter(
      (e) =>
        e.status === 'active' &&
        !e.hidden &&
        // Заказчики упаковки в сводке активности команды не участвуют.
        isStaff(e) &&
        (scope === 'all'
          ? true
          : me.role === 'head'
            ? e.department === me.department
            : e._id === me._id),
    )

    return Promise.all(
      active.map(async (e) => {
        const sessions = await ctx.db
          .query('visits')
          .withIndex('by_employee', (q) => q.eq('employeeId', e._id))
          .collect()
        const logins = await ctx.db
          .query('loginEvents')
          .withIndex('by_employee', (q) => q.eq('employeeId', e._id))
          .collect()

        // Один список моментов начала: сеансы плюс входы, не попавшие ни в
        // один сеанс. Иначе вход и открытая следом вкладка считались бы
        // двумя посещениями.
        const covered = (t: number) => sessions.some((s) => t >= s.startedAt && t <= s.lastAt)
        const starts = [
          ...sessions.map((s) => s.startedAt),
          ...visits(logins.map((l) => l.at)).filter((t) => !covered(t)),
        ].sort((a, b) => b - a)

        const lastAt =
          Math.max(
            sessions.reduce((m, s) => Math.max(m, s.lastAt), 0),
            starts[0] ?? 0,
            e.lastLoginAt ?? 0,
          ) || null

        const minutes30d = sessions
          .filter((s) => now - s.lastAt <= 30 * DAY)
          .reduce((sum, s) => sum + (s.lastAt - s.startedAt) / 60000, 0)

        return {
          employeeId: e._id,
          loginTotal: starts.length,
          loginCount30d: starts.filter((t) => now - t <= 30 * DAY).length,
          loginCount7d: starts.filter((t) => now - t <= 7 * DAY).length,
          lastLoginAt: lastAt,
          minutes30d: Math.round(minutes30d),
          today: !!lastAt && localDate(lastAt) === localDate(now),
          // «Давно не заходил» — два полных рабочих дня без визита. Выходные
          // не считаем, иначе в понедельник краснела бы вся команда.
          stale: missedWorkdays(lastAt, now) >= 2,
        }
      }),
    )
  },
})
