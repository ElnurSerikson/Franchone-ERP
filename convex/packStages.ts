// Модуль упаковки — этапы, материалы, версии и комментарии (ТЗ Упаковка §5, §11).
//
// Сценарий согласования (§5.3) целиком здесь: упаковщик готовит материалы,
// система проверяет готовность обязательных элементов, этап передаётся
// клиенту, клиент утверждает или возвращает единый пакет замечаний, упаковщик
// грузит новые версии и передаёт повторно. После утверждения этап закрывается
// от обычного редактирования, его вес идёт в прогресс клиента и в KPI
// упаковщика (BR-04).
//
// Действия клиента живут в packClient.ts, но выполняются теми же функциями
// approveStage/returnStage — правило начисления должно быть одно на всех.

import { query, mutation } from './_generated/server'
import { v, ConvexError } from 'convex/values'
import type { MutationCtx, QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { currentEmployee, requireEmployee } from './lib'
import {
  addDays,
  dayEnd,
  deadlineFrom,
  logPackEvent,
  maySeePack,
  mayManagePack,
  mayWorkOnPack,
  awardPuzzle,
  notifyPack,
  openStageRewards,
  packSettings,
  requirePack,
  stageLike,
  stagesOf,
  teamOf,
  today,
} from './packs'
import {
  accruedReward,
  isMaterialDone,
  progressOf,
  weightSum,
  type MaterialStatus,
  type StageStatus,
} from './packModel'

// ——— Структура этапов (§4.2) ———

// До запуска структура правится свободно. После запуска изменение веса и уже
// начавшихся сроков журналируется с причиной (§4.4, BR-08).
function requireReasonAfterLaunch(pack: Doc<'packs'>, reason: string | undefined, what: string) {
  if (pack.launchedAt && !reason?.trim()) {
    throw new ConvexError(`Проект уже запущен: укажите причину изменения (${what})`)
  }
}

export const addStage = mutation({
  args: {
    packId: v.id('packs'),
    title: v.string(),
    kind: v.optional(v.union(v.literal('zero'), v.literal('main'))),
    weight: v.optional(v.number()),
    clientNote: v.optional(v.string()),
    internalNote: v.optional(v.string()),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    doneCondition: v.optional(v.string()),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { me, pack } = await requirePack(ctx, args.packId, 'manage')
    requireReasonAfterLaunch(pack, args.reason, 'добавление этапа')
    const title = args.title.trim()
    if (!title) throw new ConvexError('Укажите название этапа')
    const settings = await packSettings(ctx)
    const stages = await stagesOf(ctx, args.packId)
    const order = stages.length ? Math.max(...stages.map((s) => s.order)) + 1 : 0

    const id = await ctx.db.insert('packStages', {
      packId: args.packId,
      order,
      kind: args.kind ?? 'main',
      title,
      clientNote: args.clientNote?.trim() || undefined,
      internalNote: args.internalNote?.trim() || undefined,
      startDate: args.startDate,
      endDate: args.endDate,
      weight: args.weight ?? 0,
      reviewDays: settings.reviewDays,
      rereviewDays: settings.rereviewDays,
      fixDays: settings.fixDays,
      doneCondition: args.doneCondition?.trim() || undefined,
      // После запуска новый этап встаёт в очередь заблокированным.
      status: pack.launchedAt ? 'locked' : 'planned',
      returnCount: 0,
    })
    await logPackEvent(ctx, {
      packId: args.packId,
      stageId: id,
      type: 'stage_added',
      byId: me._id,
      to: title,
      reason: args.reason?.trim() || undefined,
    })
    return id
  },
})

export const updateStage = mutation({
  args: {
    id: v.id('packStages'),
    title: v.optional(v.string()),
    clientNote: v.optional(v.string()),
    internalNote: v.optional(v.string()),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    weight: v.optional(v.number()),
    reviewDays: v.optional(v.number()),
    rereviewDays: v.optional(v.number()),
    fixDays: v.optional(v.number()),
    doneCondition: v.optional(v.string()),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, { id, reason, ...patch }) => {
    const stage = await ctx.db.get(id)
    if (!stage) throw new ConvexError('Этап не найден')
    const { me, pack } = await requirePack(ctx, stage.packId, 'manage')

    const changes: { field: string; from: string; to: string; type: string }[] = []
    const next: Record<string, unknown> = {}
    const set = (field: string, key: string, before: unknown, after: unknown, type = 'stage_updated') => {
      if (after === undefined) return
      if (String(before ?? '') === String(after ?? '')) return
      next[key] = after
      changes.push({ field, from: String(before ?? '—'), to: String(after ?? '—'), type })
    }

    if (patch.title !== undefined) {
      const t = patch.title.trim()
      if (!t) throw new ConvexError('Название этапа не может быть пустым')
      set('название', 'title', stage.title, t)
    }
    if (patch.clientNote !== undefined) {
      set('описание для клиента', 'clientNote', stage.clientNote, patch.clientNote.trim() || undefined)
    }
    if (patch.internalNote !== undefined) {
      set('внутренний комментарий', 'internalNote', stage.internalNote, patch.internalNote.trim() || undefined)
    }
    if (patch.doneCondition !== undefined) {
      set('условия завершения', 'doneCondition', stage.doneCondition, patch.doneCondition.trim() || undefined)
    }
    if (patch.startDate !== undefined) set('дата начала', 'startDate', stage.startDate, patch.startDate, 'stage_dates')
    if (patch.endDate !== undefined) set('дата завершения', 'endDate', stage.endDate, patch.endDate, 'stage_dates')
    if (patch.weight !== undefined) {
      // §4.2: вес нулевого этапа настраивается так же, как вес основного —
      // он участвует в прогрессе и KPI (но части пазла не открывает).
      if (patch.weight < 0 || patch.weight > 100) throw new ConvexError('Вес этапа — от 0 до 100%')
      set('вес', 'weight', stage.weight, patch.weight, 'stage_weight')
    }
    if (patch.reviewDays !== undefined) set('срок первичной проверки', 'reviewDays', stage.reviewDays, patch.reviewDays)
    if (patch.rereviewDays !== undefined) set('срок повторной проверки', 'rereviewDays', stage.rereviewDays, patch.rereviewDays)
    if (patch.fixDays !== undefined) set('срок доработки', 'fixDays', stage.fixDays, patch.fixDays)

    if (changes.length === 0) return
    // §4.4/BR-08: вес и уже начавшиеся сроки после запуска — только с причиной.
    const critical = changes.some((c) => c.type === 'stage_weight' || c.type === 'stage_dates')
    if (critical) requireReasonAfterLaunch(pack, reason, 'вес или срок этапа')

    await ctx.db.patch(id, next)
    // Если этап ждёт нашу работу и сдвинули плановую дату — двигаем и таймер.
    if (next.endDate && stage.awaiting === 'franchone' && !stage.handedAt) {
      await ctx.db.patch(id, { dueAt: dayEnd(String(next.endDate)) })
    }
    for (const c of changes) {
      await logPackEvent(ctx, {
        packId: stage.packId,
        stageId: id,
        type: c.type,
        byId: me._id,
        field: `${stage.title}: ${c.field}`,
        from: c.from,
        to: c.to,
        reason: reason?.trim() || undefined,
      })
    }
    // §7.3: изменение весов после начисления требует пересчёта и записи.
    if (changes.some((c) => c.type === 'stage_weight') && pack.launchedAt) {
      const stages = await stagesOf(ctx, stage.packId)
      const progress = progressOf(stages.map(stageLike))
      await logPackEvent(ctx, {
        packId: stage.packId,
        type: 'kpi_recalc',
        byId: me._id,
        note: `KPI ${progress}%, начислено ${accruedReward(pack.price, pack.packerPercent, progress)} ₸`,
        financial: true,
      })
    }
  },
})

export const removeStage = mutation({
  args: { id: v.id('packStages'), reason: v.optional(v.string()) },
  handler: async (ctx, { id, reason }) => {
    const stage = await ctx.db.get(id)
    if (!stage) return
    const { me, pack } = await requirePack(ctx, stage.packId, 'manage')
    if (stage.status === 'approved') {
      throw new ConvexError('Утверждённый этап удалять нельзя — его вес уже начислен')
    }
    requireReasonAfterLaunch(pack, reason, 'удаление этапа')

    for (const m of await ctx.db
      .query('packMaterials')
      .withIndex('by_stage', (q) => q.eq('stageId', id))
      .collect()) {
      for (const ver of await ctx.db
        .query('packMaterialVersions')
        .withIndex('by_material', (q) => q.eq('materialId', m._id))
        .collect()) {
        if (ver.storageId) await ctx.storage.delete(ver.storageId)
        await ctx.db.delete(ver._id)
      }
      await ctx.db.delete(m._id)
    }
    await ctx.db.delete(id)
    await logPackEvent(ctx, {
      packId: stage.packId,
      type: 'stage_removed',
      byId: me._id,
      from: stage.title,
      reason: reason?.trim() || undefined,
    })
  },
})

// §4.2: изменение порядка этапов до запуска.
export const reorderStages = mutation({
  args: { packId: v.id('packs'), ids: v.array(v.id('packStages')) },
  handler: async (ctx, { packId, ids }) => {
    const { me, pack } = await requirePack(ctx, packId, 'manage')
    if (pack.launchedAt) {
      throw new ConvexError('Порядок этапов меняется только до запуска проекта')
    }
    for (let i = 0; i < ids.length; i++) {
      const s = await ctx.db.get(ids[i])
      if (!s || s.packId !== packId) continue
      await ctx.db.patch(ids[i], { order: i })
    }
    await logPackEvent(ctx, { packId, type: 'stage_updated', byId: me._id, field: 'порядок этапов' })
  },
})

// Разложить веса поровну — быстрый способ вернуть сумму к 100% (§4.3).
export const equalizeWeights = mutation({
  args: { packId: v.id('packs') },
  handler: async (ctx, { packId }) => {
    const { me, pack } = await requirePack(ctx, packId, 'manage')
    if (pack.launchedAt) throw new ConvexError('Веса запущенного проекта меняются по одному, с причиной')
    // §4.2: делим 100% между ВСЕМИ активными этапами, включая нулевой.
    const stages = await stagesOf(ctx, packId)
    if (stages.length === 0) throw new ConvexError('В проекте нет этапов')
    const base = Math.floor(100 / stages.length)
    // Остаток отдаём последнему этапу: сумма обязана быть ровно 100 (BR-02).
    for (let i = 0; i < stages.length; i++) {
      const w = i === stages.length - 1 ? 100 - base * (stages.length - 1) : base
      await ctx.db.patch(stages[i]._id, { weight: w })
    }
    await logPackEvent(ctx, { packId, type: 'stage_weight', byId: me._id, field: 'веса выровнены', to: '100%' })
  },
})

// ——— §5.3: сценарий согласования ———

// Готовность обязательных элементов (§5.3.2).
export async function readiness(ctx: QueryCtx | MutationCtx, stageId: Id<'packStages'>) {
  const materials = await ctx.db
    .query('packMaterials')
    .withIndex('by_stage', (q) => q.eq('stageId', stageId))
    .collect()
  const required = materials.filter((m) => m.required && m.side === 'team')
  const done = required.filter((m) => isMaterialDone(m.status as MaterialStatus))
  return {
    required: required.length,
    done: done.length,
    missing: required.filter((m) => !isMaterialDone(m.status as MaterialStatus)).map((m) => m.title),
    ready: required.length > 0 ? done.length === required.length : materials.length > 0,
  }
}

// Этап взят в работу.
export const startStage = mutation({
  args: { id: v.id('packStages') },
  handler: async (ctx, { id }) => {
    const stage = await ctx.db.get(id)
    if (!stage) throw new ConvexError('Этап не найден')
    const { me, pack } = await requirePack(ctx, stage.packId, 'work')
    if (pack.status !== 'active') throw new ConvexError('Проект не активен')
    if (stage.status === 'locked') {
      throw new ConvexError('Предыдущий этап ещё не утверждён — этот пока заблокирован')
    }
    if (stage.status !== 'planned') return
    await ctx.db.patch(id, {
      status: 'in_progress',
      startedAt: Date.now(),
      awaiting: 'franchone',
      dueAt: stage.endDate ? dayEnd(stage.endDate) : undefined,
    })
    await logPackEvent(ctx, { packId: stage.packId, stageId: id, type: 'stage_started', byId: me._id, to: stage.title })
  },
})

// §5.3.3: «Передать этап клиенту». BR-06: клиентский таймер запускается
// только после официальной передачи ВСЕГО этапа.
export const handover = mutation({
  args: { id: v.id('packStages'), note: v.optional(v.string()) },
  handler: async (ctx, { id, note }) => {
    const stage = await ctx.db.get(id)
    if (!stage) throw new ConvexError('Этап не найден')
    const { me, pack } = await requirePack(ctx, stage.packId, 'work')
    if (pack.status !== 'active') throw new ConvexError('Проект не активен — передавать этап нельзя')
    if (!pack.clientId) throw new ConvexError('У проекта не назначен клиент')
    if (!['in_progress', 'ready', 'rework'].includes(stage.status)) {
      throw new ConvexError('Этот этап сейчас нельзя передать клиенту')
    }
    const check = await readiness(ctx, id)
    if (check.required > 0 && check.done < check.required) {
      throw new ConvexError(`Не готовы обязательные материалы: ${check.missing.join(', ')}`)
    }

    const now = Date.now()
    const repeat = (stage.handoverCount ?? 0) > 0
    const days = repeat ? stage.rereviewDays : stage.reviewDays
    const dueAt = deadlineFrom(now, days, pack.workingDays === true)

    await ctx.db.patch(id, {
      // §5.3.7: доработанная версия уходит на повторную проверку.
      status: repeat ? 'rereview' : 'review',
      handedAt: now,
      handoverCount: (stage.handoverCount ?? 0) + 1,
      awaiting: 'client',
      dueAt,
      // Копим суммарную длительность доработки для §7.4 «средний срок доработки».
      reworkMs: stage.reworkStartedAt
        ? (stage.reworkMs ?? 0) + (now - stage.reworkStartedAt)
        : stage.reworkMs,
      reworkStartedAt: undefined,
    })
    // Материалы, доступные клиенту для просмотра (§11.1 «Готов к проверке»).
    for (const m of await ctx.db
      .query('packMaterials')
      .withIndex('by_stage', (q) => q.eq('stageId', id))
      .collect()) {
      if (m.side === 'team' && (m.status === 'in_progress' || m.status === 'planned')) {
        await ctx.db.patch(m._id, { status: 'ready' })
      }
    }

    // §5.4: с передачей у клиента появляется шанс получить награду этапа —
    // срок её условия совпадает со сроком ответа.
    await openStageRewards(ctx, id, dueAt)

    await logPackEvent(ctx, {
      packId: stage.packId,
      stageId: id,
      type: 'stage_handover',
      byId: me._id,
      to: stage.title,
      note: note?.trim() || undefined,
    })
    // §14.1: официальная передача этапа — ключевое уведомление клиенту.
    await notifyPack(ctx, [pack.clientId], {
      packId: stage.packId,
      kind: 'handover',
      title: repeat ? 'Доработанный этап на проверке' : 'Этап передан вам на проверку',
      text:
        `${pack.title} · ${stage.title}\n` +
        `Ответ ждём до ${new Date(dueAt + 5 * 3600 * 1000).toISOString().slice(0, 10)}.` +
        (note?.trim() ? `\n\n${note.trim()}` : ''),
      link: '/',
    })
    await notifyPack(ctx, teamOf(pack), {
      packId: stage.packId,
      kind: 'handover',
      title: 'Этап передан клиенту',
      text: `${pack.title} · ${stage.title}`,
      link: `/packs/${stage.packId}`,
      skip: me._id,
    })
  },
})

// §5.3.8: этап утверждён — вес идёт в прогресс клиента и KPI упаковщика.
// Используется и клиентом (packClient.approveStage), и владельцем вручную (§3).
export async function approveStage(
  ctx: MutationCtx,
  pack: Doc<'packs'>,
  stage: Doc<'packStages'>,
  byId: Id<'employees'>,
  note?: string,
) {
  if (stage.status === 'approved') return
  const now = Date.now()
  await ctx.db.patch(stage._id, {
    status: 'approved',
    approvedAt: now,
    approvedById: byId,
    awaiting: undefined,
    dueAt: undefined,
    // §13.2: дата решения сравнивается с настроенным сроком приёмки этапа.
    // Своевременность самого упаковщика считается отдельно — по дате
    // перевода материалов в «Готов к проверке» (§10).
    approvedOnTime: stage.acceptDueAt ? now <= stage.acceptDueAt : true,
    reworkMs: stage.reworkStartedAt ? (stage.reworkMs ?? 0) + (now - stage.reworkStartedAt) : stage.reworkMs,
    reworkStartedAt: undefined,
  })
  for (const m of await ctx.db
    .query('packMaterials')
    .withIndex('by_stage', (q) => q.eq('stageId', stage._id))
    .collect()) {
    if (m.status !== 'approved') await ctx.db.patch(m._id, { status: 'approved', approvedAt: now })
  }

  // §7.1, §13.2: часть пазла открывается, если этап принят в срок.
  const fresh = await ctx.db.get(stage._id)
  if (fresh) await awardPuzzle(ctx, pack, fresh, now)

  // Следующий этап выходит из блокировки (§5.2 «Заблокирован»).
  const stages = await stagesOf(ctx, pack._id)
  const next = stages.find((s) => s.order > stage.order && s.status === 'locked')
  if (next) {
    await ctx.db.patch(next._id, {
      status: 'planned',
      awaiting: 'franchone',
      dueAt: next.endDate ? dayEnd(next.endDate) : undefined,
    })
  }

  await logPackEvent(ctx, {
    packId: pack._id,
    stageId: stage._id,
    type: 'stage_approved',
    byId,
    to: stage.title,
    note: note?.trim() || undefined,
  })

  // §10: этап включается в фактический KPI только после принятия заказчиком.
  // Принятый нулевой этап тоже входит — по назначенному ему весу (§4.2).
  const after = await stagesOf(ctx, pack._id)
  const progress = progressOf(after.map(stageLike))
  {
    await logPackEvent(ctx, {
      packId: pack._id,
      stageId: stage._id,
      type: 'kpi_accrued',
      byId,
      field: `вес этапа ${stage.weight}%`,
      to: `${accruedReward(pack.price, pack.packerPercent, stage.weight)} ₸`,
      note: `накопленный KPI ${progress}%`,
      financial: true,
    })
    await notifyPack(ctx, [pack.packerId], {
      packId: pack._id,
      kind: 'kpi',
      title: 'Этап утверждён — начислено вознаграждение',
      text:
        `${pack.title} · ${stage.title}\n` +
        `+${accruedReward(pack.price, pack.packerPercent, stage.weight)} ₸ · KPI проекта ${progress}%`,
      link: `/packs/${pack._id}`,
    })
  }
  await notifyPack(ctx, teamOf(pack), {
    packId: pack._id,
    kind: 'approved',
    title: 'Этап утверждён клиентом',
    text: `${pack.title} · ${stage.title} · готовность ${progress}%`,
    link: `/packs/${pack._id}`,
    skip: byId,
  })
  if (next) {
    await notifyPack(ctx, [...teamOf(pack), ...(pack.clientId ? [pack.clientId] : [])], {
      packId: pack._id,
      kind: 'next_stage',
      title: 'Начался следующий этап',
      text: `${pack.title} · ${next.title}`,
      skip: byId,
    })
  }
  return progress
}

// §5.3.5–5.3.6, BR-07: возврат на доработку — ответственность и таймер
// переходят к FRANCHONE.
export async function returnStage(
  ctx: MutationCtx,
  pack: Doc<'packs'>,
  stage: Doc<'packStages'>,
  byId: Id<'employees'>,
  comment: string,
) {
  const now = Date.now()
  const dueAt = deadlineFrom(now, stage.fixDays, pack.workingDays === true)
  await ctx.db.patch(stage._id, {
    status: 'rework',
    awaiting: 'franchone',
    dueAt,
    returnCount: stage.returnCount + 1,
    reworkStartedAt: now,
  })
  // §11.1: по материалам этапа есть замечания.
  for (const m of await ctx.db
    .query('packMaterials')
    .withIndex('by_stage', (q) => q.eq('stageId', stage._id))
    .collect()) {
    if (m.side === 'team' && m.status !== 'approved') {
      await ctx.db.patch(m._id, { status: 'rework' })
    }
  }
  await logPackEvent(ctx, {
    packId: pack._id,
    stageId: stage._id,
    type: 'stage_return',
    byId,
    to: stage.title,
    note: comment.trim() || undefined,
  })
  await notifyPack(ctx, teamOf(pack), {
    packId: pack._id,
    kind: 'return',
    title: 'Клиент отправил замечания',
    text: `${pack.title} · ${stage.title}\n\n${comment.trim()}`,
    link: `/packs/${pack._id}`,
    skip: byId,
  })
}

// §3: владелец при необходимости утверждает и возвращает этап вручную.
export const approve = mutation({
  args: { id: v.id('packStages'), note: v.optional(v.string()) },
  handler: async (ctx, { id, note }) => {
    const stage = await ctx.db.get(id)
    if (!stage) throw new ConvexError('Этап не найден')
    const { me, pack } = await requirePack(ctx, stage.packId, 'manage')
    if (me.role !== 'owner') {
      throw new ConvexError('Утверждает этап клиент; вручную это может сделать только владелец')
    }
    if (stage.status === 'locked' || stage.status === 'paused') {
      throw new ConvexError('Этап сейчас нельзя утвердить')
    }
    await approveStage(ctx, pack, stage, me._id, note ?? 'утверждено владельцем вручную')
  },
})

export const returnForChanges = mutation({
  args: { id: v.id('packStages'), comment: v.string() },
  handler: async (ctx, { id, comment }) => {
    const stage = await ctx.db.get(id)
    if (!stage) throw new ConvexError('Этап не найден')
    const { me, pack } = await requirePack(ctx, stage.packId, 'manage')
    if (me.role !== 'owner') {
      throw new ConvexError('Возврат на доработку выполняет клиент или владелец')
    }
    if (!comment.trim()) throw new ConvexError('Опишите замечания')
    if (stage.status === 'approved') throw new ConvexError('Этап утверждён — сначала переоткройте его')
    await returnStage(ctx, pack, stage, me._id, comment)
  },
})

// §7.3: при повторном открытии утверждённого этапа система предупреждает о
// влиянии на KPI и сохраняет историю корректировки.
export const reopenStage = mutation({
  args: { id: v.id('packStages'), reason: v.string() },
  handler: async (ctx, { id, reason }) => {
    const stage = await ctx.db.get(id)
    if (!stage) throw new ConvexError('Этап не найден')
    const { me, pack } = await requirePack(ctx, stage.packId, 'manage')
    if (me.role !== 'owner') throw new ConvexError('Переоткрыть утверждённый этап может только владелец')
    if (stage.status !== 'approved') throw new ConvexError('Этап и так не утверждён')
    if (!reason.trim()) throw new ConvexError('Укажите причину переоткрытия — она уйдёт в журнал')

    const before = progressOf((await stagesOf(ctx, pack._id)).map(stageLike))
    await ctx.db.patch(id, {
      status: 'rework',
      awaiting: 'franchone',
      dueAt: deadlineFrom(Date.now(), stage.fixDays, pack.workingDays === true),
      approvedAt: undefined,
      approvedById: undefined,
      approvedOnTime: undefined,
      reworkStartedAt: Date.now(),
    })
    const after = progressOf((await stagesOf(ctx, pack._id)).map(stageLike))
    await logPackEvent(ctx, {
      packId: pack._id,
      stageId: id,
      type: 'stage_reopened',
      byId: me._id,
      field: stage.title,
      from: `KPI ${before}%`,
      to: `KPI ${after}%`,
      reason: reason.trim(),
      financial: true,
    })
    await logPackEvent(ctx, {
      packId: pack._id,
      type: 'kpi_recalc',
      byId: me._id,
      note: `начислено ${accruedReward(pack.price, pack.packerPercent, after)} ₸ при KPI ${after}%`,
      financial: true,
    })
    await notifyPack(ctx, [pack.packerId, ...(pack.clientId ? [pack.clientId] : [])], {
      packId: pack._id,
      kind: 'reopened',
      title: 'Этап переоткрыт',
      text: `${pack.title} · ${stage.title}. Причина: ${reason.trim()}`,
      link: `/packs/${pack._id}`,
      skip: me._id,
    })
  },
})

// ——— §11: материалы ———

export const addMaterial = mutation({
  args: {
    stageId: v.id('packStages'),
    title: v.string(),
    description: v.optional(v.string()),
    kind: v.union(
      v.literal('file'),
      v.literal('link'),
      v.literal('doc'),
      v.literal('design'),
      v.literal('site'),
      v.literal('other'),
    ),
    required: v.optional(v.boolean()),
    ownerId: v.optional(v.id('employees')),
    dueDate: v.optional(v.string()),
    side: v.optional(v.union(v.literal('team'), v.literal('client'))),
  },
  handler: async (ctx, args) => {
    const stage = await ctx.db.get(args.stageId)
    if (!stage) throw new ConvexError('Этап не найден')
    const { me, pack } = await requirePack(ctx, stage.packId, 'work')
    const title = args.title.trim()
    if (!title) throw new ConvexError('Укажите название материала')

    const id = await ctx.db.insert('packMaterials', {
      packId: stage.packId,
      stageId: args.stageId,
      title,
      description: args.description?.trim() || undefined,
      kind: args.kind,
      required: args.required === true,
      status: 'planned',
      ownerId: args.ownerId ?? (args.side === 'client' ? pack.clientId : me._id),
      dueDate: args.dueDate,
      version: 0,
      side: args.side ?? 'team',
      createdAt: Date.now(),
      createdById: me._id,
    })
    await logPackEvent(ctx, {
      packId: stage.packId,
      stageId: args.stageId,
      materialId: id,
      type: 'material_added',
      byId: me._id,
      to: title,
    })
    // §10.3: клиенту сразу видно, что от него ждут исходники.
    if ((args.side ?? 'team') === 'client' && pack.clientId && pack.launchedAt) {
      await notifyPack(ctx, [pack.clientId], {
        packId: stage.packId,
        kind: 'need_material',
        title: 'Нужны материалы от вас',
        text: `${pack.title} · ${stage.title}: ${title}`,
        link: '/',
      })
    }
    return id
  },
})

export const updateMaterial = mutation({
  args: {
    id: v.id('packMaterials'),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    required: v.optional(v.boolean()),
    ownerId: v.optional(v.id('employees')),
    dueDate: v.optional(v.string()),
    status: v.optional(
      v.union(
        v.literal('planned'),
        v.literal('in_progress'),
        v.literal('ready'),
        v.literal('rework'),
        v.literal('reworked'),
        v.literal('approved'),
      ),
    ),
  },
  handler: async (ctx, { id, ...patch }) => {
    const material = await ctx.db.get(id)
    if (!material) throw new ConvexError('Материал не найден')
    const { me } = await requirePack(ctx, material.packId, 'work')

    const next: Record<string, unknown> = {}
    if (patch.title !== undefined) {
      const t = patch.title.trim()
      if (!t) throw new ConvexError('Название материала не может быть пустым')
      next.title = t
    }
    if (patch.description !== undefined) next.description = patch.description.trim() || undefined
    if (patch.required !== undefined) next.required = patch.required
    if (patch.ownerId !== undefined) next.ownerId = patch.ownerId
    if (patch.dueDate !== undefined) next.dueDate = patch.dueDate || undefined
    if (patch.status !== undefined && patch.status !== material.status) {
      // §5.2: «Принят» и «На доработке» ставит только заказчик.
      if (patch.status === 'approved' || patch.status === 'rework') {
        throw new ConvexError('Решение по материалу принимает заказчик')
      }
      // §15: «Заменен уже принятый файл» — снятие принятия подтверждает
      // только администратор, чтобы не изменить завершённый результат случайно.
      if (material.status === 'approved' && me.role !== 'owner') {
        throw new ConvexError('Принятый материал переоткрывает только администратор')
      }
      next.status = patch.status
      if (patch.status === 'ready') {
        // §10, §15.1: своевременность упаковщика считается по дате перевода
        // в «Готов к проверке», а не по дате приёмки заказчиком.
        const now = Date.now()
        next.readyAt = now
        const stage = await ctx.db.get(material.stageId)
        const due = material.dueDate ?? stage?.endDate ?? null
        next.readyOnTime = due ? now <= dayEnd(due) : true
      }
      await logPackEvent(ctx, {
        packId: material.packId,
        stageId: material.stageId,
        materialId: id,
        type: 'material_status',
        byId: me._id,
        field: material.title,
        from: material.status,
        to: patch.status,
      })
    }
    await ctx.db.patch(id, next)
    await syncStageFromMaterials(ctx, material.stageId)
    // §12: первое целевое сообщение — материал переведён в «Готов к проверке».
    if (next.status === 'ready') {
      const pack = await ctx.db.get(material.packId)
      if (pack?.clientId && pack.launchedAt) {
        await notifyPack(ctx, [pack.clientId], {
          packId: material.packId,
          kind: 'material_ready',
          title: 'Документ готов к проверке',
          text: `${pack.title} · ${material.title}. Откройте ERP и проверьте материал.`,
          link: '/stages',
          // §12.1: повторная техническая обработка дубля не создаёт.
          key: `pack_material_ready:${id}:${material.version}`,
        })
      }
    }
  },
})

export const removeMaterial = mutation({
  args: { id: v.id('packMaterials') },
  handler: async (ctx, { id }) => {
    const material = await ctx.db.get(id)
    if (!material) return
    const { me } = await requirePack(ctx, material.packId, 'manage')
    for (const ver of await ctx.db
      .query('packMaterialVersions')
      .withIndex('by_material', (q) => q.eq('materialId', id))
      .collect()) {
      if (ver.storageId) await ctx.storage.delete(ver.storageId)
      await ctx.db.delete(ver._id)
    }
    await ctx.db.delete(id)
    await logPackEvent(ctx, {
      packId: material.packId,
      stageId: material.stageId,
      type: 'material_status',
      byId: me._id,
      field: material.title,
      to: 'удалён',
    })
    await syncStageFromMaterials(ctx, material.stageId)
  },
})

// ТЗ v1.1 §5.3: этап передаётся на итоговую приёмку, как только загружены
// все обязательные материалы, и считается принятым, когда все они приняты.
// Отдельной кнопки «передать этап» нет — упаковщик управляет статусами
// материалов (§9.2), а этап следует за ними.
export async function syncStageFromMaterials(ctx: MutationCtx, stageId: Id<'packStages'>) {
  const stage = await ctx.db.get(stageId)
  if (!stage) return
  if (stage.status === 'locked' || stage.status === 'paused') return
  const pack = await ctx.db.get(stage.packId)
  if (!pack) return

  const materials = await ctx.db
    .query('packMaterials')
    .withIndex('by_stage', (q) => q.eq('stageId', stageId))
    .collect()
  const required = materials.filter((m) => m.required && m.side === 'team')
  // §15: этап без обязательных материалов проходит приёмку только если
  // администратор явно это разрешил.
  const gate = required.length > 0 || stage.allowNoDocs === true

  // §5.3: этап принят, когда приняты все его обязательные материалы.
  const allAccepted =
    gate && required.length > 0 && required.every((m) => m.status === 'approved')
  if (allAccepted && stage.status !== 'approved') {
    await acceptStageFromMaterials(ctx, pack, stage)
    return
  }
  if (stage.status === 'approved') return

  // §5.3: на итоговую приёмку — только после загрузки всех обязательных.
  const allReady = gate && required.every((m) => isMaterialDone(m.status as MaterialStatus))
  // Хоть один возврат — этап снова за нами (§15 «Материал возвращен»).
  const anyReturned = required.some((m) => m.status === 'rework')

  if (anyReturned) {
    if (stage.status !== 'rework') {
      await ctx.db.patch(stageId, {
        status: 'rework',
        awaiting: 'franchone',
        dueAt: deadlineFrom(Date.now(), stage.fixDays, pack.workingDays === true),
        reworkStartedAt: stage.reworkStartedAt ?? Date.now(),
      })
    }
    return
  }

  if (allReady && required.length > 0) {
    if (stage.status === 'review' || stage.status === 'rereview') return
    const now = Date.now()
    const repeat = (stage.handoverCount ?? 0) > 0
    const days = repeat ? stage.rereviewDays : stage.reviewDays
    // §4.1, §12.1: срок приёмки берётся из настроек этапа.
    const acceptDueAt = deadlineFrom(now, days, pack.workingDays === true)
    await ctx.db.patch(stageId, {
      status: repeat ? 'rereview' : 'review',
      handedAt: now,
      handoverCount: (stage.handoverCount ?? 0) + 1,
      awaiting: 'client',
      dueAt: acceptDueAt,
      acceptDueAt,
      reworkMs: stage.reworkStartedAt
        ? (stage.reworkMs ?? 0) + (now - stage.reworkStartedAt)
        : stage.reworkMs,
      reworkStartedAt: undefined,
    })
    return
  }

  // Готовность потеряна — этап снова в работе.
  if (stage.status === 'review' || stage.status === 'rereview' || stage.status === 'ready') {
    await ctx.db.patch(stageId, {
      status: 'in_progress',
      awaiting: 'franchone',
      dueAt: stage.endDate ? dayEnd(stage.endDate) : undefined,
      acceptDueAt: undefined,
    })
  }
}

// §13.2: все обязательные материалы приняты → этап отмечается принятым,
// фиксируется дата решения, сравнивается со сроком приёмки, при соблюдении
// открывается часть пазла, обновляются прогресс и фактический KPI.
async function acceptStageFromMaterials(
  ctx: MutationCtx,
  pack: Doc<'packs'>,
  stage: Doc<'packStages'>,
) {
  const clientId = pack.clientId
  await approveStage(ctx, pack, stage, clientId ?? pack.packerId)
}

// Совместимость: старое имя вызывалось из мутаций материалов.
export const maybeMarkStageReady = syncStageFromMaterials

// §11.2: новая версия материала. Старые версии не перезаписываются.
export async function addMaterialVersion(
  ctx: MutationCtx,
  material: Doc<'packMaterials'>,
  byId: Id<'employees'>,
  row: {
    kind: 'file' | 'link'
    name: string
    url?: string
    storageId?: Id<'_storage'>
    note?: string
  },
) {
  const version = material.version + 1
  await ctx.db.insert('packMaterialVersions', {
    materialId: material._id,
    packId: material.packId,
    version,
    kind: row.kind,
    name: row.name,
    url: row.url,
    storageId: row.storageId,
    note: row.note,
    byId,
    at: Date.now(),
  })
  // §5.2, §5.4: статусов пять. Повторная загрузка после доработки сразу даёт
  // «Готов к проверке» — отдельного «Доработан» в версии 1.1 нет.
  // §15: у уже принятого материала статус принятия сам не сбрасывается.
  const status: MaterialStatus = material.status === 'approved' ? 'approved' : 'ready'
  const now = Date.now()
  const stage = await ctx.db.get(material.stageId)
  const due = material.dueDate ?? stage?.endDate ?? null
  await ctx.db.patch(material._id, {
    version,
    status,
    ...(status === 'ready'
      ? { readyAt: now, readyOnTime: due ? now <= dayEnd(due) : true }
      : {}),
  })
  await logPackEvent(ctx, {
    packId: material.packId,
    stageId: material.stageId,
    materialId: material._id,
    type: 'material_version',
    byId,
    field: material.title,
    to: `версия ${version}`,
    note: row.name,
  })
  await syncStageFromMaterials(ctx, material.stageId)
  return version
}

export const addVersion = mutation({
  args: {
    materialId: v.id('packMaterials'),
    kind: v.union(v.literal('file'), v.literal('link')),
    name: v.string(),
    url: v.optional(v.string()),
    storageId: v.optional(v.id('_storage')),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const material = await ctx.db.get(args.materialId)
    if (!material) throw new ConvexError('Материал не найден')
    const { me, pack } = await requirePack(ctx, material.packId, 'work')
    const name = args.name.trim() || args.url?.trim() || `Версия ${material.version + 1}`
    if (args.kind === 'link' && !args.url?.trim()) throw new ConvexError('Укажите ссылку')
    if (args.kind === 'file' && !args.storageId) throw new ConvexError('Файл не загружен')

    const version = await addMaterialVersion(ctx, material, me._id, {
      kind: args.kind,
      name,
      url: args.url?.trim(),
      storageId: args.storageId,
      note: args.note?.trim(),
    })
    // §14.1: клиенту не шлём уведомление о каждом техническом изменении файла —
    // ключевое уведомление это официальная передача этапа.
    await notifyPack(ctx, teamOf(pack), {
      packId: material.packId,
      kind: 'version',
      title: 'Загружена новая версия',
      text: `${pack.title} · ${material.title} · версия ${version}`,
      link: `/packs/${material.packId}`,
      skip: me._id,
    })
    return version
  },
})

export const removeVersion = mutation({
  args: { id: v.id('packMaterialVersions') },
  handler: async (ctx, { id }) => {
    const ver = await ctx.db.get(id)
    if (!ver) return
    const material = await ctx.db.get(ver.materialId)
    if (!material) return
    const { me } = await requirePack(ctx, ver.packId, 'manage')
    if (ver.storageId) await ctx.storage.delete(ver.storageId)
    await ctx.db.delete(id)
    const rest = await ctx.db
      .query('packMaterialVersions')
      .withIndex('by_material', (q) => q.eq('materialId', ver.materialId))
      .collect()
    await ctx.db.patch(material._id, {
      version: rest.length ? Math.max(...rest.map((r) => r.version)) : 0,
    })
    await logPackEvent(ctx, {
      packId: ver.packId,
      stageId: material.stageId,
      materialId: material._id,
      type: 'material_removed',
      byId: me._id,
      field: material.title,
      from: `версия ${ver.version}`,
    })
  },
})

// ——— §11.3: комментарии ———

export async function addPackComment(
  ctx: MutationCtx,
  row: {
    packId: Id<'packs'>
    stageId?: Id<'packStages'>
    materialId?: Id<'packMaterials'>
    versionId?: Id<'packMaterialVersions'>
    authorId: Id<'employees'>
    scope: 'internal' | 'client'
    text: string
    attachments: {
      kind: 'file' | 'link'
      name: string
      url?: string
      storageId?: Id<'_storage'>
    }[]
  },
) {
  const id = await ctx.db.insert('packComments', {
    ...row,
    resolved: false,
    at: Date.now(),
  })
  await logPackEvent(ctx, {
    packId: row.packId,
    stageId: row.stageId,
    materialId: row.materialId,
    type: 'comment',
    byId: row.authorId,
    field: row.scope === 'internal' ? 'внутренний' : 'клиентский',
  })
  return id
}

export const addComment = mutation({
  args: {
    packId: v.id('packs'),
    stageId: v.optional(v.id('packStages')),
    materialId: v.optional(v.id('packMaterials')),
    versionId: v.optional(v.id('packMaterialVersions')),
    scope: v.union(v.literal('internal'), v.literal('client')),
    text: v.string(),
    attachments: v.optional(
      v.array(
        v.object({
          kind: v.union(v.literal('file'), v.literal('link')),
          name: v.string(),
          url: v.optional(v.string()),
          storageId: v.optional(v.id('_storage')),
        }),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const { me, pack } = await requirePack(ctx, args.packId, 'work')
    if (!args.text.trim()) throw new ConvexError('Комментарий пустой')
    await addPackComment(ctx, {
      packId: args.packId,
      stageId: args.stageId,
      materialId: args.materialId,
      versionId: args.versionId,
      authorId: me._id,
      scope: args.scope,
      text: args.text.trim(),
      attachments: args.attachments ?? [],
    })
    // Клиентский комментарий видит клиент — внутренний не покидает команду.
    if (args.scope === 'client' && pack.clientId && pack.launchedAt) {
      await notifyPack(ctx, [pack.clientId], {
        packId: args.packId,
        kind: 'comment',
        title: 'Новый комментарий по проекту',
        text: `${pack.title}\n\n${args.text.trim()}`,
        link: '/',
      })
    }
  },
})

export const resolveComment = mutation({
  args: { id: v.id('packComments'), resolved: v.boolean() },
  handler: async (ctx, { id, resolved }) => {
    const comment = await ctx.db.get(id)
    if (!comment) throw new ConvexError('Комментарий не найден')
    const { me } = await requirePack(ctx, comment.packId, 'work')
    await ctx.db.patch(id, {
      resolved,
      resolvedAt: resolved ? Date.now() : undefined,
      resolvedById: resolved ? me._id : undefined,
    })
  },
})

export const removeComment = mutation({
  args: { id: v.id('packComments') },
  handler: async (ctx, { id }) => {
    const comment = await ctx.db.get(id)
    if (!comment) return
    const me = await requireEmployee(ctx)
    const pack = await ctx.db.get(comment.packId)
    if (!pack) return
    if (comment.authorId !== me._id && !mayManagePack(me, pack)) {
      throw new ConvexError('Удалить комментарий может автор или руководитель проекта')
    }
    for (const a of comment.attachments) {
      if (a.storageId) await ctx.storage.delete(a.storageId)
    }
    await ctx.db.delete(id)
  },
})

// ——— Данные карточки проекта: этапы с материалами и комментариями ———

export const board = query({
  args: { packId: v.id('packs') },
  handler: async (ctx, { packId }) => {
    const me = await currentEmployee(ctx)
    if (!me || me.role === 'client') return null
    const pack = await ctx.db.get(packId)
    if (!pack || !(await maySeePack(ctx, me, pack))) return null

    const stages = await stagesOf(ctx, packId)
    const materials = await ctx.db
      .query('packMaterials')
      .withIndex('by_pack', (q) => q.eq('packId', packId))
      .collect()
    const versions = await ctx.db
      .query('packMaterialVersions')
      .withIndex('by_pack', (q) => q.eq('packId', packId))
      .collect()
    const comments = await ctx.db
      .query('packComments')
      .withIndex('by_pack', (q) => q.eq('packId', packId))
      .collect()
    const people = new Map(
      (await ctx.db.query('employees').collect()).map((e) => [
        e._id as string,
        { name: e.name, initials: e.initials, avatarColor: e.avatarColor, role: e.role },
      ]),
    )
    const who = (id?: Id<'employees'> | null) =>
      id ? (people.get(id as string) ?? { name: '—', initials: '—', avatarColor: '#9498a1', role: 'employee' }) : null

    const versionsByMaterial = new Map<string, typeof versions>()
    for (const v0 of versions) {
      const arr = versionsByMaterial.get(v0.materialId as string) ?? []
      arr.push(v0)
      versionsByMaterial.set(v0.materialId as string, arr)
    }

    // Ссылки на файлы разрешаем здесь: во фронте под каждый файл пришлось бы
    // заводить отдельный запрос, а в списке версий их десятки.
    const fileUrls = new Map<string, string | null>()
    for (const x of versions) {
      if (x.storageId) fileUrls.set(x.storageId as string, await ctx.storage.getUrl(x.storageId))
    }
    for (const c of comments) {
      for (const a of c.attachments) {
        if (a.storageId && !fileUrls.has(a.storageId as string)) {
          fileUrls.set(a.storageId as string, await ctx.storage.getUrl(a.storageId))
        }
      }
    }
    const fileUrl = (id?: Id<'_storage'> | null) => (id ? (fileUrls.get(id as string) ?? null) : null)
    const withUrls = (list: typeof comments) =>
      list.map((c) => ({
        _id: c._id,
        scope: c.scope,
        text: c.text,
        resolved: c.resolved,
        at: c.at,
        author: who(c.authorId),
        attachments: c.attachments.map((a) => ({
          kind: a.kind,
          name: a.name,
          url: a.url ?? fileUrl(a.storageId),
        })),
      }))

    const out = []
    for (const s of stages) {
      const mine = materials.filter((m) => m.stageId === s._id)
      const check = await readiness(ctx, s._id)
      out.push({
        _id: s._id,
        order: s.order,
        kind: s.kind,
        title: s.title,
        clientNote: s.clientNote ?? null,
        internalNote: s.internalNote ?? null,
        startDate: s.startDate ?? null,
        endDate: s.endDate ?? null,
        weight: s.weight,
        reviewDays: s.reviewDays,
        rereviewDays: s.rereviewDays,
        fixDays: s.fixDays,
        doneCondition: s.doneCondition ?? null,
        status: s.status as StageStatus,
        dueAt: s.dueAt ?? null,
        awaiting: s.awaiting ?? null,
        handedAt: s.handedAt ?? null,
        handoverCount: s.handoverCount ?? 0,
        approvedAt: s.approvedAt ?? null,
        approvedBy: who(s.approvedById),
        approvedOnTime: s.approvedOnTime ?? null,
        returnCount: s.returnCount,
        reworkMs: s.reworkMs ?? 0,
        readiness: check,
        materials: mine
          .map((m) => ({
            _id: m._id,
            title: m.title,
            description: m.description ?? null,
            kind: m.kind,
            required: m.required,
            status: m.status as MaterialStatus,
            side: m.side,
            owner: who(m.ownerId),
            dueDate: m.dueDate ?? null,
            version: m.version,
            approvedAt: m.approvedAt ?? null,
            // §6.3, §9.2: оценка заказчика и его решение видны команде.
            rating: m.rating ?? null,
            decidedAt: m.decidedAt ?? null,
            // §10: своевременность считается по дате «Готов к проверке».
            readyAt: m.readyAt ?? null,
            readyOnTime: m.readyOnTime ?? null,
            returnCount: m.returnCount ?? 0,
            versions: (versionsByMaterial.get(m._id as string) ?? [])
              .sort((a, b) => b.version - a.version)
              .map((x) => ({
                _id: x._id,
                version: x.version,
                kind: x.kind,
                name: x.name,
                url: x.url ?? fileUrl(x.storageId),
                note: x.note ?? null,
                at: x.at,
                by: who(x.byId),
              })),
            comments: withUrls(comments.filter((c) => c.materialId === m._id).sort((a, b) => a.at - b.at)),
          }))
          .sort((a, b) => Number(b.required) - Number(a.required) || a.title.localeCompare(b.title, 'ru')),
        comments: withUrls(
          comments.filter((c) => c.stageId === s._id && !c.materialId).sort((a, b) => a.at - b.at),
        ),
      })
    }

    return {
      stages: out,
      weightSum: weightSum(stages.map(stageLike)),
      canManage: mayManagePack(me, pack),
      canWork: mayWorkOnPack(me, pack),
      isOwner: me.role === 'owner',
      launched: !!pack.launchedAt,
      packStatus: pack.status,
      today: today(),
      now: Date.now(),
    }
  },
})

// §6.2: календарь проекта — плановые и фактические даты, проверки, доработки,
// контрольные точки и общая дата завершения. Списком, календарём и временной
// шкалой это рисует фронт из одного набора событий.
export const calendar = query({
  args: { packId: v.id('packs') },
  handler: async (ctx, { packId }) => {
    const me = await currentEmployee(ctx)
    if (!me) return null
    const pack = await ctx.db.get(packId)
    if (!pack || !(await maySeePack(ctx, me, pack))) return null
    const stages = await stagesOf(ctx, packId)
    const forClient = me.role === 'client'

    const items: {
      date: string
      kind: string
      title: string
      fact: boolean
      stageId?: Id<'packStages'>
    }[] = [
      { date: pack.startDate, kind: 'start', title: 'Старт проекта', fact: true },
      { date: pack.dueDate, kind: 'due', title: 'Общий срок проекта', fact: false },
    ]
    for (const s of stages) {
      if (s.startDate) {
        items.push({ date: s.startDate, kind: 'stage_start', title: `${s.title} — плановое начало`, fact: false, stageId: s._id })
      }
      if (s.endDate) {
        items.push({ date: s.endDate, kind: 'stage_end', title: `${s.title} — плановое завершение`, fact: false, stageId: s._id })
      }
      if (s.handedAt) {
        items.push({
          date: new Date(s.handedAt + 5 * 3600 * 1000).toISOString().slice(0, 10),
          kind: 'handover',
          title: `${s.title} — передан на проверку`,
          fact: true,
          stageId: s._id,
        })
      }
      if (s.dueAt && s.status !== 'approved') {
        items.push({
          date: new Date(s.dueAt + 5 * 3600 * 1000).toISOString().slice(0, 10),
          kind: s.awaiting === 'client' ? 'client_deadline' : 'team_deadline',
          title:
            s.awaiting === 'client'
              ? `${s.title} — срок ответа клиента`
              : `${s.title} — срок работы FRANCHONE`,
          fact: false,
          stageId: s._id,
        })
      }
      if (s.approvedAt) {
        items.push({
          date: new Date(s.approvedAt + 5 * 3600 * 1000).toISOString().slice(0, 10),
          kind: 'approved',
          title: `${s.title} — утверждён`,
          fact: true,
          stageId: s._id,
        })
      }
    }
    // §6.1, §6.2: платёжные и иные контрольные даты. Клиенту отдаём только
    // отмеченные как видимые и НИКОГДА не отдаём сумму (§3.1).
    for (const m of await ctx.db
      .query('packMilestones')
      .withIndex('by_pack', (q) => q.eq('packId', packId))
      .collect()) {
      if (forClient && !m.clientVisible) continue
      const money = !forClient && m.amount ? ` — ${m.amount} ₸` : ''
      items.push({
        date: m.date,
        kind: m.kind === 'payment' ? 'payment' : 'control',
        title: `${m.title}${money}`,
        fact: m.done,
      })
    }

    // §6.2: встречи проекта — из общего модуля ERP, по участию команды.
    if (!forClient) {
      const team = new Set(teamOf(pack).map((t) => t as string))
      for (const m of await ctx.db.query('meetings').collect()) {
        if ((m.status ?? 'planned') === 'cancelled') continue
        if (!m.participantIds.some((p) => team.has(p as string))) continue
        if (m.date < pack.startDate || m.date > addDays(pack.dueDate, 30)) continue
        items.push({ date: m.date, kind: 'meeting', title: `Встреча: ${m.title} (${m.time})`, fact: false })
      }
    }
    if (pack.finishedAt) {
      items.push({
        date: new Date(pack.finishedAt + 5 * 3600 * 1000).toISOString().slice(0, 10),
        kind: 'finished',
        title: 'Проект завершён',
        fact: true,
      })
    }
    return {
      items: items.sort((a, b) => a.date.localeCompare(b.date)),
      today: today(),
      startDate: pack.startDate,
      dueDate: pack.dueDate,
    }
  },
})
