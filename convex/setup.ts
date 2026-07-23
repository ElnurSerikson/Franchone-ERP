import { mutation } from './_generated/server'
import { v } from 'convex/values'
import type { Doc } from './_generated/dataModel'

// Одноразовая настройка: назначить владельцу email для входа и привести
// все email сотрудников к нижнему регистру (email = логин).
export const bootstrapOwner = mutation({
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

export const reseedTasks = mutation({
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
export const recolorAvatars = mutation({
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
export const seedSmm = mutation({
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
export const seedCampaigns = mutation({
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
export const clearCampaigns = mutation({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query('campaigns').collect()
    for (const c of all) await ctx.db.delete(c._id)
    return { deleted: all.length }
  },
})

// ДЕМО: продажные ежедневные отчёты за текущий месяц (для таба «Отдел продаж»).
// Привязаны к владельцу — в дисциплине/«Мой отчёт» не показываются, только в KPI.
// Удаляются мутацией setup:clearSalesDemo по команде.
export const seedSalesDemo = mutation({
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
export const clearSalesDemo = mutation({
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

export const seedSmmReports = mutation({
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

export const clearSmmReports = mutation({
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
export const makeHiddenAdmin = mutation({
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
export const resetTeam = mutation({
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
export const seedReports = mutation({
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
export const seedActivity = mutation({
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
