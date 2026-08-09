// Модуль упаковки — награды, контент, постпроектные сценарии и аналитика
// (ТЗ Упаковка §12, §13, §14.3).
//
// §1.2 прямо ограничивает первую итерацию: конкретные темы тестов, содержание
// видеороликов, тексты статей, состав наград и точные постпроектные цепочки
// определяются позднее. Требуется функциональная возможность создавать,
// публиковать, назначать и отключать такие материалы и сценарии — она здесь.

import { query, mutation, internalMutation } from './_generated/server'
import { v, ConvexError } from 'convex/values'
import type { MutationCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { currentEmployee, requireEmployee } from './lib'
import { viewScope } from './permissions'
import { notifyMeetingEvent } from './telegramFlow'
import { DAY_MS, youtubeId } from './packModel'
import {
  dayEnd,
  logPackEvent,
  maySeePack,
  notifyPack,
  packSettings,
  requirePack,
  stagesOf,
  teamOf,
} from './packs'

async function requireOwner(ctx: MutationCtx) {
  const me = await requireEmployee(ctx)
  // §3: настройка наград и контента — только владелец.
  if (me.role !== 'owner') throw new ConvexError('Настраивать награды и контент может только владелец')
  return me
}

// ——— §12: награды ———

export const rewards = query({
  args: { packId: v.id('packs') },
  handler: async (ctx, { packId }) => {
    const me = await currentEmployee(ctx)
    if (!me || me.role === 'client') return []
    const pack = await ctx.db.get(packId)
    if (!pack || !(await maySeePack(ctx, me, pack))) return []
    const stageTitle = new Map((await stagesOf(ctx, packId)).map((s) => [s._id as string, s.title]))
    return (
      await ctx.db
        .query('packRewards')
        .withIndex('by_pack', (q) => q.eq('packId', packId))
        .collect()
    )
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((r) => ({
        _id: r._id,
        title: r.title,
        description: r.description ?? null,
        imageUrl: r.imageUrl ?? null,
        condition: r.condition ?? null,
        stageId: r.stageId ?? null,
        stage: r.stageId ? (stageTitle.get(r.stageId as string) ?? null) : null,
        status: r.status,
        dueAt: r.dueAt ?? null,
        earnedAt: r.earnedAt ?? null,
        grantedAt: r.grantedAt ?? null,
      }))
  },
})

export const createReward = mutation({
  args: {
    packId: v.id('packs'),
    stageId: v.optional(v.id('packStages')),
    title: v.string(),
    description: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    condition: v.optional(v.string()),
    // §12: «срок выполнения условия». Пусто — срок берётся от этапа: столько,
    // сколько у клиента есть на ответ (§5.4).
    dueDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const me = await requireOwner(ctx)
    const pack = await ctx.db.get(args.packId)
    if (!pack) throw new ConvexError('Упаковка не найдена')
    const title = args.title.trim()
    if (!title) throw new ConvexError('Укажите название награды')

    // Награда за уже переданный этап сразу доступна — иначе она бы никогда
    // не открылась (§12: статус «доступна» наступает с передачей).
    const stage = args.stageId ? await ctx.db.get(args.stageId) : null
    const alreadyOpen = stage && (stage.handoverCount ?? 0) > 0 && stage.status !== 'approved'
    const manualDue = args.dueDate ? dayEnd(args.dueDate) : undefined

    const id = await ctx.db.insert('packRewards', {
      packId: args.packId,
      stageId: args.stageId,
      title,
      description: args.description?.trim() || undefined,
      imageUrl: args.imageUrl?.trim() || undefined,
      condition: args.condition?.trim() || undefined,
      status: alreadyOpen ? 'available' : 'locked',
      dueAt: manualDue ?? (alreadyOpen ? (stage?.dueAt ?? undefined) : undefined),
      createdById: me._id,
      createdAt: Date.now(),
    })
    await logPackEvent(ctx, {
      packId: args.packId,
      stageId: args.stageId,
      type: 'reward',
      byId: me._id,
      field: title,
      to: 'создана',
    })
    return id
  },
})

export const updateReward = mutation({
  args: {
    id: v.id('packRewards'),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    condition: v.optional(v.string()),
    dueDate: v.optional(v.string()),
    stageId: v.optional(v.id('packStages')),
    // §12: ручное решение владельца в спорной ситуации.
    status: v.optional(
      v.union(
        v.literal('locked'),
        v.literal('available'),
        v.literal('earned'),
        v.literal('granted'),
        v.literal('missed'),
        v.literal('restored'),
      ),
    ),
  },
  handler: async (ctx, { id, ...patch }) => {
    const me = await requireOwner(ctx)
    const reward = await ctx.db.get(id)
    if (!reward) throw new ConvexError('Награда не найдена')
    const next: Record<string, unknown> = {}
    if (patch.title !== undefined) {
      const t = patch.title.trim()
      if (!t) throw new ConvexError('Название награды не может быть пустым')
      next.title = t
    }
    if (patch.description !== undefined) next.description = patch.description.trim() || undefined
    if (patch.imageUrl !== undefined) next.imageUrl = patch.imageUrl.trim() || undefined
    if (patch.condition !== undefined) next.condition = patch.condition.trim() || undefined
    if (patch.dueDate !== undefined) next.dueAt = patch.dueDate ? dayEnd(patch.dueDate) : undefined
    if (patch.stageId !== undefined) next.stageId = patch.stageId
    if (patch.status !== undefined && patch.status !== reward.status) {
      next.status = patch.status
      next.decidedById = me._id
      if (patch.status === 'granted') next.grantedAt = Date.now()
      if (patch.status === 'earned' || patch.status === 'restored') next.earnedAt = Date.now()
      await logPackEvent(ctx, {
        packId: reward.packId,
        stageId: reward.stageId,
        type: 'reward',
        byId: me._id,
        field: reward.title,
        from: reward.status,
        to: patch.status,
      })
      // §14.1: «получена награда».
      const pack = await ctx.db.get(reward.packId)
      if (pack?.clientId && ['earned', 'granted', 'restored'].includes(patch.status)) {
        await notifyPack(ctx, [pack.clientId], {
          packId: reward.packId,
          kind: 'reward',
          title: patch.status === 'granted' ? 'Награда выдана' : 'Награда доступна',
          text: reward.title,
          link: '/rewards',
        })
      }
    }
    await ctx.db.patch(id, next)
  },
})

export const removeReward = mutation({
  args: { id: v.id('packRewards') },
  handler: async (ctx, { id }) => {
    const me = await requireOwner(ctx)
    const reward = await ctx.db.get(id)
    if (!reward) return
    await ctx.db.delete(id)
    await logPackEvent(ctx, {
      packId: reward.packId,
      type: 'reward',
      byId: me._id,
      field: reward.title,
      to: 'удалена',
    })
  },
})

// ——— §13.3: контентный функционал ———

export const contentList = query({
  args: {},
  handler: async (ctx) => {
    const me = await currentEmployee(ctx)
    if (!me || me.role === 'client') return []
    if (me.role !== 'owner' && (await viewScope(ctx, 'packs')) === 'none') return []
    const packs = new Map((await ctx.db.query('packs').collect()).map((p) => [p._id as string, p.title]))
    return (await ctx.db.query('packContent').collect())
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((c) => ({
        _id: c._id,
        title: c.title,
        kind: c.kind,
        body: c.body ?? null,
        url: c.url ?? null,
        summary: c.summary ?? null,
        coverId: c.coverId ?? null,
        questions: c.questions ?? [],
        stageOrder: c.stageOrder ?? null,
        published: c.published,
        availability: c.availability,
        afterStageOrder: c.afterStageOrder ?? null,
        packIds: c.packIds ?? [],
        packTitles: (c.packIds ?? []).map((p) => packs.get(p as string) ?? '—'),
        createdAt: c.createdAt,
      }))
  },
})

export const createContent = mutation({
  args: {
    title: v.string(),
    kind: v.union(
      v.literal('article'),
      v.literal('video'),
      v.literal('test'),
      v.literal('guide'),
      v.literal('checklist'),
      v.literal('template'),
      v.literal('offer'),
    ),
    body: v.optional(v.string()),
    url: v.optional(v.string()),
    // §8.1: краткое описание и обложка теста или статьи.
    summary: v.optional(v.string()),
    coverId: v.optional(v.id('_storage')),
    questions: v.optional(v.array(
        v.object({
          text: v.string(),
          imageId: v.optional(v.id('_storage')),
          multiple: v.boolean(),
          options: v.array(
            v.object({
              text: v.string(),
              imageId: v.optional(v.id('_storage')),
              correct: v.boolean(),
            }),
          ),
        }),
      )),
    availability: v.union(
      v.literal('always'),
      v.literal('after_stage'),
      v.literal('post_project'),
    ),
    afterStageOrder: v.optional(v.number()),
    // §8.1: тест можно назначить конкретному проекту или этапу.
    stageOrder: v.optional(v.number()),
    packIds: v.optional(v.array(v.id('packs'))),
    published: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const me = await requireOwner(ctx)
    const title = args.title.trim()
    if (!title) throw new ConvexError('Укажите название материала')
    if (args.kind === 'video' && !youtubeId(args.url)) {
      throw new ConvexError('Для видео нужна ссылка YouTube — ролик проигрывается внутри ERP')
    }
    return await ctx.db.insert('packContent', {
      title,
      kind: args.kind,
      body: args.body?.trim() || undefined,
      url: args.url?.trim() || undefined,
      summary: args.summary?.trim() || undefined,
      coverId: args.coverId,
      questions: args.questions?.length ? args.questions : undefined,
      published: args.published !== false,
      availability: args.availability,
      afterStageOrder: args.availability === 'after_stage' ? (args.afterStageOrder ?? 1) : undefined,
      stageOrder: args.stageOrder,
      packIds: args.packIds?.length ? args.packIds : undefined,
      createdById: me._id,
      createdAt: Date.now(),
    })
  },
})

export const updateContent = mutation({
  args: {
    id: v.id('packContent'),
    title: v.optional(v.string()),
    body: v.optional(v.string()),
    url: v.optional(v.string()),
    summary: v.optional(v.string()),
    coverId: v.optional(v.id('_storage')),
    // Отсутствие coverId значит «не трогали», поэтому снятие обложки нужно
    // передавать отдельным флагом — иначе убрать её при правке нельзя.
    clearCover: v.optional(v.boolean()),
    questions: v.optional(v.array(
        v.object({
          text: v.string(),
          imageId: v.optional(v.id('_storage')),
          multiple: v.boolean(),
          options: v.array(
            v.object({
              text: v.string(),
              imageId: v.optional(v.id('_storage')),
              correct: v.boolean(),
            }),
          ),
        }),
      )),
    published: v.optional(v.boolean()),
    availability: v.optional(
      v.union(v.literal('always'), v.literal('after_stage'), v.literal('post_project')),
    ),
    afterStageOrder: v.optional(v.number()),
    stageOrder: v.optional(v.number()),
    packIds: v.optional(v.array(v.id('packs'))),
  },
  handler: async (ctx, { id, ...patch }) => {
    await requireOwner(ctx)
    const row = await ctx.db.get(id)
    if (!row) throw new ConvexError('Материал не найден')
    const next: Record<string, unknown> = {}
    if (patch.summary !== undefined) next.summary = patch.summary.trim() || undefined
    // §8.1: обложку можно заменить или удалить до публикации.
    if (patch.clearCover) next.coverId = undefined
    else if (patch.coverId !== undefined) next.coverId = patch.coverId
    if (patch.questions !== undefined) next.questions = patch.questions.length ? patch.questions : undefined
    if (patch.stageOrder !== undefined) next.stageOrder = patch.stageOrder
    if (patch.title !== undefined) {
      const t = patch.title.trim()
      if (!t) throw new ConvexError('Название не может быть пустым')
      next.title = t
    }
    if (patch.body !== undefined) next.body = patch.body.trim() || undefined
    if (patch.url !== undefined) next.url = patch.url.trim() || undefined
    if (patch.published !== undefined) next.published = patch.published
    if (patch.availability !== undefined) next.availability = patch.availability
    if (patch.afterStageOrder !== undefined) next.afterStageOrder = patch.afterStageOrder
    if (patch.packIds !== undefined) next.packIds = patch.packIds.length ? patch.packIds : undefined
    await ctx.db.patch(id, next)
  },
})

export const removeContent = mutation({
  args: { id: v.id('packContent') },
  handler: async (ctx, { id }) => {
    await requireOwner(ctx)
    // Сценарии, которые ссылались на материал, останутся без него — обнуляем
    // ссылку, чтобы сценарий не отправлял пустоту.
    for (const s of await ctx.db.query('packScenarios').collect()) {
      if (s.contentId === id) await ctx.db.patch(s._id, { contentId: undefined })
    }
    await ctx.db.delete(id)
  },
})

// §8.1: изображения обложки, вопросов и вариантов ответа. Загружаются в
// хранилище ERP и подчиняются его общим лимитам.
export const contentUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireOwner(ctx)
    return await ctx.storage.generateUploadUrl()
  },
})

// ——— §13.2: постпроектные сценарии ———

export const scenarios = query({
  args: {},
  handler: async (ctx) => {
    const me = await currentEmployee(ctx)
    if (!me || me.role === 'client') return []
    if (me.role !== 'owner' && (await viewScope(ctx, 'packs')) === 'none') return []
    const content = new Map(
      (await ctx.db.query('packContent').collect()).map((c) => [c._id as string, c.title]),
    )
    const runs = await ctx.db.query('packScenarioRuns').collect()
    return (await ctx.db.query('packScenarios').collect())
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((s) => ({
        _id: s._id,
        title: s.title,
        trigger: s.trigger,
        triggerDays: s.triggerDays ?? null,
        action: s.action,
        contentId: s.contentId ?? null,
        contentTitle: s.contentId ? (content.get(s.contentId as string) ?? null) : null,
        message: s.message ?? null,
        active: s.active,
        packIds: s.packIds ?? [],
        runs: runs.filter((r) => r.scenarioId === s._id).length,
        lastRunAt: runs
          .filter((r) => r.scenarioId === s._id)
          .reduce((max, r) => Math.max(max, r.at), 0) || null,
      }))
  },
})

export const createScenario = mutation({
  args: {
    title: v.string(),
    trigger: v.union(
      v.literal('days_after_finish'),
      v.literal('client_action'),
      v.literal('no_activity'),
      v.literal('test_result'),
      v.literal('manual'),
    ),
    triggerDays: v.optional(v.number()),
    action: v.union(
      v.literal('notify'),
      v.literal('material'),
      v.literal('recommendation'),
      v.literal('test'),
      v.literal('invite'),
      v.literal('offer'),
    ),
    contentId: v.optional(v.id('packContent')),
    message: v.optional(v.string()),
    packIds: v.optional(v.array(v.id('packs'))),
    active: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const me = await requireOwner(ctx)
    const title = args.title.trim()
    if (!title) throw new ConvexError('Укажите название сценария')
    if (
      (args.trigger === 'days_after_finish' || args.trigger === 'no_activity') &&
      !(args.triggerDays && args.triggerDays > 0)
    ) {
      throw new ConvexError('Укажите количество дней для запуска сценария')
    }
    return await ctx.db.insert('packScenarios', {
      title,
      trigger: args.trigger,
      triggerDays: args.triggerDays,
      action: args.action,
      contentId: args.contentId,
      message: args.message?.trim() || undefined,
      active: args.active !== false,
      packIds: args.packIds?.length ? args.packIds : undefined,
      createdById: me._id,
      createdAt: Date.now(),
    })
  },
})

export const updateScenario = mutation({
  args: {
    id: v.id('packScenarios'),
    title: v.optional(v.string()),
    triggerDays: v.optional(v.number()),
    message: v.optional(v.string()),
    contentId: v.optional(v.id('packContent')),
    packIds: v.optional(v.array(v.id('packs'))),
    // §13.2: остановка, редактирование и индивидуальное назначение сценария.
    active: v.optional(v.boolean()),
  },
  handler: async (ctx, { id, ...patch }) => {
    await requireOwner(ctx)
    const row = await ctx.db.get(id)
    if (!row) throw new ConvexError('Сценарий не найден')
    const next: Record<string, unknown> = {}
    if (patch.title !== undefined) {
      const t = patch.title.trim()
      if (!t) throw new ConvexError('Название не может быть пустым')
      next.title = t
    }
    if (patch.triggerDays !== undefined) next.triggerDays = patch.triggerDays
    if (patch.message !== undefined) next.message = patch.message.trim() || undefined
    if (patch.contentId !== undefined) next.contentId = patch.contentId
    if (patch.packIds !== undefined) next.packIds = patch.packIds.length ? patch.packIds : undefined
    if (patch.active !== undefined) next.active = patch.active
    await ctx.db.patch(id, next)
  },
})

export const removeScenario = mutation({
  args: { id: v.id('packScenarios') },
  handler: async (ctx, { id }) => {
    await requireOwner(ctx)
    for (const r of await ctx.db
      .query('packScenarioRuns')
      .withIndex('by_scenario', (q) => q.eq('scenarioId', id))
      .collect()) {
      await ctx.db.delete(r._id)
    }
    await ctx.db.delete(id)
  },
})

// Отправка сценария одному проекту. Общая для ручного запуска и планировщика.
async function runScenario(
  ctx: MutationCtx,
  scenario: Doc<'packScenarios'>,
  packId: Id<'packs'>,
  byId: Id<'employees'> | null,
) {
  const pack = await ctx.db.get(packId)
  if (!pack?.clientId) return false
  // Повторно одному проекту сценарий не срабатывает.
  const already = await ctx.db
    .query('packScenarioRuns')
    .withIndex('by_scenario_pack', (q) => q.eq('scenarioId', scenario._id).eq('packId', packId))
    .first()
  if (already) return false

  const content = scenario.contentId ? await ctx.db.get(scenario.contentId) : null
  const text = [scenario.message?.trim(), content ? `Материал: ${content.title}` : null]
    .filter(Boolean)
    .join('\n\n')

  await notifyPack(ctx, [pack.clientId], {
    packId,
    kind: 'scenario',
    title: scenario.title,
    text: text || undefined,
    link: '/learn',
  })
  await ctx.db.insert('packScenarioRuns', {
    scenarioId: scenario._id,
    packId,
    at: Date.now(),
    status: 'sent',
  })
  await logPackEvent(ctx, {
    packId,
    type: 'scenario',
    byId: byId ?? pack.packerId,
    field: scenario.title,
    to: 'отправлен',
  })
  return true
}

// §13.2: ручной запуск — «запуск по вручную заданному событию».
export const triggerScenario = mutation({
  args: { id: v.id('packScenarios'), packId: v.id('packs') },
  handler: async (ctx, { id, packId }) => {
    const me = await requireOwner(ctx)
    const scenario = await ctx.db.get(id)
    if (!scenario) throw new ConvexError('Сценарий не найден')
    const sent = await runScenario(ctx, scenario, packId, me._id)
    if (!sent) throw new ConvexError('Сценарий уже отправлялся по этому проекту или у проекта нет клиента')
  },
})

// Планировщик постпроектных сценариев: раз в сутки проверяет условия запуска.
export const tick = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now()
    const scenarios = (await ctx.db.query('packScenarios').collect()).filter((s) => s.active)
    if (scenarios.length === 0) return
    const packs = (await ctx.db.query('packs').collect()).filter((p) => p.finishedAt)

    for (const s of scenarios) {
      if (s.trigger !== 'days_after_finish' && s.trigger !== 'no_activity') continue
      const days = s.triggerDays ?? 0
      if (days <= 0) continue
      for (const pack of packs) {
        if (s.packIds?.length && !s.packIds.some((p) => p === pack._id)) continue
        if (!pack.clientId) continue

        if (s.trigger === 'days_after_finish') {
          if (now - (pack.finishedAt ?? 0) < days * DAY_MS) continue
        } else {
          // §13.2: запуск по отсутствию активности клиента.
          const client = await ctx.db.get(pack.clientId)
          const last = Math.max(client?.lastLoginAt ?? 0, pack.lastActivityAt)
          if (now - last < days * DAY_MS) continue
        }
        await runScenario(ctx, s, pack._id, null)
      }
    }
  },
})

// §14.1: «до срока осталось настраиваемое время» и «срок нарушен».
//
// Порог берётся из настроек модуля (§6.3) — тот же, по которому индикатор
// здоровья становится жёлтым. Ключ события включает номер передачи: после
// повторной передачи этапа предупреждение приходит заново, а внутри одной
// передачи — ровно один раз.
export const deadlineTick = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now()
    const packs = (await ctx.db.query('packs').collect()).filter((p) => p.status === 'active')

    for (const pack of packs) {
      if (!pack.clientId) continue
      for (const s of await stagesOf(ctx, pack._id)) {
        // §12.1: если этап уже принят, напоминание о его приёмке не шлём.
        if (s.status === 'approved' || !s.acceptDueAt) continue
        if (s.awaiting !== 'client') continue
        const left = s.acceptDueAt - now
        // §12: «До срока приемки этапа остались сутки».
        if (left <= 0 || left > DAY_MS) continue
        await notifyPack(ctx, [pack.clientId], {
          packId: pack._id,
          kind: 'accept_due',
          title: 'Сутки до срока приёмки',
          text:
            `${pack.title} · ${s.title}. Примите работу до срока, ` +
            'чтобы сохранить часть пазла.',
          // §12.1: прямая ссылка на соответствующий материал или проект.
          link: '/stages',
          // §12.1: повторная обработка события дубля не создаёт. Номер
          // передачи в ключе — после повторной передачи напоминание новое.
          key: `pack_accept_due:${s._id}:${s.handoverCount ?? 0}`,
        })
      }
    }
  },
})

// ——— §14.3: аналитика ———

export const analytics = query({
  args: { from: v.optional(v.string()), to: v.optional(v.string()) },
  handler: async (ctx, { from, to }) => {
    const me = await currentEmployee(ctx)
    if (!me || me.role === 'client') return null
    const settings = await packSettings(ctx)
    const now = Date.now()

    const packs = []
    for (const p of await ctx.db.query('packs').collect()) {
      if (!(await maySeePack(ctx, me, p))) continue
      packs.push(p)
    }
    const inRange = (at: number | undefined) =>
      !!at &&
      (!from || at >= Date.parse(`${from}T00:00:00+05:00`)) &&
      (!to || at <= Date.parse(`${to}T23:59:59+05:00`))

    let projectMsTotal = 0
    let projectCount = 0
    let stageMsTotal = 0
    let stageCount = 0
    let onTimeStages = 0
    let approvedStages = 0
    let lateOnUs = 0
    let lateOnClient = 0
    let lateMsUs = 0
    let lateMsClient = 0
    let returns = 0
    const returnReasons: { pack: string; stage: string; text: string; at: number }[] = []
    const load = new Map<string, { name: string; active: number; stages: number }>()
    const byMonth = new Map<string, { approved: number; finished: number }>()
    let finished = 0
    let clientsActiveAfter = 0
    let clientsFinished = 0

    const names = new Map(
      (await ctx.db.query('employees').collect()).map((e) => [e._id as string, e.name]),
    )

    for (const pack of packs) {
      const stages = await stagesOf(ctx, pack._id)
      // §14.3 «количество и причины возвратов». Источник — журнал: событие
      // stage_return несёт ровно тот текст, с которым этап вернули, и его
      // дату. Раньше сюда попадали все клиентские комментарии этапа подряд —
      // включая те, что к возврату отношения не имели.
      const events = await ctx.db
        .query('packEvents')
        .withIndex('by_pack', (q) => q.eq('packId', pack._id))
        .collect()
      const stageTitle = new Map(stages.map((s) => [s._id as string, s.title]))
      for (const e of events) {
        if (e.type !== 'stage_return' || !inRange(e.at)) continue
        returns += 1
        if (e.note) {
          returnReasons.push({
            pack: pack.title,
            stage: e.stageId ? (stageTitle.get(e.stageId as string) ?? '—') : '—',
            text: e.note,
            at: e.at,
          })
        }
      }
      if (pack.finishedAt && inRange(pack.finishedAt)) {
        finished += 1
        if (pack.launchedAt) {
          projectMsTotal += pack.finishedAt - pack.launchedAt
          projectCount += 1
        }
        const m = new Date(pack.finishedAt + 5 * 3600 * 1000).toISOString().slice(0, 7)
        const cur = byMonth.get(m) ?? { approved: 0, finished: 0 }
        cur.finished += 1
        byMonth.set(m, cur)

        // §14.3: активность клиентов после завершения.
        clientsFinished += 1
        if (pack.clientId) {
          const client = await ctx.db.get(pack.clientId)
          if (client?.lastLoginAt && client.lastLoginAt > pack.finishedAt) clientsActiveAfter += 1
        }
      }

      const key = pack.packerId as string
      const cur = load.get(key) ?? { name: names.get(key) ?? '—', active: 0, stages: 0 }
      if (pack.status === 'active') cur.active += 1

      for (const s of stages) {
        if (s.status === 'approved' && s.approvedAt && inRange(s.approvedAt)) {
          approvedStages += 1
          cur.stages += 1
          if (s.approvedOnTime) onTimeStages += 1
          if (s.startedAt) {
            stageMsTotal += s.approvedAt - s.startedAt
            stageCount += 1
          }
          const m = new Date(s.approvedAt + 5 * 3600 * 1000).toISOString().slice(0, 7)
          const row = byMonth.get(m) ?? { approved: 0, finished: 0 }
          row.approved += 1
          byMonth.set(m, row)
        }
        // Просрочки по сторонам: живой таймер, который уже нарушен.
        if (s.dueAt && s.dueAt < now && s.status !== 'approved') {
          if (s.awaiting === 'client') {
            lateOnClient += 1
            lateMsClient += now - s.dueAt
          } else {
            lateOnUs += 1
            lateMsUs += now - s.dueAt
          }
        }
      }
      load.set(key, cur)
    }

    return {
      avgProjectDays: projectCount ? projectMsTotal / projectCount / DAY_MS : 0,
      avgStageDays: stageCount ? stageMsTotal / stageCount / DAY_MS : 0,
      onTimeRate: approvedStages ? onTimeStages / approvedStages : 0,
      approvedStages,
      finished,
      returns,
      returnReasons: returnReasons.sort((a, b) => b.at - a.at).slice(0, 30),
      lateOnUs,
      lateOnClient,
      avgLateUsDays: lateOnUs ? lateMsUs / lateOnUs / DAY_MS : 0,
      avgLateClientDays: lateOnClient ? lateMsClient / lateOnClient / DAY_MS : 0,
      load: [...load.values()].sort((a, b) => b.stages - a.stages),
      months: [...byMonth.entries()].sort().map(([month, x]) => ({ month, ...x })),
      clientsFinished,
      clientsActiveAfter,
      warnHours: settings.warnHours,
    }
  },
})

// ——— Настройки модуля (§6.3, §6.1) ———

export const moduleSettings = query({
  args: {},
  handler: async (ctx) => {
    const me = await currentEmployee(ctx)
    if (!me || me.role !== 'owner') return null
    return await packSettings(ctx)
  },
})

export const setModuleSettings = mutation({
  args: {
    warnHours: v.optional(v.number()),
    reviewDays: v.optional(v.number()),
    rereviewDays: v.optional(v.number()),
    fixDays: v.optional(v.number()),
    idleDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireOwner(ctx)
    const row = await ctx.db
      .query('settings')
      .withIndex('by_key', (q) => q.eq('key', 'global'))
      .first()
    if (!row) throw new ConvexError('Настройки ещё не инициализированы')
    const patch: Record<string, number> = {}
    if (args.warnHours !== undefined) patch.packWarnHours = Math.max(1, args.warnHours)
    if (args.reviewDays !== undefined) patch.packReviewDays = Math.max(1, args.reviewDays)
    if (args.rereviewDays !== undefined) patch.packRereviewDays = Math.max(1, args.rereviewDays)
    if (args.fixDays !== undefined) patch.packFixDays = Math.max(1, args.fixDays)
    if (args.idleDays !== undefined) patch.packIdleDays = Math.max(1, args.idleDays)
    await ctx.db.patch(row._id, patch)
  },
})

// §9.4: из карточки этапа можно создать связанную задачу. Завершение задачи
// не закрывает этап автоматически (BR-09) — связь только смысловая.
export const createStageTask = mutation({
  args: {
    stageId: v.id('packStages'),
    title: v.string(),
    assigneeId: v.id('employees'),
    deadline: v.optional(v.string()),
    priority: v.optional(
      v.union(v.literal('low'), v.literal('medium'), v.literal('high'), v.literal('urgent')),
    ),
  },
  handler: async (ctx, args) => {
    const stage = await ctx.db.get(args.stageId)
    if (!stage) throw new ConvexError('Этап не найден')
    const { me, pack } = await requirePack(ctx, stage.packId, 'work')
    const title = args.title.trim()
    if (!title) throw new ConvexError('Укажите название задачи')

    const taskId = await ctx.db.insert('tasks', {
      title,
      description: `Упаковка «${pack.title}» · этап «${stage.title}»`,
      status: 'assigned',
      priority: args.priority ?? 'medium',
      assigneeId: args.assigneeId,
      reporterId: me._id,
      deadline: args.deadline || stage.endDate,
      tags: ['упаковка'],
      checklist: [],
      attachments: 0,
      comments: 0,
      source: 'pack',
    })
    await logPackEvent(ctx, {
      packId: pack._id,
      stageId: args.stageId,
      type: 'stage_updated',
      byId: me._id,
      field: 'создана связанная задача',
      to: title,
    })
    await notifyPack(ctx, [args.assigneeId], {
      packId: pack._id,
      kind: 'task',
      title: 'Задача по упаковке',
      text: `${pack.title} · ${stage.title}: ${title}`,
      link: '/tasks',
      skip: me._id,
    })
    return taskId
  },
})

// §9.4: «Из карточки этапа можно создать связанную задачу или встречу».
// Встреча заводится в общем модуле ERP — отдельного календаря у упаковки нет,
// и приглашённые получают уведомление по общей логике (§9.4).
export const createStageMeeting = mutation({
  args: {
    stageId: v.id('packStages'),
    title: v.string(),
    date: v.string(),
    time: v.string(),
    place: v.optional(v.string()),
    comment: v.optional(v.string()),
    participantIds: v.optional(v.array(v.id('employees'))),
    // Пригласить заказчика: встречи по упаковке часто именно с ним.
    withClient: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const stage = await ctx.db.get(args.stageId)
    if (!stage) throw new ConvexError('Этап не найден')
    const { me, pack } = await requirePack(ctx, stage.packId, 'work')
    const title = args.title.trim()
    if (!title) throw new ConvexError('Укажите название встречи')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) throw new ConvexError('Укажите дату встречи')
    if (!/^\d{2}:\d{2}$/.test(args.time)) throw new ConvexError('Укажите время встречи')

    const ids = new Set<string>([me._id as string, ...(args.participantIds ?? []).map((p) => p as string)])
    if (args.withClient && pack.clientId) ids.add(pack.clientId as string)

    const meetingId = await ctx.db.insert('meetings', {
      title,
      date: args.date,
      time: args.time,
      place: args.place?.trim() || undefined,
      comment:
        `Упаковка «${pack.title}» · этап «${stage.title}»` +
        (args.comment?.trim() ? `\n${args.comment.trim()}` : ''),
      createdById: me._id,
      participantIds: [...ids] as Id<'employees'>[],
      createdAt: Date.now(),
      status: 'planned',
      originalDate: args.date,
      originalTime: args.time,
      rescheduleCount: 0,
      source: 'pack',
    })
    await logPackEvent(ctx, {
      packId: pack._id,
      stageId: args.stageId,
      type: 'stage_updated',
      byId: me._id,
      field: 'создана связанная встреча',
      to: `${title} · ${args.date} ${args.time}`,
    })
    const created = await ctx.db.get(meetingId)
    if (created) await notifyMeetingEvent(ctx, created, 'Новая встреча по упаковке', [], me._id)
    return meetingId
  },
})

// Задачи и встречи, связанные с проектом (§9.4) — из общих модулей ERP.
export const linkedWork = query({
  args: { packId: v.id('packs') },
  handler: async (ctx, { packId }) => {
    const me = await currentEmployee(ctx)
    if (!me || me.role === 'client') return null
    const pack = await ctx.db.get(packId)
    if (!pack || !(await maySeePack(ctx, me, pack))) return null
    const team = new Set(teamOf(pack).map((t) => t as string))
    const names = new Map(
      (await ctx.db.query('employees').collect()).map((e) => [e._id as string, e.name]),
    )
    const tasks = (await ctx.db.query('tasks').collect()).filter(
      (t) => t.description?.includes(`Упаковка «${pack.title}»`) && team.has(t.assigneeId as string),
    )
    const meetings = (await ctx.db.query('meetings').collect()).filter(
      (m) =>
        (m.status ?? 'planned') !== 'cancelled' &&
        m.date >= pack.startDate &&
        m.participantIds.some((p) => team.has(p as string)),
    )
    return {
      tasks: tasks.map((t) => ({
        _id: t._id,
        title: t.title,
        status: t.status,
        deadline: t.deadline ?? null,
        assignee: names.get(t.assigneeId as string) ?? '—',
      })),
      meetings: meetings
        .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
        .slice(0, 20)
        .map((m) => ({ _id: m._id, title: m.title, date: m.date, time: m.time })),
    }
  },
})
