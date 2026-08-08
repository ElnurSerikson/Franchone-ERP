// Telegram-модуль ERP FRANCHONE — ядро (ТЗ Telegram, версия 1.0).
//
// Ключевая концепция ТЗ: Telegram не является отдельной системой учёта. Бот —
// дополнительный интерфейс ERP: принимает голосовые команды, создаёт записи
// ТОЛЬКО после подтверждения и доставляет уведомления. Источником данных и
// прав доступа остаётся ERP.
//
// Здесь: привязка аккаунтов (§3), реестр отправленного и правила доставки
// (§6.1), пороги KPI (§7), журнал (§10). Сетевые вызовы — в telegramBot.ts:
// мутация в Convex не умеет ходить наружу, поэтому отправка идёт через
// планировщик.

import { query, mutation, internalMutation, internalQuery } from './_generated/server'
import { v, ConvexError } from 'convex/values'
import type { MutationCtx, QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { internal } from './_generated/api'
import { currentEmployee, requireEmployee, isManager, isStaff } from './lib'
import { DEFAULT_TZ, nowIn, momentIn } from './orgTime'

// Смещение пояса организации в виде «+05:00» — для разбора границ суток.
const DEFAULT_TZ_OFFSET = '+05:00'
import { forgetChat } from './telegramTalk'

// Категории уведомлений (§6.1): администратор включает и выключает их
// глобально и для конкретного сотрудника, не меняя его права в ERP.
export const NOTIFY_CATEGORIES = [
  'task', 'meeting', 'report', 'plan', 'kpi', 'pack', 'connect',
] as const
export type NotifyCategory = (typeof NOTIFY_CATEGORIES)[number]

export const CATEGORY_LABEL: Record<NotifyCategory, string> = {
  task: 'Задачи',
  meeting: 'Встречи',
  report: 'Отчёты',
  plan: 'Планы и показатели',
  kpi: 'Достижения KPI',
  // ТЗ Упаковка §14.1: каналы первой итерации — уведомления внутри ERP и
  // Telegram по общей интеграции.
  pack: 'Упаковка франшизы',
  // Кто подключился к боту. Своя категория, а не «Задачи»: событие про
  // доступ, и выключать его нужно отдельно от рабочего потока.
  connect: 'Подключения',
}

const DEFAULTS = {
  inviteTtlHours: 24,
  meetingRemindMin: 60,
  reportRemindMin: 60,
  taskRemindAt: '10:00',
  transcriptKeepDays: 90,
  // Утренняя сводка приходит с началом окна, а окно закрывается вечером.
  // Границы фиксированные и от рабочих часов не зависят: ночью телефон не
  // трогаем, даже если у отдела сместился график.
  digestAt: '09:00',
  quietFrom: '09:00',
  quietTo: '20:00',
}

// §7.2: тексты мотивационных сообщений. Хранятся в настройках ERP и
// редактируются администратором; это — значения по умолчанию.
export const KPI_TEXTS: { threshold: number; text: string }[] = [
  { threshold: 10, text: '{name}, вы уже выполнили 10% KPI. Отличное начало — продолжаем!' },
  { threshold: 20, text: '{name}, выполнено 20% KPI. Уже пятая часть пути позади — двигаемся дальше!' },
  { threshold: 30, text: '{name}, за плечами 30% KPI. Хороший темп — так держать!' },
  { threshold: 40, text: '{name}, выполнено 40% KPI. До половины совсем немного.' },
  { threshold: 50, text: 'Половина готова! Ваш KPI выполнен на 50%. Темп хороший — не сбавляем.' },
  { threshold: 60, text: '{name}, 60% KPI позади. Большая часть пути пройдена.' },
  { threshold: 70, text: '{name}, выполнено 70% KPI. Отличный результат, осталось немного.' },
  { threshold: 80, text: 'Уже 80% KPI! Финишная прямая — осталось совсем немного.' },
  { threshold: 90, text: '{name}, 90% KPI. План почти закрыт — последний рывок!' },
  { threshold: 100, text: '{name}, KPI выполнен на 100%! План закрыт — отличный результат.' },
]

// ——— Настройки модуля ———

export async function tgSettings(ctx: QueryCtx | MutationCtx) {
  const s = await ctx.db
    .query('settings')
    .withIndex('by_key', (q) => q.eq('key', 'global'))
    .first()
  return {
    timezone: s?.tgTimezone || DEFAULT_TZ,
    inviteTtlHours: s?.tgInviteTtlHours ?? DEFAULTS.inviteTtlHours,
    meetingRemindMin: s?.tgMeetingRemindMin ?? DEFAULTS.meetingRemindMin,
    reportRemindMin: s?.tgReportRemindMin ?? DEFAULTS.reportRemindMin,
    taskRemindAt: s?.tgTaskRemindAt || DEFAULTS.taskRemindAt,
    // §6: по настройке о просрочке узнаёт автор задачи.
    taskEscalateAuthor: s?.tgTaskEscalateAuthor !== false,
    transcriptKeepDays: s?.tgTranscriptKeepDays ?? DEFAULTS.transcriptKeepDays,
    reportRecipients: s?.tgReportRecipients ?? [],
    disabledCategories: new Set(s?.tgDisabledCategories ?? []),
    kpiTexts: s?.tgKpiTexts?.length ? s.tgKpiTexts : KPI_TEXTS,
    kpiOverachieve: s?.tgKpiOverachieve === true,
    // Утренняя сводка и окно для «мягких» сообщений.
    digestAt: s?.tgDigestAt || DEFAULTS.digestAt,
    digestOn: s?.tgDigestOn !== false,
    quietFrom: s?.tgQuietFrom || DEFAULTS.quietFrom,
    quietTo: s?.tgQuietTo || DEFAULTS.quietTo,
  }
}

// ——— Доставка ———

// Отправить уведомление сотруднику, если это уместно.
//
// §6.1: перед отправкой проверяется актуальность события, права получателя и
// статус его Telegram-подключения. Ключ гарантирует, что одно событие уходит
// ровно один раз — повторная доставка webhook или повторный проход крона
// дубля не создают.
export async function notify(
  ctx: MutationCtx,
  opts: {
    employeeId: Id<'employees'>
    category: NotifyCategory
    text: string
    // Уникальный ключ события. Без него уведомление отправляется всегда —
    // так шлются мгновенные реакции на действие пользователя.
    key?: string
    // Кнопка «Открыть в ERP» (§6). Путь внутри приложения, например /tasks.
    link?: string
    // false — «мягкое» сообщение: подождёт начала разрешённого окна.
    // По умолчанию событие уходит немедленно.
    instant?: boolean
    // Кнопки под сообщением: ответ одним нажатием вместо похода в ERP.
    buttons?: { text: string; data: string }[][]
  },
): Promise<boolean> {
  if (opts.key) {
    const seen = await ctx.db
      .query('telegramSent')
      .withIndex('by_key', (q) => q.eq('key', opts.key!))
      .first()
    if (seen) return false
  }

  const link = await ctx.db
    .query('telegramLinks')
    .withIndex('by_employee', (q) => q.eq('employeeId', opts.employeeId))
    .first()
  // Нет подтверждённой привязки — уведомления не отправляются (§3.4).
  if (!link || link.status !== 'connected' || !link.chatId) return false

  const settings = await tgSettings(ctx)
  if (settings.disabledCategories.has(opts.category)) return false
  if (link.mutedCategories?.includes(opts.category)) return false

  if (opts.key) {
    await ctx.db.insert('telegramSent', {
      key: opts.key,
      employeeId: opts.employeeId,
      category: opts.category,
      at: Date.now(),
      status: 'ok',
    })
  }

  // Мутация не ходит в сеть — отправку выполняет action.
  //
  // Ночью телефон трогают только события, которых человек ждёт: ему поставили
  // задачу, назначили или перенесли встречу. Всё остальное — напоминания,
  // пороги KPI, изменения планов — ждёт начала окна, а не будит в три часа.
  const at = opts.instant === false ? await nextWindowStart(ctx) : 0
  if (at > 0) {
    await ctx.scheduler.runAt(at, internal.telegramBot.deliver, {
      chatId: link.chatId,
      text: opts.text,
      link: opts.link,
      employeeId: opts.employeeId,
      buttons: opts.buttons,
    })
    return true
  }
  await ctx.scheduler.runAfter(0, internal.telegramBot.deliver, {
    chatId: link.chatId,
    text: opts.text,
    link: opts.link,
    employeeId: opts.employeeId,
    buttons: opts.buttons,
  })
  return true
}

// Ближайший момент внутри разрешённого окна. Ноль — значит окно открыто и
// отправлять можно прямо сейчас.
async function nextWindowStart(ctx: MutationCtx): Promise<number> {
  const s = await tgSettings(ctx)
  const now = nowIn(s.timezone)
  if (now.time >= s.quietFrom && now.time < s.quietTo) return 0
  // После конца окна следующее отправление — завтра утром.
  const day = now.time >= s.quietTo ? addDay(now.date) : now.date
  const at = momentIn(s.timezone, day, s.quietFrom)
  return Number.isFinite(at) ? at : 0
}

function addDay(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10)
}

// Уведомление нескольким сотрудникам сразу. Ключ дополняется получателем,
// иначе первое же отправленное сообщение закрыло бы событие для остальных.
export async function notifyMany(
  ctx: MutationCtx,
  ids: Id<'employees'>[],
  opts: {
    category: NotifyCategory
    text: string
    key?: string
    link?: string
    instant?: boolean
  },
) {
  const unique = [...new Set(ids.map((i) => i as string))] as Id<'employees'>[]
  for (const employeeId of unique) {
    await notify(ctx, {
      employeeId,
      category: opts.category,
      text: opts.text,
      link: opts.link,
      key: opts.key ? `${opts.key}:${employeeId}` : undefined,
    })
  }
}

export async function audit(
  ctx: MutationCtx,
  row: {
    kind: string
    employeeId?: Id<'employees'>
    byId?: Id<'employees'>
    chatId?: number
    updateId?: number
    text?: string
    fields?: string
    result?: string
    objectRef?: string
    status?: string
    error?: string
  },
) {
  await ctx.db.insert('telegramAudit', { at: Date.now(), ...row })
}

// ——— §3: подключение сотрудника ———

async function requireAdmin(ctx: MutationCtx): Promise<Doc<'employees'>> {
  const me = await requireEmployee(ctx)
  // §2: управление подключением доступно только владельцу/администратору ERP.
  if (me.role !== 'owner') {
    throw new ConvexError('Управлять подключением Telegram может только администратор')
  }
  return me
}

// Состояние привязки для карточки сотрудника (§8.1).
export const linkFor = query({
  args: { employeeId: v.id('employees') },
  handler: async (ctx, { employeeId }) => {
    const me = await currentEmployee(ctx)
    if (!me) return null
    // Свою привязку видит сам сотрудник, чужую — только руководство.
    if (me._id !== employeeId && !isManager(me)) return null

    const link = await ctx.db
      .query('telegramLinks')
      .withIndex('by_employee', (q) => q.eq('employeeId', employeeId))
      .first()
    const names = await ctx.db.query('employees').collect()
    const nameById = new Map(names.map((e) => [e._id as string, e.name]))

    if (!link) {
      return {
        status: 'none' as const,
        categories: NOTIFY_CATEGORIES.map((c) => ({ key: c, label: CATEGORY_LABEL[c], on: true })),
      }
    }
    const muted = new Set(link.mutedCategories ?? [])
    return {
      status: link.status,
      username: link.username ?? null,
      // §8.1: user ID показывается маскированно — полное значение служебное.
      chatIdMasked: link.chatId ? `…${String(link.chatId).slice(-4)}` : null,
      connectedAt: link.connectedAt ?? null,
      connectedBy: link.connectedById ? (nameById.get(link.connectedById as string) ?? null) : null,
      lastDeliveryAt: link.lastDeliveryAt ?? null,
      lastError: link.lastError ?? null,
      inviteExpiresAt: link.inviteExpiresAt ?? null,
      inviteCode: link.status === 'invited' ? (link.inviteCode ?? null) : null,
      tgName: link.tgName ?? null,
      categories: NOTIFY_CATEGORIES.map((c) => ({
        key: c,
        label: CATEGORY_LABEL[c],
        on: !muted.has(c),
      })),
    }
  },
})

// ——— Вход в бота по рабочей почте ———
//
// Порядок: сотрудник запускает бота → вводит свой email из ERP → получает на
// почту шестизначный код → вводит его → доступ открыт.
//
// Раньше привязку выдавал администратор одноразовой ссылкой. Владелец заменил
// этот порядок: ссылку можно переслать другому человеку, а доступ к рабочей
// почте — нет, поэтому код на почту личность подтверждает строже. Роль
// администратора осталась в отключении и настройке уведомлений.

const CODE_TTL_MIN = 10
const MAX_ATTEMPTS = 5

function randomCode(): string {
  // Шесть цифр — как в письме для входа в саму ERP.
  return String(Math.floor(100000 + Math.random() * 900000))
}

// Шаг 1: по введённому email находим сотрудника и заводим код.
// Возвращает код, чтобы action отправил письмо: мутация в сеть не ходит.
export const requestCode = internalMutation({
  args: { chatId: v.number(), email: v.string() },
  handler: async (ctx, { chatId, email }) => {
    const low = email.trim().toLowerCase()
    const employee = await ctx.db
      .query('employees')
      .withIndex('by_email', (q) => q.eq('email', low))
      .first()

    // Одинаковый ответ на «нет такого» и «уволен»: подсказывать, кто работает
    // в компании, посторонним не надо.
    if (!employee || employee.status !== 'active') {
      await audit(ctx, { kind: 'login', chatId, result: `неизвестный email ${low}` })
      return { ok: false as const, reason: 'unknown' as const }
    }

    // Бот — инструмент команды. Заказчик упаковки входит в ERP тем же кодом с
    // почты, поэтому без этой проверки он попал бы и сюда — и получил бы
    // сводку сотрудника с чужими формулировками про KPI и отчёты. Свой кабинет
    // в боте у него будет отдельным.
    if (!isStaff(employee)) {
      await audit(ctx, {
        kind: 'login',
        employeeId: employee._id,
        chatId,
        result: 'клиенту доступ в бота закрыт',
      })
      return { ok: false as const, reason: 'client' as const }
    }

    // §3.2 сохраняем: один Telegram-аккаунт — одна карточка сотрудника.
    const taken = await ctx.db
      .query('telegramLinks')
      .withIndex('by_chat', (q) => q.eq('chatId', chatId))
      .first()
    if (taken && taken.status === 'connected' && taken.employeeId !== employee._id) {
      return { ok: false as const, reason: 'busy' as const }
    }

    // Прежние коды этого чата гасим: действующим остаётся один.
    for (const old of await ctx.db
      .query('telegramAuthCodes')
      .withIndex('by_chat', (q) => q.eq('chatId', chatId))
      .collect()) {
      await ctx.db.delete(old._id)
    }

    const code = randomCode()
    await ctx.db.insert('telegramAuthCodes', {
      chatId,
      employeeId: employee._id,
      email: low,
      code,
      expiresAt: Date.now() + CODE_TTL_MIN * 60 * 1000,
      attempts: 0,
      createdAt: Date.now(),
    })
    await audit(ctx, {
      kind: 'login',
      employeeId: employee._id,
      chatId,
      result: 'код отправлен на почту',
    })
    return {
      ok: true as const,
      code,
      email: low,
      name: employee.name,
      ttlMin: CODE_TTL_MIN,
    }
  },
})

// Шаг 2: проверка кода. Совпал — доступ открыт немедленно.
export const verifyCode = internalMutation({
  args: {
    chatId: v.number(),
    code: v.string(),
    username: v.optional(v.string()),
    tgName: v.optional(v.string()),
  },
  handler: async (ctx, { chatId, code, username, tgName }) => {
    const row = await ctx.db
      .query('telegramAuthCodes')
      .withIndex('by_chat', (q) => q.eq('chatId', chatId))
      .first()
    if (!row) return { ok: false as const, reason: 'none' as const }

    if (row.expiresAt < Date.now()) {
      await ctx.db.delete(row._id)
      return { ok: false as const, reason: 'expired' as const }
    }

    if (row.code !== code.trim()) {
      const attempts = row.attempts + 1
      if (attempts >= MAX_ATTEMPTS) {
        await ctx.db.delete(row._id)
        await audit(ctx, {
          kind: 'login',
          employeeId: row.employeeId,
          chatId,
          status: 'error',
          result: 'исчерпаны попытки ввода кода',
        })
        return { ok: false as const, reason: 'blocked' as const }
      }
      await ctx.db.patch(row._id, { attempts })
      return { ok: false as const, reason: 'wrong' as const, left: MAX_ATTEMPTS - attempts }
    }

    const employee = await ctx.db.get(row.employeeId)
    if (!employee || employee.status !== 'active') {
      await ctx.db.delete(row._id)
      return { ok: false as const, reason: 'unknown' as const }
    }

    // Привязка сотрудника могла существовать с прежним Telegram-аккаунтом:
    // почта подтверждена, поэтому просто переносим её на новый.
    const existing = await ctx.db
      .query('telegramLinks')
      .withIndex('by_employee', (q) => q.eq('employeeId', row.employeeId))
      .first()
    const fields = {
      status: 'connected' as const,
      chatId,
      username,
      tgName,
      connectedAt: Date.now(),
      connectedById: row.employeeId,
      lastError: undefined,
      inviteCode: undefined,
      inviteExpiresAt: undefined,
    }
    if (existing) await ctx.db.patch(existing._id, fields)
    else await ctx.db.insert('telegramLinks', { employeeId: row.employeeId, ...fields })

    await ctx.db.delete(row._id)
    await audit(ctx, {
      kind: 'login',
      employeeId: row.employeeId,
      chatId,
      result: 'подключение подтверждено кодом с почты',
      status: 'ok',
    })

    // Администратор должен знать, кто подключился: гейта на входе больше нет,
    // значит событие важно видеть.
    for (const a of (await ctx.db.query('employees').collect()).filter(
      (e) => e.role === 'owner' && e.status === 'active' && e._id !== row.employeeId,
    )) {
      await notify(ctx, {
        employeeId: a._id,
        category: 'connect',
        text:
          `<b>Подключение к боту</b>\n\n${employee.name} · ${employee.department}\n` +
          `Telegram: ${username ? '@' + username : tgName || '—'}`,
        link: '/team',
      })
    }

    return {
      ok: true as const,
      name: employee.name,
      position: employee.positionLabel,
      employeeId: employee._id,
      isOwner: employee.role === 'owner',
    }
  },
})

// §3.3: отключение. История и данные ERP не удаляются.
export const disableLink = mutation({
  args: { employeeId: v.id('employees') },
  handler: async (ctx, { employeeId }) => {
    const me = await requireAdmin(ctx)
    await disable(ctx, employeeId, me._id, 'отключено администратором')
  },
})

export async function disable(
  ctx: MutationCtx,
  employeeId: Id<'employees'>,
  byId: Id<'employees'> | undefined,
  reason: string,
) {
  const link = await ctx.db
    .query('telegramLinks')
    .withIndex('by_employee', (q) => q.eq('employeeId', employeeId))
    .first()
  if (!link || link.status === 'disabled') return
  await ctx.db.patch(link._id, {
    status: 'disabled',
    inviteCode: undefined,
    inviteExpiresAt: undefined,
  })
  // Доступ закрыт — значит закрыт и разговор: держать переписку с человеком,
  // которого отключили, незачем.
  if (link.chatId !== undefined) await forgetChat(ctx, link.chatId)
  await audit(ctx, { kind: 'disable', employeeId, byId, result: reason })
}

// §3.2: при увольнении или блокировке сотрудника доступ отключается
// автоматически. Вызывается из employees при архивации.
export const disableForArchived = internalMutation({
  args: { employeeId: v.id('employees') },
  handler: async (ctx, { employeeId }) => {
    await disable(ctx, employeeId, undefined, 'сотрудник архивирован в ERP')
  },
})

// §6.1 и §8.1: категории уведомлений сотрудника.
export const setCategories = mutation({
  args: { employeeId: v.id('employees'), muted: v.array(v.string()) },
  handler: async (ctx, { employeeId, muted }) => {
    await requireAdmin(ctx)
    const link = await ctx.db
      .query('telegramLinks')
      .withIndex('by_employee', (q) => q.eq('employeeId', employeeId))
      .first()
    if (!link) throw new ConvexError('Сотрудник не подключён к Telegram')
    await ctx.db.patch(link._id, {
      mutedCategories: muted.filter((m) =>
        (NOTIFY_CATEGORIES as readonly string[]).includes(m),
      ),
    })
  },
})

// ——— Служебное для webhook и действий ———

// Проверка «этот вызов от администратора» для action: у него нет прямого
// доступа к базе.
export const callerIsOwner = internalQuery({
  args: {},
  handler: async (ctx) => {
    const me = await currentEmployee(ctx)
    return me?.role === 'owner'
  },
})

// Часовой пояс организации для разбора относительных дат (§4.3).
export const timezone = internalQuery({
  args: {},
  handler: async (ctx) => (await tgSettings(ctx)).timezone,
})

export const linkByChat = internalQuery({
  args: { chatId: v.number() },
  handler: async (ctx, { chatId }) => {
    const link = await ctx.db
      .query('telegramLinks')
      .withIndex('by_chat', (q) => q.eq('chatId', chatId))
      .first()
    if (!link) return null
    const employee = await ctx.db.get(link.employeeId)
    return {
      status: link.status,
      employeeId: link.employeeId,
      employeeName: employee?.name ?? '',
      isOwner: employee?.role === 'owner',
      active: link.status === 'connected' && employee?.status === 'active',
    }
  },
})

// Сброс всех подключений: начать с чистого листа.
//
// Нужен, когда состояние запуталось — часть людей переподключалась, часть
// удалила переписку, и проще раздать вход заново, чем разбирать каждый случай.
// Стираются только связи и служебное состояние; журнал событий остаётся, иначе
// сброс стирал бы и след самого сброса.
//
// Раньше это делалось командой в терминале с боевой базой — операция не для
// повседневной работы, и место ей здесь, под правом администратора.
async function wipeLinks(
  ctx: MutationCtx,
  byId: Id<'employees'> | undefined,
  by: string,
): Promise<{ links: number; codes: number; drafts: number; sent: number; more: boolean }> {
  // Ограничение на проход: мутация не должна упереться в лимит документов.
  // Если записей окажется больше, сброс повторяют — счётчики покажут, что
  // осталось.
  const CAP = 2000
  let links = 0
  for (const row of await ctx.db.query('telegramLinks').take(CAP)) {
    if (row.chatId !== undefined) await forgetChat(ctx, row.chatId)
    await ctx.db.delete(row._id)
    links++
  }
  let codes = 0
  for (const row of await ctx.db.query('telegramAuthCodes').take(CAP)) {
    await ctx.db.delete(row._id)
    codes++
  }
  let drafts = 0
  for (const row of await ctx.db.query('telegramDrafts').take(CAP)) {
    await ctx.db.delete(row._id)
    drafts++
  }
  // Реестр отправленного держит ключи «это уже посылали». После сброса он
  // помешал бы прислать те же напоминания заново.
  let sent = 0
  for (const row of await ctx.db.query('telegramSent').take(CAP)) {
    await ctx.db.delete(row._id)
    sent++
  }

  await audit(ctx, {
    kind: 'disable',
    byId,
    result: `сброшены все подключения (${by}): связей ${links}, кодов ${codes}, черновиков ${drafts}`,
    status: 'ok',
  })
  return { links, codes, drafts, sent, more: links >= CAP || sent >= CAP }
}

export const resetAll = mutation({
  args: {},
  handler: async (ctx) => {
    const me = await requireAdmin(ctx)
    return await wipeLinks(ctx, me._id, 'из настроек')
  },
})

// Тот же сброс, но запускаемый со стороны обслуживания, без входа в приложение.
// Внутренняя функция клиенту недоступна: вызвать её можно только с сервера или
// консолью деплоймента, а туда доступ и так есть лишь у владельца проекта.
export const resetAllOps = internalMutation({
  args: {},
  handler: async (ctx) => await wipeLinks(ctx, undefined, 'обслуживание'),
})

// Возвращение после разрыва.
//
// Если человек удалил переписку с ботом или заблокировал его, Telegram
// отказывает в доставке, и привязка уходит в состояние «ошибка». Нажатие
// «Старт» снимает блокировку с его стороны — и заново гонять сотрудника через
// почту и код незачем: Telegram-аккаунт тот же самый, а личность по нему уже
// подтверждали. Отключение администратором так не снимается: это его решение.
export const resume = internalMutation({
  args: { chatId: v.number() },
  handler: async (ctx, { chatId }) => {
    const link = await ctx.db
      .query('telegramLinks')
      .withIndex('by_chat', (q) => q.eq('chatId', chatId))
      .first()
    if (!link) return { ok: false as const, reason: 'none' as const }
    if (link.status === 'disabled') return { ok: false as const, reason: 'disabled' as const }
    if (link.status !== 'failed') return { ok: false as const, reason: 'none' as const }

    const employee = await ctx.db.get(link.employeeId)
    if (!employee || employee.status !== 'active') {
      return { ok: false as const, reason: 'disabled' as const }
    }
    await ctx.db.patch(link._id, { status: 'connected', lastError: undefined })
    await audit(ctx, {
      kind: 'reconnect',
      employeeId: link.employeeId,
      chatId,
      result: 'сотрудник вернулся в бота',
      status: 'ok',
    })
    return { ok: true as const, name: employee.name }
  },
})

// §11: идемпотентная обработка. Второй раз тот же update не исполняется.
export const claimUpdate = internalMutation({
  args: { updateId: v.number() },
  handler: async (ctx, { updateId }) => {
    const seen = await ctx.db
      .query('telegramUpdates')
      .withIndex('by_update', (q) => q.eq('updateId', updateId))
      .first()
    if (seen) return false
    await ctx.db.insert('telegramUpdates', { updateId, at: Date.now() })
    return true
  },
})

export const markDelivery = internalMutation({
  args: {
    employeeId: v.optional(v.id('employees')),
    chatId: v.number(),
    ok: v.boolean(),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { chatId, ok, error }) => {
    const link = await ctx.db
      .query('telegramLinks')
      .withIndex('by_chat', (q) => q.eq('chatId', chatId))
      .first()
    if (!link) return
    if (ok) {
      await ctx.db.patch(link._id, { lastDeliveryAt: Date.now(), lastError: undefined })
      // Связь восстановилась после ошибки доставки.
      if (link.status === 'failed') await ctx.db.patch(link._id, { status: 'connected' })
      return
    }
    // §3.4: бот заблокирован пользователем — администратор видит состояние.
    await ctx.db.patch(link._id, {
      lastError: error?.slice(0, 300),
      status: link.status === 'connected' ? 'failed' : link.status,
    })
    await audit(ctx, {
      kind: 'error',
      employeeId: link.employeeId,
      chatId,
      status: 'error',
      error: error?.slice(0, 300),
    })
  },
})

export const logAudit = internalMutation({
  args: {
    kind: v.string(),
    employeeId: v.optional(v.id('employees')),
    chatId: v.optional(v.number()),
    updateId: v.optional(v.number()),
    text: v.optional(v.string()),
    fields: v.optional(v.string()),
    result: v.optional(v.string()),
    objectRef: v.optional(v.string()),
    status: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, row) => {
    await audit(ctx, row)
  },
})

// §10: журнал администратору с фильтрами.
export const auditLog = query({
  args: {
    employeeId: v.optional(v.id('employees')),
    kind: v.optional(v.string()),
    // §10: журнал должен фильтроваться по сотруднику, событию, статусу и
    // периоду. Статус хранится строкой ('ok' | 'error'), поэтому отдельным
    // признаком просим «только сбои» — так его ищут чаще всего.
    status: v.optional(v.string()),
    errorsOnly: v.optional(v.boolean()),
    from: v.optional(v.string()), // YYYY-MM-DD, включительно
    to: v.optional(v.string()), // YYYY-MM-DD, включительно
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { employeeId, kind, status, errorsOnly, from, to, search, limit }) => {
    const me = await currentEmployee(ctx)
    // Обычный сотрудник не видит технический журнал и действия других.
    if (!me || me.role !== 'owner') return []
    const names = new Map(
      (await ctx.db.query('employees').collect()).map((e) => [e._id as string, e.name]),
    )

    // Границы периода считаем в поясе организации: сутки для человека
    // начинаются в полночь по Алматы, а не по UTC.
    const dayStart = (d: string) => Date.parse(`${d}T00:00:00${DEFAULT_TZ_OFFSET}`)
    const dayEnd = (d: string) => Date.parse(`${d}T23:59:59.999${DEFAULT_TZ_OFFSET}`)
    const needle = search?.trim().toLowerCase()

    // Берём с запасом: фильтры сужают выборку, а листать журнал глубже
    // нескольких сотен записей всё равно незачем.
    return (await ctx.db.query('telegramAudit').withIndex('by_at').order('desc').take(1500))
      .filter((r) => !employeeId || r.employeeId === employeeId)
      .filter((r) => !kind || r.kind === kind)
      .filter((r) => !errorsOnly || r.status === 'error' || !!r.error)
      .filter((r) => !status || r.status === status)
      .filter((r) => !from || r.at >= dayStart(from))
      .filter((r) => !to || r.at <= dayEnd(to))
      .filter(
        (r) =>
          !needle ||
          [r.text, r.result, r.error, r.fields, r.kind]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(needle)),
      )
      .slice(0, limit ?? 100)
      .map((r) => ({
        _id: r._id,
        at: r.at,
        kind: r.kind,
        employee: r.employeeId ? (names.get(r.employeeId as string) ?? '—') : null,
        by: r.byId ? (names.get(r.byId as string) ?? '—') : null,
        text: r.text ?? null,
        result: r.result ?? null,
        objectRef: r.objectRef ?? null,
        status: r.status ?? null,
        error: r.error ?? null,
      }))
  },
})

// У кого бот молчит.
//
// Сотрудник, заблокировавший бота или удаливший чат, перестаёт получать
// задачи и напоминания — и никак этого не показывает. Раньше состояние
// «Ошибка доставки» было видно, только если открыть его карточку, то есть
// ровно тогда, когда уже что-то заподозрили. Выносим наверх.
export const deliveryProblems = query({
  args: {},
  handler: async (ctx) => {
    const me = await currentEmployee(ctx)
    if (!me || me.role !== 'owner') return []
    const names = new Map(
      (await ctx.db.query('employees').collect()).map((e) => [e._id as string, e]),
    )
    return (await ctx.db.query('telegramLinks').collect())
      .filter((l) => l.status === 'failed')
      .map((l) => {
        const e = names.get(l.employeeId as string)
        return {
          employeeId: l.employeeId,
          name: e?.name ?? '—',
          position: e?.positionLabel ?? '',
          error: l.lastError ?? null,
          lastDeliveryAt: l.lastDeliveryAt ?? null,
        }
      })
      // Уволенных не показываем: их доступ и так отключён.
      .filter((r) => names.get(r.employeeId as string)?.status === 'active')
  },
})

// Кого можно назначить исполнителем или пригласить на встречу (§4.3, §5.1):
// только сотрудники, доступные автору по правилам ERP.
export const visiblePeople = internalQuery({
  args: { employeeId: v.id('employees') },
  handler: async (ctx, { employeeId }) => {
    const me = await ctx.db.get(employeeId)
    if (!me) return []
    const all = (await ctx.db
      .query('employees')
      .collect()).filter((e) => e.status === 'active' && isStaff(e))
    const scoped =
      me.role === 'owner'
        ? all
        : me.role === 'head'
          ? all.filter((e) => e.department === me.department)
          : all.filter((e) => e._id === me._id)
    return scoped.map((e) => ({
      _id: e._id,
      name: e.name,
      positionLabel: e.positionLabel,
      department: e.department,
    }))
  },
})
