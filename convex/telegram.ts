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
import { currentEmployee, requireEmployee, isManager } from './lib'

// Категории уведомлений (§6.1): администратор включает и выключает их
// глобально и для конкретного сотрудника, не меняя его права в ERP.
export const NOTIFY_CATEGORIES = ['task', 'meeting', 'report', 'plan', 'kpi'] as const
export type NotifyCategory = (typeof NOTIFY_CATEGORIES)[number]

export const CATEGORY_LABEL: Record<NotifyCategory, string> = {
  task: 'Задачи',
  meeting: 'Встречи',
  report: 'Отчёты',
  plan: 'Планы и показатели',
  kpi: 'Достижения KPI',
}

const DEFAULTS = {
  inviteTtlHours: 24,
  meetingRemindMin: 60,
  reportRemindMin: 60,
  taskRemindMin: 60,
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
    inviteTtlHours: s?.tgInviteTtlHours ?? DEFAULTS.inviteTtlHours,
    meetingRemindMin: s?.tgMeetingRemindMin ?? DEFAULTS.meetingRemindMin,
    reportRemindMin: s?.tgReportRemindMin ?? DEFAULTS.reportRemindMin,
    taskRemindMin: s?.tgTaskRemindMin ?? DEFAULTS.taskRemindMin,
    reportRecipients: s?.tgReportRecipients ?? [],
    disabledCategories: new Set(s?.tgDisabledCategories ?? []),
    kpiTexts: s?.tgKpiTexts?.length ? s.tgKpiTexts : KPI_TEXTS,
    kpiOverachieve: s?.tgKpiOverachieve === true,
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
  await ctx.scheduler.runAfter(0, internal.telegramBot.deliver, {
    chatId: link.chatId,
    text: opts.text,
    link: opts.link,
    employeeId: opts.employeeId,
  })
  return true
}

// Уведомление нескольким сотрудникам сразу. Ключ дополняется получателем,
// иначе первое же отправленное сообщение закрыло бы событие для остальных.
export async function notifyMany(
  ctx: MutationCtx,
  ids: Id<'employees'>[],
  opts: { category: NotifyCategory; text: string; key?: string; link?: string },
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

function randomCode(): string {
  // Одноразовый код приглашения. Длины хватает, чтобы его нельзя было
  // подобрать перебором за срок жизни ссылки.
  const abc = 'abcdefghijkmnpqrstuvwxyz23456789'
  let out = ''
  for (let i = 0; i < 24; i++) out += abc[Math.floor(Math.random() * abc.length)]
  return out
}

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

// §3.1 шаг 1–2: администратор создаёт персональную одноразовую ссылку.
export const createInvite = mutation({
  args: { employeeId: v.id('employees') },
  handler: async (ctx, { employeeId }) => {
    const me = await requireAdmin(ctx)
    const employee = await ctx.db.get(employeeId)
    if (!employee) throw new ConvexError('Сотрудник не найден')
    if (employee.status !== 'active') {
      throw new ConvexError('Нельзя подключить Telegram архивному сотруднику')
    }

    const { inviteTtlHours } = await tgSettings(ctx)
    const code = randomCode()
    const expiresAt = Date.now() + inviteTtlHours * 3600 * 1000

    const existing = await ctx.db
      .query('telegramLinks')
      .withIndex('by_employee', (q) => q.eq('employeeId', employeeId))
      .first()

    const fields = {
      status: 'invited' as const,
      inviteCode: code,
      inviteExpiresAt: expiresAt,
      inviteCreatedById: me._id,
      // Новое приглашение обнуляет прежнюю привязку: §3.3 требует запускать
      // процесс заново, а не подменять аккаунт молча.
      chatId: undefined,
      username: undefined,
      tgName: undefined,
      connectedAt: undefined,
      connectedById: undefined,
      lastError: undefined,
    }
    if (existing) await ctx.db.patch(existing._id, fields)
    else await ctx.db.insert('telegramLinks', { employeeId, ...fields })

    await audit(ctx, { kind: 'invite', employeeId, byId: me._id, result: 'создано приглашение' })
    return { code, expiresAt }
  },
})

// §3.1 шаг 4–5: сотрудник запустил бота по ссылке. Вызывается из webhook.
export const claimInvite = internalMutation({
  args: {
    code: v.string(),
    chatId: v.number(),
    username: v.optional(v.string()),
    tgName: v.optional(v.string()),
  },
  handler: async (ctx, { code, chatId, username, tgName }) => {
    const link = await ctx.db
      .query('telegramLinks')
      .withIndex('by_code', (q) => q.eq('inviteCode', code))
      .first()
    // §3.2: истёкшие, использованные и отозванные ссылки недействительны.
    if (!link || link.status !== 'invited') return { ok: false, reason: 'invalid' as const }
    if (!link.inviteExpiresAt || link.inviteExpiresAt < Date.now()) {
      return { ok: false, reason: 'expired' as const }
    }

    // §3.2: один Telegram user ID — одна активная карточка сотрудника.
    const taken = await ctx.db
      .query('telegramLinks')
      .withIndex('by_chat', (q) => q.eq('chatId', chatId))
      .first()
    if (taken && taken._id !== link._id && taken.status === 'connected') {
      return { ok: false, reason: 'busy' as const }
    }

    await ctx.db.patch(link._id, {
      status: 'pending',
      chatId,
      username,
      tgName,
      // Код погашен: повторно по той же ссылке не зайти.
      inviteCode: undefined,
    })
    const employee = await ctx.db.get(link.employeeId)
    await audit(ctx, {
      kind: 'claim',
      employeeId: link.employeeId,
      chatId,
      result: 'ожидает подтверждения администратора',
    })

    // §3.1 шаг 5: администратору уходит запрос на финальное подтверждение.
    const admins = (await ctx.db.query('employees').collect()).filter(
      (e) => e.role === 'owner' && e.status === 'active',
    )
    for (const a of admins) {
      const adminLink = await ctx.db
        .query('telegramLinks')
        .withIndex('by_employee', (q) => q.eq('employeeId', a._id))
        .first()
      if (!adminLink?.chatId || adminLink.status !== 'connected') continue
      await ctx.scheduler.runAfter(0, internal.telegramBot.deliver, {
        chatId: adminLink.chatId,
        text:
          `<b>Запрос на подключение Telegram</b>\n\n` +
          `Сотрудник: ${employee?.name ?? '—'}\n` +
          `Telegram: ${username ? '@' + username : tgName || '—'}\n` +
          `User ID: <code>${chatId}</code>\n\n` +
          `Подтвердите подключение в ERP — Команда → карточка сотрудника.`,
        link: '/team',
        employeeId: a._id,
      })
    }
    return { ok: true, employeeName: employee?.name ?? '' }
  },
})

// §3.1 шаг 6: только после подтверждения администратором связь активируется.
export const confirmLink = mutation({
  args: { employeeId: v.id('employees'), approve: v.boolean() },
  handler: async (ctx, { employeeId, approve }) => {
    const me = await requireAdmin(ctx)
    const link = await ctx.db
      .query('telegramLinks')
      .withIndex('by_employee', (q) => q.eq('employeeId', employeeId))
      .first()
    if (!link || link.status !== 'pending') {
      throw new ConvexError('Нет запроса на подтверждение')
    }

    if (!approve) {
      await ctx.db.patch(link._id, {
        status: 'disabled',
        chatId: undefined,
        username: undefined,
        tgName: undefined,
      })
      await audit(ctx, { kind: 'reject', employeeId, byId: me._id, result: 'отклонено' })
      return
    }

    await ctx.db.patch(link._id, {
      status: 'connected',
      connectedAt: Date.now(),
      connectedById: me._id,
      lastError: undefined,
    })
    await audit(ctx, { kind: 'confirm', employeeId, byId: me._id, chatId: link.chatId })

    const employee = await ctx.db.get(employeeId)
    if (link.chatId) {
      await ctx.scheduler.runAfter(0, internal.telegramBot.deliver, {
        chatId: link.chatId,
        text:
          `<b>Подключение подтверждено</b>\n\n` +
          `${employee?.name ?? ''}, бот FRANCHONE ERP на связи.\n\n` +
          `Отправьте голосовое сообщение, чтобы поставить задачу или назначить встречу. ` +
          `Например: «Поставь Арману задачу подготовить отчёт до завтра, 18:00, высокий приоритет».\n\n` +
          `Команда /help — что умеет бот.`,
        employeeId,
      })
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
      active: link.status === 'connected' && employee?.status === 'active',
    }
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
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { employeeId, kind, limit }) => {
    const me = await currentEmployee(ctx)
    // Обычный сотрудник не видит технический журнал и действия других.
    if (!me || me.role !== 'owner') return []
    const names = new Map(
      (await ctx.db.query('employees').collect()).map((e) => [e._id as string, e.name]),
    )
    return (await ctx.db.query('telegramAudit').withIndex('by_at').order('desc').take(400))
      .filter((r) => !employeeId || r.employeeId === employeeId)
      .filter((r) => !kind || r.kind === kind)
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

// Кого можно назначить исполнителем или пригласить на встречу (§4.3, §5.1):
// только сотрудники, доступные автору по правилам ERP.
export const visiblePeople = internalQuery({
  args: { employeeId: v.id('employees') },
  handler: async (ctx, { employeeId }) => {
    const me = await ctx.db.get(employeeId)
    if (!me) return []
    const all = (await ctx.db.query('employees').collect()).filter((e) => e.status === 'active')
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
