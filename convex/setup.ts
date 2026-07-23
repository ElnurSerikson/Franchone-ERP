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
    const salesOwner = byPos('sales', 'owner')
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
    await insert(smm, '-ooooloooo-ooo', (date) => {
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

    // Ануар (владелец, продажи) — заполняет стабильно, включая сегодня.
    await insert(salesOwner, 'oooooolooooooo', (date) => {
      const seed = Number(date.slice(-2))
      return {
        sales: {
          leads: 14 + (seed % 8),
          meetings: 4 + (seed % 3),
          sales: 1 + (seed % 3),
          revenue: (1 + (seed % 3)) * 350000,
          note: '',
        },
      }
    })

    // Аружан (руководитель, продажи) — стабильно, пара опозданий и пропуск.
    await insert(salesHead, '-oloooooolo--o', (date) => {
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
