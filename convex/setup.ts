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
