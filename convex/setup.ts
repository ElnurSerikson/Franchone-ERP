// Сервисные операции: разовые настройки, миграции, сиды и сбросы. Прав здесь
// не проверяет никто — значит наружу их отдавать нельзя. Все функции файла
// объявлены как internalMutation: публичная mutation вызывается по HTTP любым,
// кто знает URL деплоя, а он зашит в бандл сайта. Так `resetTeam` снёс бы
// боевую команду со всеми отчётами одним запросом с улицы.
//
// Запуск — из CLI, у него есть админский доступ к internal-функциям:
//   npx convex run setup:seedCatalogs
//   npx convex run setup:addHiddenEmployee '{"email":"…","name":"…","position":"smm"}'
import { internalMutation, internalQuery } from './_generated/server'
import { salesSummary } from './sales'
import { computeMonth } from './payroll'
import { deadlineMs } from './reports'
import { assertCopyable, copyPlanMonth } from './planCopy'
import { collect as targetLeadsCollect } from './targetLeads'
import { datesBetween, meetingStats, reportStats, taskStats } from './effectiveness'
import {
  daysInMonth,
  daysOfMonthInPeriod,
  leadPlanKpi,
  leadWeight,
  monthEnd,
  proratePlan,
} from './targetLeads'
import { v } from 'convex/values'
import type { Doc, Id } from './_generated/dataModel'
import { normalizeAccount, resultCostCents } from './campaignGoals'
import { tgSettings } from './telegram'
import { nowIn, offsetAt, momentIn, deadlineDate as addendumDeadlineDate } from './orgTime'
import type { MutationCtx } from './_generated/server'
// Проверка модуля упаковки использует те же функции, что и сами мутации, —
// иначе она проверяла бы не продукт, а свою копию правил.
import {
  accruedReward as packAccrued,
  packHealth as packHealthOf,
  progressOf as packProgressOf,
  DEFAULT_STAGES,
} from './packModel'
import {
  addDays as packAddDays,
  dayEnd as packDayEnd,
  deadlineFrom as packDeadlineFrom,
  openStageRewards as packOpenRewards,
  preflight as packPreflight,
  settleStageRewards as packSettleRewards,
  stageLike as packStageLike,
  stagesOf as packStagesOf,
  today as packToday,
} from './packs'
import {
  addMaterialVersion as packAddVersion,
  approveStage as packApproveStage,
  readiness as packReadiness,
  returnStage as packReturnStage,
} from './packStages'

async function packProgress(ctx: MutationCtx, packId: Id<'packs'>): Promise<number> {
  return packProgressOf((await packStagesOf(ctx, packId)).map(packStageLike))
}

// Одноразовая настройка: назначить владельцу email для входа и привести
// все email сотрудников к нижнему регистру (email = логин).
export const bootstrapOwner = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const target = email.toLowerCase().trim()
    const all = await ctx.db.query('employees').collect()

    for (const e of all) {
      const low = e.email.toLowerCase().trim()
      if (low !== e.email) await ctx.db.patch(e._id, { email: low })
    }

    const owner = all.find((e) => e.role === 'owner')
    if (!owner) throw new Error('Владелец не найден')
    await ctx.db.patch(owner._id, { email: target })

    return { owner: owner.name, email: target }
  },
})

// Миграция задач под 3-статусную модель ТЗ (Назначено/В работе/Готово).
// Полностью пересевает демо-задачи с данными о завершении (в срок/опоздание).
type Seed = {
  title: string
  desc?: string
  status: 'assigned' | 'in_progress' | 'done'
  priority: 'low' | 'medium' | 'high' | 'urgent'
  assignee: Doc<'employees'>
  reporter: Doc<'employees'>
  deadline: string
  completedAt?: number
  onTime?: boolean
  tags?: string[]
  kpiRef?: string
}

export const reseedTasks = internalMutation({
  args: {},
  handler: async (ctx) => {
    for (const t of ['taskComments', 'taskEvents', 'taskAttachments', 'tasks'] as const) {
      const rows = await ctx.db.query(t).collect()
      for (const r of rows) await ctx.db.delete(r._id)
    }

    const emps = await ctx.db.query('employees').collect()
    const owner = emps.find((e) => e.role === 'owner')!
    const smm = emps.find((e) => e.position === 'smm')!
    const targ = emps.find((e) => e.position === 'targetolog')!
    const head = emps.find((e) => e.role === 'head')!
    const packer = emps.find((e) => e.position === 'packer')!
    const ms = (d: string) => new Date(d + 'T12:00:00Z').getTime()

    const TASKS: Seed[] = [
      { title: 'Снять 4 Reels для аккаунта ANUAR', desc: 'Съёмка и монтаж по контент-плану на неделю.', status: 'assigned', priority: 'high', assignee: smm, reporter: owner, deadline: '2026-07-24', tags: ['SMM', 'Контент'], kpiRef: 'ANUAR · Рилсы' },
      { title: 'Обзвонить 22 заявки по «Упаковке»', desc: 'Новые заявки с прошлой недели.', status: 'assigned', priority: 'high', assignee: head, reporter: owner, deadline: '2026-07-22', tags: ['Продажи'] },
      { title: 'Свести отчёт по CPL за июль', status: 'assigned', priority: 'low', assignee: targ, reporter: head, deadline: '2026-07-31', tags: ['Таргет', 'Отчёт'] },
      { title: 'Перезапустить кампанию «Брокеридж»', desc: 'CPL выше плана — обновить креативы и аудитории.', status: 'in_progress', priority: 'urgent', assignee: targ, reporter: owner, deadline: '2026-07-20', tags: ['Таргет', 'FR-002'], kpiRef: 'Кампания FR-002' },
      { title: 'Упаковка GREEK FOOD — операционный блок', desc: 'Чек-листы открытия, бизнес-процессы.', status: 'in_progress', priority: 'medium', assignee: packer, reporter: head, deadline: '2026-07-25', tags: ['Упаковка', 'Проект'] },
      { title: 'Карусель «5 мифов о франчайзинге»', status: 'in_progress', priority: 'medium', assignee: smm, reporter: owner, deadline: '2026-07-23', tags: ['SMM', 'Контент'], kpiRef: 'FRANCHONE · Карусели' },
      { title: 'Обновить прайс на сайте franchone.kz', desc: 'Актуализировать стоимость услуг.', status: 'in_progress', priority: 'high', assignee: head, reporter: owner, deadline: '2026-07-16', tags: ['Сайт'] },
      { title: 'Финмодель для франшизы Panda Lamian', status: 'done', priority: 'medium', assignee: packer, reporter: head, deadline: '2026-07-15', completedAt: ms('2026-07-14'), onTime: true, tags: ['Упаковка', 'Финансы'] },
      { title: 'Брендбук BLV — правки после ревью', status: 'done', priority: 'low', assignee: packer, reporter: head, deadline: '2026-07-12', completedAt: ms('2026-07-12'), onTime: true, tags: ['Упаковка', 'Бренд'] },
      { title: 'Подготовить 20 сторис FRANCHONE', status: 'done', priority: 'medium', assignee: smm, reporter: owner, deadline: '2026-07-13', completedAt: ms('2026-07-13'), onTime: true, tags: ['SMM'], kpiRef: 'FRANCHONE · Сторис' },
      { title: 'Настроить пиксель для кампании Invite', status: 'done', priority: 'high', assignee: targ, reporter: head, deadline: '2026-07-10', completedAt: ms('2026-07-13'), onTime: false, tags: ['Таргет'] },
      { title: 'Договор франшизы для Aneli', status: 'done', priority: 'medium', assignee: packer, reporter: owner, deadline: '2026-07-08', completedAt: ms('2026-07-11'), onTime: false, tags: ['Упаковка', 'Юр'] },
    ]

    for (const t of TASKS) {
      const id = await ctx.db.insert('tasks', {
        title: t.title,
        description: t.desc,
        status: t.status,
        priority: t.priority,
        assigneeId: t.assignee._id,
        reporterId: t.reporter._id,
        deadline: t.deadline,
        completedAt: t.completedAt,
        completedOnTime: t.onTime,
        tags: t.tags ?? [],
        checklist: [],
        attachments: 0,
        comments: 0,
        kpiRef: t.kpiRef,
      })
      await ctx.db.insert('taskEvents', { taskId: id, type: 'created', byId: t.reporter._id })
      if (t.status === 'done') {
        await ctx.db.insert('taskEvents', {
          taskId: id,
          type: 'status',
          fromStatus: 'in_progress',
          toStatus: 'done',
          byId: t.assignee._id,
        })
      }
    }
    return { tasks: TASKS.length }
  },
})

// Перекраска аватаров под новую фирменную бирюзовую палитру (#057269).
// Одноразовая миграция данных в БД (старые зелёные оттенки → новые).
export const recolorAvatars = internalMutation({
  args: {},
  handler: async (ctx) => {
    const map: Record<string, string> = {
      '#1c7d4d': '#057269',
      '#20915a': '#0a857a',
      '#0f5c34': '#044f48',
      '#57c78a': '#4db3a6',
    }
    let n = 0
    for (const e of await ctx.db.query('employees').collect()) {
      const nc = map[e.avatarColor.toLowerCase()]
      if (nc && nc !== e.avatarColor) {
        await ctx.db.patch(e._id, { avatarColor: nc })
        n++
      }
    }
    return { recolored: n }
  },
})

// Контент-KPI (SMM) за текущий месяц — аккаунты FRANCHONE + ANUAR × форматы.
// Данные соответствуют KPI_SMM (Excel заказчика). employeeId — Ануар (владелец);
// в расчёте KPI не используется (computeSmm суммирует все строки глобально).
export const seedSmm = internalMutation({
  args: {},
  handler: async (ctx) => {
    for (const r of await ctx.db.query('smmMetrics').collect()) await ctx.db.delete(r._id)
    const owner = await ctx.db
      .query('employees')
      .withIndex('by_email', (q) => q.eq('email', 'tassymbekovsky@gmail.com'))
      .first()
    if (!owner) throw new Error('Владелец не найден')

    const SMM = [
      { account: 'FRANCHONE', format: 'Рилсы', weight: 0.2, weekPlans: [4, 4, 4, 4, 0], weekFacts: [5, 0, 0, 0, 0] },
      { account: 'FRANCHONE', format: 'Сторис', weight: 0.1, weekPlans: [24, 24, 24, 24, 0], weekFacts: [8, 0, 0, 0, 0] },
      { account: 'FRANCHONE', format: 'Карусели', weight: 0.1, weekPlans: [1, 1, 1, 1, 0], weekFacts: [6, 0, 0, 0, 0] },
      { account: 'ANUAR', format: 'Рилсы', weight: 0.3, weekPlans: [15, 15, 15, 15, 0], weekFacts: [10, 0, 0, 0, 0] },
      { account: 'ANUAR', format: 'Сторис', weight: 0.2, weekPlans: [35, 35, 35, 35, 0], weekFacts: [14, 0, 0, 0, 0] },
      { account: 'ANUAR', format: 'Карусели', weight: 0.1, weekPlans: [2, 2, 2, 2, 0], weekFacts: [4, 0, 0, 0, 0] },
    ] as const

    for (const m of SMM) {
      await ctx.db.insert('smmMetrics', {
        employeeId: owner._id,
        account: m.account,
        format: m.format,
        weight: m.weight,
        weekPlans: [...m.weekPlans],
        weekFacts: [...m.weekFacts],
        month: '2026-07',
      })
    }
    return { rows: SMM.length }
  },
})

// ДЕМО: мок-данные рекламных кампаний для таба «Таргетолог».
// Удаляется мутацией setup:clearCampaigns по команде.
export const seedCampaigns = internalMutation({
  args: {},
  handler: async (ctx) => {
    for (const c of await ctx.db.query('campaigns').collect()) await ctx.db.delete(c._id)

    const CAMPAIGNS = [
      { code: 'FR-001', account: 'FRANCHONE', category: 'Свои услуги', brand: 'Подбор франшизы', campaign: 'Подбор франшизы', moneySource: 'FRANCHONE', status: 'Активна', weight: 0.125, planBudget: 400000, planLeads: 80, factBudget: 385000, factLeads: 96 },
      { code: 'FR-002', account: 'FRANCHONE', category: 'Свои услуги', brand: 'Брокеридж', campaign: 'Брокеридж', moneySource: 'FRANCHONE', status: 'Активна', weight: 0.125, planBudget: 300000, planLeads: 40, factBudget: 320000, factLeads: 33 },
      { code: 'FR-003', account: 'FRANCHONE', category: 'Свои услуги', brand: 'Invite', campaign: 'Invite', moneySource: 'FRANCHONE', status: 'Активна', weight: 0.125, planBudget: 250000, planLeads: 50, factBudget: 240000, factLeads: 44 },
      { code: 'AN-001', account: 'ANUAR', category: 'Свои услуги', brand: 'Упаковка франшизы', campaign: 'Упаковка франшизы', moneySource: 'FRANCHONE', status: 'Активна', weight: 0.125, planBudget: 500000, planLeads: 25, factBudget: 520000, factLeads: 22 },
      { code: 'AN-002', account: 'ANUAR', category: 'Свои услуги', brand: 'Настройка продаж', campaign: 'Настройка продаж', moneySource: 'FRANCHONE', status: 'Активна', weight: 0.125, planBudget: 200000, planLeads: 30, factBudget: 180000, factLeads: 20 },
      { code: 'AN-003', account: 'ANUAR', category: 'Свои услуги', brand: 'Консультации', campaign: 'Консультации', moneySource: 'FRANCHONE', status: 'Активна', weight: 0.125, planBudget: 150000, planLeads: 40, factBudget: 160000, factLeads: 51 },
      { code: 'PT-001', account: 'GREEK FOOD', category: 'Партнёр', brand: 'Greek Food', campaign: 'Лидген франшизы', moneySource: 'Партнёр', status: 'Активна', weight: 0.125, planBudget: 300000, planLeads: 60, factBudget: 310000, factLeads: 72 },
      { code: 'PT-002', account: 'ROMANTIC', category: 'Партнёр', brand: 'Romantic Flowers', campaign: 'Лидген франшизы', moneySource: 'Партнёр', status: 'Пауза', weight: 0.125, planBudget: 200000, planLeads: 50, factBudget: 195000, factLeads: 45 },
    ] as const

    for (const c of CAMPAIGNS) {
      const campaignId = await ctx.db.insert('campaigns', {
        code: c.code,
        account: c.account,
        category: c.category,
        brand: c.brand,
        campaign: c.campaign,
        moneySource: c.moneySource,
        status: c.status,
      })
      // План на месяц — отдельной записью, как лист «Планы по месяцам».
      // Факт не пишем: он собирается из ежедневных отчётов.
      await ctx.db.insert('campaignPlans', {
        campaignId,
        month: '2026-07',
        planBudget: c.planBudget,
        planLeads: c.planLeads,
        weight: c.weight,
      })
    }
    return { campaigns: CAMPAIGNS.length }
  },
})

// Удалить все кампании (снять демо-данные таргетолога).
export const clearCampaigns = internalMutation({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query('campaigns').collect()
    // Планы удаляем вместе с кампанией: раньше они оставались в базе
    // осиротевшими — расчёт их пропускал, но мусор копился с каждой чисткой.
    let plans = 0
    for (const c of all) {
      for (const p of await ctx.db
        .query('campaignPlans')
        .withIndex('by_campaign', (q) => q.eq('campaignId', c._id))
        .collect()) {
        await ctx.db.delete(p._id)
        plans++
      }
      await ctx.db.delete(c._id)
    }
    return { deleted: all.length, plans }
  },
})

// ——— Сброс перед боевым запуском ———
// Снимает накопленное за демо: сотрудников кроме руководства, их отчёты,
// задачи со всей перепиской и вложениями, историю входов и тестовые закрытия
// месяцев. Конфигурацию (планы SMM, реестр кампаний, оклады, дедлайн) НЕ
// трогает: без неё KPI не с чем сравнивать.
//
// Владельцев не удаляем ни при каких условиях — это единственный вход в
// систему, и потерять его нельзя.
export const resetForProduction = internalMutation({
  args: {},
  handler: async (ctx) => {
    const employees = await ctx.db.query('employees').collect()
    const keep = employees.filter((e) => e.role === 'owner')
    const drop = employees.filter((e) => e.role !== 'owner')

    // Задачи: вместе с комментариями, событиями и файлами из хранилища.
    let tasks = 0
    for (const t of await ctx.db.query('tasks').collect()) {
      for (const c of await ctx.db
        .query('taskComments')
        .withIndex('by_task', (q) => q.eq('taskId', t._id))
        .collect())
        await ctx.db.delete(c._id)
      for (const e of await ctx.db
        .query('taskEvents')
        .withIndex('by_task', (q) => q.eq('taskId', t._id))
        .collect())
        await ctx.db.delete(e._id)
      for (const a of await ctx.db
        .query('taskAttachments')
        .withIndex('by_task', (q) => q.eq('taskId', t._id))
        .collect()) {
        if (a.storageId) await ctx.storage.delete(a.storageId)
        await ctx.db.delete(a._id)
      }
      await ctx.db.delete(t._id)
      tasks++
    }

    // Отчёты и входы — по всем, включая владельцев (демо-данные были и у них).
    let reports = 0
    for (const r of await ctx.db.query('dailyReports').collect()) {
      await ctx.db.delete(r._id)
      reports++
    }
    let logins = 0
    for (const l of await ctx.db.query('loginEvents').collect()) {
      await ctx.db.delete(l._id)
      logins++
    }

    // Тестовые закрытия месяцев и снапшоты начислений.
    let closures = 0
    for (const c of await ctx.db.query('monthClosures').collect()) {
      await ctx.db.delete(c._id)
      closures++
    }
    for (const s of await ctx.db.query('payrollSnapshots').collect()) await ctx.db.delete(s._id)

    // Сотрудники — последними, когда всё связанное уже снято.
    for (const e of drop) {
      await ctx.db.patch(e._id, { lastLoginAt: undefined })
      await ctx.db.delete(e._id)
    }

    // Ключи латиницей: Convex допускает в именах полей только ASCII.
    return {
      deleted: {
        employees: drop.length,
        tasks,
        reports,
        logins,
        monthClosures: closures,
      },
      kept: keep.map((e) => `${e.name} (${e.role})`),
    }
  },
})

// Разовая уборка: планы кампаний, которых уже нет в реестре.
export const dropOrphanPlans = internalMutation({
  args: {},
  handler: async (ctx) => {
    let deleted = 0
    for (const p of await ctx.db.query('campaignPlans').collect()) {
      if (!(await ctx.db.get(p.campaignId))) {
        await ctx.db.delete(p._id)
        deleted++
      }
    }
    return { deleted }
  },
})

// ДЕМО: продажные ежедневные отчёты за текущий месяц (для таба «Отдел продаж»).
// Привязаны к владельцу — в дисциплине/«Мой отчёт» не показываются, только в KPI.
// Удаляются мутацией setup:clearSalesDemo по команде.
export const seedSalesDemo = internalMutation({
  args: {},
  handler: async (ctx) => {
    const owner = await ctx.db
      .query('employees')
      .withIndex('by_email', (q) => q.eq('email', 'tassymbekovsky@gmail.com'))
      .first()
    if (!owner) throw new Error('Владелец не найден')

    for (const r of await ctx.db
      .query('dailyReports')
      .withIndex('by_employee', (q) => q.eq('employeeId', owner._id))
      .collect()) {
      if (r.sales) await ctx.db.delete(r._id)
    }

    const DATA = [
      { date: '2026-07-01', leads: 45, meetings: 26, sales: 7, revenue: 2450000 },
      { date: '2026-07-03', leads: 38, meetings: 22, sales: 6, revenue: 2100000 },
      { date: '2026-07-05', leads: 50, meetings: 30, sales: 8, revenue: 2800000 },
      { date: '2026-07-08', leads: 42, meetings: 24, sales: 7, revenue: 2450000 },
      { date: '2026-07-10', leads: 40, meetings: 23, sales: 6, revenue: 2100000 },
      { date: '2026-07-12', leads: 45, meetings: 25, sales: 8, revenue: 2800000 },
    ]
    for (const d of DATA) {
      const at = Date.parse(`${d.date}T18:00:00+05:00`)
      await ctx.db.insert('dailyReports', {
        employeeId: owner._id,
        position: 'sales',
        date: d.date,
        submittedAt: at,
        onTime: true,
        editCount: 0,
        history: [{ at, byId: owner._id, action: 'submitted' as const }],
        sales: { leads: d.leads, meetings: d.meetings, sales: d.sales, revenue: d.revenue, note: '' },
      })
    }
    return { days: DATA.length }
  },
})

// Снять демо-данные продаж (продажные отчёты владельца).
export const clearSalesDemo = internalMutation({
  args: {},
  handler: async (ctx) => {
    const owner = await ctx.db
      .query('employees')
      .withIndex('by_email', (q) => q.eq('email', 'tassymbekovsky@gmail.com'))
      .first()
    if (!owner) return { deleted: 0 }
    let n = 0
    for (const r of await ctx.db
      .query('dailyReports')
      .withIndex('by_employee', (q) => q.eq('employeeId', owner._id))
      .collect()) {
      if (r.sales) {
        await ctx.db.delete(r._id)
        n++
      }
    }
    return { deleted: n }
  },
})

// Демо-отчёты SMM за июль — чтобы было видно, как ежедневный отчёт становится
// KPI и выплатой. Значения подобраны под планы из seedSmm: большинство форматов
// идёт около 75% плана, а «FRANCHONE Карусели» перевыполнены (6 при плане 4) —
// на них видно отсечку MIN(факт/план; 1). Снести: setup:clearSmmReports.
const SMM_DEMO_DAYS = 24

function smmDemoLines(day: number) {
  return [
    { page: 'FRANCHONE', type: 'Рилсы', count: day % 2 === 0 ? 1 : 0 },
    { page: 'FRANCHONE', type: 'Сторис', count: 3 },
    { page: 'FRANCHONE', type: 'Карусели', count: day % 4 === 0 ? 1 : 0 },
    { page: 'ANUAR', type: 'Рилсы', count: 2 },
    { page: 'ANUAR', type: 'Сторис', count: 4 },
    { page: 'ANUAR', type: 'Карусели', count: day % 3 === 0 ? 1 : 0 },
  ].filter((l) => l.count > 0)
}

export const seedSmmReports = internalMutation({
  args: {},
  handler: async (ctx) => {
    const emps = await ctx.db.query('employees').collect()
    const smm = emps.find((e) => e.position === 'smm' && e.status === 'active' && !e.hidden)
    if (!smm) {
      const who = emps
        .filter((e) => e.status === 'active' && !e.hidden)
        .map((e) => `${e.name} — ${e.position}`)
        .join('; ')
      throw new Error(
        `Нет активного сотрудника с должностью smm. Сейчас в команде: ${who || 'никого'}`,
      )
    }

    // Идемпотентность: свои прошлые демо-отчёты сначала убираем.
    for (const r of await ctx.db
      .query('dailyReports')
      .withIndex('by_employee', (q) => q.eq('employeeId', smm._id))
      .collect()) {
      if (r.smm) await ctx.db.delete(r._id)
    }

    for (let day = 1; day <= SMM_DEMO_DAYS; day++) {
      const date = `2026-07-${String(day).padStart(2, '0')}`
      const at = Date.parse(`${date}T18:00:00+05:00`)
      await ctx.db.insert('dailyReports', {
        employeeId: smm._id,
        position: 'smm' as const,
        date,
        submittedAt: at,
        onTime: true,
        editCount: 0,
        history: [{ at, byId: smm._id, action: 'submitted' as const }],
        smm: smmDemoLines(day),
      })
    }
    return { employee: smm.name, days: SMM_DEMO_DAYS }
  },
})

// ——— Перенос настроек из KPI_SMM.xlsx и KPI_TARGETOLOG.xlsx ———
// Всё числовое из двух книг: оклады и веса с дашбордов, недельные планы SMM,
// реестр кампаний и их веса в KPI. Идемпотентно — можно гонять повторно.
//
// Планы бюджета и заявок по кампаниям в книге пустые (ячейки H/I = 0), поэтому
// заводим нули: их заполняет владелец. Пока они нулевые, кампания не попадает
// в итоговый KPI таргетолога — так же, как в самом файле.
const WB_MONTH = '2026-07' // «Отчетный месяц» B4 на обоих дашбордах

const WB_SMM = [
  { account: 'FRANCHONE' as const, format: 'Рилсы' as const, weight: 0.2, weekPlans: [4, 4, 4, 4, 0] },
  { account: 'FRANCHONE' as const, format: 'Сторис' as const, weight: 0.1, weekPlans: [24, 24, 24, 24, 0] },
  { account: 'FRANCHONE' as const, format: 'Карусели' as const, weight: 0.1, weekPlans: [1, 1, 1, 1, 0] },
  { account: 'ANUAR' as const, format: 'Рилсы' as const, weight: 0.3, weekPlans: [15, 15, 15, 15, 0] },
  { account: 'ANUAR' as const, format: 'Сторис' as const, weight: 0.2, weekPlans: [35, 35, 35, 35, 0] },
  { account: 'ANUAR' as const, format: 'Карусели' as const, weight: 0.1, weekPlans: [2, 2, 2, 2, 0] },
]

const WB_CAMPAIGNS = [
  { code: 'FR-001', account: 'FRANCHONE', brand: 'Подбор франшизы', campaign: 'Подбор франшизы' },
  { code: 'FR-002', account: 'FRANCHONE', brand: 'Брокеридж', campaign: 'Брокеридж' },
  { code: 'FR-003', account: 'FRANCHONE', brand: 'Invite', campaign: 'Invite' },
  { code: 'AN-001', account: 'ANUAR', brand: 'Упаковка франшизы', campaign: 'Упаковка франшизы' },
  { code: 'AN-002', account: 'ANUAR', brand: 'Настройка продаж', campaign: 'Настройка продаж' },
  { code: 'AN-003', account: 'ANUAR', brand: 'Консультации', campaign: 'Консультации' },
]

export const applyKpiWorkbooks = internalMutation({
  args: {},
  handler: async (ctx) => {
    // 1. Дашборды: оклады и веса KPI таргетолога.
    const s = await ctx.db
      .query('settings')
      .withIndex('by_key', (q) => q.eq('key', 'global'))
      .first()
    const values = {
      leadWeight: 0.7,
      cplWeight: 0.3,
      salarySmm: 600000,
      salaryTargetolog: 200000,
    }
    if (s) await ctx.db.patch(s._id, values)
    else
      await ctx.db.insert('settings', {
        key: 'global',
        reportMonth: 'Июль 2026',
        reportDeadlineTime: '20:00',
        ...values,
      })

    // 2. Оклад в карточке сотрудника — чтобы «Оклады» в настройках не пустовали.
    for (const e of await ctx.db.query('employees').collect()) {
      if (e.position === 'smm') await ctx.db.patch(e._id, { salary: values.salarySmm })
      if (e.position === 'targetolog')
        await ctx.db.patch(e._id, { salary: values.salaryTargetolog })
    }

    // 3. Недельные планы и веса SMM.
    const existingSmm = await ctx.db.query('smmMetrics').collect()
    for (const row of WB_SMM) {
      const hit = existingSmm.find(
        (m) => m.month === WB_MONTH && m.account === row.account && m.format === row.format,
      )
      const doc = { ...row, month: WB_MONTH, weekFacts: [0, 0, 0, 0, 0] }
      if (hit) await ctx.db.patch(hit._id, doc)
      else await ctx.db.insert('smmMetrics', doc)
    }

    // 4. Реестр кампаний и их веса в KPI: 6 кампаний, вес поровну (1/6).
    const weight = 1 / WB_CAMPAIGNS.length
    for (const c of WB_CAMPAIGNS) {
      let row = await ctx.db
        .query('campaigns')
        .withIndex('by_code', (q) => q.eq('code', c.code))
        .first()
      const card = {
        ...c,
        category: 'Свои услуги',
        moneySource: 'FRANCHONE' as const,
        status: 'Активна' as const,
      }
      if (row) await ctx.db.patch(row._id, card)
      else row = (await ctx.db.get(await ctx.db.insert('campaigns', card)))!

      const plans = await ctx.db
        .query('campaignPlans')
        .withIndex('by_campaign', (q) => q.eq('campaignId', row!._id))
        .collect()
      const plan = plans.find((p) => p.month === WB_MONTH)
      if (plan) await ctx.db.patch(plan._id, { weight })
      else
        await ctx.db.insert('campaignPlans', {
          campaignId: row._id,
          month: WB_MONTH,
          planBudget: 0,
          planLeads: 0,
          weight,
        })
    }

    return {
      month: WB_MONTH,
      smmRows: WB_SMM.length,
      campaigns: WB_CAMPAIGNS.length,
      salarySmm: values.salarySmm,
      salaryTargetolog: values.salaryTargetolog,
    }
  },
})

export const clearSmmReports = internalMutation({
  args: {},
  handler: async (ctx) => {
    const emps = await ctx.db.query('employees').collect()
    let n = 0
    for (const e of emps) {
      if (e.position !== 'smm') continue
      for (const r of await ctx.db
        .query('dailyReports')
        .withIndex('by_employee', (q) => q.eq('employeeId', e._id))
        .collect()) {
        if (r.smm) {
          await ctx.db.delete(r._id)
          n++
        }
      }
    }
    return { deleted: n }
  },
})

// Сделать аккаунт скрытым владельцем (служебный/разработчик): полный доступ
// по роли owner, но невидим во всех списках фронта. Вход и роль работают
// (currentEmployee/isInvited матчат по email независимо от hidden).
export const makeHiddenAdmin = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const e = await ctx.db
      .query('employees')
      .withIndex('by_email', (q) => q.eq('email', email.toLowerCase().trim()))
      .first()
    if (!e) throw new Error('Сотрудник не найден: ' + email)
    await ctx.db.patch(e._id, { role: 'owner', hidden: true })
    return { updated: e.name, email: e.email }
  },
})

// Сброс команды под реальный старт: стирает демо-данные (задачи, кампании,
// SMM-метрики, ежедневные отчёты, входы) и старых сотрудников, создаёт
// реальную стартовую команду (владелец + AI-разработчик). Auth-таблицы не трогаем.
export const resetTeam = internalMutation({
  args: {},
  handler: async (ctx) => {
    // 1. Зависимые демо-данные
    for (const t of [
      'taskComments',
      'taskEvents',
      'taskAttachments',
      'tasks',
      'dailyReports',
      'smmMetrics',
      'campaigns',
      'loginEvents',
    ] as const) {
      for (const r of await ctx.db.query(t).collect()) await ctx.db.delete(r._id)
    }

    // 2. Все текущие сотрудники
    for (const e of await ctx.db.query('employees').collect()) await ctx.db.delete(e._id)

    // 3. Реальная стартовая команда (email в нижнем регистре — это логин)
    const owner = await ctx.db.insert('employees', {
      name: 'Ануар Тасымбеков',
      role: 'owner',
      position: 'sales',
      positionLabel: 'Владелец / основатель',
      department: 'Руководство',
      salary: 0,
      email: 'tassymbekovsky@gmail.com',
      phone: '',
      avatarColor: '#057269',
      initials: 'АТ',
      status: 'active',
      hiredAt: '2017-01-10',
    })
    const dev = await ctx.db.insert('employees', {
      name: 'Елнур Серикулы',
      role: 'employee',
      position: 'developer',
      positionLabel: 'AI разработчик',
      department: 'Разработка',
      salary: 0,
      email: 'elnur.serikson@gmail.com',
      phone: '',
      avatarColor: '#0a857a',
      initials: 'ЕС',
      status: 'active',
      hiredAt: '2026-07-01',
    })

    return { owner, dev, team: 2 }
  },
})

// Демо-отчёты для раздела «Отчёты» (§3). Наполняет сетку дисциплины
// за последние 14 дней с разным статусом (в срок / с опозданием / пропуск).
export const seedReports = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db.query('dailyReports').collect()
    for (const r of existing) await ctx.db.delete(r._id)

    // Дедлайн отчёта по умолчанию — 20:00 (Алматы).
    const settings = await ctx.db
      .query('settings')
      .withIndex('by_key', (q) => q.eq('key', 'global'))
      .first()
    if (settings && !settings.reportDeadlineTime) {
      await ctx.db.patch(settings._id, { reportDeadlineTime: '20:00' })
    }

    const emps = await ctx.db.query('employees').collect()
    const byPos = (p: string, role?: string) =>
      emps.find((e) => e.position === p && (role ? e.role === role : true))!
    const smm = byPos('smm')
    const targ = byPos('targetolog')
    const salesHead = byPos('sales', 'head')

    const today = new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 10)
    const addDays = (d: string, delta: number) =>
      new Date(Date.parse(`${d}T00:00:00Z`) + delta * 86400000).toISOString().slice(0, 10)
    const submitMs = (date: string, ok: boolean) =>
      Date.parse(`${date}T${ok ? '18:20' : '21:40'}:00+05:00`)

    // 'o' = в срок, 'l' = с опозданием, '-' = не сдан. Индекс = дней назад (0 = сегодня).
    const insert = async (
      e: Doc<'employees'>,
      pattern: string,
      make: (date: string) => Record<string, unknown>,
    ) => {
      for (let off = 0; off < pattern.length; off++) {
        const code = pattern[off]
        if (code === '-') continue
        const date = addDays(today, -off)
        const ok = code === 'o'
        const at = submitMs(date, ok)
        await ctx.db.insert('dailyReports', {
          employeeId: e._id,
          position: e.position as 'smm' | 'targetolog' | 'sales',
          date,
          submittedAt: at,
          onTime: ok,
          editCount: 0,
          history: [{ at, byId: e._id, action: 'submitted' as const }],
          ...make(date),
        })
      }
    }

    // Нурай (SMM) — дисциплинирован, одно опоздание, один пропуск.
    await insert(smm, 'oooooloooo-ooo', (date) => {
      const seed = Number(date.slice(-2))
      return {
        smm: [
          { page: 'FRANCHONE', type: 'Reels', count: 1 + (seed % 3) },
          { page: 'FRANCHONE', type: 'Stories', count: 3 + (seed % 4) },
          { page: 'ANUAR', type: 'Reels', count: seed % 2 },
          { page: 'ANUAR', type: 'Посты', count: 1 },
        ],
      }
    })

    // Дамир (таргетолог) — нерегулярно, много пропусков.
    await insert(targ, '-oo-l-oo--l--o', (date) => {
      const seed = Number(date.slice(-2))
      const budget = 12000 + (seed % 5) * 1500
      const leads = 6 + (seed % 7)
      return {
        targetolog: [
          { project: 'Упаковка франшиз', campaign: 'FR-001 · Лиды', budget, leads },
          {
            project: 'GREEK FOOD',
            campaign: 'FR-002 · Охваты',
            budget: 8000 + (seed % 4) * 1200,
            leads: 3 + (seed % 4),
          },
        ],
      }
    })

    // Аружан (руководитель отдела продаж) — сдаёт наравне с сотрудниками.
    await insert(salesHead, 'ooloooooolo--o', (date) => {
      const seed = Number(date.slice(-2))
      return {
        sales: {
          leads: 18 + (seed % 10),
          meetings: 6 + (seed % 4),
          sales: 2 + (seed % 3),
          revenue: (2 + (seed % 3)) * 420000,
          note: '',
        },
      }
    })

    return { seeded: existing.length === 0 ? 'fresh' : 'reseeded' }
  },
})

// Демо-входы для раздела «Активность». Ерлан — «давно не заходил».
export const seedActivity = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db.query('loginEvents').collect()
    for (const r of existing) await ctx.db.delete(r._id)

    const emps = await ctx.db.query('employees').collect()
    const owner = emps.find((e) => e.role === 'owner')!
    const smm = emps.find((e) => e.position === 'smm')!
    const targ = emps.find((e) => e.position === 'targetolog')!
    const head = emps.find((e) => e.role === 'head')!
    const packer = emps.find((e) => e.position === 'packer')!
    const now = Date.now()
    const D = 24 * 60 * 60 * 1000

    const plan: Array<{ e: Doc<'employees'>; days: number[] }> = [
      { e: owner, days: [0, 0, 0, 1, 1, 2, 3, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] },
      { e: smm, days: [0, 1, 2, 3, 4, 6, 7, 9, 11, 13] },
      { e: targ, days: [1, 1, 3, 5, 8, 12] },
      { e: head, days: [0, 1, 2, 4, 5, 8, 10] },
      { e: packer, days: [6, 9, 13] },
    ]

    for (const { e, days } of plan) {
      let lastAt = 0
      for (const d of days) {
        const at = now - d * D - d * 3600000
        await ctx.db.insert('loginEvents', { employeeId: e._id, at })
        if (at > lastAt) lastAt = at
      }
      await ctx.db.patch(e._id, { lastLoginAt: lastAt })
    }
    return { seeded: plan.length }
  },
})

// Скрытый служебный аккаунт-сотрудник: доступ по роли есть, но нигде во
// фронте не виден (Команда/KPI/Дисциплина/Активность фильтруют hidden) — как
// у владельца elnur.serikson. Нужен, чтобы владелец зашёл «как сотрудник» и
// проверил кабинет отчётов. Запуск:
// npx convex run setup:addHiddenEmployee '{"email":"almnurken@gmail.com","name":"Алмнуркен","position":"smm"}'
export const addHiddenEmployee = internalMutation({
  args: {
    email: v.string(),
    name: v.string(),
    position: v.optional(
      v.union(v.literal('smm'), v.literal('targetolog'), v.literal('sales')),
    ),
  },
  handler: async (ctx, { email, name, position }) => {
    const low = email.toLowerCase().trim()
    const pos = position ?? 'smm'
    const LABEL = { smm: 'SMM-специалист', targetolog: 'Таргетолог', sales: 'Менеджер по продажам' } as const
    const DEPT = { smm: 'Маркетинг', targetolog: 'Маркетинг', sales: 'Продажи' } as const
    const parts = name.trim().split(/\s+/).filter(Boolean)
    const initials = (parts.length >= 2 ? parts[0][0] + parts[1][0] : name.trim().slice(0, 2)).toUpperCase()

    const fields = {
      name: name.trim(),
      role: 'employee' as const,
      position: pos,
      positionLabel: LABEL[pos],
      department: DEPT[pos],
      salary: 0,
      email: low,
      phone: '',
      avatarColor: '#7c3aed',
      initials,
      status: 'active' as const,
      hiredAt: '2026-07-01',
      hidden: true,
    }

    const existing = await ctx.db
      .query('employees')
      .withIndex('by_email', (q) => q.eq('email', low))
      .first()
    if (existing) {
      await ctx.db.patch(existing._id, fields)
      return { updated: true, email: low, position: pos }
    }
    await ctx.db.insert('employees', fields)
    return { created: true, email: low, position: pos }
  },
})

// DEV: подготовить скрытого sales-сотрудника и тестовые объекты продаж для
// проверки нового модуля без попадания тестового аккаунта в обычные списки.
// Запуск:
// npx convex run setup:seedHiddenSalesObjects '{"email":"almnurken@gmail.com","month":"2026-07"}'
export const seedHiddenSalesObjects = internalMutation({
  args: {
    email: v.optional(v.string()),
    month: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const email = (args.email ?? 'almnurken@gmail.com').toLowerCase().trim()
    const month = args.month ?? '2026-07'
    const existingEmployee = await ctx.db
      .query('employees')
      .withIndex('by_email', (q) => q.eq('email', email))
      .first()

    const employeeFields = {
      name: existingEmployee?.name ?? 'Алмнур Кен',
      role: 'employee' as const,
      position: 'sales',
      positionLabel: 'Менеджер по продажам',
      department: 'Продажи',
      salary: existingEmployee?.salary ?? 0,
      email,
      phone: existingEmployee?.phone ?? '',
      avatarColor: existingEmployee?.avatarColor ?? '#7c3aed',
      initials: existingEmployee?.initials ?? 'АК',
      status: 'active' as const,
      hiredAt: existingEmployee?.hiredAt ?? '2026-07-01',
      hidden: true,
    }

    const employeeId = existingEmployee?._id ?? (await ctx.db.insert('employees', employeeFields))
    if (existingEmployee) await ctx.db.patch(existingEmployee._id, employeeFields)

    const rows = [
      {
        name: 'Упаковка',
        type: 'service' as const,
        planDeals: 4,
        comment: 'Комплексная упаковка франшизы: финмодель, бренд, процессы и запуск.',
      },
      {
        name: 'Инвайт',
        type: 'service' as const,
        planDeals: 3,
        comment: 'Invite-механика и привлечение заявок на консультации.',
      },
      {
        name: 'Консалтинг',
        type: 'service' as const,
        planDeals: 2,
        comment: 'Консультационные продукты по продажам, масштабированию и франчайзингу.',
      },
      {
        name: 'Подбор',
        type: 'service' as const,
        planDeals: 5,
        comment: 'Подбор франшизы и сопровождение клиента до сделки.',
      },
    ]

    const objectNames: string[] = []
    for (const row of rows) {
      const existingObject = (await ctx.db.query('salesObjects').collect()).find(
        (object) => object.name.toLowerCase() === row.name.toLowerCase(),
      )
      const managerIds = Array.from(
        new Set([...(existingObject?.managerIds ?? []), employeeId]),
      )
      const objectId =
        existingObject?._id ??
        (await ctx.db.insert('salesObjects', {
          name: row.name,
          type: row.type,
          status: 'active',
          managerIds,
          comment: row.comment,
          createdAt: Date.now(),
        }))
      if (existingObject) {
        await ctx.db.patch(existingObject._id, {
          type: row.type,
          status: 'active',
          managerIds,
          comment: row.comment,
        })
      }

      const existingMonth = await ctx.db
        .query('salesObjectMonths')
        .withIndex('by_object_month', (q) => q.eq('objectId', objectId).eq('month', month))
        .first()
      const otherPlans = (existingMonth?.managerPlans ?? []).filter(
        (plan) => plan.managerId !== employeeId,
      )
      const managerPlans = [...otherPlans, { managerId: employeeId, planDeals: row.planDeals }]
      if (existingMonth) {
        await ctx.db.patch(existingMonth._id, { status: 'selling', managerPlans })
      } else {
        await ctx.db.insert('salesObjectMonths', {
          objectId,
          month,
          status: 'selling',
          managerPlans,
        })
      }
      objectNames.push(row.name)
    }

    return { email, employeeId, month, objects: objectNames }
  },
})

// Миграция §5 на персональную модель KPI/оклада. Аккуратно с боевыми данными:
// — SMM-планы (smmMetrics) привязываем к действующему SMM-специалисту (Нурай);
// — план продаж (settings.planRevenueSales) переносим в salesPlans на менеджера
//   (Асем) за текущий месяц;
// — оклад на человека: из settings по должности, если у сотрудника ещё 0.
// Факты не трогаем — они уже в ежедневных отчётах и привязаны к employeeId.
// Идемпотентна: повторный запуск не дублирует.
export const migrateToPerEmployeeKpi = internalMutation({
  args: {},
  handler: async (ctx) => {
    const emps = await ctx.db.query('employees').collect()
    const s = await ctx.db
      .query('settings')
      .withIndex('by_key', (q) => q.eq('key', 'global'))
      .first()
    const SAL: Record<string, number> = {
      smm: s?.salarySmm ?? 0,
      targetolog: s?.salaryTargetolog ?? 0,
      sales: s?.salarySales ?? 0,
    }
    const month = new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 7)
    const real = (pos: string) =>
      emps.find((e) => e.position === pos && !e.hidden && e.status === 'active' && e.role !== 'owner')

    const out = { month, salariesSet: [] as string[], smmReassigned: 0, salesPlan: null as null | string }

    // 1. Оклад на человека.
    for (const e of emps) {
      if (e.hidden || e.role === 'owner') continue
      const want = SAL[e.position] ?? 0
      if ((e.salary ?? 0) === 0 && want > 0) {
        await ctx.db.patch(e._id, { salary: want })
        out.salariesSet.push(`${e.name}: ${want}`)
      }
    }

    // 2. SMM-планы → действующему SMM-специалисту.
    const smmEmp = real('smm')
    if (smmEmp) {
      for (const m of await ctx.db.query('smmMetrics').collect()) {
        if (m.employeeId !== smmEmp._id) {
          await ctx.db.patch(m._id, { employeeId: smmEmp._id })
          out.smmReassigned++
        }
      }
    }

    // 3. План продаж → менеджеру, за текущий месяц (если ещё нет).
    const salesEmp = real('sales')
    if (salesEmp) {
      const has = (
        await ctx.db
          .query('salesPlans')
          .withIndex('by_employee', (q) => q.eq('employeeId', salesEmp._id))
          .collect()
      ).some((p) => p.month === month)
      if (!has) {
        await ctx.db.insert('salesPlans', {
          employeeId: salesEmp._id,
          month,
          planRevenue: s?.planRevenueSales ?? 0,
        })
        out.salesPlan = `${salesEmp.name}: ${s?.planRevenueSales ?? 0} (${month})`
      }
    }

    return out
  },
})

// Переключить видимость сотрудника. hidden=false — показать в Команде/KPI/
// Дисциплине и включить его отчёты в общий факт (для сквозного теста);
// hidden=true — снова спрятать и исключить из KPI. Запуск:
// npx convex run setup:setEmployeeHidden '{"email":"almnurken@gmail.com","hidden":false}'
export const setEmployeeHidden = internalMutation({
  args: { email: v.string(), hidden: v.boolean() },
  handler: async (ctx, { email, hidden }) => {
    const low = email.toLowerCase().trim()
    const e = await ctx.db
      .query('employees')
      .withIndex('by_email', (q) => q.eq('email', low))
      .first()
    if (!e) throw new Error(`Сотрудник не найден: ${low}`)
    await ctx.db.patch(e._id, { hidden })
    return { email: low, hidden, name: e.name }
  },
})

// Заполнить справочники должностей и отделов из текущих данных (§11, Stage B).
// Идемпотентна. Встроенные должности (smm/targetolog/sales) помечаем builtin —
// на них завязан KPI, удалять нельзя.
export const seedCatalogs = internalMutation({
  args: {},
  handler: async (ctx) => {
    const POSITIONS = [
      { slug: 'smm', label: 'SMM-специалист', kpiModel: 'smm' as const, builtin: true },
      { slug: 'targetolog', label: 'Таргетолог', kpiModel: 'targetolog' as const, builtin: true },
      { slug: 'sales', label: 'Менеджер по продажам', kpiModel: 'sales' as const, builtin: true },
      { slug: 'packer', label: 'Упаковщик / проект-менеджер', kpiModel: 'none' as const },
      { slug: 'developer', label: 'AI разработчик', kpiModel: 'none' as const },
    ]
    const existingPos = await ctx.db.query('positions').collect()
    let posAdded = 0
    for (const p of POSITIONS) {
      if (!existingPos.some((x) => x.slug === p.slug)) {
        await ctx.db.insert('positions', p)
        posAdded++
      }
    }

    const emps = await ctx.db.query('employees').collect()
    const names = new Set<string>(['Маркетинг', 'Продажи', 'Производство', 'Руководство', 'Разработка'])
    for (const e of emps) if (e.department?.trim()) names.add(e.department.trim())
    const existingDep = await ctx.db.query('departments').collect()
    let depAdded = 0
    for (const name of names) {
      if (!existingDep.some((d) => d.name === name)) {
        await ctx.db.insert('departments', { name })
        depAdded++
      }
    }
    return { posAdded, depAdded }
  },
})

// Одноразово: привести position каждого отчёта к фактическому разделу данных
// (smm/targetolog/sales). Чинит старые отчёты, где position «застрял» от
// прежней должности сотрудника, из-за чего форма рисовалась пустой.
export const syncReportPositions = internalMutation({
  args: {},
  handler: async (ctx) => {
    const changes: { date: string; from: string; to: string }[] = []
    for (const r of await ctx.db.query('dailyReports').collect()) {
      const actual = r.smm ? 'smm' : r.targetolog ? 'targetolog' : r.sales ? 'sales' : null
      if (actual && actual !== r.position) {
        await ctx.db.patch(r._id, { position: actual })
        changes.push({ date: r.date, from: r.position, to: actual })
      }
    }
    return { fixed: changes.length, changes }
  },
})

// Одноразово: выставить час дедлайна ежедневных отчётов. Значение в БД
// перекрывает умолчание из кода, поэтому после смены правила его надо
// обновить явно. ТЗ СИСТЕМА §2 — 14:00 СЛЕДУЮЩЕГО календарного дня; «на
// следующий день» зашито в расчёте, здесь задаётся только час.
// Запуск: npx convex run setup:setReportDeadline
export const setReportDeadline = internalMutation({
  args: { time: v.optional(v.string()) },
  handler: async (ctx, { time }) => {
    const value = time ?? '14:00'
    const row = await ctx.db
      .query('settings')
      .withIndex('by_key', (q) => q.eq('key', 'global'))
      .first()
    if (row) await ctx.db.patch(row._id, { reportDeadlineTime: value })
    return { reportDeadlineTime: value, existed: !!row }
  },
})

// Сменить должность сотрудника по email, не трогая больше ничего: ни статус,
// ни видимость, ни отдел. Подпись берём из справочника positions — если задать
// её руками, slug и ярлык разойдутся, и в карточке будет одно, а в расчёте KPI
// другое. Запуск: npx convex run setup:setEmployeePosition '{"email":"…","position":"targetolog"}'
export const setEmployeePosition = internalMutation({
  args: { email: v.string(), position: v.string() },
  handler: async (ctx, { email, position }) => {
    const low = email.toLowerCase().trim()
    const emp = await ctx.db
      .query('employees')
      .withIndex('by_email', (q) => q.eq('email', low))
      .first()
    if (!emp) throw new Error(`Сотрудник ${low} не найден`)
    const pos = await ctx.db
      .query('positions')
      .withIndex('by_slug', (q) => q.eq('slug', position))
      .first()
    if (!pos) throw new Error(`Должности «${position}» нет в справочнике positions`)
    await ctx.db.patch(emp._id, { position: pos.slug, positionLabel: pos.label })
    // Имена полей — только ASCII: Convex не сериализует кириллические ключи.
    return {
      name: emp.name,
      email: low,
      from: `${emp.position} (${emp.positionLabel})`,
      to: `${pos.slug} (${pos.label})`,
    }
  },
})

// Демо-данные отдела продаж для DEV: три объекта, назначенные на тестового
// менеджера, планы месяца и история за три прошедших дня. Сегодняшний день
// намеренно оставлен пустым — чтобы можно было вживую сдать отчёт и увидеть
// галочки, счётчик «Сдано отчётов» и пересчёт LIVE-воронки.
// Только для dev: на проде падает, ничего не тронув.
export const seedDevSalesDemo = internalMutation({
  args: { email: v.optional(v.string()) },
  handler: async (ctx, { email }) => {
    const url = process.env.CONVEX_CLOUD_URL ?? ''
    if (!url.includes(DEV_DEPLOYMENT)) {
      throw new Error(`Только для dev-деплоймента ${DEV_DEPLOYMENT}. Текущий: ${url || 'неизвестен'}`)
    }

    const low = (email ?? 'almnurken@gmail.com').toLowerCase().trim()
    const manager = await ctx.db
      .query('employees')
      .withIndex('by_email', (q) => q.eq('email', low))
      .first()
    if (!manager) throw new Error(`Сотрудник ${low} не найден`)

    // Модуль продаж завязан на должность: без неё объекты менеджеру не видны.
    const pos = await ctx.db
      .query('positions')
      .withIndex('by_slug', (q) => q.eq('slug', 'sales'))
      .first()
    if (!pos) throw new Error('В справочнике нет должности sales')
    await ctx.db.patch(manager._id, {
      position: pos.slug,
      positionLabel: pos.label,
      status: 'active',
      hidden: false,
      // Оклад нужен, чтобы карточка «Заработано» показывала не ноль:
      // выплата = оклад × KPI. Значение демонстрационное, только для dev.
      salary: 400_000,
    })

    const today = new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 10)
    const month = today.slice(0, 7)
    const dayBefore = (n: number) =>
      new Date(Date.parse(`${today}T00:00:00Z`) - n * 86400000).toISOString().slice(0, 10)

    // 1. Объекты продаж: доводим до трёх, чтобы счётчик «X из 3» был нагляден.
    const wanted: { name: string; type: 'franchise' | 'service' | 'product'; plan: number }[] = [
      { name: 'Упаковка франшизы', type: 'service', plan: 2 },
      { name: 'Консалтинг', type: 'service', plan: 3 },
      { name: 'Greek Food', type: 'franchise', plan: 2 },
    ]
    const existing = await ctx.db.query('salesObjects').collect()
    const objects: { id: Id<'salesObjects'>; name: string; plan: number }[] = []
    for (const w of wanted) {
      const found = existing.find((o) => o.name === w.name)
      const id =
        found?._id ??
        (await ctx.db.insert('salesObjects', {
          name: w.name,
          type: w.type,
          status: 'active',
          managerIds: [],
          createdAt: Date.now(),
        }))
      const row = await ctx.db.get(id)
      const managerIds = row && row.managerIds.includes(manager._id) ? row.managerIds : [manager._id]
      await ctx.db.patch(id, { status: 'active', managerIds })
      objects.push({ id, name: w.name, plan: w.plan })
    }

    // 2. Месяц продаж: объект продаётся, у менеджера есть план сделок.
    for (const o of objects) {
      const setting = await ctx.db
        .query('salesObjectMonths')
        .withIndex('by_object_month', (q) => q.eq('objectId', o.id).eq('month', month))
        .first()
      const fields = {
        objectStatus: 'active' as const,
        status: 'selling' as const,
        managerPlans: [{ managerId: manager._id, planDeals: o.plan }],
      }
      if (setting) await ctx.db.patch(setting._id, fields)
      else await ctx.db.insert('salesObjectMonths', { objectId: o.id, month, ...fields })
    }

    // 3. История за три прошедших дня по первым двум объектам. Сегодня не
    // трогаем — этот день сдаёт живой человек через интерфейс.
    const history = [
      { day: 3, obj: 0, newLeads: 6, newConsultations: 4, repeatConsultations: 2, newMeetings: 2, repeatMeetings: 1, newPrepayments: 1, newDeals: 1, revenue: 1_500_000 },
      { day: 2, obj: 0, newLeads: 4, newConsultations: 3, repeatConsultations: 1, newMeetings: 1, repeatMeetings: 0, newPrepayments: 0, newDeals: 0, revenue: 0 },
      { day: 2, obj: 1, newLeads: 7, newConsultations: 5, repeatConsultations: 3, newMeetings: 3, repeatMeetings: 2, newPrepayments: 1, newDeals: 1, revenue: 900_000 },
      { day: 1, obj: 1, newLeads: 5, newConsultations: 2, repeatConsultations: 1, newMeetings: 1, repeatMeetings: 0, newPrepayments: 0, newDeals: 0, revenue: 0 },
    ]
    let reports = 0
    const byDate = new Map<string, { leads: number; meetings: number; sales: number; revenue: number }>()
    for (const h of history) {
      const date = dayBefore(h.day)
      const objectId = objects[h.obj].id
      const dup = await ctx.db
        .query('salesObjectReports')
        .withIndex('by_employee_date_object', (q) =>
          q.eq('employeeId', manager._id).eq('date', date).eq('objectId', objectId),
        )
        .first()
      if (dup) continue
      await ctx.db.insert('salesObjectReports', {
        employeeId: manager._id,
        objectId,
        date,
        month: date.slice(0, 7),
        newLeads: h.newLeads,
        newConsultations: h.newConsultations,
        repeatConsultations: h.repeatConsultations,
        newMeetings: h.newMeetings,
        repeatMeetings: h.repeatMeetings,
        newPrepayments: h.newPrepayments,
        newDeals: h.newDeals,
        revenue: h.revenue,
        submittedAt: Date.parse(`${date}T18:00:00+05:00`),
        editCount: 0,
      })
      reports++
      const agg = byDate.get(date) ?? { leads: 0, meetings: 0, sales: 0, revenue: 0 }
      agg.leads += h.newLeads
      agg.meetings += h.newMeetings
      agg.sales += h.newDeals
      agg.revenue += h.revenue
      byDate.set(date, agg)
    }

    // 4. Легаси-агрегат дня: из него считаются KPI и сетка дисциплины.
    for (const [date, agg] of byDate) {
      const existingDay = await ctx.db
        .query('dailyReports')
        .withIndex('by_employee_date', (q) => q.eq('employeeId', manager._id).eq('date', date))
        .first()
      const payload = {
        sales: { ...agg, note: 'Синхронизировано из объектных отчётов продаж' },
        position: 'sales' as const,
      }
      if (existingDay) await ctx.db.patch(existingDay._id, payload)
      else
        await ctx.db.insert('dailyReports', {
          employeeId: manager._id,
          date,
          ...payload,
          submittedAt: Date.parse(`${date}T18:00:00+05:00`),
          onTime: true,
          editCount: 0,
          history: [
            { at: Date.parse(`${date}T18:00:00+05:00`), byId: manager._id, action: 'submitted' as const },
          ],
        })
    }

    // 5. План выручки — чтобы у менеджера считался личный KPI и заработок.
    const plan = await ctx.db
      .query('salesPlans')
      .withIndex('by_employee', (q) => q.eq('employeeId', manager._id))
      .collect()
    const planRow = plan.find((p) => p.month === month)
    if (planRow) await ctx.db.patch(planRow._id, { planRevenue: 5_000_000 })
    else await ctx.db.insert('salesPlans', { employeeId: manager._id, month, planRevenue: 5_000_000 })

    return {
      deployment: url,
      manager: `${manager.name} <${low}> → ${pos.label}`,
      month,
      today,
      objects: objects.map((o) => `${o.name} (план ${o.plan})`),
      historyReports: reports,
      planRevenue: 5_000_000,
      note: 'Сегодняшний день пуст — сдайте отчёт через интерфейс',
    }
  },
})

// Привязка существующих рекламных кампаний к объектам продаж.
// ТЗ таргетолога требует объект у каждой кампании (§7.1 «обязательно», §14
// «объект не выбран — не разрешать сохранять»), а §2.2 заменяет им прежние
// «бренд» и «категорию». Названия объектов взяты из §6.1, где ТЗ само их
// перечисляет — они почти дословно совпадают с брендами кампаний.
// Недостающие объекты создаём, существующие переиспользуем по имени.
// Только для dev: на проде падает, ничего не тронув.
const CAMPAIGN_OBJECT_MAP: { code: string; object: string }[] = [
  { code: 'FR-001', object: 'Подбор франшизы' },
  { code: 'FR-002', object: 'Брокеридж' },
  { code: 'FR-003', object: 'Invite' },
  // Обе кампании ведут личный бренд основателя — в §6.1 это «Продвижение / контент».
  { code: 'FR-004', object: 'Продвижение / контент' },
  { code: 'FR-005', object: 'Продвижение / контент' },
  { code: 'AN-001', object: 'Упаковка франшизы' },
  // «Настройки продаж» в §6.1 нет, но это реальная услуга аккаунта ANUAR.
  { code: 'AN-002', object: 'Настройка продаж' },
  // Кампания называется «Консультации», в справочнике объект уже есть.
  { code: 'AN-003', object: 'Консалтинг' },
]

export const linkCampaignsToObjects = internalMutation({
  args: {},
  handler: async (ctx) => {
    const url = process.env.CONVEX_CLOUD_URL ?? ''
    if (!url.includes(DEV_DEPLOYMENT)) {
      throw new Error(`Только для dev-деплоймента ${DEV_DEPLOYMENT}. Текущий: ${url || 'неизвестен'}`)
    }

    const objects = await ctx.db.query('salesObjects').collect()
    const byName = new Map(objects.map((o) => [o.name, o._id]))
    const created: string[] = []
    const linked: string[] = []
    const missing: string[] = []

    for (const { code, object } of CAMPAIGN_OBJECT_MAP) {
      const campaign = await ctx.db
        .query('campaigns')
        .withIndex('by_code', (q) => q.eq('code', code))
        .first()
      if (!campaign) {
        missing.push(code)
        continue
      }

      let objectId = byName.get(object)
      if (!objectId) {
        objectId = await ctx.db.insert('salesObjects', {
          name: object,
          type: 'service',
          status: 'active',
          // Менеджеров не назначаем: объект заведён под рекламу. Если по нему
          // начнут продавать — владелец назначит их в настройках месяца.
          managerIds: [],
          createdAt: Date.now(),
        })
        byName.set(object, objectId)
        created.push(object)
      }

      if (campaign.objectId !== objectId) {
        await ctx.db.patch(campaign._id, { objectId })
        linked.push(`${code} → ${object}`)
      }
    }

    const unlinked = (await ctx.db.query('campaigns').collect()).filter(
      (c) => !c.archived && !c.objectId,
    )
    return {
      deployment: url,
      createdObjects: created,
      linked,
      campaignsNotFound: missing,
      stillWithoutObject: unlinked.map((c) => c.code),
    }
  },
})

// Демо-отчёт таргетолога за вчера: заполняет новые таблицы модуля, чтобы
// вживую увидеть цену по каждой цели, «Нет результата» при нулевом результате
// и цену за 1000 охватов. Значения подобраны так, чтобы каждая формула из §8
// была представлена. Только для dev.
export const seedDevTargetReport = internalMutation({
  args: { email: v.optional(v.string()), date: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const url = process.env.CONVEX_CLOUD_URL ?? ''
    if (!url.includes(DEV_DEPLOYMENT)) {
      throw new Error(`Только для dev-деплоймента ${DEV_DEPLOYMENT}. Текущий: ${url || 'неизвестен'}`)
    }

    const low = (args.email ?? 'almnurken@gmail.com').toLowerCase().trim()
    const author = await ctx.db
      .query('employees')
      .withIndex('by_email', (q) => q.eq('email', low))
      .first()
    if (!author) throw new Error(`Сотрудник ${low} не найден`)

    const today = new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 10)
    const date =
      args.date ?? new Date(Date.parse(`${today}T00:00:00Z`) - 86400000).toISOString().slice(0, 10)

    // Бюджет в центах, результат в единицах цели. AN-003 намеренно с нулевым
    // результатом — это и есть случай «Нет результата».
    const plan: { code: string; budgetCents: number; result: number }[] = [
      { code: 'AN-001', budgetCents: 1240, result: 4 },
      { code: 'AN-002', budgetCents: 860, result: 2 },
      { code: 'AN-003', budgetCents: 430, result: 0 },
      { code: 'FR-001', budgetCents: 1980, result: 6 },
      { code: 'FR-002', budgetCents: 500, result: 1 },
      { code: 'FR-003', budgetCents: 720, result: 3 },
      { code: 'FR-004', budgetCents: 900, result: 45 },
      { code: 'FR-005', budgetCents: 876, result: 32961 },
    ]

    const existing = await ctx.db
      .query('targetReports')
      .withIndex('by_employee_date', (q) => q.eq('employeeId', author._id).eq('date', date))
      .first()
    const reportId =
      existing?._id ??
      (await ctx.db.insert('targetReports', {
        employeeId: author._id,
        date,
        month: date.slice(0, 7),
        comment: 'Демо-данные для проверки модуля',
      }))
    for (const old of await ctx.db
      .query('targetReportRows')
      .withIndex('by_report', (q) => q.eq('reportId', reportId))
      .collect()) {
      await ctx.db.delete(old._id)
    }

    const written: string[] = []
    const skipped: string[] = []
    let totalCents = 0
    for (const p of plan) {
      const campaign = await ctx.db
        .query('campaigns')
        .withIndex('by_code', (q) => q.eq('code', p.code))
        .first()
      if (!campaign) {
        skipped.push(p.code)
        continue
      }
      await ctx.db.insert('targetReportRows', {
        reportId,
        campaignId: campaign._id,
        date,
        budgetCents: p.budgetCents,
        result: p.result,
      })
      totalCents += p.budgetCents
      const cost = resultCostCents(p.budgetCents, p.result, campaign.goal)
      written.push(
        `${p.code}: $${(p.budgetCents / 100).toFixed(2)} / ${p.result} → ${
          cost === null ? 'Нет данных' : '$' + (cost / 100).toFixed(2)
        }`,
      )
    }

    // Отправляем: так виден и заблокированный отчёт, и запись в истории.
    await ctx.db.patch(reportId, { submittedAt: Date.parse(`${date}T18:30:00+05:00`) })

    return {
      deployment: url,
      author: author.name,
      date,
      rows: written,
      campaignsNotFound: skipped,
      totalBudget: `$${(totalCents / 100).toFixed(2)}`,
    }
  },
})

// ——— Превращение DEV-деплоймента в песочницу ———
// После разделения сред на dev осталась копия боевых данных: настоящая команда,
// её отчёты и зарплаты. Для разработки это лишнее и небезопасно. Оставляем два
// служебных аккаунта разработчика (они же перестают быть скрытыми — прятать их
// было нужно, только пока dev обслуживал живых пользователей), всё остальное
// личное удаляем. Справочники, кампании и объекты продаж остаются: они не
// персональные и нужны, чтобы было на чём тестировать.
//
// ЗАЩИТА ОТ ЗАПУСКА НА ПРОДЕ: функция сверяет адрес деплоймента и на проде
// падает, ничего не тронув. Плюс она internal — сама по себе не выполняется
// никогда, только по явной команде `npx convex run setup:makeDevSandbox`.
const DEV_DEPLOYMENT = 'affable-kookabura-929'
const DEV_KEEP_EMAILS = ['elnur.serikson@gmail.com', 'almnurken@gmail.com']

export const makeDevSandbox = internalMutation({
  args: {},
  handler: async (ctx) => {
    const url = process.env.CONVEX_CLOUD_URL ?? ''
    if (!url.includes(DEV_DEPLOYMENT)) {
      throw new Error(
        `Только для dev-деплоймента ${DEV_DEPLOYMENT}. Текущий деплоймент: ${url || 'неизвестен'}`,
      )
    }

    const employees = await ctx.db.query('employees').collect()
    const keep = employees.filter((e) => DEV_KEEP_EMAILS.includes(e.email.toLowerCase()))
    const drop = employees.filter((e) => !DEV_KEEP_EMAILS.includes(e.email.toLowerCase()))
    const dropIds = new Set(drop.map((e) => e._id))

    // 1. Служебные аккаунты становятся обычными видимыми сотрудниками.
    for (const e of keep) {
      await ctx.db.patch(e._id, { hidden: false, status: 'active' })
    }

    // 2. Личные данные удаляемых: отчёты, планы, входы.
    let removed = 0
    for (const table of ['dailyReports', 'loginEvents', 'salesObjectReports', 'salesPlans'] as const) {
      for (const row of await ctx.db.query(table).collect()) {
        if (dropIds.has(row.employeeId)) {
          await ctx.db.delete(row._id)
          removed++
        }
      }
    }
    for (const table of ['smmMetrics', 'campaignPlans'] as const) {
      for (const row of await ctx.db.query(table).collect()) {
        if (row.employeeId && dropIds.has(row.employeeId)) {
          await ctx.db.delete(row._id)
          removed++
        }
      }
    }

    // 3. Задачи, где удаляемый — исполнитель или постановщик: вместе с
    // перепиской, историей и вложениями, иначе останутся битые ссылки.
    let tasksRemoved = 0
    for (const t of await ctx.db.query('tasks').collect()) {
      if (!dropIds.has(t.assigneeId) && !dropIds.has(t.reporterId)) continue
      for (const c of await ctx.db
        .query('taskComments')
        .withIndex('by_task', (q) => q.eq('taskId', t._id))
        .collect()) {
        await ctx.db.delete(c._id)
      }
      for (const ev of await ctx.db
        .query('taskEvents')
        .withIndex('by_task', (q) => q.eq('taskId', t._id))
        .collect()) {
        await ctx.db.delete(ev._id)
      }
      for (const a of await ctx.db
        .query('taskAttachments')
        .withIndex('by_task', (q) => q.eq('taskId', t._id))
        .collect()) {
        if (a.storageId) await ctx.storage.delete(a.storageId)
        await ctx.db.delete(a._id)
      }
      await ctx.db.delete(t._id)
      tasksRemoved++
    }

    // 4. Ссылки на удаляемых в объектах продаж — вычищаем, сами объекты
    // оставляем: они пригодятся для тестов.
    for (const o of await ctx.db.query('salesObjects').collect()) {
      const next = o.managerIds.filter((id) => !dropIds.has(id))
      if (next.length !== o.managerIds.length) await ctx.db.patch(o._id, { managerIds: next })
    }
    for (const m of await ctx.db.query('salesObjectMonths').collect()) {
      const next = m.managerPlans.filter((p) => !dropIds.has(p.managerId))
      if (next.length !== m.managerPlans.length) await ctx.db.patch(m._id, { managerPlans: next })
    }

    // 5. Учётки входа удаляемых: без строки в employees вход и так закрыт
    // (инвайт-гейт), но держать чужие почты в dev незачем.
    const dropEmails = new Set(drop.map((e) => e.email.toLowerCase()))
    const users = await ctx.db.query('users').collect()
    const dropUserIds = new Set(
      users.filter((u) => u.email && dropEmails.has(u.email.toLowerCase())).map((u) => u._id),
    )
    const dropSessionIds = new Set<string>()
    for (const s of await ctx.db.query('authSessions').collect()) {
      if (dropUserIds.has(s.userId)) {
        dropSessionIds.add(s._id)
        await ctx.db.delete(s._id)
      }
    }
    for (const t of await ctx.db.query('authRefreshTokens').collect()) {
      if (dropSessionIds.has(t.sessionId)) await ctx.db.delete(t._id)
    }
    for (const a of await ctx.db.query('authAccounts').collect()) {
      if (dropUserIds.has(a.userId)) await ctx.db.delete(a._id)
    }
    for (const id of dropUserIds) await ctx.db.delete(id)

    // 6. Сами сотрудники — последними, когда на них уже никто не ссылается.
    for (const e of drop) await ctx.db.delete(e._id)

    return {
      deployment: url,
      kept: keep.map((e) => `${e.name} <${e.email}> (${e.role})`),
      removedEmployees: drop.map((e) => e.name),
      removedPersonalRows: removed,
      removedTasks: tasksRemoved,
    }
  },
})

// Демо-данные под контрольный пример из «Дополнения к ТЗ — Live-воронка»
// (§2, §5, §6). Нужны, чтобы приёмку можно было сверить глазами с цифрами
// заказчика, а не на слово.
//
// Три активных объекта в сумме дают ровно 20 / 10 / 5 / 2 / 1 — воронка обязана
// показать 100% / 50% / 50% / 40% / 50%, а общая конверсия — 5%.
// Четвёртый объект приостановлен и набит крупными числами: если он просочится
// в сводный режим «Все активные объекты», цифры немедленно разъедутся — это и
// есть проверка §5.
//
// Только dev. Запуск: npx convex run setup:seedDevFunnelSpecDemo
export const seedDevFunnelSpecDemo = internalMutation({
  args: { email: v.optional(v.string()) },
  handler: async (ctx, { email }) => {
    const url = process.env.CONVEX_CLOUD_URL ?? ''
    if (!url.includes(DEV_DEPLOYMENT)) {
      throw new Error(`Только для dev-деплоймента ${DEV_DEPLOYMENT}. Текущий: ${url || 'неизвестен'}`)
    }

    // Отдельный демо-менеджер: живые dev-аккаунты заняты другими должностями,
    // а воронка считает только сотрудников с должностью sales. Логин ему не
    // нужен — владелец видит сводку по всему отделу.
    const low = (email ?? 'demo.sales@franchone.dev').toLowerCase().trim()
    const pos = await ctx.db
      .query('positions')
      .withIndex('by_slug', (q) => q.eq('slug', 'sales'))
      .first()
    if (!pos) throw new Error('В справочнике нет должности sales')
    const found = await ctx.db
      .query('employees')
      .withIndex('by_email', (q) => q.eq('email', low))
      .first()
    const managerId =
      found?._id ??
      (await ctx.db.insert('employees', {
        name: 'Демо Продажник',
        role: 'employee',
        position: pos.slug,
        positionLabel: pos.label,
        department: 'Продажи',
        salary: 400_000,
        email: low,
        phone: '',
        avatarColor: '#0a857a',
        initials: 'ДП',
        status: 'active',
        hiredAt: '2026-07-01',
      }))
    await ctx.db.patch(managerId, {
      position: pos.slug,
      positionLabel: pos.label,
      status: 'active',
      hidden: false,
    })
    const manager = { _id: managerId }

    const today = new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 10)
    const dayBefore = (n: number) =>
      new Date(Date.parse(`${today}T00:00:00Z`) - n * 86400000).toISOString().slice(0, 10)

    const plan: {
      name: string
      status: 'active' | 'paused'
      // Дни назад от сегодня. 1 и 4 попадают в «последние 7 дней», 9 — нет:
      // так на одних данных видно и полный пример ТЗ, и работу фильтра.
      rows: { day: number; l: number; c: number; m: number; p: number; d: number; rev: number }[]
    }[] = [
      {
        name: 'ТЗ · Объект A',
        status: 'active',
        rows: [
          { day: 9, l: 6, c: 4, m: 2, p: 1, d: 1, rev: 1_500_000 },
          { day: 4, l: 4, c: 2, m: 1, p: 0, d: 0, rev: 0 },
        ],
      },
      {
        name: 'ТЗ · Объект B',
        status: 'active',
        rows: [
          { day: 4, l: 4, c: 2, m: 1, p: 1, d: 0, rev: 0 },
          { day: 1, l: 3, c: 1, m: 1, p: 0, d: 0, rev: 0 },
        ],
      },
      {
        name: 'ТЗ · Объект C',
        status: 'active',
        rows: [{ day: 1, l: 3, c: 1, m: 0, p: 0, d: 0, rev: 0 }],
      },
      {
        name: 'ТЗ · Объект на паузе',
        status: 'paused',
        rows: [{ day: 1, l: 50, c: 40, m: 30, p: 20, d: 10, rev: 99_000_000 }],
      },
    ]

    const existing = await ctx.db.query('salesObjects').collect()
    let inserted = 0
    for (const p of plan) {
      const found = existing.find((o) => o.name === p.name)
      const objectId =
        found?._id ??
        (await ctx.db.insert('salesObjects', {
          name: p.name,
          type: 'service',
          status: 'active',
          managerIds: [],
          createdAt: Date.now(),
        }))
      await ctx.db.patch(objectId, { status: 'active', managerIds: [manager._id] })

      // Статус объекта в месяце — то, что читает сводный режим. Ставим его на
      // каждый месяц, который задевают строки: период может пересечь границу.
      const months = new Set(p.rows.map((r) => dayBefore(r.day).slice(0, 7)))
      for (const month of months) {
        const setting = await ctx.db
          .query('salesObjectMonths')
          .withIndex('by_object_month', (q) => q.eq('objectId', objectId).eq('month', month))
          .first()
        const fields = {
          objectStatus: p.status,
          status: (p.status === 'active' ? 'selling' : 'not_selling') as 'selling' | 'not_selling',
          managerPlans: [{ managerId: manager._id, planDeals: 1 }],
        }
        if (setting) await ctx.db.patch(setting._id, fields)
        else await ctx.db.insert('salesObjectMonths', { objectId, month, ...fields })
      }

      for (const r of p.rows) {
        const date = dayBefore(r.day)
        const dup = await ctx.db
          .query('salesObjectReports')
          .withIndex('by_employee_date_object', (q) =>
            q.eq('employeeId', manager._id).eq('date', date).eq('objectId', objectId),
          )
          .first()
        const fields = {
          newLeads: r.l,
          newConsultations: r.c,
          repeatConsultations: 0,
          newMeetings: r.m,
          repeatMeetings: 0,
          newPrepayments: r.p,
          newDeals: r.d,
          revenue: r.rev,
        }
        if (dup) {
          await ctx.db.patch(dup._id, fields)
          continue
        }
        await ctx.db.insert('salesObjectReports', {
          employeeId: manager._id,
          objectId,
          date,
          month: date.slice(0, 7),
          ...fields,
          submittedAt: Date.parse(`${date}T18:00:00+05:00`),
          editCount: 0,
        })
        inserted++
      }
    }

    return {
      inserted,
      expectMonth: 'июль: 20 / 10 / 5 / 2 / 1 → 100% / 50% / 50% / 40% / 50%, общая 5%',
      expectLast7Days: '14 / 6 / 3 / 1 / 0 → 100% / 42,9% / 50% / 33,3% / 0%, общая 0%',
      note: 'Объект на паузе (50/40/30/20/10) в сводный режим попадать не должен',
    }
  },
})

// Прогон боевого расчёта Live-воронки из CLI (только dev). Личности в CLI нет,
// поэтому сотрудник задаётся явно — всё остальное считает та же salesSummary,
// что и на экране KPI.
// npx convex run setup:devFunnelCheck '{"from":"2026-07-01","to":"2026-07-31"}'
export const devFunnelCheck = internalQuery({
  args: {
    email: v.optional(v.string()),
    month: v.optional(v.string()),
    from: v.optional(v.string()),
    to: v.optional(v.string()),
    objectName: v.optional(v.string()),
  },
  handler: async (ctx, { email, month, from, to, objectName }) => {
    const url = process.env.CONVEX_CLOUD_URL ?? ''
    if (!url.includes(DEV_DEPLOYMENT)) {
      throw new Error(`Только для dev-деплоймента ${DEV_DEPLOYMENT}. Текущий: ${url || 'неизвестен'}`)
    }
    const low = (email ?? 'elnur.serikson@gmail.com').toLowerCase().trim()
    const viewer = await ctx.db
      .query('employees')
      .withIndex('by_email', (q) => q.eq('email', low))
      .first()
    if (!viewer) throw new Error(`Сотрудник ${low} не найден`)

    let objectId: Id<'salesObjects'> | undefined
    if (objectName) {
      const o = (await ctx.db.query('salesObjects').collect()).find((x) => x.name === objectName)
      if (!o) throw new Error(`Объект «${objectName}» не найден`)
      objectId = o._id
    }

    const s = await salesSummary(ctx, { month, from, to, objectId }, async () => viewer)
    const t = s.totals
    const pct = (x: number) => {
      const value = x * 100
      const rounded = Math.round(value * 10) / 10
      return (Number.isInteger(rounded) ? rounded : rounded.toFixed(1).replace('.', ',')) + '%'
    }
    // Ключи только ASCII: Convex не принимает кириллицу в именах полей.
    return {
      period: `${s.period.from} … ${s.period.to}`,
      planApplies: s.period.planApplies,
      funnel: [
        `Заявки              ${t.newLeads} · 100%`,
        `Консультации        ${t.newConsultations} · ${pct(t.conversions.consultation)}`,
        `Встречи             ${t.newMeetings} · ${pct(t.conversions.meeting)}`,
        `Договоры            ${t.newPrepayments} · ${pct(t.conversions.contract)}`,
        `Сделки              ${t.newDeals} · ${pct(t.conversions.deal)}`,
      ],
      totalConversion: pct(t.conversions.total),
      planDeals: t.planDeals,
      objects: (s.objectRows as { name: string; newLeads: number; newDeals: number }[]).map(
        (r) => `${r.name}: ${r.newLeads} заявок → ${r.newDeals} сделок`,
      ),
    }
  },
})

// Критерии приёмки дополнения «Модуль таргетолога» (§5). Считает боевая
// resultCostCents, а не её копия. Только dev.
// npx convex run setup:devTargetCostCheck
export const devTargetCostCheck = internalQuery({
  args: {},
  handler: async () => {
    const url = process.env.CONVEX_CLOUD_URL ?? ''
    if (!url.includes(DEV_DEPLOYMENT)) {
      throw new Error(`Только для dev-деплоймента ${DEV_DEPLOYMENT}. Текущий: ${url || 'неизвестен'}`)
    }
    const money = (c: number | null) => (c === null ? 'Нет данных' : '$' + (c / 100).toFixed(2))
    return {
      // §2.2: 9 USD ÷ 3 200 охватов × 1 000 = 2,81 USD
      reach_9usd_3200: money(resultCostCents(900, 3200, 'reach')),
      reach_zero: money(resultCostCents(900, 0, 'reach')),
      // §2.8.1: агрегат считается по сумме, а не как среднее уже посчитанных
      // цен. Числа подобраны так, чтобы два способа заведомо разошлись:
      // кампания A — $9 на 3 200 охватов, кампания B — $1 на 10 000.
      a_reach: money(resultCostCents(900, 3200, 'reach')),
      b_reach: money(resultCostCents(100, 10000, 'reach')),
      aggregate_correct_sum: money(resultCostCents(900 + 100, 3200 + 10000, 'reach')),
      aggregate_wrong_average: money(
        Math.round(
          ((resultCostCents(900, 3200, 'reach') ?? 0) + (resultCostCents(100, 10000, 'reach') ?? 0)) / 2,
        ),
      ),
      msg_400usd_800: money(resultCostCents(40000, 800, 'msg_inst')),
    }
  },
})

// Контрольные примеры ТАРГЕТ 1.6 (§8–§10, §13.3, §16). Сеет данные из примеров
// заказчика и прогоняет по ним БОЕВЫЕ функции модуля targetLeads. Только dev.
// npx convex run setup:seedDevLeadDemo   → затем
// npx convex run setup:devLeadMathCheck
export const seedDevLeadDemo = internalMutation({
  args: { email: v.optional(v.string()) },
  handler: async (ctx, { email }) => {
    const url = process.env.CONVEX_CLOUD_URL ?? ''
    if (!url.includes(DEV_DEPLOYMENT)) {
      throw new Error(`Только для dev-деплоймента ${DEV_DEPLOYMENT}. Текущий: ${url || 'неизвестен'}`)
    }
    const low = (email ?? 'almnurken@gmail.com').toLowerCase().trim()
    const targetolog = await ctx.db
      .query('employees')
      .withIndex('by_email', (q) => q.eq('email', low))
      .first()
    if (!targetolog) throw new Error(`Сотрудник ${low} не найден`)

    const today = new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 10)
    const month = today.slice(0, 7)

    // Пример §10: KazNaves план 200 / факт 250, Упаковка план 100 / факт 50.
    // Общий KPI обязан выйти 250 ÷ 300 = 83,3%, а не 300 ÷ 300 = 100%.
    const plan: { name: string; planLeads: number; fact: number; budgetCents?: number }[] = [
      { name: 'ТЗ · KazNaves', planLeads: 200, fact: 250, budgetCents: 100000 },
      { name: 'ТЗ · Упаковка', planLeads: 100, fact: 50 },
    ]

    const existing = await ctx.db.query('salesObjects').collect()
    for (const p of plan) {
      const found = existing.find((o) => o.name === p.name)
      const objectId =
        found?._id ??
        (await ctx.db.insert('salesObjects', {
          name: p.name,
          type: 'service',
          status: 'active',
          managerIds: [],
          createdAt: Date.now(),
        }))
      await ctx.db.patch(objectId, { status: 'active' })

      const oldPlan = (
        await ctx.db
          .query('targetLeadPlans')
          .withIndex('by_employee_month', (q) =>
            q.eq('employeeId', targetolog._id).eq('month', month),
          )
          .collect()
      ).find((x) => x.objectId === objectId)
      if (oldPlan) {
        await ctx.db.patch(oldPlan._id, {
          planLeads: p.planLeads,
          planBudgetCents: p.budgetCents,
        })
      } else {
        await ctx.db.insert('targetLeadPlans', {
          employeeId: targetolog._id,
          objectId,
          month,
          planLeads: p.planLeads,
          planBudgetCents: p.budgetCents,
        })
      }

      // Факт кладём одним днём — сумма за месяц от этого не меняется.
      const date = `${month}-01`
      const oldFact = await ctx.db
        .query('targetLeadReports')
        .withIndex('by_employee_date_object', (q) =>
          q.eq('employeeId', targetolog._id).eq('date', date).eq('objectId', objectId),
        )
        .first()
      if (oldFact) {
        await ctx.db.patch(oldFact._id, { leads: p.fact, updatedAt: Date.now(), updatedById: targetolog._id })
      } else {
        await ctx.db.insert('targetLeadReports', {
          employeeId: targetolog._id,
          objectId,
          date,
          month,
          leads: p.fact,
          updatedAt: Date.now(),
          updatedById: targetolog._id,
        })
      }
    }

    return { month, employee: targetolog.name, expect: 'общий KPI 250 ÷ 300 = 83,3%' }
  },
})

export const devLeadMathCheck = internalQuery({
  args: { email: v.optional(v.string()) },
  handler: async (ctx, { email }) => {
    const url = process.env.CONVEX_CLOUD_URL ?? ''
    if (!url.includes(DEV_DEPLOYMENT)) {
      throw new Error(`Только для dev-деплоймента ${DEV_DEPLOYMENT}. Текущий: ${url || 'неизвестен'}`)
    }
    const low = (email ?? 'almnurken@gmail.com').toLowerCase().trim()
    const targetolog = await ctx.db
      .query('employees')
      .withIndex('by_email', (q) => q.eq('email', low))
      .first()
    if (!targetolog) throw new Error(`Сотрудник ${low} не найден`)
    const month = new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 7)

    const pct = (x: number | null) => {
      if (x === null) return '—'
      const v = Math.round(x * 1000) / 10
      return (Number.isInteger(v) ? v : v.toFixed(1).replace('.', ',')) + '%'
    }

    // §10 — боевая функция, та же, что читает расчёт зарплаты.
    const kpi = await leadPlanKpi(ctx, targetolog._id, month)
    const weight = await leadWeight(ctx)

    // §13.3 — боевая функция пропорционального пересчёта плана.
    const days = daysInMonth(month)
    const half = `${month}-15`
    return {
      s10_plan: kpi.planLeads,
      s10_fact: kpi.factLeads,
      s10_completion_capped: pct(kpi.completion),
      s10_wrong_uncapped: pct(kpi.planLeads > 0 ? kpi.factLeads / kpi.planLeads : null),
      s11_weight: pct(weight),
      s11_kpi_for_payroll: pct(kpi.completion === null ? null : kpi.completion * weight),
      s13_days_in_month: days,
      s13_prorate_full_month: proratePlan(200, month, `${month}-01`, monthEnd(month)),
      s13_prorate_first_half: Math.round(proratePlan(200, month, `${month}-01`, half) * 10) / 10,
      s13_prorate_one_day: Math.round(proratePlan(200, month, half, half) * 10) / 10,
      s13_days_of_month_in_period: daysOfMonthInPeriod(month, `${month}-01`, half),
    }
  },
})

// Боевой расчёт зарплаты за месяц из CLI (только dev). Проверяет, что KPI
// таргетолога действительно доходит до начислений (ТАРГЕТ 1.6 §11).
// npx convex run setup:devPayrollCheck '{"month":"2026-08"}'
export const devPayrollCheck = internalQuery({
  args: { month: v.optional(v.string()) },
  handler: async (ctx, { month }) => {
    const url = process.env.CONVEX_CLOUD_URL ?? ''
    if (!url.includes(DEV_DEPLOYMENT)) {
      throw new Error(`Только для dev-деплоймента ${DEV_DEPLOYMENT}. Текущий: ${url || 'неизвестен'}`)
    }
    const ym = month ?? new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 7)
    const rows = await computeMonth(ctx, ym)
    const pct = (x: number) => {
      const v = Math.round(x * 1000) / 10
      return (Number.isInteger(v) ? v : v.toFixed(1).replace('.', ',')) + '%'
    }
    return rows.map(
      (r) =>
        `${r.name} · ${r.positionLabel} · KPI ${pct(r.kpi)} · план ${r.planTotal ?? '—'} · факт ${r.factTotal ?? '—'} · оклад ${r.salary} → ${r.payout}`,
    )
  },
})

// Контрольный пример ТЗ СИСТЕМА §2.1: отчёт за 1 августа заполняется до
// 2 августа 14:00 и в 14:00 блокируется. Считает боевая deadlineMs.
// npx convex run setup:devDeadlineCheck
export const devDeadlineCheck = internalQuery({
  args: {},
  handler: async (ctx) => {
    const url = process.env.CONVEX_CLOUD_URL ?? ''
    if (!url.includes(DEV_DEPLOYMENT)) {
      throw new Error(`Только для dev-деплоймента ${DEV_DEPLOYMENT}. Текущий: ${url || 'неизвестен'}`)
    }
    const s = await ctx.db
      .query('settings')
      .withIndex('by_key', (q) => q.eq('key', 'global'))
      .first()
    const time = s?.reportDeadlineTime ?? '14:00'
    const at = (iso: string) => Date.parse(iso)
    const fmt = (ms: number) =>
      new Date(ms).toLocaleString('ru-RU', { timeZone: 'Asia/Almaty' })
    const d = deadlineMs('2026-08-01', time)
    return {
      deadlineTime: time,
      report_2026_08_01_deadline: fmt(d),
      // Сдача в свой день — вовремя
      submitted_01_aug_18_00: at('2026-08-01T18:00:00+05:00') <= d ? 'вовремя' : 'опоздание',
      // Утром следующего дня — ещё вовремя
      submitted_02_aug_09_00: at('2026-08-02T09:00:00+05:00') <= d ? 'вовремя' : 'опоздание',
      // Ровно в 14:00 — последняя минута
      submitted_02_aug_14_00: at('2026-08-02T14:00:00+05:00') <= d ? 'вовремя' : 'опоздание',
      // Минутой позже — уже блокировка
      submitted_02_aug_14_01: at('2026-08-02T14:01:00+05:00') <= d ? 'вовремя' : 'опоздание',
    }
  },
})

// Раздел «Эффективность» на реальных данных сотрудника (ТЗ СИСТЕМА §3.3,
// §3.4). Считают боевые функции модуля effectiveness. Только dev.
// npx convex run setup:devEffectivenessCheck '{"email":"almnurken@gmail.com"}'
export const devEffectivenessCheck = internalQuery({
  args: { email: v.optional(v.string()), from: v.optional(v.string()), to: v.optional(v.string()) },
  handler: async (ctx, { email, from: fromArg, to: toArg }) => {
    const url = process.env.CONVEX_CLOUD_URL ?? ''
    if (!url.includes(DEV_DEPLOYMENT)) {
      throw new Error(`Только для dev-деплоймента ${DEV_DEPLOYMENT}. Текущий: ${url || 'неизвестен'}`)
    }
    const low = (email ?? 'almnurken@gmail.com').toLowerCase().trim()
    const e = await ctx.db
      .query('employees')
      .withIndex('by_email', (q) => q.eq('email', low))
      .first()
    if (!e) throw new Error(`Сотрудник ${low} не найден`)

    const today = new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 10)
    const month = today.slice(0, 7)
    const from = fromArg ?? `${month}-01`
    const to = toArg ?? today

    const s = await ctx.db
      .query('settings')
      .withIndex('by_key', (q) => q.eq('key', 'global'))
      .first()
    const time = s?.reportDeadlineTime ?? '14:00'

    const reports = await reportStats(ctx, e, datesBetween(from, to), Date.now(), time)
    const tasks = taskStats(
      (await ctx.db.query('tasks').collect()).filter((t) => t.assigneeId === e._id),
      from,
      to,
      today,
    )
    const pct = (x: number | null) => {
      if (x === null) return '—'
      const v = Math.round(x * 1000) / 10
      return (Number.isInteger(v) ? v : v.toFixed(1).replace('.', ',')) + '%'
    }
    return {
      employee: e.name,
      period: `${from} … ${to}`,
      deadline: `${time} следующего дня`,
      reports: `обязательных ${reports.required} · вовремя ${reports.onTime} · после блокировки ${reports.lateByAdmin} · не внесено ${reports.missing} · своевременность ${pct(reports.onTimeRate)}`,
      tasks: `всего ${tasks.total} · выполнено ${tasks.done} · в срок ${tasks.doneOnTime} · с опозданием ${tasks.doneLate} · просрочено ${tasks.overdue} · выполнение ${pct(tasks.completionRate)}`,
    }
  },
})

// Прогон переноса плановых значений из прошлого месяца (только dev).
// Вызывает боевую логику planCopy напрямую, минуя проверку личности.
// npx convex run setup:devCopyCheck '{"section":"smm","from":"2026-07"}'
export const devCopyCheck = internalMutation({
  args: { section: v.string(), from: v.string(), email: v.optional(v.string()) },
  handler: async (ctx, { section, from, email }) => {
    const url = process.env.CONVEX_CLOUD_URL ?? ''
    if (!url.includes(DEV_DEPLOYMENT)) {
      throw new Error(`Только для dev-деплоймента ${DEV_DEPLOYMENT}. Текущий: ${url || 'неизвестен'}`)
    }
    const to = new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 7)
    let employeeId: Id<'employees'> | undefined
    if (email) {
      const e = await ctx.db
        .query('employees')
        .withIndex('by_email', (q) => q.eq('email', email.toLowerCase().trim()))
        .first()
      employeeId = e?._id
    }
    const before = (await ctx.db.query('smmMetrics').collect()).filter((m) => m.month === to).length
    const res = await copyPlanMonth(ctx, section as never, from, to, employeeId)
    const after = (await ctx.db.query('smmMetrics').collect()).filter((m) => m.month === to).length
    return { from, to, ...res, smmRowsBefore: before, smmRowsAfter: after }
  },
})

// Готовит данные для проверки переноса: прошлый месяц с планами и текущий
// с «мусором», который перенос обязан заменить. Только dev.
export const seedDevCopyDemo = internalMutation({
  args: {},
  handler: async (ctx) => {
    const url = process.env.CONVEX_CLOUD_URL ?? ''
    if (!url.includes(DEV_DEPLOYMENT)) {
      throw new Error(`Только для dev-деплоймента ${DEV_DEPLOYMENT}. Текущий: ${url || 'неизвестен'}`)
    }
    const to = new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 7)
    const [y, m] = to.split('-').map(Number)
    const from = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`

    const emp = (await ctx.db.query('employees').collect()).find((e) => e.role !== 'owner')
    if (!emp) throw new Error('Нет сотрудников')

    for (const r of await ctx.db.query('smmMetrics').collect()) await ctx.db.delete(r._id)

    // Прошлый месяц — то, что переносим.
    const source = [
      { account: 'FRANCHONE' as const, format: 'Рилсы' as const, weight: 0.2, weekPlans: [4, 4, 4, 4, 0] },
      { account: 'FRANCHONE' as const, format: 'Сторис' as const, weight: 0.1, weekPlans: [24, 24, 24, 24, 0] },
      { account: 'ANUAR' as const, format: 'Рилсы' as const, weight: 0.7, weekPlans: [14, 14, 14, 14, 0] },
    ]
    for (const s of source) {
      await ctx.db.insert('smmMetrics', {
        employeeId: emp._id,
        month: from,
        account: s.account,
        format: s.format,
        weight: s.weight,
        weekPlans: s.weekPlans,
        weekFacts: [9, 9, 9, 9, 9],
      })
    }
    // Текущий месяц — одна пустая строка, её перенос обязан снести.
    await ctx.db.insert('smmMetrics', {
      employeeId: emp._id,
      month: to,
      account: 'ANUAR',
      format: 'Карусели',
      weight: 0,
      weekPlans: [0, 0, 0, 0, 0],
      weekFacts: [0, 0, 0, 0, 0],
    })
    return { from, to, employee: emp.name, sourceRows: source.length, targetRowsBefore: 1 }
  },
})

// Правило выбора месяцев для переноса (только dev). Считает боевая
// assertCopyable. npx convex run setup:devCopyRuleCheck
export const devCopyRuleCheck = internalQuery({
  args: {},
  handler: async () => {
    const url = process.env.CONVEX_CLOUD_URL ?? ''
    if (!url.includes(DEV_DEPLOYMENT)) {
      throw new Error(`Только для dev-деплоймента ${DEV_DEPLOYMENT}. Текущий: ${url || 'неизвестен'}`)
    }
    const to = '2026-08' // текущий месяц в проверке
    const check = (from: string) => {
      try {
        assertCopyable(from, to)
        return 'разрешено'
      } catch (e) {
        return 'отклонено: ' + ((e as { data?: string }).data ?? 'ошибка')
      }
    }
    return {
      prev_month_2026_07: check('2026-07'),
      older_2026_05: check('2026-05'),
      last_year_2025_12: check('2025-12'),
      same_month_2026_08: check('2026-08'),
      future_2026_09: check('2026-09'),
      garbage: check('июль'),
    }
  },
})

// Что показывает раздел KPI таргетолога: список объектов и итоги сверху.
// Считает боевая collect через overview-логику. Только dev.
// npx convex run setup:devKpiListCheck
export const devKpiListCheck = internalQuery({
  args: { email: v.optional(v.string()) },
  handler: async (ctx, { email }) => {
    const url = process.env.CONVEX_CLOUD_URL ?? ''
    if (!url.includes(DEV_DEPLOYMENT)) {
      throw new Error(`Только для dev-деплоймента ${DEV_DEPLOYMENT}. Текущий: ${url || 'неизвестен'}`)
    }
    const low = (email ?? 'elnur.serikson@gmail.com').toLowerCase().trim()
    const me = await ctx.db
      .query('employees')
      .withIndex('by_email', (q) => q.eq('email', low))
      .first()
    if (!me) throw new Error(`Сотрудник ${low} не найден`)
    const month = new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 7)
    const [y, m] = month.split('-').map(Number)
    const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)

    const data = await targetLeadsCollect(ctx, me, `${month}-01`, last, {})
    const usd = (c: number) => '$' + (c / 100).toFixed(2)
    // Ключи только ASCII: Convex не принимает кириллицу в именах полей.
    return {
      month,
      rowsInTable: data.rows.length,
      objects: data.rows.map(
        (r) => `${r.name}: план ${r.planLeads ?? '—'} · факт ${r.factLeads} · расход ${usd(r.factBudgetCents)}`,
      ),
      totalSpend: usd(data.totals.factBudgetCents),
      totalPlan: data.totals.planLeads,
      totalFact: data.totals.factLeads,
    }
  },
})

// Единое написание рекламного аккаунта у кампаний.
//
// Карточка кампании предлагала «Anuar», а вся остальная система работает с
// «ANUAR» — в фильтре KPI появлялся третий аккаунт, которого не существует.
// Форма исправлена, здесь приводим уже накопленные записи.
//
// Это НЕ dev-функция: расхождение живёт на проде, его и надо чинить.
// Запуск: npx convex run setup:normalizeCampaignAccounts --prod
export const normalizeCampaignAccounts = internalMutation({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, { dryRun }) => {
    const rows = await ctx.db.query('campaigns').collect()
    const changes: string[] = []
    for (const c of rows) {
      const next = normalizeAccount(c.account)
      if (next === c.account) continue
      changes.push(`${c.campaign?.trim() || c.code || c._id}: «${c.account}» → «${next}»`)
      if (!dryRun) await ctx.db.patch(c._id, { account: next })
    }
    // Что осталось в базе после приведения — для проверки глазами.
    const after = new Map<string, number>()
    for (const c of await ctx.db.query('campaigns').collect()) {
      after.set(c.account, (after.get(c.account) ?? 0) + 1)
    }
    return {
      dryRun: dryRun === true,
      changed: changes.length,
      changes,
      accounts: [...after.entries()].map(([a, n]) => `${a}: ${n}`).sort(),
    }
  },
})

// Записать имя бота в настройки — из него собирается ссылка-приглашение
// (ТЗ Telegram §3.1, §8.2). Токен сюда не попадает: он живёт в окружении.
// npx convex run setup:setTelegramBot '{"username":"franchone_dev_bot"}'
export const setTelegramBot = internalMutation({
  args: { username: v.string() },
  handler: async (ctx, { username }) => {
    const row = await ctx.db
      .query('settings')
      .withIndex('by_key', (q) => q.eq('key', 'global'))
      .first()
    const value = username.replace('@', '').trim()
    if (row) await ctx.db.patch(row._id, { tgBotUsername: value })
    return { tgBotUsername: value, existed: !!row }
  },
})

// ——— Прогон Telegram-модуля на dev ———
// Проходит весь путь ТЗ без реального Telegram: приглашение → запуск бота →
// подтверждение администратором. Сообщения бот отправить не сможет (чат
// вымышленный) — это ожидаемо и видно в журнале.

export const devTgInvite = internalMutation({
  args: { email: v.optional(v.string()) },
  handler: async (ctx, { email }) => {
    const url = process.env.CONVEX_CLOUD_URL ?? ''
    if (!url.includes(DEV_DEPLOYMENT)) throw new Error('Только для dev')
    const low = (email ?? 'almnurken@gmail.com').toLowerCase().trim()
    const e = await ctx.db
      .query('employees')
      .withIndex('by_email', (q) => q.eq('email', low))
      .first()
    if (!e) throw new Error(`Сотрудник ${low} не найден`)
    const code = 'devtest' + Math.floor(Math.random() * 1e6)
    const existing = await ctx.db
      .query('telegramLinks')
      .withIndex('by_employee', (q) => q.eq('employeeId', e._id))
      .first()
    const fields = {
      status: 'invited' as const,
      inviteCode: code,
      inviteExpiresAt: Date.now() + 24 * 3600 * 1000,
      chatId: undefined,
      connectedAt: undefined,
      lastError: undefined,
    }
    if (existing) await ctx.db.patch(existing._id, fields)
    else await ctx.db.insert('telegramLinks', { employeeId: e._id, ...fields })
    return { employee: e.name, code }
  },
})

export const devTgState = internalQuery({
  args: {},
  handler: async (ctx) => {
    const url = process.env.CONVEX_CLOUD_URL ?? ''
    if (!url.includes(DEV_DEPLOYMENT)) throw new Error('Только для dev')
    const names = new Map(
      (await ctx.db.query('employees').collect()).map((e) => [e._id as string, e.name]),
    )
    const links = (await ctx.db.query('telegramLinks').collect()).map(
      (l) => `${names.get(l.employeeId as string) ?? '—'}: ${l.status}${l.chatId ? ` chat=${l.chatId}` : ''}`,
    )
    const drafts = (await ctx.db.query('telegramDrafts').collect())
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 3)
      .map((d) => `${d.kind}/${d.state}: ${d.payload}`)
    const audit = (await ctx.db.query('telegramAudit').withIndex('by_at').order('desc').take(6)).map(
      (a) => `${a.kind}${a.result ? ' · ' + a.result : ''}${a.error ? ' · ОШИБКА: ' + a.error : ''}`,
    )
    return { links, drafts, audit }
  },
})

export const devTgConfirm = internalMutation({
  args: { email: v.optional(v.string()) },
  handler: async (ctx, { email }) => {
    const url = process.env.CONVEX_CLOUD_URL ?? ''
    if (!url.includes(DEV_DEPLOYMENT)) throw new Error('Только для dev')
    const low = (email ?? 'almnurken@gmail.com').toLowerCase().trim()
    const e = await ctx.db
      .query('employees')
      .withIndex('by_email', (q) => q.eq('email', low))
      .first()
    if (!e) throw new Error('Сотрудник не найден')
    const link = await ctx.db
      .query('telegramLinks')
      .withIndex('by_employee', (q) => q.eq('employeeId', e._id))
      .first()
    if (!link) throw new Error('Привязки нет')
    await ctx.db.patch(link._id, {
      status: 'connected',
      connectedAt: Date.now(),
      connectedById: e._id,
    })
    return { employee: e.name, status: 'connected' }
  },
})

// Убрать следы прогона Telegram-модуля на dev: вымышленные привязки, черновики
// и созданные ботом записи. Только dev.
export const devTgCleanup = internalMutation({
  args: {},
  handler: async (ctx) => {
    const url = process.env.CONVEX_CLOUD_URL ?? ''
    if (!url.includes(DEV_DEPLOYMENT)) throw new Error('Только для dev')
    let removed = 0
    for (const t of ['telegramLinks', 'telegramDrafts', 'telegramUpdates', 'telegramSent'] as const) {
      for (const r of await ctx.db.query(t).collect()) {
        await ctx.db.delete(r._id)
        removed++
      }
    }
    for (const t of await ctx.db.query('tasks').collect()) {
      if (t.source === 'telegram') {
        await ctx.db.delete(t._id)
        removed++
      }
    }
    for (const m of await ctx.db.query('meetings').collect()) {
      if (m.source === 'telegram') {
        await ctx.db.delete(m._id)
        removed++
      }
    }
    return { removed }
  },
})

// Часовой пояс организации: смещение и «сейчас» считает боевой orgTime.
// npx convex run setup:devTzCheck
export const devTzCheck = internalQuery({
  args: {},
  handler: async (ctx) => {
    const url = process.env.CONVEX_CLOUD_URL ?? ''
    if (!url.includes(DEV_DEPLOYMENT)) throw new Error('Только для dev')
    const s = await tgSettings(ctx)
    const out: Record<string, string> = { setting: s.timezone }
    for (const tz of ['Asia/Almaty', 'Europe/Moscow', 'UTC', 'Asia/Dubai']) {
      const n = nowIn(tz)
      out[tz] = `${n.date} ${n.time} (${n.weekday}) · смещение ${offsetAt(tz)}`
    }
    // Момент «завтра 15:00» в поясе организации — по нему считаются напоминания.
    const at15 = momentIn(s.timezone, nowIn(s.timezone).date, '15:00')
    out['moment_15_00'] = new Date(at15).toISOString() + ' (UTC)'
    return out
  },
})

// Контрольный прогон дополнения по встречам (§7.2, §7.3). Сеет разбор
// случаев и считает боевой meetingStats. Только dev.
export const devMeetingStatsCheck = internalMutation({
  args: {},
  handler: async (ctx) => {
    const url = process.env.CONVEX_CLOUD_URL ?? ''
    if (!url.includes(DEV_DEPLOYMENT)) throw new Error('Только для dev')
    const emps = await ctx.db.query('employees').collect()
    const me = emps.find((e) => e.role === 'owner')!
    const other = emps.find((e) => e._id !== me._id)!

    for (const m of await ctx.db.query('meetings').collect()) await ctx.db.delete(m._id)
    for (const e of await ctx.db.query('meetingEvents').collect()) await ctx.db.delete(e._id)

    const mk = async (o: {
      title: string
      date: string
      time: string
      by: 'me' | 'other'
      status?: 'planned' | 'held' | 'cancelled'
    }) =>
      await ctx.db.insert('meetings', {
        title: o.title,
        date: o.date,
        time: o.time,
        createdById: o.by === 'me' ? me._id : other._id,
        // Организатор всегда в участниках — §7.2 требует не считать дважды.
        participantIds: o.by === 'me' ? [me._id, other._id] : [other._id, me._id],
        createdAt: Date.now(),
        status: o.status ?? 'planned',
        rescheduleCount: 0,
      })

    // Моя встреча, состоялась
    await mk({ title: 'A · моя, состоялась', date: '2026-08-01', time: '10:00', by: 'me', status: 'held' })
    // Моя встреча, отменена
    await mk({ title: 'B · моя, отменена', date: '2026-08-02', time: '10:00', by: 'me', status: 'cancelled' })
    // Моя, время прошло, результата нет → ожидает подтверждения
    await mk({ title: 'C · моя, без результата', date: '2026-08-03', time: '09:00', by: 'me' })
    // Чужая, я приглашён, впереди
    await mk({ title: 'D · чужая, впереди', date: '2026-12-01', time: '15:00', by: 'other' })
    // Перенесённая: дата уже НОВАЯ, событие переноса в августе
    const moved = await mk({ title: 'E · перенесена', date: '2026-09-10', time: '12:00', by: 'me' })
    await ctx.db.patch(moved, { rescheduleCount: 1, originalDate: '2026-08-05' })
    await ctx.db.insert('meetingEvents', {
      meetingId: moved,
      type: 'rescheduled',
      at: Date.parse('2026-08-04T12:00:00+05:00'),
      byId: me._id,
      fromDate: '2026-08-05',
      fromTime: '12:00',
      toDate: '2026-09-10',
      toTime: '12:00',
    })

    const meetings = await ctx.db.query('meetings').collect()
    const events = await ctx.db.query('meetingEvents').collect()
    const now = Date.parse('2026-08-04T12:00:00+05:00')
    const aug = meetingStats(meetings, events, me._id, '2026-08-01', '2026-08-31', now)
    const sep = meetingStats(meetings, events, me._id, '2026-09-01', '2026-09-30', now)
    return {
      august: `всего ${aug.total} · организовано ${aug.organized} · приглашений ${aug.invited} · участников ${aug.invitedPeople} · состоялось ${aug.held} · отменено ${aug.cancelled} · предстоит ${aug.upcoming} · ожидает ${aug.awaiting} · переносов ${aug.reschedules}`,
      september: `всего ${sep.total} · переносов ${sep.reschedules} · предстоит ${sep.upcoming}`,
    }
  },
})

// Убрать встречи, посеянные проверкой §7. Только dev.
export const devMeetingCleanup = internalMutation({
  args: {},
  handler: async (ctx) => {
    const url = process.env.CONVEX_CLOUD_URL ?? ''
    if (!url.includes(DEV_DEPLOYMENT)) throw new Error('Только для dev')
    let removed = 0
    for (const e of await ctx.db.query('meetingEvents').collect()) {
      await ctx.db.delete(e._id)
      removed++
    }
    for (const m of await ctx.db.query('meetings').collect()) {
      await ctx.db.delete(m._id)
      removed++
    }
    return { removed }
  },
})

// ——— Проверка модуля упаковки (ТЗ Упаковка) ———
//
// Прогоняет проект целиком по сценарию §5.3 и сверяет цифры с примером §7.2:
// стоимость 1 000 000 ₸, процент 20% → полное вознаграждение 200 000 ₸, и по
// 40 000 ₸ за каждый утверждённый этап весом 20%. Только dev.
export const devPackCheck = internalMutation({
  args: {},
  handler: async (ctx) => {
    const url = process.env.CONVEX_CLOUD_URL ?? ''
    if (!url.includes(DEV_DEPLOYMENT)) throw new Error('Только для dev')
    const log: string[] = []

    await devPackWipe(ctx)

    const owner = (await ctx.db.query('employees').collect()).find((e) => e.role === 'owner')!
    const clientId = await ctx.db.insert('employees', {
      name: 'Проверочный Клиент',
      role: 'client',
      position: 'client',
      positionLabel: 'Кофейня у дома',
      department: '',
      salary: 0,
      email: 'pack-check@example.invalid',
      phone: '',
      avatarColor: '#2563eb',
      initials: 'ПК',
      status: 'active',
      hiredAt: packToday(),
    })

    const start = packToday()
    const due = packAddDays(start, 60)
    const packId = await ctx.db.insert('packs', {
      title: 'ПРОВЕРКА · Упаковка франшизы',
      clientId,
      packerId: owner._id,
      memberIds: [],
      startDate: start,
      dueDate: due,
      price: 1_000_000,
      packerPercent: 20,
      status: 'draft',
      createdById: owner._id,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    })
    for (let i = 0; i < DEFAULT_STAGES.length; i++) {
      const b = DEFAULT_STAGES[i]
      await ctx.db.insert('packStages', {
        packId,
        order: i,
        kind: b.kind,
        title: b.title,
        clientNote: b.clientNote,
        startDate: start,
        endDate: packAddDays(start, 10 * (i + 1)),
        weight: b.weight,
        reviewDays: 3,
        rereviewDays: 2,
        fixDays: 3,
        status: 'planned',
        returnCount: 0,
      })
    }

    // §4.3: проверки перед запуском.
    const pack0 = (await ctx.db.get(packId))!
    const issues = await packPreflight(ctx, pack0)
    log.push(
      `§4.3 проверки: ошибок ${issues.filter((i) => i.level === 'error').length}, предупреждений ${issues.filter((i) => i.level === 'warning').length}`,
    )

    // Запуск: первый этап в работе, остальные заблокированы (§5.2).
    let stages = await packStagesOf(ctx, packId)
    for (let i = 0; i < stages.length; i++) {
      await ctx.db.patch(stages[i]._id, {
        status: i === 0 ? 'in_progress' : 'locked',
        awaiting: i === 0 ? 'franchone' : undefined,
        dueAt: i === 0 ? packDayEnd(stages[i].endDate!) : undefined,
      })
    }
    await ctx.db.patch(packId, { status: 'active', launchedAt: Date.now(), launchedById: owner._id })

    // Нулевой этап проходим сразу — он не влияет на прогресс (BR-03).
    stages = await packStagesOf(ctx, packId)
    await packApproveStage(ctx, (await ctx.db.get(packId))!, stages[0], owner._id)
    log.push(`BR-03 после нулевого этапа: прогресс ${await packProgress(ctx, packId)}% (ожидаем 0)`)

    // Этап 1: обязательный материал → передача → возврат → доработка → приёмка.
    stages = await packStagesOf(ctx, packId)
    const s1 = stages[1]
    await ctx.db.patch(s1._id, { status: 'in_progress', awaiting: 'franchone' })
    const materialId = await ctx.db.insert('packMaterials', {
      packId,
      stageId: s1._id,
      title: 'Концепция франшизы.pdf',
      kind: 'doc',
      required: true,
      status: 'planned',
      version: 0,
      side: 'team',
      createdAt: Date.now(),
      createdById: owner._id,
    })
    const before = await packReadiness(ctx, s1._id)
    log.push(`§5.3.2 готовность до загрузки: ${before.done}/${before.required}, можно передавать: ${before.ready}`)

    await packAddVersion(ctx, (await ctx.db.get(materialId))!, owner._id, {
      kind: 'link',
      name: 'https://example.com/v1',
      url: 'https://example.com/v1',
    })
    const after = await packReadiness(ctx, s1._id)
    log.push(`§5.3.2 готовность после загрузки: ${after.done}/${after.required}, можно передавать: ${after.ready}`)

    // Награда за этап — станет доступной с передачей (§12, §5.4).
    const rewardId = await ctx.db.insert('packRewards', {
      packId,
      stageId: s1._id,
      title: 'Разбор воронки продаж',
      status: 'locked',
      createdById: owner._id,
      createdAt: Date.now(),
    })

    // Передача клиенту (BR-06): стартует клиентский таймер.
    const dueAt = packDeadlineFrom(Date.now(), 3, false)
    await ctx.db.patch(s1._id, {
      status: 'review',
      handedAt: Date.now(),
      handoverCount: 1,
      awaiting: 'client',
      dueAt,
    })
    await packOpenRewards(ctx, s1._id, dueAt)
    log.push(`BR-06 после передачи: статус ${(await ctx.db.get(s1._id))!.status}, ждём ${(await ctx.db.get(s1._id))!.awaiting}, награда ${(await ctx.db.get(rewardId))!.status}`)
    log.push(`§7.3 KPI на проверке: ${await packProgress(ctx, packId)}% (ожидаем 0 — передача KPI не даёт)`)

    // Клиент возвращает на доработку в срок (BR-07, §5.4).
    await packSettleRewards(ctx, (await ctx.db.get(s1._id))!, clientId, true)
    await packReturnStage(ctx, (await ctx.db.get(packId))!, (await ctx.db.get(s1._id))!, clientId, 'Нужно уточнить юнит-экономику')
    const returned = (await ctx.db.get(s1._id))!
    log.push(
      `BR-07 после возврата: статус ${returned.status}, ждём ${returned.awaiting}, возвратов ${returned.returnCount}, награда ${(await ctx.db.get(rewardId))!.status}`,
    )

    // Доработка и повторная передача.
    await packAddVersion(ctx, (await ctx.db.get(materialId))!, owner._id, {
      kind: 'link',
      name: 'https://example.com/v2',
      url: 'https://example.com/v2',
    })
    log.push(`§11.1 материал после новой версии: ${(await ctx.db.get(materialId))!.status}, версия ${(await ctx.db.get(materialId))!.version}`)
    await ctx.db.patch(s1._id, { status: 'rereview', handoverCount: 2, awaiting: 'client', dueAt: packDeadlineFrom(Date.now(), 2, false) })

    // Клиент утверждает (BR-04).
    await packApproveStage(ctx, (await ctx.db.get(packId))!, (await ctx.db.get(s1._id))!, clientId)
    const p1 = await packProgress(ctx, packId)
    log.push(
      `§7.2 после этапа 1: KPI ${p1}% (ожидаем 20), начислено ${packAccrued(1_000_000, 20, p1)} ₸ (ожидаем 40 000)`,
    )
    log.push(`§5.2 следующий этап разблокирован: ${(await packStagesOf(ctx, packId))[2].status}`)

    // Остальные этапы.
    for (const s of (await packStagesOf(ctx, packId)).filter((x) => x.kind === 'main' && x.status !== 'approved')) {
      await packApproveStage(ctx, (await ctx.db.get(packId))!, s, clientId)
    }
    const pAll = await packProgress(ctx, packId)
    log.push(
      `§7.2 после всех этапов: KPI ${pAll}% (ожидаем 100), начислено ${packAccrued(1_000_000, 20, pAll)} ₸ (ожидаем 200 000)`,
    )

    // Здоровье и ответственная сторона (§6.3).
    const finalStages = (await packStagesOf(ctx, packId)).map(packStageLike)
    const health = packHealthOf({
      status: 'active',
      dueDate: due,
      stages: finalStages,
      now: Date.now(),
      warnHours: 48,
    })
    log.push(`§6.3 здоровье: ${health.health} · ${health.reason} · сторона ${health.side}`)

    // §13.1: итоговый хаб.
    await ctx.db.patch(packId, { status: 'done', finishedAt: Date.now(), hubOpenedAt: Date.now() })
    const events = await ctx.db.query('packEvents').withIndex('by_pack', (q) => q.eq('packId', packId)).collect()
    log.push(
      `§14.2 журнал: ${events.length} записей, из них финансовых ${events.filter((e) => e.financial).length} (клиенту они не отдаются)`,
    )
    // §14.3: аналитика берёт причины возвратов отсюда — из события, а не из
    // всех комментариев этапа подряд.
    const returns = events.filter((e) => e.type === 'stage_return')
    log.push(
      `§14.3 возвраты: ${returns.length}, причина «${returns[0]?.note ?? '—'}»`,
    )
    log.push(`§13.1 хаб открыт: ${!!(await ctx.db.get(packId))!.hubOpenedAt}`)

    return log
  },
})

export const devPackCleanup = internalMutation({
  args: {},
  handler: async (ctx) => {
    const url = process.env.CONVEX_CLOUD_URL ?? ''
    if (!url.includes(DEV_DEPLOYMENT)) throw new Error('Только для dev')
    return { removed: await devPackWipe(ctx) }
  },
})

// Снести всё, что посеяла проверка. Трогает только проекты с меткой ПРОВЕРКА
// и проверочного клиента — реальные данные не задевает.
async function devPackWipe(ctx: MutationCtx): Promise<number> {
  let removed = 0
  const packs = (await ctx.db.query('packs').collect()).filter((p) => p.title.startsWith('ПРОВЕРКА'))
  for (const pack of packs) {
    for (const t of ['packStages', 'packMaterials', 'packMaterialVersions', 'packComments', 'packEvents', 'packRewards', 'packNotifications'] as const) {
      for (const row of (await ctx.db.query(t).collect()).filter((r) => r.packId === pack._id)) {
        await ctx.db.delete(row._id)
        removed++
      }
    }
    await ctx.db.delete(pack._id)
    removed++
  }
  for (const e of (await ctx.db.query('employees').collect()).filter(
    (x) => x.email === 'pack-check@example.invalid',
  )) {
    await ctx.db.delete(e._id)
    removed++
  }
  return removed
}

// ——— Проверка дополнения «заявки и выходные» ———
//
// §2: количество заявок принадлежит таргетологу и попадает в воронку ровно
// один раз. §3: в субботу и воскресенье просрочки нет, срок — понедельник.
// Только dev.
export const devAddendumCheck = internalMutation({
  args: {},
  handler: async (ctx) => {
    const url = process.env.CONVEX_CLOUD_URL ?? ''
    if (!url.includes(DEV_DEPLOYMENT)) throw new Error('Только для dev')
    const log: string[] = []

    // §3.2: срок сдачи не может выпасть на выходной.
    const week = ['2026-08-06', '2026-08-07', '2026-08-08', '2026-08-09', '2026-08-10']
    const names = ['чт', 'пт', 'сб', 'вс', 'пн']
    log.push(
      '§3.2 срок сдачи: ' +
        week.map((d, i) => `${names[i]} ${d} → ${addendumDeadlineDate(d)}`).join(', '),
    )

    await devAddendumWipe(ctx)

    const targetolog = (await ctx.db.query('employees').collect()).find(
      (e) => e.position === 'targetolog' && e.status === 'active',
    )
    const manager = (await ctx.db.query('employees').collect()).find(
      (e) => e.position === 'sales' && e.status === 'active' && e.role !== 'owner',
    )
    if (!targetolog || !manager) {
      log.push('§2 пропущено: в базе нет активного таргетолога или менеджера продаж')
      return log
    }

    const date = '2026-08-03'
    const month = date.slice(0, 7)
    const objectId = await ctx.db.insert('salesObjects', {
      name: 'ПРОВЕРКА · Объект заявок',
      type: 'franchise',
      status: 'active',
      managerIds: [manager._id],
      createdAt: Date.now(),
      createdBy: manager._id,
    })
    await ctx.db.insert('salesObjectMonths', {
      objectId,
      month,
      objectStatus: 'active',
      status: 'selling',
      managerPlans: [{ managerId: manager._id, planDeals: 1 }],
    })

    // Менеджер сдал свои ступени воронки. Заявок он не вводит (§2.3.2).
    await ctx.db.insert('salesObjectReports', {
      employeeId: manager._id,
      objectId,
      date,
      month,
      newLeads: 0,
      newConsultations: 18,
      repeatConsultations: 0,
      newMeetings: 7,
      repeatMeetings: 0,
      newPrepayments: 3,
      newDeals: 2,
      revenue: 0,
      submittedAt: Date.now(),
      editCount: 0,
      // §2.2: обращения, которых таргетолог не видит.
      leadsHint: 4,
      leadsHintNote: 'звонки по визитке',
    })

    // Таргетолог сохранил официальное значение (§2.1).
    await ctx.db.insert('targetLeadReports', {
      employeeId: targetolog._id,
      objectId,
      date,
      month,
      leads: 30,
      updatedAt: Date.now(),
      updatedById: targetolog._id,
    })

    const owner = (await ctx.db.query('employees').collect()).find((e) => e.role === 'owner')!
    const sum = await salesSummary(
      ctx,
      { from: date, to: date, objectId },
      async () => owner,
    )
    const row = (sum.objectRows as { name: string; newLeads: number; newConsultations: number; conversions: { consultation: number } }[])[0]
    log.push(
      `§2.4 воронка: заявок ${row?.newLeads ?? 0} (ожидаем 30), консультаций ${row?.newConsultations ?? 0} (ожидаем 18), ` +
        `конверсия ${Math.round((row?.conversions.consultation ?? 0) * 100)}% (ожидаем 60%)`,
    )
    log.push(`§2.3.6 без двойного счёта: итог по компании ${sum.totals.newLeads} (ожидаем 30)`)

    // §2.2: подсказка менеджера видна, но в показатель не входит.
    const hint = (
      await ctx.db
        .query('salesObjectReports')
        .withIndex('by_date', (q) => q.eq('date', date))
        .collect()
    ).find((r) => r.objectId === objectId)
    log.push(
      `§2.2 подсказка менеджера: ${hint?.leadsHint ?? '—'} — в показатель не вошла (${sum.totals.newLeads} = 30)`,
    )

    // Отсечка: за день ДО вступления правила старое ручное значение ещё
    // читается, за день ПОСЛЕ — только отчёт таргетолога, иначе ноль.
    for (const [label, day] of [
      ['до отсечки 2026-08-07', '2026-08-07'],
      ['после отсечки 2026-08-09', '2026-08-09'],
    ] as const) {
      await ctx.db.insert('salesObjectReports', {
        employeeId: manager._id,
        objectId,
        date: day,
        month: day.slice(0, 7),
        // Так выглядит строка, заведённая до дополнения: заявки вбиты руками.
        newLeads: 12,
        newConsultations: 5,
        repeatConsultations: 0,
        newMeetings: 0,
        repeatMeetings: 0,
        newPrepayments: 0,
        newDeals: 0,
        revenue: 0,
        submittedAt: Date.now(),
        editCount: 0,
      })
      const one = await salesSummary(ctx, { from: day, to: day, objectId }, async () => owner)
      log.push(`§2 фолбэк ${label}: заявок ${one.totals.newLeads} (ожидаем ${day < '2026-08-08' ? 12 : 0})`)
    }

    await devAddendumWipe(ctx)
    return log
  },
})

async function devAddendumWipe(ctx: MutationCtx): Promise<void> {
  for (const o of (await ctx.db.query('salesObjects').collect()).filter((x) =>
    x.name.startsWith('ПРОВЕРКА'),
  )) {
    for (const r of (await ctx.db.query('salesObjectReports').collect()).filter(
      (x) => x.objectId === o._id,
    )) {
      await ctx.db.delete(r._id)
    }
    for (const r of (await ctx.db.query('targetLeadReports').collect()).filter(
      (x) => x.objectId === o._id,
    )) {
      await ctx.db.delete(r._id)
    }
    for (const r of (await ctx.db.query('salesObjectMonths').collect()).filter(
      (x) => x.objectId === o._id,
    )) {
      await ctx.db.delete(r._id)
    }
    await ctx.db.delete(o._id)
  }
}
