// Кабинет клиента (ТЗ Упаковка §10, §13).
//
// ГЛАВНОЕ ПРАВИЛО ФАЙЛА (§3.1, BR-05): ни одно финансовое поле не покидает
// сервер. Стоимость проекта, процент упаковщика, начисленное вознаграждение,
// внутренние комментарии и KPI команды не должны попадать в клиентский ответ
// и не должны быть доступны через просмотр кода страницы или сетевых запросов.
//
// Поэтому здесь НЕТ ни одного `...pack` и ни одного `...stage`: каждый ответ
// собирается поимённо. Добавили поле в схему — оно не появится у клиента само.
// Проверка простая: если в этом файле встретилось слово price, percent, salary
// или reward-сумма — что-то пошло не так.

import { query, mutation } from './_generated/server'
import { v, ConvexError } from 'convex/values'
import type { QueryCtx, MutationCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { currentEmployee, requireEmployee } from './lib'
import {
  logPackEvent,
  notifyPack,
  packSettings,
  settleStageRewards,
  stageLike,
  stagesOf,
  teamOf,
  today,
} from './packs'
import {
  addMaterialVersion,
  addPackComment,
  approveStage,
  returnStage,
  syncStageFromMaterials,
} from './packStages'
import {
  PUZZLE_PARTS,
  clientStageStatus,
  isAtClient,
  isMaterialDone,
  packHealth,
  progressOf,
  type MaterialStatus,
  type StageStatus,
} from './packModel'

// Клиент видит материал только когда тот действительно доступен: пока команда
// его готовит, показывать нечего (§10.2 «доступные материалы»).
const VISIBLE_TO_CLIENT: MaterialStatus[] = ['ready', 'rework', 'reworked', 'approved']

async function myPacks(ctx: QueryCtx | MutationCtx, me: Doc<'employees'>) {
  // BR-12: клиент видит только свой проект. И только запущенный (§4.4).
  return (
    await ctx.db
      .query('packs')
      .withIndex('by_client', (q) => q.eq('clientId', me._id))
      .collect()
  )
    .filter((p) => p.launchedAt)
    .sort((a, b) => (b.launchedAt ?? 0) - (a.launchedAt ?? 0))
}

async function requireClient(ctx: QueryCtx | MutationCtx): Promise<Doc<'employees'> | null> {
  const me = await currentEmployee(ctx)
  if (!me || me.role !== 'client' || me.status !== 'active') return null
  return me
}

async function requireMyPack(
  ctx: MutationCtx,
  packId: Id<'packs'>,
): Promise<{ me: Doc<'employees'>; pack: Doc<'packs'> }> {
  const me = await requireEmployee(ctx)
  if (me.role !== 'client') throw new ConvexError('Действие доступно только клиенту проекта')
  const pack = await ctx.db.get(packId)
  if (!pack || pack.clientId !== me._id || !pack.launchedAt) {
    throw new ConvexError('Проект не найден')
  }
  return { me, pack }
}

// ——— §10.1: верхняя зона кабинета ———

export const dashboard = query({
  args: { packId: v.optional(v.id('packs')) },
  handler: async (ctx, { packId }) => {
    const me = await requireClient(ctx)
    if (!me) return null
    // §10: своё фото заказчик видит, но не меняет — его ставит команда.
    const avatarUrl = me.avatarId ? await ctx.storage.getUrl(me.avatarId) : null
    const packs = await myPacks(ctx, me)
    if (packs.length === 0) {
      return {
        me: { name: me.name, initials: me.initials, avatarColor: me.avatarColor, company: me.positionLabel, avatarUrl },
        packs: [],
        pack: null,
      }
    }
    const pack = (packId && packs.find((p) => p._id === packId)) || packs[0]
    const settings = await packSettings(ctx)
    const stages = await stagesOf(ctx, pack._id)
    const likes = stages.map(stageLike)
    const now = Date.now()
    const health = packHealth({
      status: pack.status,
      dueDate: pack.dueDate,
      stages: likes,
      now,
      warnHours: settings.warnHours,
    })
    const progress = progressOf(likes)
    const current = stages.find((s) => s.status !== 'approved') ?? null
    const waiting = stages.find((s) => isAtClient(s.status)) ?? null

    // §10.1: визуальный путь / Season Pass — уровни по основным этапам.
    const path = stages
      .filter((s) => s.kind === 'main')
      .map((s) => ({
        _id: s._id,
        title: s.title,
        weight: s.weight,
        status: clientStageStatus(s.status as StageStatus),
        approvedAt: s.approvedAt ?? null,
      }))

    const rewards = await ctx.db
      .query('packRewards')
      .withIndex('by_pack', (q) => q.eq('packId', pack._id))
      .collect()

    // §6.1, §7: блок пазла — собранные части, активная и закрытые. Часть
    // соответствует основному этапу; нулевой этап части не открывает (§4.2).
    const mainStages = stages.filter((s) => s.kind === 'main')
    const activeIndex = mainStages.findIndex((s) => !s.puzzleAwarded && s.status !== 'approved')
    const puzzle = {
      total: PUZZLE_PARTS,
      collected: mainStages.filter((s) => s.puzzleAwarded).length,
      parts: mainStages.map((s, i) => ({
        index: i + 1,
        stageId: s._id,
        title: s.title,
        // open — часть открыта; active — этап в работе или на проверке.
        open: s.puzzleAwarded === true,
        active: i === activeIndex,
        awardedAt: s.puzzleAwardedAt ?? null,
        // §15: принят после срока — часть автоматически не выдаётся.
        missed: s.status === 'approved' && !s.puzzleAwarded,
      })),
    }

    const unread = (
      await ctx.db
        .query('packNotifications')
        .withIndex('by_employee', (q) => q.eq('employeeId', me._id))
        .collect()
    ).filter((n) => !n.readAt).length

    // §10.1 «ближайшее действие» — короткая формулировка того, что происходит.
    const nextAction = waiting
      ? `Проверьте этап «${waiting.title}» и утвердите его или отправьте замечания`
      : pack.status === 'paused'
        ? 'Проект приостановлен'
        : pack.status === 'done'
          ? 'Проект завершён — материалы доступны в итоговом хабе'
          : current
            ? `Команда FRANCHONE готовит этап «${current.title}»`
            : 'Ожидание'

    return {
      me: { name: me.name, initials: me.initials, avatarColor: me.avatarColor, company: me.positionLabel, avatarUrl },
      packs: packs.map((p) => ({ _id: p._id, title: p.title })),
      pack: {
        _id: pack._id,
        title: pack.title,
        description: pack.description ?? null,
        status: pack.status,
        startDate: pack.startDate,
        // §10.1: плановая дата завершения.
        dueDate: pack.dueDate,
        progress,
        health: health.health,
        healthReason: health.reason,
        side: health.side,
        // §10.1: таймер текущего согласования.
        timerDueAt: waiting?.dueAt ?? null,
        awaitingStage: waiting ? { _id: waiting._id, title: waiting.title } : null,
        currentStage: current ? { _id: current._id, title: current.title, status: clientStageStatus(current.status as StageStatus) } : null,
        nextAction,
        path,
        pausedReason: pack.status === 'paused' ? (pack.pausedReason ?? null) : null,
        finishedAt: pack.finishedAt ?? null,
        hubOpenedAt: pack.hubOpenedAt ?? null,
      },
      // §10.1: текущая и будущие награды.
      rewards: rewards.map((r) => ({
        _id: r._id,
        title: r.title,
        description: r.description ?? null,
        imageUrl: r.imageUrl ?? null,
        condition: r.condition ?? null,
        status: r.status,
        dueAt: r.dueAt ?? null,
      })),
      puzzle,
      // §7.2: заказчик видит только ПРАВО на подарок. Содержание заранее не
      // раскрывается, внутренний статус и описание ему не показываются (§7.3).
      gift: {
        earned: !!pack.giftEarnedAt,
        earnedAt: pack.giftEarnedAt ?? null,
      },
      unread,
      today: today(),
      now,
    }
  },
})

// ——— §10.2: карта этапов ———

export const stages = query({
  args: { packId: v.id('packs') },
  handler: async (ctx, { packId }) => {
    const me = await requireClient(ctx)
    if (!me) return null
    const pack = await ctx.db.get(packId)
    if (!pack || pack.clientId !== me._id || !pack.launchedAt) return null

    const rows = await stagesOf(ctx, packId)
    const materials = await ctx.db
      .query('packMaterials')
      .withIndex('by_pack', (q) => q.eq('packId', packId))
      .collect()
    const versions = await ctx.db
      .query('packMaterialVersions')
      .withIndex('by_pack', (q) => q.eq('packId', packId))
      .collect()
    // §11.3, BR-12: внутренние обсуждения команды клиент не видит НИКОГДА.
    const comments = (
      await ctx.db
        .query('packComments')
        .withIndex('by_pack', (q) => q.eq('packId', packId))
        .collect()
    ).filter((c) => c.scope === 'client')

    const people = new Map(
      (await ctx.db.query('employees').collect()).map((e) => [
        e._id as string,
        // Клиенту достаточно имени и аватара. Должность, оклад и роль остаются
        // внутри компании.
        { name: e.name, initials: e.initials, avatarColor: e.avatarColor, isTeam: e.role !== 'client' },
      ]),
    )
    const who = (id?: Id<'employees'> | null) =>
      id ? (people.get(id as string) ?? { name: 'FRANCHONE', initials: 'F', avatarColor: '#057269', isTeam: true }) : null

    // Ссылки на файлы разрешаем на сервере: storageId клиенту не нужен, а
    // отдельный запрос под каждый файл превратил бы список версий в лавину.
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
        text: c.text,
        resolved: c.resolved,
        at: c.at,
        author: who(c.authorId),
        mine: c.authorId === me._id,
        attachments: c.attachments.map((a) => ({
          kind: a.kind,
          name: a.name,
          url: a.url ?? fileUrl(a.storageId),
        })),
      }))

    const out = []
    for (const s of rows) {
      const mine = materials.filter(
        (m) =>
          m.stageId === s._id &&
          (m.side === 'client' || VISIBLE_TO_CLIENT.includes(m.status as MaterialStatus)),
      )
      out.push({
        _id: s._id,
        order: s.order,
        kind: s.kind,
        title: s.title,
        // Внутренний комментарий команды сюда не попадает — только описание
        // для клиента (§4.2).
        note: s.clientNote ?? null,
        weight: s.weight,
        status: clientStageStatus(s.status as StageStatus),
        startDate: s.startDate ?? null,
        endDate: s.endDate ?? null,
        dueAt: s.dueAt ?? null,
        awaiting: s.awaiting ?? null,
        handedAt: s.handedAt ?? null,
        approvedAt: s.approvedAt ?? null,
        returnCount: s.returnCount,
        doneCondition: s.doneCondition ?? null,
        // §10.3: можно ли действовать прямо сейчас.
        canAct: isAtClient(s.status as StageStatus) && pack.status === 'active',
        materials: mine.map((m) => ({
          _id: m._id,
          title: m.title,
          description: m.description ?? null,
          kind: m.kind,
          required: m.required,
          status: m.status as MaterialStatus,
          side: m.side,
          dueDate: m.dueDate ?? null,
          version: m.version,
          // §6.2: два решения доступны, пока материал на проверке.
          canDecide:
            m.side === 'team' &&
            pack.status === 'active' &&
            (m.status === 'ready' || m.status === 'reworked'),
          // §6.3: оценка от 1 до 5 звёзд для готового или принятого материала.
          canRate: m.side === 'team' && isMaterialDone(m.status as MaterialStatus),
          rating: m.rating ?? null,
          decidedAt: m.decidedAt ?? null,
          readyAt: m.readyAt ?? null,
          versions: versions
            .filter((x) => x.materialId === m._id)
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
        })),
        comments: withUrls(
          comments.filter((c) => c.stageId === s._id && !c.materialId).sort((a, b) => a.at - b.at),
        ),
      })
    }
    return { stages: out, packStatus: pack.status, today: today(), now: Date.now() }
  },
})

// ——— §10.3: блок «Требуется от вас» ———

export const todo = query({
  args: { packId: v.id('packs') },
  handler: async (ctx, { packId }) => {
    const me = await requireClient(ctx)
    if (!me) return null
    const pack = await ctx.db.get(packId)
    if (!pack || pack.clientId !== me._id || !pack.launchedAt) return null

    const rows = await stagesOf(ctx, packId)
    return {
      // Этапы, ожидающие проверки.
      awaitingStages: rows
        .filter((s) => isAtClient(s.status as StageStatus))
        .map((s) => ({
          _id: s._id,
          title: s.title,
          note: s.clientNote ?? null,
          dueAt: s.dueAt ?? null,
          repeat: (s.handoverCount ?? 0) > 1,
        })),
      // Списки «загрузить материалы» и «неотвеченные комментарии» из блока
      // убраны — заказчик работает с материалами в разделе «Документы», и
      // дублировать их на обзоре не нужно.
      // Ближайшие сроки.
      deadlines: rows
        .filter((s) => s.dueAt && s.status !== 'approved')
        .sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0))
        .slice(0, 5)
        .map((s) => ({
          title: s.title,
          dueAt: s.dueAt ?? null,
          mine: s.awaiting === 'client',
        })),
      now: Date.now(),
    }
  },
})

// ——— §10.3: действия клиента ———

// §6.2: «Принять». Материал получает статус «Принят», решение и дата
// фиксируются. Когда приняты все обязательные материалы этапа, этап
// принимается сам (§5.3, §13.2) — отдельного действия по этапу у клиента нет.
export const acceptMaterial = mutation({
  args: { materialId: v.id('packMaterials') },
  handler: async (ctx, { materialId }) => {
    const material = await ctx.db.get(materialId)
    if (!material) throw new ConvexError('Материал не найден')
    const { me, pack } = await requireMyPack(ctx, material.packId)
    if (pack.status !== 'active') throw new ConvexError('Проект не активен')
    if (material.side !== 'team') throw new ConvexError('Этот материал загружаете вы сами')
    if (!isMaterialDone(material.status as MaterialStatus)) {
      throw new ConvexError('Материал ещё не передан на проверку')
    }
    if (material.status === 'approved') return

    const now = Date.now()
    await ctx.db.patch(materialId, {
      status: 'approved',
      approvedAt: now,
      decidedAt: now,
      decidedById: me._id,
    })
    await logPackEvent(ctx, {
      packId: pack._id,
      stageId: material.stageId,
      materialId,
      type: 'material_status',
      byId: me._id,
      field: material.title,
      to: 'принят',
    })
    // Этап пересобирается по материалам: если приняты все обязательные —
    // он принимается, открывается часть пазла и растёт KPI (§13.2).
    await syncStageFromMaterials(ctx, material.stageId)
    await notifyPack(ctx, teamOf(pack), {
      packId: pack._id,
      kind: 'material_accepted',
      title: 'Заказчик принял материал',
      text: `${pack.title} · ${material.title}`,
      link: `/packs/${pack._id}`,
    })
  },
})

// §6.2: «На доработку». Обязательный комментарий не требуется — содержание
// правок стороны обсуждают во внешних каналах (§1.2, §16).
export const returnMaterial = mutation({
  args: { materialId: v.id('packMaterials') },
  handler: async (ctx, { materialId }) => {
    const material = await ctx.db.get(materialId)
    if (!material) throw new ConvexError('Материал не найден')
    const { me, pack } = await requireMyPack(ctx, material.packId)
    if (pack.status !== 'active') throw new ConvexError('Проект не активен')
    if (material.side !== 'team') throw new ConvexError('Этот материал загружаете вы сами')
    if (!isMaterialDone(material.status as MaterialStatus)) {
      throw new ConvexError('Материал ещё не передан на проверку')
    }
    const now = Date.now()
    await ctx.db.patch(materialId, {
      status: 'rework',
      decidedAt: now,
      decidedById: me._id,
      returnCount: (material.returnCount ?? 0) + 1,
      approvedAt: undefined,
    })
    await logPackEvent(ctx, {
      packId: pack._id,
      stageId: material.stageId,
      materialId,
      type: 'material_status',
      byId: me._id,
      field: material.title,
      to: 'на доработке',
    })
    // §15 «Материал возвращен»: этап не считается принятым до повторной
    // приёмки, а срок доработки идёт по настройке этапа.
    await syncStageFromMaterials(ctx, material.stageId)
    await notifyPack(ctx, teamOf(pack), {
      packId: pack._id,
      kind: 'material_rework',
      title: 'Заказчик вернул материал на доработку',
      text: `${pack.title} · ${material.title}`,
      link: `/packs/${pack._id}`,
    })
  },
})

// §6.3: оценка от 1 до 5 звёзд. Не заменяет «Принять» и на статус не влияет.
export const rateMaterial = mutation({
  args: { materialId: v.id('packMaterials'), rating: v.number() },
  handler: async (ctx, { materialId, rating }) => {
    const material = await ctx.db.get(materialId)
    if (!material) throw new ConvexError('Материал не найден')
    const { pack } = await requireMyPack(ctx, material.packId)
    void pack
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new ConvexError('Оценка — целое число от 1 до 5')
    }
    if (!isMaterialDone(material.status as MaterialStatus)) {
      throw new ConvexError('Оценить можно готовый или принятый материал')
    }
    await ctx.db.patch(materialId, { rating, ratedAt: Date.now() })
  },
})

// §5.3.5: клиент утверждает этап.
export const approve = mutation({
  args: { stageId: v.id('packStages'), note: v.optional(v.string()) },
  handler: async (ctx, { stageId, note }) => {
    const stage = await ctx.db.get(stageId)
    if (!stage) throw new ConvexError('Этап не найден')
    const { me, pack } = await requireMyPack(ctx, stage.packId)
    if (pack.status !== 'active') throw new ConvexError('Проект не активен')
    if (!isAtClient(stage.status as StageStatus)) {
      throw new ConvexError('Этот этап сейчас не на вашей проверке')
    }
    // §5.4: успел ли клиент в срок — от этого зависит только награда,
    // на KPI упаковщика клиентская задержка не влияет (§7.3).
    const onTime = !stage.dueAt || Date.now() <= stage.dueAt
    await settleStageRewards(ctx, stage, me._id, onTime)
    await approveStage(ctx, pack, stage, me._id, note)
    if (note?.trim()) {
      await addPackComment(ctx, {
        packId: pack._id,
        stageId,
        authorId: me._id,
        scope: 'client',
        text: note.trim(),
        attachments: [],
      })
    }
  },
})

// §5.3.5–5.3.6: клиент отправляет ЕДИНЫЙ пакет замечаний — с комментарием и,
// при необходимости, файлами, ссылками, скриншотами или референсами.
export const requestChanges = mutation({
  args: {
    stageId: v.id('packStages'),
    comment: v.string(),
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
  handler: async (ctx, { stageId, comment, attachments }) => {
    const stage = await ctx.db.get(stageId)
    if (!stage) throw new ConvexError('Этап не найден')
    const { me, pack } = await requireMyPack(ctx, stage.packId)
    if (pack.status !== 'active') throw new ConvexError('Проект не активен')
    if (!isAtClient(stage.status as StageStatus)) {
      throw new ConvexError('Этот этап сейчас не на вашей проверке')
    }
    if (!comment.trim()) throw new ConvexError('Опишите замечания — команде важно понять, что изменить')

    // §5.4: отправка замечаний в срок сохраняет награду наравне с
    // утверждением. Нельзя стимулировать принимать результат без проверки.
    const onTime = !stage.dueAt || Date.now() <= stage.dueAt
    await settleStageRewards(ctx, stage, me._id, onTime)

    await addPackComment(ctx, {
      packId: pack._id,
      stageId,
      authorId: me._id,
      scope: 'client',
      text: comment.trim(),
      attachments: attachments ?? [],
    })
    await returnStage(ctx, pack, stage, me._id, comment)
  },
})

// §11.3: комментарий клиента к этапу или материалу.
export const comment = mutation({
  args: {
    packId: v.id('packs'),
    stageId: v.optional(v.id('packStages')),
    materialId: v.optional(v.id('packMaterials')),
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
    const { me, pack } = await requireMyPack(ctx, args.packId)
    if (!args.text.trim()) throw new ConvexError('Комментарий пустой')
    await addPackComment(ctx, {
      packId: args.packId,
      stageId: args.stageId,
      materialId: args.materialId,
      authorId: me._id,
      // Клиент физически не может создать внутренний комментарий: scope зашит.
      scope: 'client',
      text: args.text.trim(),
      attachments: args.attachments ?? [],
    })
    await notifyPack(ctx, teamOf(pack), {
      packId: args.packId,
      kind: 'comment',
      title: 'Комментарий клиента',
      text: `${pack.title}\n\n${args.text.trim()}`,
      link: `/packs/${args.packId}`,
    })
  },
})

export const resolveComment = mutation({
  args: { id: v.id('packComments'), resolved: v.boolean() },
  handler: async (ctx, { id, resolved }) => {
    const row = await ctx.db.get(id)
    if (!row) throw new ConvexError('Комментарий не найден')
    if (row.scope !== 'client') throw new ConvexError('Комментарий не найден')
    const { me } = await requireMyPack(ctx, row.packId)
    await ctx.db.patch(id, {
      resolved,
      resolvedAt: resolved ? Date.now() : undefined,
      resolvedById: resolved ? me._id : undefined,
    })
  },
})

// §3: клиент загружает свои исходники и вложения — и только их.
export const uploadVersion = mutation({
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
    const { me, pack } = await requireMyPack(ctx, material.packId)
    if (material.side !== 'client') {
      throw new ConvexError('Этот материал готовит команда FRANCHONE')
    }
    if (args.kind === 'link' && !args.url?.trim()) throw new ConvexError('Укажите ссылку')
    if (args.kind === 'file' && !args.storageId) throw new ConvexError('Файл не загружен')

    const version = await addMaterialVersion(ctx, material, me._id, {
      kind: args.kind,
      name: args.name.trim() || args.url?.trim() || `Версия ${material.version + 1}`,
      url: args.url?.trim(),
      storageId: args.storageId,
      note: args.note?.trim(),
    })
    await notifyPack(ctx, teamOf(pack), {
      packId: material.packId,
      kind: 'client_upload',
      title: 'Клиент загрузил материал',
      text: `${pack.title} · ${material.title} · версия ${version}`,
      link: `/packs/${material.packId}`,
    })
    return version
  },
})

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const me = await requireEmployee(ctx)
    if (me.role !== 'client') throw new ConvexError('Недоступно')
    return await ctx.storage.generateUploadUrl()
  },
})

// ——— §10.4: дополнительные разделы ———

// Все материалы проекта и история версий — одним списком.
export const materials = query({
  args: { packId: v.id('packs') },
  handler: async (ctx, { packId }) => {
    const me = await requireClient(ctx)
    if (!me) return []
    const pack = await ctx.db.get(packId)
    if (!pack || pack.clientId !== me._id || !pack.launchedAt) return []
    const stageTitle = new Map((await stagesOf(ctx, packId)).map((s) => [s._id as string, s.title]))
    const versions = await ctx.db
      .query('packMaterialVersions')
      .withIndex('by_pack', (q) => q.eq('packId', packId))
      .collect()
    const rows = (
      await ctx.db
        .query('packMaterials')
        .withIndex('by_pack', (q) => q.eq('packId', packId))
        .collect()
    ).filter((m) => m.side === 'client' || VISIBLE_TO_CLIENT.includes(m.status as MaterialStatus))

    const fileUrls = new Map<string, string | null>()
    for (const x of versions) {
      if (x.storageId) fileUrls.set(x.storageId as string, await ctx.storage.getUrl(x.storageId))
    }
    return rows.map((m) => ({
      _id: m._id,
      title: m.title,
      description: m.description ?? null,
      kind: m.kind,
      status: m.status as MaterialStatus,
      side: m.side,
      stage: stageTitle.get(m.stageId as string) ?? '',
      version: m.version,
      approvedAt: m.approvedAt ?? null,
      versions: versions
        .filter((x) => x.materialId === m._id)
        .sort((a, b) => b.version - a.version)
        .map((x) => ({
          _id: x._id,
          version: x.version,
          kind: x.kind,
          name: x.name,
          url: x.url ?? (x.storageId ? (fileUrls.get(x.storageId as string) ?? null) : null),
          at: x.at,
        })),
    }))
  },
})

// §10.4: уведомления клиента.
export const notifications = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireClient(ctx)
    if (!me) return []
    return (
      await ctx.db
        .query('packNotifications')
        .withIndex('by_employee', (q) => q.eq('employeeId', me._id))
        .collect()
    )
      .sort((a, b) => b.at - a.at)
      .slice(0, 60)
      .map((n) => ({
        _id: n._id,
        kind: n.kind,
        title: n.title,
        text: n.text ?? null,
        at: n.at,
        read: !!n.readAt,
      }))
  },
})

export const markRead = mutation({
  args: {},
  handler: async (ctx) => {
    const me = await requireEmployee(ctx)
    if (me.role !== 'client') return
    for (const n of await ctx.db
      .query('packNotifications')
      .withIndex('by_employee', (q) => q.eq('employeeId', me._id))
      .collect()) {
      if (!n.readAt) await ctx.db.patch(n._id, { readAt: Date.now() })
    }
  },
})

// §10.4, §13.3: обучающие материалы, тесты, видео и рекомендации.
// Содержание в первой итерации не детализируется — важна доступность.
export const content = query({
  args: { packId: v.id('packs') },
  handler: async (ctx, { packId }) => {
    const me = await requireClient(ctx)
    if (!me) return []
    const pack = await ctx.db.get(packId)
    if (!pack || pack.clientId !== me._id || !pack.launchedAt) return []
    const rows = await stagesOf(ctx, packId)
    const approvedOrders = rows.filter((s) => s.status === 'approved').map((s) => s.order)
    const maxApproved = approvedOrders.length ? Math.max(...approvedOrders) : -1
    const finished = pack.status === 'done' || pack.status === 'archived'

    const results = await ctx.db
      .query('packTestResults')
      .withIndex('by_pack', (q) => q.eq('packId', packId))
      .collect()

    const list = (
      await ctx.db
        .query('packContent')
        .withIndex('by_published', (q) => q.eq('published', true))
        .collect()
    )
      .filter((c) => !c.packIds?.length || c.packIds.some((p) => p === packId))
      .filter((c) => {
        if (c.availability === 'always') return true
        if (c.availability === 'post_project') return finished
        return maxApproved >= (c.afterStageOrder ?? 0)
      })
      .filter((c) => {
        // §8.1: тест можно назначить конкретному этапу — до его приёмки он
        // в кабинете не показывается.
        if (c.stageOrder === undefined || c.stageOrder === null) return true
        return maxApproved >= c.stageOrder
      })
    const out = []
    for (const c of list) {
      out.push({
        _id: c._id,
        title: c.title,
        kind: c.kind,
        summary: c.summary ?? null,
        body: c.body ?? null,
        url: c.url ?? null,
        coverUrl: c.coverId ? await ctx.storage.getUrl(c.coverId) : null,
        // §8.1: вопросы отдаются БЕЗ правильных ответов — иначе тест можно
        // было бы пройти, посмотрев сетевой запрос.
        questions: await Promise.all(
          (c.questions ?? []).map(async (q) => ({
            text: q.text,
            multiple: q.multiple,
            imageUrl: q.imageId ? await ctx.storage.getUrl(q.imageId) : null,
            options: await Promise.all(
              q.options.map(async (o) => ({
                text: o.text,
                imageUrl: o.imageId ? await ctx.storage.getUrl(o.imageId) : null,
              })),
            ),
          })),
        ),
        // Последний результат прохождения — чтобы не проходить заново вслепую.
        result:
          results
            .filter((r) => r.contentId === c._id)
            .sort((a, b) => b.at - a.at)
            .map((r) => ({ correct: r.correct, total: r.total, at: r.at }))[0] ?? null,
      })
    }
    return out
  },
})

// §8.1: прохождение теста и подсчёт результата после завершения. Тесты не
// влияют на прогресс, KPI, сроки приёмки и пазл (§8, §16).
export const submitTest = mutation({
  args: {
    contentId: v.id('packContent'),
    packId: v.id('packs'),
    // Номера выбранных вариантов по каждому вопросу.
    answers: v.array(v.array(v.number())),
  },
  handler: async (ctx, { contentId, packId, answers }) => {
    const { me, pack } = await requireMyPack(ctx, packId)
    void pack
    const content = await ctx.db.get(contentId)
    if (!content || !content.published || content.kind !== 'test') {
      throw new ConvexError('Тест не найден')
    }
    const questions = content.questions ?? []
    let correct = 0
    questions.forEach((q, i) => {
      const picked = new Set(answers[i] ?? [])
      const right = new Set(q.options.map((o, k) => (o.correct ? k : -1)).filter((k) => k >= 0))
      // Ответ засчитывается, только если выбраны ровно все правильные.
      const same =
        picked.size === right.size && [...right].every((k) => picked.has(k))
      if (same) correct += 1
    })
    await ctx.db.insert('packTestResults', {
      contentId,
      packId,
      employeeId: me._id,
      correct,
      total: questions.length,
      at: Date.now(),
    })
    return { correct, total: questions.length }
  },
})

// §13.1: итоговый хаб — постоянный кабинет готовой франшизы.
export const hub = query({
  args: { packId: v.id('packs') },
  handler: async (ctx, { packId }) => {
    const me = await requireClient(ctx)
    if (!me) return null
    const pack = await ctx.db.get(packId)
    if (!pack || pack.clientId !== me._id || !pack.launchedAt) return null
    // Хаб ещё не открыт — форма ответа та же, просто пустая: иначе у фронта
    // получается два разных типа одного запроса.
    if (!pack.hubOpenedAt) {
      return {
        open: false,
        title: pack.title,
        note: null as string | null,
        finishedAt: null as number | null,
        materials: [] as {
          _id: Id<'packMaterials'>
          title: string
          kind: string
          stage: string
          latest: {
            version: number
            kind: 'file' | 'link'
            name: string
            url: string | null
          } | null
        }[],
        rewards: [] as {
          _id: Id<'packRewards'>
          title: string
          description: string | null
          imageUrl: string | null
          status: string
          grantedAt: number | null
        }[],
        events: [] as {
          _id: Id<'packEvents'>
          type: string
          at: number
          stage: string | null
          note: string | null
        }[],
      }
    }

    const stageTitle = new Map((await stagesOf(ctx, packId)).map((s) => [s._id as string, s.title]))
    const versions = await ctx.db
      .query('packMaterialVersions')
      .withIndex('by_pack', (q) => q.eq('packId', packId))
      .collect()
    const materials = (
      await ctx.db
        .query('packMaterials')
        .withIndex('by_pack', (q) => q.eq('packId', packId))
        .collect()
    ).filter((m) => m.status === 'approved' || m.side === 'client')

    const rewards = (
      await ctx.db
        .query('packRewards')
        .withIndex('by_pack', (q) => q.eq('packId', packId))
        .collect()
    ).filter((r) => r.status === 'earned' || r.status === 'granted' || r.status === 'restored')

    // §13.1: история проекта и согласований. Строки с финансами — не для
    // клиента, поэтому они отфильтрованы, а не «спрятаны в интерфейсе».
    const events = (
      await ctx.db
        .query('packEvents')
        .withIndex('by_pack', (q) => q.eq('packId', packId))
        .collect()
    )
      .filter((e) => !e.financial)
      .filter((e) =>
        ['launched', 'stage_handover', 'stage_return', 'stage_approved', 'finished', 'hub'].includes(
          e.type,
        ),
      )
      .sort((a, b) => b.at - a.at)
      .slice(0, 100)
      .map((e) => ({
        _id: e._id,
        type: e.type,
        at: e.at,
        stage: e.stageId ? (stageTitle.get(e.stageId as string) ?? null) : null,
        note: e.note ?? null,
      }))

    return {
      open: true,
      title: pack.title,
      note: pack.hubNote ?? null,
      finishedAt: pack.finishedAt ?? null,
      // §13.1: итоговые документы и актуальные версии.
      materials: await Promise.all(
        materials.map(async (m) => {
          const latest = versions
            .filter((x) => x.materialId === m._id)
            .sort((a, b) => b.version - a.version)[0]
          return {
            _id: m._id,
            title: m.title,
            kind: m.kind,
            stage: stageTitle.get(m.stageId as string) ?? '',
            latest: latest
              ? {
                  version: latest.version,
                  kind: latest.kind,
                  name: latest.name,
                  url:
                    latest.url ??
                    (latest.storageId ? await ctx.storage.getUrl(latest.storageId) : null),
                }
              : null,
          }
        }),
      ),
      rewards: rewards.map((r) => ({
        _id: r._id,
        title: r.title,
        description: r.description ?? null,
        imageUrl: r.imageUrl ?? null,
        status: r.status,
        grantedAt: r.grantedAt ?? null,
      })),
      events,
    }
  },
})

// §10.4: канал обращения к команде FRANCHONE. Отдельного мессенджера в первой
// итерации нет — обращение приходит команде проекта как комментарий и
// уведомление.
export const contactTeam = mutation({
  args: { packId: v.id('packs'), text: v.string() },
  handler: async (ctx, { packId, text }) => {
    const { me, pack } = await requireMyPack(ctx, packId)
    if (!text.trim()) throw new ConvexError('Напишите сообщение')
    await addPackComment(ctx, {
      packId,
      authorId: me._id,
      scope: 'client',
      text: text.trim(),
      attachments: [],
    })
    await logPackEvent(ctx, { packId, type: 'comment', byId: me._id, field: 'обращение клиента' })
    await notifyPack(ctx, teamOf(pack), {
      packId,
      kind: 'contact',
      title: 'Обращение клиента',
      text: `${pack.title}\n\n${text.trim()}`,
      link: `/packs/${packId}`,
    })
  },
})
