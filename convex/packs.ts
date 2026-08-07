// Модуль «Производство и запуск франшизы» — ядро (ТЗ Упаковка v1.0).
//
// Здесь живёт сам проект: конструктор (§4), запуск клиенту (§4.4), пауза и
// завершение (§5.2, §13.1), дашборд владельца (§8), панель упаковщика (§9),
// KPI и вознаграждение (§7) и журнал действий (§14.2).
//
// Жизненный цикл этапов, материалы и комментарии — в packStages.ts.
// Клиентский кабинет — в packClient.ts: у него отдельные запросы, которые
// собирают ответ поимённо и не могут случайно вынести наружу цену проекта,
// процент упаковщика или начисление (§3.1, BR-05).

import { query, mutation } from './_generated/server'
import { v, ConvexError } from 'convex/values'
import type { QueryCtx, MutationCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { currentEmployee, requireEmployee, isStaff } from './lib'
import { viewScope } from './permissions'
import { DEFAULT_PERMS } from './permModel'
import { notify } from './telegram'
import {
  DAY_MS,
  DEFAULT_FIX_DAYS,
  DEFAULT_IDLE_DAYS,
  DEFAULT_REREVIEW_DAYS,
  DEFAULT_REVIEW_DAYS,
  DEFAULT_STAGES,
  DEFAULT_WARN_HOURS,
  accruedReward,
  packHealth,
  packerReward,
  progressOf,
  weightSum,
  type StageLike,
} from './packModel'

const TZ = '+05:00'

// ——— Общие помощники модуля ———

export function dayEnd(iso: string): number {
  return Date.parse(`${iso}T23:59:59${TZ}`)
}

export function today(): string {
  return new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 10)
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00${TZ}`)
  d.setUTCDate(d.getUTCDate() + days)
  return new Date(d.getTime() + 5 * 3600 * 1000).toISOString().slice(0, 10)
}

// §6.1: «возможность использовать календарные или рабочие дни». Срок реакции
// отсчитывается от момента передачи; в режиме рабочих дней выходные не
// расходуют срок.
export function deadlineFrom(from: number, days: number, workingDays: boolean): number {
  if (!workingDays) return from + days * DAY_MS
  let left = days
  let at = from
  while (left > 0) {
    at += DAY_MS
    const wd = new Date(at + 5 * 3600 * 1000).getUTCDay()
    if (wd !== 0 && wd !== 6) left -= 1
  }
  return at
}

export async function packSettings(ctx: QueryCtx | MutationCtx) {
  const s = await ctx.db
    .query('settings')
    .withIndex('by_key', (q) => q.eq('key', 'global'))
    .first()
  return {
    warnHours: s?.packWarnHours ?? DEFAULT_WARN_HOURS,
    reviewDays: s?.packReviewDays ?? DEFAULT_REVIEW_DAYS,
    rereviewDays: s?.packRereviewDays ?? DEFAULT_REREVIEW_DAYS,
    fixDays: s?.packFixDays ?? DEFAULT_FIX_DAYS,
    idleDays: s?.packIdleDays ?? DEFAULT_IDLE_DAYS,
  }
}

// §14.2: журнал фиксирует пользователя, действие, объект, дату и время,
// старое и новое значение, а также причину, если она обязательна.
export async function logPackEvent(
  ctx: MutationCtx,
  row: {
    packId: Id<'packs'>
    stageId?: Id<'packStages'>
    materialId?: Id<'packMaterials'>
    type: string
    byId: Id<'employees'>
    field?: string
    from?: string
    to?: string
    reason?: string
    note?: string
    financial?: boolean
  },
) {
  await ctx.db.insert('packEvents', { at: Date.now(), ...row })
  // §8.1 «проекты без активности»: отметку времени держим на самом проекте,
  // иначе для каждой карточки пришлось бы поднимать весь журнал.
  await ctx.db.patch(row.packId, { lastActivityAt: Date.now() })
}

// §14.1: уведомление внутри ERP + Telegram по общей интеграции. Одно событие —
// одна запись в ленте и одно сообщение в боте.
export async function notifyPack(
  ctx: MutationCtx,
  ids: Id<'employees'>[],
  opts: {
    packId: Id<'packs'>
    kind: string
    title: string
    text?: string
    link?: string
    // Не слать инициатору собственное действие.
    skip?: Id<'employees'>
    // Ключ события для повторяющихся проверок (крон): с ним уведомление уйдёт
    // ровно один раз, сколько бы раз проверка ни прошла.
    key?: string
  },
) {
  const unique = [...new Set(ids.map((i) => i as string))] as Id<'employees'>[]
  for (const employeeId of unique) {
    if (opts.skip && employeeId === opts.skip) continue
    const person = await ctx.db.get(employeeId)
    if (!person || person.status !== 'active') continue
    if (opts.key) {
      // Лента внутри ERP и Telegram делят один реестр отправленного —
      // иначе крон дублировал бы карточку в кабинете.
      const seen = await ctx.db
        .query('telegramSent')
        .withIndex('by_key', (q) => q.eq('key', `${opts.key}:${employeeId}`))
        .first()
      if (seen) continue
      await ctx.db.insert('telegramSent', {
        key: `${opts.key}:${employeeId}`,
        employeeId,
        category: 'pack',
        at: Date.now(),
        status: 'ok',
      })
    }
    await ctx.db.insert('packNotifications', {
      employeeId,
      packId: opts.packId,
      kind: opts.kind,
      title: opts.title,
      text: opts.text,
      link: opts.link,
      at: Date.now(),
    })
    await notify(ctx, {
      employeeId,
      category: 'pack',
      text: `<b>${opts.title}</b>${opts.text ? `\n\n${opts.text}` : ''}`,
      link: opts.link,
    })
  }
}

// ——— §12: награды этапа ———
//
// §5.4 — геймификационное условие: награда сохраняется, если клиент в
// установленный срок ЛИБО утверждает этап, ЛИБО отправляет консолидированные
// замечания. Возврат на доработку награду не отнимает — иначе система
// подталкивала бы принимать результат без проверки.

export async function openStageRewards(
  ctx: MutationCtx,
  stageId: Id<'packStages'>,
  dueAt: number,
) {
  const rows = await ctx.db
    .query('packRewards')
    .withIndex('by_stage', (q) => q.eq('stageId', stageId))
    .collect()
  for (const r of rows) {
    if (r.status !== 'locked') continue
    // §12: если владелец задал свой срок условия — он и остаётся. Иначе
    // награда живёт ровно столько, сколько у клиента есть на ответ (§5.4).
    await ctx.db.patch(r._id, { status: 'available', dueAt: r.dueAt ?? dueAt })
  }
}

export async function settleStageRewards(
  ctx: MutationCtx,
  stage: Doc<'packStages'>,
  byId: Id<'employees'>,
  onTime: boolean,
) {
  const rows = await ctx.db
    .query('packRewards')
    .withIndex('by_stage', (q) => q.eq('stageId', stage._id))
    .collect()
  for (const r of rows) {
    if (r.status !== 'available') continue
    await ctx.db.patch(r._id, {
      status: onTime ? 'earned' : 'missed',
      earnedAt: onTime ? Date.now() : undefined,
    })
    await logPackEvent(ctx, {
      packId: stage.packId,
      stageId: stage._id,
      type: 'reward',
      byId,
      field: r.title,
      to: onTime ? 'заработана' : 'не получена',
    })
    if (onTime) {
      const pack = await ctx.db.get(stage.packId)
      if (pack?.clientId) {
        await notifyPack(ctx, [pack.clientId], {
          packId: stage.packId,
          kind: 'reward',
          title: 'Награда получена',
          text: r.title,
          link: '/rewards',
        })
      }
    }
  }
}

export async function stagesOf(ctx: QueryCtx | MutationCtx, packId: Id<'packs'>) {
  const rows = await ctx.db
    .query('packStages')
    .withIndex('by_pack', (q) => q.eq('packId', packId))
    .collect()
  return rows.sort((a, b) => a.order - b.order)
}

export function stageLike(s: Doc<'packStages'>): StageLike {
  return {
    kind: s.kind,
    status: s.status,
    weight: s.weight,
    dueAt: s.dueAt ?? null,
    awaiting: s.awaiting ?? null,
    endDate: s.endDate ?? null,
  }
}

// Кто получает уведомления по проекту со стороны FRANCHONE.
export function teamOf(pack: Doc<'packs'>): Id<'employees'>[] {
  return [pack.packerId, pack.createdById, ...pack.memberIds]
}

// ——— Права (§3) ———

// Видит ли сотрудник проект: владелец — все, право «Все» — все, остальные —
// назначенные и созданные (§3, строка «Просмотр всех проектов»).
export async function maySeePack(
  ctx: QueryCtx | MutationCtx,
  me: Doc<'employees'>,
  pack: Doc<'packs'>,
): Promise<boolean> {
  if (me.role === 'owner') return true
  if (me.role === 'client') return pack.clientId === me._id && !!pack.launchedAt
  if (
    pack.packerId === me._id ||
    pack.createdById === me._id ||
    pack.memberIds.some((m) => m === me._id)
  ) {
    return true
  }
  return (await viewScope(ctx, 'packs')) === 'all'
}

// Настраивать проект может владелец, его упаковщик и создатель. Просто
// «участник» смотрит и загружает материалы, но экономику и структуру не трогает.
export function mayManagePack(me: Doc<'employees'>, pack: Doc<'packs'>): boolean {
  return me.role === 'owner' || pack.packerId === me._id || pack.createdById === me._id
}

// Работать внутри проекта (материалы, комментарии, статусы) может вся команда
// проекта.
export function mayWorkOnPack(me: Doc<'employees'>, pack: Doc<'packs'>): boolean {
  return mayManagePack(me, pack) || pack.memberIds.some((m) => m === me._id)
}

export async function requirePack(
  ctx: MutationCtx,
  id: Id<'packs'>,
  level: 'see' | 'work' | 'manage',
): Promise<{ me: Doc<'employees'>; pack: Doc<'packs'> }> {
  const me = await requireEmployee(ctx)
  const pack = await ctx.db.get(id)
  if (!pack) throw new ConvexError('Упаковка не найдена')
  if (!(await maySeePack(ctx, me, pack))) throw new ConvexError('Нет доступа к этой упаковке')
  if (level === 'manage' && !mayManagePack(me, pack)) {
    throw new ConvexError('Настраивать проект может владелец, упаковщик или создатель')
  }
  if (level === 'work' && !mayWorkOnPack(me, pack)) {
    throw new ConvexError('Действие доступно команде проекта')
  }
  return { me, pack }
}

// ——— §7.3, §7.4: выплаты вознаграждения ———

export async function paidFor(
  ctx: QueryCtx | MutationCtx,
  packId: Id<'packs'>,
): Promise<number> {
  const rows = await ctx.db
    .query('packPayouts')
    .withIndex('by_pack', (q) => q.eq('packId', packId))
    .collect()
  return rows.reduce((sum, r) => sum + r.amount, 0)
}

// ——— Сводка по проекту ———

export interface PackSummary {
  progress: number
  weightSum: number
  approvedStages: number
  mainStages: number
  health: ReturnType<typeof packHealth>
  currentStage: { _id: Id<'packStages'>; title: string; status: string; order: number } | null
  plannedFinish: string
  overdueCount: number
}

export function summarize(
  pack: Doc<'packs'>,
  stages: Doc<'packStages'>[],
  warnHours: number,
  now = Date.now(),
): PackSummary {
  const likes = stages.map(stageLike)
  const main = stages.filter((s) => s.kind === 'main')
  const health = packHealth({
    status: pack.status,
    dueDate: pack.dueDate,
    stages: likes,
    now,
    warnHours,
  })
  // Текущий этап — первый незавершённый по порядку.
  const current = stages.find((s) => s.status !== 'approved') ?? null
  // §6.1: плановая дата окончания считается по этапам, а не только по общему
  // сроку — иначе противоречие между ними никто бы не заметил.
  const ends = stages.map((s) => s.endDate).filter((d): d is string => !!d)
  const plannedFinish = ends.length ? ends.slice().sort()[ends.length - 1] : pack.dueDate
  const overdueCount = stages.filter(
    (s) => s.dueAt && s.dueAt < now && s.status !== 'approved',
  ).length

  return {
    progress: progressOf(likes),
    weightSum: weightSum(likes),
    approvedStages: main.filter((s) => s.status === 'approved').length,
    mainStages: main.length,
    health,
    currentStage: current
      ? { _id: current._id, title: current.title, status: current.status, order: current.order }
      : null,
    plannedFinish,
    overdueCount,
  }
}

async function person(ctx: QueryCtx | MutationCtx, id: Id<'employees'> | undefined | null) {
  if (!id) return null
  const e = await ctx.db.get(id)
  if (!e) return null
  return {
    _id: e._id,
    name: e.name,
    initials: e.initials,
    avatarColor: e.avatarColor,
    positionLabel: e.positionLabel,
  }
}

// ——— Доступ к разделу ———

// Показывать ли сотруднику раздел «Упаковки». Матрица прав — не единственный
// источник: §3 и BR-11 говорят, что упаковщик ведёт назначенные ему проекты,
// поэтому назначение само по себе открывает раздел.
export const access = query({
  args: {},
  handler: async (ctx) => {
    const me = await currentEmployee(ctx)
    const none = { canView: false, canCreate: false, canSeeAll: false, isOwner: false, isClient: false }
    if (!me || me.status !== 'active') return none
    if (me.role === 'client') return { ...none, canView: false, isClient: true }

    const scope = await viewScope(ctx, 'packs')
    const isOwner = me.role === 'owner'
    // Достаточно одного назначения, чтобы раздел появился в меню.
    const assigned = (await ctx.db.query('packs').collect()).some(
      (p) =>
        p.packerId === me._id ||
        p.createdById === me._id ||
        p.memberIds.some((m) => m === me._id),
    )
    return {
      canView: isOwner || scope !== 'none' || assigned,
      canCreate: await mayDo(ctx, me, 'create'),
      canSeeAll: scope === 'all',
      isOwner,
      isClient: false,
    }
  },
})

// Право из матрицы (§9 основного ТЗ) без обращения к permissions.requireCan:
// оно нужно и в запросах, где мутационного контекста нет.
async function mayDo(
  ctx: QueryCtx | MutationCtx,
  me: Doc<'employees'> | null,
  action: string,
): Promise<boolean> {
  if (!me) return false
  if (me.role === 'owner') return true
  if (me.role !== 'head' && me.role !== 'employee') return false
  const row = await ctx.db
    .query('rolePermissions')
    .withIndex('by_role', (q) => q.eq('role', me.role as 'head' | 'employee'))
    .first()
  const allowed = new Set(row?.allowed ?? DEFAULT_PERMS[me.role as 'head' | 'employee'] ?? [])
  return allowed.has(`packs:${action}`)
}

// ——— §8: дашборд владельца ———

export const list = query({
  args: {
    packerId: v.optional(v.id('employees')),
    clientId: v.optional(v.id('employees')),
    status: v.optional(v.string()),
    health: v.optional(v.string()),
    side: v.optional(v.string()),
    stageOrder: v.optional(v.number()),
    from: v.optional(v.string()),
    to: v.optional(v.string()),
    onlyOverdue: v.optional(v.boolean()),
    onlyIdle: v.optional(v.boolean()),
    mine: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const me = await currentEmployee(ctx)
    if (!me || me.role === 'client') return null

    const settings = await packSettings(ctx)
    const now = Date.now()
    const all = await ctx.db.query('packs').collect()
    const visible: {
      pack: Doc<'packs'>
      stages: Doc<'packStages'>[]
      summary: PackSummary
    }[] = []
    for (const pack of all) {
      if (!(await maySeePack(ctx, me, pack))) continue
      const stages = await stagesOf(ctx, pack._id)
      visible.push({ pack, stages, summary: summarize(pack, stages, settings.warnHours, now) })
    }

    const idleMs = settings.idleDays * DAY_MS
    const filtered = visible.filter(({ pack, summary }) => {
      if (args.mine && pack.packerId !== me._id) return false
      if (args.packerId && pack.packerId !== args.packerId) return false
      if (args.clientId && pack.clientId !== args.clientId) return false
      if (args.status && pack.status !== args.status) return false
      if (args.health && summary.health.health !== args.health) return false
      if (args.side && summary.health.side !== args.side) return false
      if (args.stageOrder !== undefined && summary.currentStage?.order !== args.stageOrder) return false
      if (args.from && pack.dueDate < args.from) return false
      if (args.to && pack.startDate > args.to) return false
      if (args.onlyOverdue && summary.overdueCount === 0 && summary.health.health !== 'red') return false
      if (args.onlyIdle && now - pack.lastActivityAt < idleMs) return false
      return true
    })

    const rows = []
    for (const { pack, summary } of filtered) {
      const reward = packerReward(pack.price, pack.packerPercent)
      rows.push({
        _id: pack._id,
        title: pack.title,
        status: pack.status,
        client: await person(ctx, pack.clientId),
        packer: await person(ctx, pack.packerId),
        startDate: pack.startDate,
        dueDate: pack.dueDate,
        plannedFinish: summary.plannedFinish,
        progress: summary.progress,
        health: summary.health.health,
        healthReason: summary.health.reason,
        side: summary.health.side,
        nextDueAt: summary.health.nextDueAt,
        currentStage: summary.currentStage,
        approvedStages: summary.approvedStages,
        mainStages: summary.mainStages,
        overdueCount: summary.overdueCount,
        idle: now - pack.lastActivityAt >= idleMs && pack.status === 'active',
        lastActivityAt: pack.lastActivityAt,
        // §3: внутренние суммы — только владельцу и по своим проектам упаковщику.
        reward,
        accrued: accruedReward(pack.price, pack.packerPercent, summary.progress),
        price: pack.price,
        packerPercent: pack.packerPercent,
        isTemplate: pack.isTemplate === true,
      })
    }

    // §8.1: верхние показатели считаются по всем видимым проектам, а не по
    // отфильтрованному срезу — иначе фильтр «просроченные» обнулил бы счётчики.
    const active = visible.filter((v) => v.pack.status === 'active')
    const finishedInPeriod = visible.filter(
      (v) =>
        v.pack.status === 'done' &&
        v.pack.finishedAt &&
        (!args.from || v.pack.finishedAt >= Date.parse(`${args.from}T00:00:00${TZ}`)) &&
        (!args.to || v.pack.finishedAt <= dayEnd(args.to)),
    )
    const stats = {
      active: active.length,
      onTrack: active.filter((v) => v.summary.health.health === 'green').length,
      risky: active.filter((v) => v.summary.health.health === 'yellow').length,
      overdue: active.filter((v) => v.summary.health.health === 'red').length,
      waitingClient: active.filter((v) => v.summary.health.side === 'client').length,
      waitingUs: active.filter((v) => v.summary.health.side === 'franchone').length,
      idle: active.filter((v) => now - v.pack.lastActivityAt >= idleMs).length,
      finished: finishedInPeriod.length,
      rewardPlanned: active.reduce(
        (s, v) => s + packerReward(v.pack.price, v.pack.packerPercent),
        0,
      ),
      rewardAccrued: visible.reduce(
        (s, v) => s + accruedReward(v.pack.price, v.pack.packerPercent, v.summary.progress),
        0,
      ),
      rewardPaid: (
        await Promise.all(visible.map((v) => paidFor(ctx, v.pack._id)))
      ).reduce((s, x) => s + x, 0),
    }

    // §8.3: фильтр «текущий этап». Названия этапов у проектов свои, общее у
    // них — порядковый номер, по нему и фильтруем.
    const stageOptions = [
      ...new Map(
        visible
          .map((v) => v.summary.currentStage)
          .filter((c): c is NonNullable<typeof c> => !!c)
          .map((c) => [c.order, { order: c.order, title: c.title }]),
      ).values(),
    ].sort((a, b) => a.order - b.order)

    // Справочники для фильтров.
    const staff = (await ctx.db.query('employees').collect()).filter(
      (e) => isStaff(e) && e.status === 'active' && !e.hidden,
    )
    const clientIds = new Set(all.map((p) => p.clientId).filter(Boolean) as Id<'employees'>[])
    const clients = []
    for (const id of clientIds) {
      const c = await person(ctx, id)
      if (c) clients.push(c)
    }

    return {
      rows: rows.sort((a, b) => {
        const rank = { red: 0, yellow: 1, blue: 2, purple: 3, green: 4, grey: 5 } as Record<string, number>
        const d = (rank[a.health] ?? 9) - (rank[b.health] ?? 9)
        return d !== 0 ? d : a.dueDate.localeCompare(b.dueDate)
      }),
      stats,
      isOwner: me.role === 'owner',
      meId: me._id,
      stageOptions,
      packers: staff.map((e) => ({
        _id: e._id,
        name: e.name,
        initials: e.initials,
        avatarColor: e.avatarColor,
        positionLabel: e.positionLabel,
      })),
      clients: clients.sort((a, b) => a.name.localeCompare(b.name, 'ru')),
      settings,
      today: today(),
    }
  },
})

// ——— Карточка проекта для команды ———

export const get = query({
  args: { id: v.id('packs') },
  handler: async (ctx, { id }) => {
    const me = await currentEmployee(ctx)
    if (!me || me.role === 'client') return null
    const pack = await ctx.db.get(id)
    if (!pack) return null
    if (!(await maySeePack(ctx, me, pack))) return null

    const settings = await packSettings(ctx)
    const stages = await stagesOf(ctx, id)
    const summary = summarize(pack, stages, settings.warnHours)
    const materials = await ctx.db
      .query('packMaterials')
      .withIndex('by_pack', (q) => q.eq('packId', id))
      .collect()
    const comments = await ctx.db
      .query('packComments')
      .withIndex('by_pack', (q) => q.eq('packId', id))
      .collect()
    const rewards = await ctx.db
      .query('packRewards')
      .withIndex('by_pack', (q) => q.eq('packId', id))
      .collect()

    const openClientComments = comments.filter((c) => c.scope === 'client' && !c.resolved).length

    return {
      _id: pack._id,
      title: pack.title,
      status: pack.status,
      description: pack.description ?? null,
      startDate: pack.startDate,
      dueDate: pack.dueDate,
      workingDays: pack.workingDays === true,
      client: await person(ctx, pack.clientId),
      packer: await person(ctx, pack.packerId),
      createdBy: await person(ctx, pack.createdById),
      members: (await Promise.all(pack.memberIds.map((m) => person(ctx, m)))).filter(Boolean),
      launchedAt: pack.launchedAt ?? null,
      finishedAt: pack.finishedAt ?? null,
      hubOpenedAt: pack.hubOpenedAt ?? null,
      hubNote: pack.hubNote ?? null,
      pausedReason: pack.pausedReason ?? null,
      pausedAt: pack.pausedAt ?? null,
      isTemplate: pack.isTemplate === true,
      lastActivityAt: pack.lastActivityAt,
      // §7.1: экономика конкретного проекта.
      price: pack.price,
      packerPercent: pack.packerPercent,
      reward: packerReward(pack.price, pack.packerPercent),
      accrued: accruedReward(pack.price, pack.packerPercent, summary.progress),
      // §7.3: выплаченное — отдельная величина, факт, а не производная.
      paid: await paidFor(ctx, pack._id),
      progress: summary.progress,
      weightSum: summary.weightSum,
      health: summary.health.health,
      healthReason: summary.health.reason,
      side: summary.health.side,
      nextDueAt: summary.health.nextDueAt,
      plannedFinish: summary.plannedFinish,
      currentStage: summary.currentStage,
      approvedStages: summary.approvedStages,
      mainStages: summary.mainStages,
      openClientComments,
      reworkMaterials: materials.filter((m) => m.status === 'rework').length,
      rewardsCount: rewards.length,
      canManage: mayManagePack(me, pack),
      canWork: mayWorkOnPack(me, pack),
      isOwner: me.role === 'owner',
      meId: me._id,
      settings,
      today: today(),
      now: Date.now(),
    }
  },
})

// ——— §4: конструктор новой упаковки ———

export const create = mutation({
  args: {
    title: v.string(),
    clientId: v.optional(v.id('employees')),
    packerId: v.optional(v.id('employees')),
    memberIds: v.optional(v.array(v.id('employees'))),
    startDate: v.string(),
    dueDate: v.string(),
    price: v.optional(v.number()),
    packerPercent: v.optional(v.number()),
    description: v.optional(v.string()),
    workingDays: v.optional(v.boolean()),
    // §4.1: «Шаблон упаковки» — новый проект или копия структуры этапов.
    templateId: v.optional(v.id('packs')),
  },
  handler: async (ctx, args) => {
    const me = await requireEmployee(ctx)
    // §3, BR-11: создавать упаковки может владелец и упаковщик с правом.
    if (!(await mayDo(ctx, me, 'create'))) {
      throw new ConvexError('Нет права создавать упаковки')
    }

    const title = args.title.trim()
    if (!title) throw new ConvexError('Укажите название упаковки')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.startDate)) throw new ConvexError('Укажите дату старта')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.dueDate)) throw new ConvexError('Укажите общий срок проекта')
    if (args.dueDate < args.startDate) {
      throw new ConvexError('Общий срок не может быть раньше даты старта')
    }
    const percent = args.packerPercent ?? 0
    if (percent < 0 || percent > 100) throw new ConvexError('Процент упаковщика — от 0 до 100')

    // Ответственный упаковщик обязателен (§4.1); по умолчанию — создатель.
    const packerId = args.packerId ?? me._id
    const packer = await ctx.db.get(packerId)
    if (!packer || !isStaff(packer)) throw new ConvexError('Упаковщик не найден')
    if (args.clientId) {
      const client = await ctx.db.get(args.clientId)
      if (!client || client.role !== 'client') throw new ConvexError('Клиент не найден')
    }

    const now = Date.now()
    const packId = await ctx.db.insert('packs', {
      title,
      clientId: args.clientId,
      packerId,
      memberIds: (args.memberIds ?? []).filter((m) => m !== packerId),
      startDate: args.startDate,
      dueDate: args.dueDate,
      price: args.price ?? 0,
      packerPercent: percent,
      description: args.description?.trim() || undefined,
      // §4: проект сначала создаётся как внутренний черновик.
      status: 'draft',
      workingDays: args.workingDays === true,
      createdById: me._id,
      createdAt: now,
      lastActivityAt: now,
    })

    const settings = await packSettings(ctx)
    // §4.1: копирование шаблона — структура этапов берётся из другого проекта.
    const source = args.templateId ? await stagesOf(ctx, args.templateId) : null
    const blueprint = source?.length
      ? source.map((s) => ({
          kind: s.kind,
          title: s.title,
          clientNote: s.clientNote ?? '',
          weight: s.weight,
          reviewDays: s.reviewDays,
          rereviewDays: s.rereviewDays,
          fixDays: s.fixDays,
          internalNote: s.internalNote,
          doneCondition: s.doneCondition,
        }))
      : // §5.1: по умолчанию нулевой этап и пять основных по 20%.
        DEFAULT_STAGES.map((s) => ({
          kind: s.kind,
          title: s.title,
          clientNote: s.clientNote,
          weight: s.weight,
          reviewDays: settings.reviewDays,
          rereviewDays: settings.rereviewDays,
          fixDays: settings.fixDays,
          internalNote: undefined as string | undefined,
          doneCondition: undefined as string | undefined,
        }))

    // Сроки этапов по умолчанию делим равномерно внутри общего срока — их
    // всё равно правят вручную до запуска (§4.2), но пустыми они оставлять
    // проверку §4.3 без данных.
    const totalDays = Math.max(
      1,
      Math.round((dayEnd(args.dueDate) - dayEnd(args.startDate)) / DAY_MS),
    )
    const per = Math.max(1, Math.floor(totalDays / blueprint.length))
    let cursor = args.startDate

    for (let i = 0; i < blueprint.length; i++) {
      const b = blueprint[i]
      const start = cursor
      const end = i === blueprint.length - 1 ? args.dueDate : addDays(start, per - 1)
      cursor = addDays(end, 1)
      await ctx.db.insert('packStages', {
        packId,
        order: i,
        kind: b.kind,
        title: b.title,
        clientNote: b.clientNote || undefined,
        internalNote: b.internalNote,
        startDate: start,
        endDate: end > args.dueDate ? args.dueDate : end,
        weight: b.weight,
        reviewDays: b.reviewDays,
        rereviewDays: b.rereviewDays,
        fixDays: b.fixDays,
        doneCondition: b.doneCondition,
        status: 'planned',
        returnCount: 0,
      })
    }

    await logPackEvent(ctx, {
      packId,
      type: 'created',
      byId: me._id,
      note: args.templateId ? 'по шаблону' : 'новый проект',
    })
    return packId
  },
})

// §4.4: изменение весов, финансов и уже начавшихся сроков после запуска
// допускается только с фиксацией автора, даты, старого значения, нового
// значения и причины (BR-08).
export const update = mutation({
  args: {
    id: v.id('packs'),
    title: v.optional(v.string()),
    clientId: v.optional(v.id('employees')),
    packerId: v.optional(v.id('employees')),
    memberIds: v.optional(v.array(v.id('employees'))),
    startDate: v.optional(v.string()),
    dueDate: v.optional(v.string()),
    price: v.optional(v.number()),
    packerPercent: v.optional(v.number()),
    description: v.optional(v.string()),
    workingDays: v.optional(v.boolean()),
    isTemplate: v.optional(v.boolean()),
    hubNote: v.optional(v.string()),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, { id, reason, ...patch }) => {
    const { me, pack } = await requirePack(ctx, id, 'manage')
    const launched = !!pack.launchedAt
    const changes: { field: string; from: string; to: string; financial?: boolean }[] = []
    const next: Record<string, unknown> = {}

    const set = (
      field: string,
      key: string,
      before: unknown,
      after: unknown,
      financial = false,
    ) => {
      if (after === undefined) return
      if (String(before ?? '') === String(after ?? '')) return
      next[key] = after
      changes.push({ field, from: String(before ?? '—'), to: String(after ?? '—'), financial })
    }

    if (patch.title !== undefined) {
      const t = patch.title.trim()
      if (!t) throw new ConvexError('Название не может быть пустым')
      set('название', 'title', pack.title, t)
    }
    if (patch.clientId !== undefined) {
      const client = await ctx.db.get(patch.clientId)
      if (!client || client.role !== 'client') throw new ConvexError('Клиент не найден')
      set('клиент', 'clientId', pack.clientId, patch.clientId)
    }
    if (patch.packerId !== undefined) {
      const p = await ctx.db.get(patch.packerId)
      if (!p || !isStaff(p)) throw new ConvexError('Упаковщик не найден')
      set('упаковщик', 'packerId', pack.packerId, patch.packerId)
    }
    if (patch.memberIds !== undefined) {
      const ids = patch.memberIds.filter((m) => m !== (next.packerId ?? pack.packerId))
      if (ids.join(',') !== pack.memberIds.join(',')) {
        next.memberIds = ids
        changes.push({ field: 'участники', from: `${pack.memberIds.length}`, to: `${ids.length}` })
      }
    }
    if (patch.startDate !== undefined) set('дата старта', 'startDate', pack.startDate, patch.startDate)
    if (patch.dueDate !== undefined) set('общий срок', 'dueDate', pack.dueDate, patch.dueDate)
    if (patch.price !== undefined) {
      if (patch.price < 0) throw new ConvexError('Стоимость не может быть отрицательной')
      set('стоимость проекта', 'price', pack.price, patch.price, true)
    }
    if (patch.packerPercent !== undefined) {
      if (patch.packerPercent < 0 || patch.packerPercent > 100) {
        throw new ConvexError('Процент упаковщика — от 0 до 100')
      }
      set('процент упаковщика', 'packerPercent', pack.packerPercent, patch.packerPercent, true)
    }
    if (patch.description !== undefined) {
      set('описание', 'description', pack.description, patch.description.trim() || undefined)
    }
    if (patch.workingDays !== undefined) {
      set('режим дней', 'workingDays', pack.workingDays === true, patch.workingDays)
    }
    if (patch.isTemplate !== undefined) {
      set('шаблон', 'isTemplate', pack.isTemplate === true, patch.isTemplate)
    }
    if (patch.hubNote !== undefined) {
      set('заметка итогового хаба', 'hubNote', pack.hubNote, patch.hubNote.trim() || undefined)
    }

    if (changes.length === 0) return

    // §4.4: критичные изменения запущенного проекта — только с причиной.
    const critical = changes.some(
      (c) => c.financial || c.field === 'дата старта' || c.field === 'общий срок',
    )
    if (launched && critical && !reason?.trim()) {
      throw new ConvexError(
        'Укажите причину: после запуска изменение финансов и сроков фиксируется в журнале',
      )
    }
    if (next.startDate && next.dueDate && String(next.dueDate) < String(next.startDate)) {
      throw new ConvexError('Общий срок не может быть раньше даты старта')
    }

    const beforePacker = pack.packerId
    await ctx.db.patch(id, next)

    for (const c of changes) {
      await logPackEvent(ctx, {
        packId: id,
        type: c.financial ? 'finance' : c.field === 'упаковщик' ? 'packer_changed' : 'updated',
        byId: me._id,
        field: c.field,
        from: c.from,
        to: c.to,
        reason: reason?.trim() || undefined,
        financial: c.financial,
      })
    }

    // §7.3: изменение стоимости, процента или весов после начисления требует
    // пересчёта. Пересчитывать нечего — начисление всегда производное (A = W×K),
    // но упаковщик должен узнать, что его вознаграждение изменилось.
    const money = changes.some((c) => c.financial)
    if (money && launched) {
      const stages = await stagesOf(ctx, id)
      const progress = progressOf(stages.map(stageLike))
      const after = await ctx.db.get(id)
      if (after) {
        await logPackEvent(ctx, {
          packId: id,
          type: 'kpi_recalc',
          byId: me._id,
          note: `начислено ${accruedReward(after.price, after.packerPercent, progress)} ₸ при KPI ${progress}%`,
          financial: true,
        })
        await notifyPack(ctx, [after.packerId], {
          packId: id,
          kind: 'kpi_recalc',
          title: 'Пересчитано вознаграждение по проекту',
          text: `${after.title}: KPI ${progress}%, начислено ${accruedReward(after.price, after.packerPercent, progress)} ₸`,
          link: `/packs/${id}`,
          skip: me._id,
        })
      }
    }
    if (next.packerId && next.packerId !== beforePacker) {
      await notifyPack(ctx, [next.packerId as Id<'employees'>], {
        packId: id,
        kind: 'assigned',
        title: 'Вы назначены упаковщиком',
        text: pack.title,
        link: `/packs/${id}`,
        skip: me._id,
      })
      // Прежний упаковщик должен узнать, что проект больше не его: у него
      // на панели он просто исчезнет, а начисления по нему остановятся.
      await notifyPack(ctx, [beforePacker], {
        packId: id,
        kind: 'unassigned',
        title: 'Проект передан другому упаковщику',
        text: `${pack.title}. Начисленное вознаграждение по утверждённым этапам сохраняется.`,
        skip: me._id,
      })
    }
  },
})

// ——— §4.3: проверки перед запуском ———

export interface PreflightIssue {
  level: 'error' | 'warning'
  text: string
}

export async function preflight(
  ctx: QueryCtx | MutationCtx,
  pack: Doc<'packs'>,
): Promise<PreflightIssue[]> {
  const stages = await stagesOf(ctx, pack._id)
  const main = stages.filter((s) => s.kind === 'main')
  const issues: PreflightIssue[] = []

  const sum = weightSum(stages.map(stageLike))
  if (main.length === 0) {
    issues.push({ level: 'error', text: 'В проекте нет ни одного основного этапа' })
  }
  if (sum !== 100) {
    issues.push({
      level: 'error',
      text: `Сумма весов основных этапов — ${sum}%, а должна быть ровно 100%`,
    })
  }
  for (const s of main) {
    if (s.weight <= 0) {
      issues.push({ level: 'error', text: `Вес этапа «${s.title}» должен быть больше 0%` })
    }
  }
  if (!pack.clientId) issues.push({ level: 'error', text: 'Не назначен клиент' })
  if (!pack.packerId) issues.push({ level: 'error', text: 'Не назначен упаковщик' })
  if (!pack.price) issues.push({ level: 'error', text: 'Не заполнена стоимость проекта' })
  if (!pack.packerPercent) {
    issues.push({ level: 'error', text: 'Не заполнен процент упаковщика' })
  }
  for (const s of stages) {
    if (!s.reviewDays || !s.rereviewDays || !s.fixDays) {
      issues.push({
        level: 'error',
        text: `У этапа «${s.title}» не заданы сроки согласования и доработки`,
      })
    }
  }

  // §4.3: сроки этапов не должны выходить за общий срок — это предупреждение,
  // а не запрет: ТЗ просит именно предупредить.
  for (const s of stages) {
    if (s.endDate && s.endDate > pack.dueDate) {
      issues.push({
        level: 'warning',
        text: `Этап «${s.title}» заканчивается ${s.endDate} — позже общего срока ${pack.dueDate}`,
      })
    }
    if (s.startDate && s.startDate < pack.startDate) {
      issues.push({
        level: 'warning',
        text: `Этап «${s.title}» начинается раньше даты старта проекта`,
      })
    }
  }
  // §4.3: пересечения этапов при последовательной работе.
  for (let i = 1; i < stages.length; i++) {
    const prev = stages[i - 1]
    const cur = stages[i]
    if (prev.endDate && cur.startDate && cur.startDate <= prev.endDate) {
      issues.push({
        level: 'warning',
        text: `Этапы «${prev.title}» и «${cur.title}» пересекаются по датам`,
      })
    }
  }
  return issues
}

export const checks = query({
  args: { id: v.id('packs') },
  handler: async (ctx, { id }) => {
    const me = await currentEmployee(ctx)
    if (!me || me.role === 'client') return null
    const pack = await ctx.db.get(id)
    if (!pack || !(await maySeePack(ctx, me, pack))) return null
    const issues = await preflight(ctx, pack)
    return {
      issues,
      canLaunch: issues.every((i) => i.level !== 'error'),
      launched: !!pack.launchedAt,
    }
  },
})

// §4.4: «Запустить и открыть клиенту». Только после этого клиент получает
// доступ и уведомление.
export const launch = mutation({
  args: { id: v.id('packs') },
  handler: async (ctx, { id }) => {
    const { me, pack } = await requirePack(ctx, id, 'manage')
    if (pack.launchedAt) throw new ConvexError('Проект уже открыт клиенту')
    const issues = await preflight(ctx, pack)
    const errors = issues.filter((i) => i.level === 'error')
    if (errors.length > 0) throw new ConvexError(errors[0].text)

    const stages = await stagesOf(ctx, id)
    // Работа идёт последовательно: открыт первый этап, остальные заблокированы
    // до утверждения предыдущего (§5.2 «Заблокирован»).
    for (let i = 0; i < stages.length; i++) {
      await ctx.db.patch(stages[i]._id, {
        status: i === 0 ? 'in_progress' : 'locked',
        awaiting: i === 0 ? 'franchone' : undefined,
        dueAt: i === 0 && stages[i].endDate ? dayEnd(stages[i].endDate!) : undefined,
        startedAt: i === 0 ? Date.now() : undefined,
      })
    }

    await ctx.db.patch(id, {
      status: 'active',
      launchedAt: Date.now(),
      launchedById: me._id,
    })
    await logPackEvent(ctx, { packId: id, type: 'launched', byId: me._id })

    // §14.1: «проект открыт клиенту» — ключевое уведомление.
    if (pack.clientId) {
      await notifyPack(ctx, [pack.clientId], {
        packId: id,
        kind: 'launched',
        title: 'Ваш проект упаковки франшизы открыт',
        text: `${pack.title}. Кабинет уже доступен — посмотрите, что происходит и что потребуется от вас.`,
        link: '/',
      })
    }
    await notifyPack(ctx, teamOf(pack), {
      packId: id,
      kind: 'launched',
      title: 'Проект запущен',
      text: pack.title,
      link: `/packs/${id}`,
      skip: me._id,
    })
  },
})

// §5.2: пауза останавливает таймеры и требует причину.
export const pause = mutation({
  args: { id: v.id('packs'), reason: v.string() },
  handler: async (ctx, { id, reason }) => {
    const { me, pack } = await requirePack(ctx, id, 'manage')
    if (pack.status !== 'active') throw new ConvexError('Приостановить можно только активный проект')
    if (!reason.trim()) throw new ConvexError('Укажите причину приостановки')

    const stages = await stagesOf(ctx, id)
    for (const s of stages) {
      if (s.status === 'approved' || s.status === 'locked' || s.status === 'paused') continue
      await ctx.db.patch(s._id, { status: 'paused', pausedFrom: s.status })
    }
    await ctx.db.patch(id, {
      status: 'paused',
      pausedAt: Date.now(),
      pausedReason: reason.trim(),
    })
    await logPackEvent(ctx, { packId: id, type: 'paused', byId: me._id, reason: reason.trim() })
    await notifyPack(ctx, [...teamOf(pack), ...(pack.clientId ? [pack.clientId] : [])], {
      packId: id,
      kind: 'paused',
      title: 'Проект приостановлен',
      text: `${pack.title}. Причина: ${reason.trim()}`,
      skip: me._id,
    })
  },
})

export const resume = mutation({
  args: { id: v.id('packs') },
  handler: async (ctx, { id }) => {
    const { me, pack } = await requirePack(ctx, id, 'manage')
    if (pack.status !== 'paused') throw new ConvexError('Проект не на паузе')
    const idleMs = pack.pausedAt ? Date.now() - pack.pausedAt : 0

    const stages = await stagesOf(ctx, id)
    for (const s of stages) {
      if (s.status !== 'paused') continue
      await ctx.db.patch(s._id, {
        status: (s.pausedFrom as Doc<'packStages'>['status']) ?? 'in_progress',
        pausedFrom: undefined,
        // Простой не должен съедать срок стороны: сдвигаем дедлайн ровно на
        // длительность паузы.
        dueAt: s.dueAt ? s.dueAt + idleMs : undefined,
      })
    }
    await ctx.db.patch(id, {
      status: 'active',
      pausedAt: undefined,
      pausedReason: undefined,
      pausedMs: (pack.pausedMs ?? 0) + idleMs,
    })
    await logPackEvent(ctx, {
      packId: id,
      type: 'resumed',
      byId: me._id,
      note: `простой ${Math.round(idleMs / DAY_MS)} дн.`,
    })
    await notifyPack(ctx, [...teamOf(pack), ...(pack.clientId ? [pack.clientId] : [])], {
      packId: id,
      kind: 'resumed',
      title: 'Проект возобновлён',
      text: pack.title,
      skip: me._id,
    })
  },
})

// §13.1, BR-10: после 100% проект не исчезает — он переводится в постоянный
// итоговый кабинет готовой франшизы.
export const finish = mutation({
  args: { id: v.id('packs') },
  handler: async (ctx, { id }) => {
    const { me, pack } = await requirePack(ctx, id, 'manage')
    if (pack.status === 'done') return
    const stages = await stagesOf(ctx, id)
    const progress = progressOf(stages.map(stageLike))
    if (progress < 100) {
      throw new ConvexError(
        `Завершить можно проект со 100% готовности; сейчас утверждено ${progress}%`,
      )
    }
    await ctx.db.patch(id, {
      status: 'done',
      finishedAt: Date.now(),
      hubOpenedAt: Date.now(),
    })
    await logPackEvent(ctx, { packId: id, type: 'finished', byId: me._id })
    await logPackEvent(ctx, { packId: id, type: 'hub', byId: me._id })
    await notifyPack(ctx, [...teamOf(pack), ...(pack.clientId ? [pack.clientId] : [])], {
      packId: id,
      kind: 'finished',
      title: 'Проект завершён',
      text: `${pack.title}. Итоговый кабинет франшизы открыт и останется доступным.`,
      skip: me._id,
    })
  },
})

export const archive = mutation({
  args: { id: v.id('packs'), archived: v.boolean() },
  handler: async (ctx, { id, archived }) => {
    const { me, pack } = await requirePack(ctx, id, 'manage')
    if (me.role !== 'owner') throw new ConvexError('Архивировать проект может только владелец')
    await ctx.db.patch(id, {
      status: archived ? 'archived' : pack.finishedAt ? 'done' : 'active',
    })
    await logPackEvent(ctx, { packId: id, type: archived ? 'archived' : 'reopened', byId: me._id })
  },
})

// Полное удаление — только черновика и только владельцу. Запущенный проект
// архивируется: BR-10 запрещает терять историю.
export const remove = mutation({
  args: { id: v.id('packs') },
  handler: async (ctx, { id }) => {
    const { me, pack } = await requirePack(ctx, id, 'manage')
    if (me.role !== 'owner') throw new ConvexError('Удалить проект может только владелец')
    if (pack.launchedAt) {
      throw new ConvexError('Запущенный проект не удаляется — его архивируют')
    }
    for (const s of await stagesOf(ctx, id)) await ctx.db.delete(s._id)
    for (const m of await ctx.db
      .query('packMaterials')
      .withIndex('by_pack', (q) => q.eq('packId', id))
      .collect()) {
      await ctx.db.delete(m._id)
    }
    for (const vRow of await ctx.db
      .query('packMaterialVersions')
      .withIndex('by_pack', (q) => q.eq('packId', id))
      .collect()) {
      if (vRow.storageId) await ctx.storage.delete(vRow.storageId)
      await ctx.db.delete(vRow._id)
    }
    for (const c of await ctx.db
      .query('packComments')
      .withIndex('by_pack', (q) => q.eq('packId', id))
      .collect()) {
      await ctx.db.delete(c._id)
    }
    for (const e of await ctx.db
      .query('packEvents')
      .withIndex('by_pack', (q) => q.eq('packId', id))
      .collect()) {
      await ctx.db.delete(e._id)
    }
    for (const r of await ctx.db
      .query('packRewards')
      .withIndex('by_pack', (q) => q.eq('packId', id))
      .collect()) {
      await ctx.db.delete(r._id)
    }
    for (const n of await ctx.db
      .query('packNotifications')
      .withIndex('by_pack', (q) => q.eq('packId', id))
      .collect()) {
      await ctx.db.delete(n._id)
    }
    for (const x of await ctx.db
      .query('packPayouts')
      .withIndex('by_pack', (q) => q.eq('packId', id))
      .collect()) {
      await ctx.db.delete(x._id)
    }
    for (const x of await ctx.db
      .query('packMilestones')
      .withIndex('by_pack', (q) => q.eq('packId', id))
      .collect()) {
      await ctx.db.delete(x._id)
    }
    await ctx.db.delete(id)
  },
})

// ——— §14.2: журнал действий ———

export const journal = query({
  args: { id: v.id('packs'), limit: v.optional(v.number()) },
  handler: async (ctx, { id, limit }) => {
    const me = await currentEmployee(ctx)
    if (!me || me.role === 'client') return []
    const pack = await ctx.db.get(id)
    if (!pack || !(await maySeePack(ctx, me, pack))) return []
    const rows = await ctx.db
      .query('packEvents')
      .withIndex('by_pack', (q) => q.eq('packId', id))
      .collect()
    const names = new Map(
      (await ctx.db.query('employees').collect()).map((e) => [e._id as string, e.name]),
    )
    const stages = new Map((await stagesOf(ctx, id)).map((s) => [s._id as string, s.title]))
    return rows
      .sort((a, b) => b.at - a.at)
      .slice(0, limit ?? 200)
      .map((e) => ({
        _id: e._id,
        type: e.type,
        at: e.at,
        by: names.get(e.byId as string) ?? '—',
        stage: e.stageId ? (stages.get(e.stageId as string) ?? null) : null,
        field: e.field ?? null,
        from: e.from ?? null,
        to: e.to ?? null,
        reason: e.reason ?? null,
        note: e.note ?? null,
        financial: e.financial === true,
      }))
  },
})

// ——— §9: панель упаковщика ———

export const packerPanel = query({
  args: {},
  handler: async (ctx) => {
    const me = await currentEmployee(ctx)
    if (!me || me.role === 'client') return null
    const settings = await packSettings(ctx)
    const now = Date.now()
    const t = today()

    const mine = (await ctx.db.query('packs').collect()).filter(
      (p) =>
        p.packerId === me._id ||
        p.createdById === me._id ||
        p.memberIds.some((m) => m === me._id),
    )

    const cards = []
    // §9.1 «Сегодня»
    const dueToday: { packId: Id<'packs'>; pack: string; stage: string; dueAt: number }[] = []
    const returned: { packId: Id<'packs'>; pack: string; stage: string; at: number }[] = []
    const toHandover: { packId: Id<'packs'>; pack: string; stage: string }[] = []
    let newClientComments = 0

    for (const pack of mine) {
      const stages = await stagesOf(ctx, pack._id)
      const summary = summarize(pack, stages, settings.warnHours, now)
      const materials = await ctx.db
        .query('packMaterials')
        .withIndex('by_pack', (q) => q.eq('packId', pack._id))
        .collect()
      const comments = await ctx.db
        .query('packComments')
        .withIndex('by_pack', (q) => q.eq('packId', pack._id))
        .collect()
      const openComments = comments.filter((c) => c.scope === 'client' && !c.resolved)
      newClientComments += openComments.length

      for (const s of stages) {
        if (s.status === 'approved' || s.status === 'locked') continue
        if (s.dueAt && new Date(s.dueAt + 5 * 3600 * 1000).toISOString().slice(0, 10) === t) {
          dueToday.push({ packId: pack._id, pack: pack.title, stage: s.title, dueAt: s.dueAt })
        }
        if (s.status === 'rework') {
          returned.push({
            packId: pack._id,
            pack: pack.title,
            stage: s.title,
            at: s.reworkStartedAt ?? s.dueAt ?? now,
          })
        }
        if (s.status === 'ready') {
          toHandover.push({ packId: pack._id, pack: pack.title, stage: s.title })
        }
      }

      cards.push({
        _id: pack._id,
        title: pack.title,
        status: pack.status,
        client: await person(ctx, pack.clientId),
        currentStage: summary.currentStage,
        progress: summary.progress,
        health: summary.health.health,
        healthReason: summary.health.reason,
        side: summary.health.side,
        nextDueAt: summary.health.nextDueAt,
        plannedFinish: summary.plannedFinish,
        openComments: openComments.length,
        reworkMaterials: materials.filter((m) => m.status === 'rework').length,
        // §9.2: проектный KPI в процентах, полное и накопленное вознаграждение.
        kpi: summary.progress,
        reward: packerReward(pack.price, pack.packerPercent),
        accrued: accruedReward(pack.price, pack.packerPercent, summary.progress),
      })
    }

    // §9.1: задачи и встречи подтягиваются из существующих модулей ERP.
    const tasks = (await ctx.db
      .query('tasks')
      .withIndex('by_assignee', (q) => q.eq('assigneeId', me._id))
      .collect()).filter((x) => x.status !== 'done')
    const meetings = (await ctx.db.query('meetings').collect()).filter(
      (m) =>
        (m.status ?? 'planned') === 'planned' &&
        m.date >= t &&
        (m.createdById === me._id || m.participantIds.some((p) => p === me._id)),
    )
    const notifications = (await ctx.db
      .query('packNotifications')
      .withIndex('by_employee', (q) => q.eq('employeeId', me._id))
      .collect())
      .filter((n) => !n.readAt)
      .sort((a, b) => b.at - a.at)
      .slice(0, 20)

    return {
      today: t,
      cards: cards.sort((a, b) => {
        const rank = { red: 0, yellow: 1, blue: 2, purple: 3, green: 4, grey: 5 } as Record<string, number>
        return (rank[a.health] ?? 9) - (rank[b.health] ?? 9)
      }),
      todayBlock: {
        tasksToday: tasks.filter((x) => x.deadline === t).length,
        tasksOverdue: tasks.filter((x) => x.deadline && x.deadline < t).length,
        meetingsToday: meetings.filter((m) => m.date === t).length,
        meetingsSoon: meetings.filter((m) => m.date > t).slice(0, 5).map((m) => ({
          _id: m._id,
          title: m.title,
          date: m.date,
          time: m.time,
        })),
        stagesDueToday: dueToday,
        returnedStages: returned,
        toHandover,
        newClientComments,
      },
      notifications: notifications.map((n) => ({
        _id: n._id,
        packId: n.packId,
        kind: n.kind,
        title: n.title,
        text: n.text ?? null,
        link: n.link ?? null,
        at: n.at,
      })),
    }
  },
})

// ——— §7.4: агрегированный KPI упаковщика ———

export const kpi = query({
  args: {
    employeeId: v.optional(v.id('employees')),
    from: v.optional(v.string()),
    to: v.optional(v.string()),
  },
  handler: async (ctx, { employeeId, from, to }) => {
    const me = await currentEmployee(ctx)
    if (!me || me.role === 'client') return null
    const who = employeeId ?? me._id
    // Чужой KPI виден владельцу и обладателю права «Упаковки: Все».
    if (who !== me._id && me.role !== 'owner' && (await viewScope(ctx, 'packs')) !== 'all') {
      return null
    }

    const settings = await packSettings(ctx)
    const fromMs = from ? Date.parse(`${from}T00:00:00${TZ}`) : null
    const toMs = to ? dayEnd(to) : null
    const inPeriod = (at: number | undefined) =>
      !!at && (!fromMs || at >= fromMs) && (!toMs || at <= toMs)

    const packs = (await ctx.db.query('packs').collect()).filter((p) => p.packerId === who)
    let rewardPlanned = 0
    let accrued = 0
    let paid = 0
    let accruedInPeriod = 0
    let approvedStages = 0
    let approvedInPeriod = 0
    let onTimeStages = 0
    let inWork = 0
    let onReview = 0
    let returns = 0
    let reworkMsTotal = 0
    let reworkCount = 0
    const progressList: number[] = []
    const rows = []
    // §7.4: динамика KPI по месяцам — по датам утверждения этапов.
    const byMonth = new Map<string, number>()

    for (const pack of packs) {
      const stages = await stagesOf(ctx, pack._id)
      const summary = summarize(pack, stages, settings.warnHours)
      const W = packerReward(pack.price, pack.packerPercent)
      const A = accruedReward(pack.price, pack.packerPercent, summary.progress)
      if (pack.status === 'active' || pack.status === 'paused') rewardPlanned += W
      accrued += A
      const packPaid = await paidFor(ctx, pack._id)
      paid += packPaid
      progressList.push(summary.progress)

      for (const s of stages) {
        if (s.kind !== 'main') continue
        if (s.status === 'approved') {
          approvedStages += 1
          if (s.approvedOnTime) onTimeStages += 1
          if (inPeriod(s.approvedAt)) {
            approvedInPeriod += 1
            accruedInPeriod += accruedReward(pack.price, pack.packerPercent, s.weight)
          }
          if (s.approvedAt) {
            const m = new Date(s.approvedAt + 5 * 3600 * 1000).toISOString().slice(0, 7)
            byMonth.set(
              m,
              (byMonth.get(m) ?? 0) + accruedReward(pack.price, pack.packerPercent, s.weight),
            )
          }
        }
        if (s.status === 'in_progress' || s.status === 'ready' || s.status === 'rework') inWork += 1
        if (s.status === 'review' || s.status === 'rereview') onReview += 1
        returns += s.returnCount
        if (s.reworkMs) {
          reworkMsTotal += s.reworkMs
          reworkCount += 1
        }
      }

      rows.push({
        _id: pack._id,
        title: pack.title,
        status: pack.status,
        client: await person(ctx, pack.clientId),
        kpi: summary.progress,
        reward: W,
        accrued: A,
        paid: packPaid,
        left: W - A,
        approvedStages: summary.approvedStages,
        mainStages: summary.mainStages,
        health: summary.health.health,
      })
    }

    return {
      employeeId: who,
      person: await person(ctx, who),
      rewardPlanned,
      accrued,
      // §7.4: «выплачено, если в ERP используется статус выплаты» и остаток.
      paid,
      unpaid: accrued - paid,
      accruedInPeriod,
      left: rewardPlanned - accrued,
      approvedStages,
      approvedInPeriod,
      avgProgress: progressList.length
        ? Math.round(progressList.reduce((s, x) => s + x, 0) / progressList.length)
        : 0,
      onTimeRate: approvedStages ? onTimeStages / approvedStages : 0,
      avgReworkDays: reworkCount ? reworkMsTotal / reworkCount / DAY_MS : 0,
      returns,
      inWork,
      onReview,
      rows: rows.sort((a, b) => b.accrued - a.accrued),
      months: [...byMonth.entries()].sort().map(([month, sum]) => ({ month, sum })),
    }
  },
})

// Список упаковщиков с их агрегированным KPI — для владельца (§8.1).
export const packersKpi = query({
  args: {},
  handler: async (ctx) => {
    const me = await currentEmployee(ctx)
    if (!me || me.role !== 'owner') return []
    const settings = await packSettings(ctx)
    const packs = await ctx.db.query('packs').collect()
    const byPacker = new Map<
      string,
      { reward: number; accrued: number; paid: number; active: number; done: number }
    >()
    for (const pack of packs) {
      const stages = await stagesOf(ctx, pack._id)
      const progress = progressOf(stages.map(stageLike))
      const key = pack.packerId as string
      const cur = byPacker.get(key) ?? { reward: 0, accrued: 0, paid: 0, active: 0, done: 0 }
      if (pack.status === 'active' || pack.status === 'paused') {
        cur.reward += packerReward(pack.price, pack.packerPercent)
        cur.active += 1
      }
      if (pack.status === 'done') cur.done += 1
      cur.accrued += accruedReward(pack.price, pack.packerPercent, progress)
      cur.paid += await paidFor(ctx, pack._id)
      byPacker.set(key, cur)
    }
    void settings
    const out = []
    for (const [id, agg] of byPacker) {
      const p = await person(ctx, id as Id<'employees'>)
      if (p) out.push({ ...p, ...agg })
    }
    return out.sort((a, b) => b.accrued - a.accrued)
  },
})

// ——— Клиенты модуля ———

// Заказчики упаковки. Отдельный список: в «Команде» их нет и быть не должно.
export const clients = query({
  args: {},
  handler: async (ctx) => {
    const me = await currentEmployee(ctx)
    if (!me || me.role === 'client') return []
    const scope = await viewScope(ctx, 'packs')
    if (me.role !== 'owner' && scope === 'none') return []
    const packs = await ctx.db.query('packs').collect()
    const rows = (await ctx.db.query('employees').collect()).filter((e) => e.role === 'client')
    return rows
      .map((e) => {
        const mine = packs.filter((p) => p.clientId === e._id)
        return {
          _id: e._id,
          name: e.name,
          email: e.email,
          phone: e.phone,
          initials: e.initials,
          avatarColor: e.avatarColor,
          status: e.status,
          company: e.positionLabel,
          packs: mine.length,
          lastLoginAt: e.lastLoginAt ?? null,
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  },
})

// Заводим клиенту доступ в кабинет. Он входит тем же кодом на почту, что и
// сотрудник, — отдельной системы паролей в ERP нет.
export const createClient = mutation({
  args: {
    name: v.string(),
    email: v.string(),
    phone: v.optional(v.string()),
    company: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const me = await requireEmployee(ctx)
    if (me.role !== 'owner' && !(await mayDo(ctx, me, 'create'))) {
      throw new ConvexError('Нет права заводить клиентов')
    }
    const name = args.name.trim()
    const email = args.email.trim().toLowerCase()
    if (!name) throw new ConvexError('Укажите имя клиента')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ConvexError('Некорректный email')
    const clash = await ctx.db
      .query('employees')
      .withIndex('by_email', (q) => q.eq('email', email))
      .first()
    if (clash) throw new ConvexError('Пользователь с таким email уже есть')

    const parts = name.split(/\s+/)
    const initials = ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '—'
    let h = 0
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
    const palette = ['#057269', '#0a857a', '#20915a', '#4db3a6', '#3a2e28', '#5f646c', '#c05621', '#2563eb']

    return await ctx.db.insert('employees', {
      name,
      role: 'client',
      // Клиент не занимает должность в компании: слот position хранит
      // технический слаг, а видимая подпись — название его бизнеса.
      position: 'client',
      positionLabel: args.company?.trim() || 'Клиент',
      department: '',
      salary: 0,
      email,
      phone: args.phone?.trim() ?? '',
      avatarColor: palette[h % palette.length],
      initials,
      status: 'active',
      hiredAt: today(),
    })
  },
})

export const updateClient = mutation({
  args: {
    id: v.id('employees'),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    company: v.optional(v.string()),
    status: v.optional(v.union(v.literal('active'), v.literal('archived'))),
  },
  handler: async (ctx, { id, ...patch }) => {
    const me = await requireEmployee(ctx)
    if (me.role !== 'owner' && !(await mayDo(ctx, me, 'create'))) {
      throw new ConvexError('Нет права менять клиентов')
    }
    const target = await ctx.db.get(id)
    if (!target || target.role !== 'client') throw new ConvexError('Клиент не найден')
    const next: Record<string, unknown> = {}
    if (patch.name !== undefined) {
      const name = patch.name.trim()
      if (!name) throw new ConvexError('Укажите имя клиента')
      const parts = name.split(/\s+/)
      next.name = name
      next.initials = ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '—'
    }
    if (patch.email !== undefined) {
      const email = patch.email.trim().toLowerCase()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ConvexError('Некорректный email')
      const clash = await ctx.db
        .query('employees')
        .withIndex('by_email', (q) => q.eq('email', email))
        .first()
      if (clash && clash._id !== id) throw new ConvexError('Пользователь с таким email уже есть')
      next.email = email
    }
    if (patch.phone !== undefined) next.phone = patch.phone.trim()
    if (patch.company !== undefined) next.positionLabel = patch.company.trim() || 'Клиент'
    if (patch.status !== undefined) next.status = patch.status
    await ctx.db.patch(id, next)
  },
})

// Шаблоны — источник структуры этапов для нового проекта (§4.1).
export const templates = query({
  args: {},
  handler: async (ctx) => {
    const me = await currentEmployee(ctx)
    if (!me || me.role === 'client') return []
    const out = []
    for (const p of await ctx.db.query('packs').collect()) {
      if (!(await maySeePack(ctx, me, p))) continue
      const stages = await stagesOf(ctx, p._id)
      out.push({
        _id: p._id,
        title: p.title,
        isTemplate: p.isTemplate === true,
        stages: stages.length,
        weightSum: weightSum(stages.map(stageLike)),
      })
    }
    // Явные шаблоны — первыми, дальше обычные проекты.
    return out.sort((a, b) => Number(b.isTemplate) - Number(a.isTemplate) || a.title.localeCompare(b.title, 'ru'))
  },
})

// ——— Лента уведомлений внутри ERP (§14.1) ———

export const notifications = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const me = await currentEmployee(ctx)
    if (!me) return []
    const rows = await ctx.db
      .query('packNotifications')
      .withIndex('by_employee', (q) => q.eq('employeeId', me._id))
      .collect()
    return rows
      .sort((a, b) => b.at - a.at)
      .slice(0, limit ?? 50)
      .map((n) => ({
        _id: n._id,
        packId: n.packId,
        kind: n.kind,
        title: n.title,
        text: n.text ?? null,
        link: n.link ?? null,
        at: n.at,
        read: !!n.readAt,
      }))
  },
})

export const markRead = mutation({
  args: { id: v.optional(v.id('packNotifications')) },
  handler: async (ctx, { id }) => {
    const me = await requireEmployee(ctx)
    if (id) {
      const row = await ctx.db.get(id)
      if (row && row.employeeId === me._id && !row.readAt) {
        await ctx.db.patch(id, { readAt: Date.now() })
      }
      return
    }
    const rows = await ctx.db
      .query('packNotifications')
      .withIndex('by_employee', (q) => q.eq('employeeId', me._id))
      .collect()
    for (const r of rows) if (!r.readAt) await ctx.db.patch(r._id, { readAt: Date.now() })
  },
})

// ——— §7.3, §7.4: выплаты ———

export const payouts = query({
  args: { packId: v.id('packs') },
  handler: async (ctx, { packId }) => {
    const me = await currentEmployee(ctx)
    if (!me || me.role === 'client') return null
    const pack = await ctx.db.get(packId)
    if (!pack || !(await maySeePack(ctx, me, pack))) return null
    // Выплаты — внутренние деньги: их видит владелец и сам упаковщик проекта.
    if (!mayManagePack(me, pack)) return null
    const names = new Map(
      (await ctx.db.query('employees').collect()).map((e) => [e._id as string, e.name]),
    )
    const stages = await stagesOf(ctx, packId)
    const progress = progressOf(stages.map(stageLike))
    const rows = await ctx.db
      .query('packPayouts')
      .withIndex('by_pack', (q) => q.eq('packId', packId))
      .collect()
    const paid = rows.reduce((sum, r) => sum + r.amount, 0)
    const accrued = accruedReward(pack.price, pack.packerPercent, progress)
    return {
      reward: packerReward(pack.price, pack.packerPercent),
      accrued,
      paid,
      // §7.3: плановое, начисленное и выплаченное — три разные величины.
      unpaid: accrued - paid,
      canEdit: me.role === 'owner',
      rows: rows
        .sort((a, b) => b.paidAt.localeCompare(a.paidAt))
        .map((r) => ({
          _id: r._id,
          amount: r.amount,
          paidAt: r.paidAt,
          note: r.note ?? null,
          by: names.get(r.byId as string) ?? '—',
          at: r.at,
        })),
    }
  },
})

export const addPayout = mutation({
  args: {
    packId: v.id('packs'),
    amount: v.number(),
    paidAt: v.string(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { me, pack } = await requirePack(ctx, args.packId, 'manage')
    // Факт выплаты фиксирует владелец: упаковщик не отмечает выплату сам себе.
    if (me.role !== 'owner') throw new ConvexError('Отметить выплату может только владелец')
    if (!(args.amount > 0)) throw new ConvexError('Сумма выплаты должна быть больше нуля')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.paidAt)) throw new ConvexError('Укажите дату выплаты')

    await ctx.db.insert('packPayouts', {
      packId: args.packId,
      amount: Math.round(args.amount),
      paidAt: args.paidAt,
      note: args.note?.trim() || undefined,
      byId: me._id,
      at: Date.now(),
    })
    await logPackEvent(ctx, {
      packId: args.packId,
      type: 'payout',
      byId: me._id,
      field: 'выплата',
      to: `${Math.round(args.amount)} ₸ · ${args.paidAt}`,
      note: args.note?.trim() || undefined,
      financial: true,
    })
    await notifyPack(ctx, [pack.packerId], {
      packId: args.packId,
      kind: 'payout',
      title: 'Выплата по проекту',
      text: `${pack.title}: ${Math.round(args.amount)} ₸ от ${args.paidAt}`,
      link: `/packs/${args.packId}`,
      skip: me._id,
    })
  },
})

export const removePayout = mutation({
  args: { id: v.id('packPayouts') },
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id)
    if (!row) return
    const { me } = await requirePack(ctx, row.packId, 'manage')
    if (me.role !== 'owner') throw new ConvexError('Удалить выплату может только владелец')
    await ctx.db.delete(id)
    await logPackEvent(ctx, {
      packId: row.packId,
      type: 'payout',
      byId: me._id,
      field: 'выплата отменена',
      from: `${row.amount} ₸ · ${row.paidAt}`,
      financial: true,
    })
  },
})

// ——— §6.1, §6.2: платёжные и иные контрольные даты ———

export const milestones = query({
  args: { packId: v.id('packs') },
  handler: async (ctx, { packId }) => {
    const me = await currentEmployee(ctx)
    if (!me || me.role === 'client') return null
    const pack = await ctx.db.get(packId)
    if (!pack || !(await maySeePack(ctx, me, pack))) return null
    return (
      await ctx.db
        .query('packMilestones')
        .withIndex('by_pack', (q) => q.eq('packId', packId))
        .collect()
    )
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((m) => ({
        _id: m._id,
        title: m.title,
        date: m.date,
        kind: m.kind,
        amount: m.amount ?? null,
        note: m.note ?? null,
        clientVisible: m.clientVisible,
        done: m.done,
      }))
  },
})

export const addMilestone = mutation({
  args: {
    packId: v.id('packs'),
    title: v.string(),
    date: v.string(),
    kind: v.union(v.literal('payment'), v.literal('control')),
    amount: v.optional(v.number()),
    note: v.optional(v.string()),
    clientVisible: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { me } = await requirePack(ctx, args.packId, 'manage')
    const title = args.title.trim()
    if (!title) throw new ConvexError('Укажите название контрольной точки')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) throw new ConvexError('Укажите дату')
    const id = await ctx.db.insert('packMilestones', {
      packId: args.packId,
      title,
      date: args.date,
      kind: args.kind,
      amount: args.amount && args.amount > 0 ? Math.round(args.amount) : undefined,
      note: args.note?.trim() || undefined,
      clientVisible: args.clientVisible !== false,
      done: false,
      createdById: me._id,
      createdAt: Date.now(),
    })
    await logPackEvent(ctx, {
      packId: args.packId,
      type: 'milestone',
      byId: me._id,
      field: title,
      to: args.date,
      // Сумму платежа держим за финансовой меткой — клиенту такие строки
      // журнала не отдаются.
      financial: !!args.amount,
    })
    return id
  },
})

export const updateMilestone = mutation({
  args: {
    id: v.id('packMilestones'),
    title: v.optional(v.string()),
    date: v.optional(v.string()),
    amount: v.optional(v.number()),
    note: v.optional(v.string()),
    clientVisible: v.optional(v.boolean()),
    done: v.optional(v.boolean()),
  },
  handler: async (ctx, { id, ...patch }) => {
    const row = await ctx.db.get(id)
    if (!row) throw new ConvexError('Контрольная точка не найдена')
    const { me } = await requirePack(ctx, row.packId, 'manage')
    const next: Record<string, unknown> = {}
    if (patch.title !== undefined) {
      const t = patch.title.trim()
      if (!t) throw new ConvexError('Название не может быть пустым')
      next.title = t
    }
    if (patch.date !== undefined) next.date = patch.date
    if (patch.amount !== undefined) next.amount = patch.amount > 0 ? Math.round(patch.amount) : undefined
    if (patch.note !== undefined) next.note = patch.note.trim() || undefined
    if (patch.clientVisible !== undefined) next.clientVisible = patch.clientVisible
    if (patch.done !== undefined) {
      next.done = patch.done
      next.doneAt = patch.done ? Date.now() : undefined
    }
    await ctx.db.patch(id, next)
    // §6.2: перенос контрольной даты сохраняет старое и новое значение.
    if (patch.date !== undefined && patch.date !== row.date) {
      await logPackEvent(ctx, {
        packId: row.packId,
        type: 'milestone',
        byId: me._id,
        field: row.title,
        from: row.date,
        to: patch.date,
      })
    }
  },
})

export const removeMilestone = mutation({
  args: { id: v.id('packMilestones') },
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id)
    if (!row) return
    const { me } = await requirePack(ctx, row.packId, 'manage')
    await ctx.db.delete(id)
    await logPackEvent(ctx, {
      packId: row.packId,
      type: 'milestone',
      byId: me._id,
      field: row.title,
      to: 'удалена',
    })
  },
})

// Ссылка загрузки файла — общая для материалов и вложений комментариев.
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireEmployee(ctx)
    return await ctx.storage.generateUploadUrl()
  },
})
