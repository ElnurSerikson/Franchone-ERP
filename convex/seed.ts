import { mutation } from './_generated/server'
import type { Id } from './_generated/dataModel'

// Наполнение базы демо-данными FRANCHONE. Идемпотентно: если сотрудники
// уже есть — ничего не делает. Запуск: `npx convex run seed:run`
// (или кнопкой из приложения позже).

type Role = 'owner' | 'head' | 'employee'
type Position = 'smm' | 'targetolog' | 'sales' | 'packer'
type Account = 'FRANCHONE' | 'ANUAR'
type Format = 'Рилсы' | 'Сторис' | 'Карусели'
type TaskStatus = 'assigned' | 'in_progress' | 'done'
type Priority = 'low' | 'medium' | 'high' | 'urgent'

const EMPLOYEES: Array<{
  key: string
  name: string
  role: Role
  position: Position
  positionLabel: string
  department: string
  salary: number
  email: string
  phone: string
  avatarColor: string
  initials: string
  hiredAt: string
}> = [
  { key: 'u1', name: 'Ануар Тасымбеков', role: 'owner', position: 'sales', positionLabel: 'Владелец / основатель', department: 'Руководство', salary: 0, email: 'anuar@franchone.kz', phone: '+7 707 101 00 02', avatarColor: '#057269', initials: 'АТ', hiredAt: '2017-01-10' },
  { key: 'u2', name: 'Нурай Сагатова', role: 'employee', position: 'smm', positionLabel: 'SMM-специалист', department: 'Маркетинг', salary: 600000, email: 'nuray@franchone.kz', phone: '+7 707 220 14 08', avatarColor: '#0a857a', initials: 'НС', hiredAt: '2024-02-01' },
  { key: 'u3', name: 'Дамир Ахметов', role: 'employee', position: 'targetolog', positionLabel: 'Таргетолог', department: 'Маркетинг', salary: 200000, email: 'damir@franchone.kz', phone: '+7 707 512 77 31', avatarColor: '#044f48', initials: 'ДА', hiredAt: '2024-05-12' },
  { key: 'u4', name: 'Аружан Калиева', role: 'head', position: 'sales', positionLabel: 'Руководитель отдела продаж', department: 'Продажи', salary: 350000, email: 'aruzhan@franchone.kz', phone: '+7 707 333 90 12', avatarColor: '#3a2e28', initials: 'АК', hiredAt: '2023-08-03' },
  { key: 'u5', name: 'Ерлан Оспанов', role: 'employee', position: 'packer', positionLabel: 'Упаковщик / проект-менеджер', department: 'Производство', salary: 300000, email: 'erlan@franchone.kz', phone: '+7 707 480 22 55', avatarColor: '#5f646c', initials: 'ЕО', hiredAt: '2023-11-20' },
]

const SMM: Array<{ emp: string; account: Account; format: Format; weight: number; weekPlans: number[]; weekFacts: number[] }> = [
  { emp: 'u2', account: 'FRANCHONE', format: 'Рилсы', weight: 0.2, weekPlans: [4, 4, 4, 4, 0], weekFacts: [5, 0, 0, 0, 0] },
  { emp: 'u2', account: 'FRANCHONE', format: 'Сторис', weight: 0.1, weekPlans: [24, 24, 24, 24, 0], weekFacts: [8, 0, 0, 0, 0] },
  { emp: 'u2', account: 'FRANCHONE', format: 'Карусели', weight: 0.1, weekPlans: [1, 1, 1, 1, 0], weekFacts: [6, 0, 0, 0, 0] },
  { emp: 'u2', account: 'ANUAR', format: 'Рилсы', weight: 0.3, weekPlans: [15, 15, 15, 15, 0], weekFacts: [10, 0, 0, 0, 0] },
  { emp: 'u2', account: 'ANUAR', format: 'Сторис', weight: 0.2, weekPlans: [35, 35, 35, 35, 0], weekFacts: [14, 0, 0, 0, 0] },
  { emp: 'u2', account: 'ANUAR', format: 'Карусели', weight: 0.1, weekPlans: [2, 2, 2, 2, 0], weekFacts: [4, 0, 0, 0, 0] },
]


const TASKS: Array<{ title: string; description?: string; status: TaskStatus; priority: Priority; assignee: string; reporter: string; deadline: string; tags: string[]; checklist: Array<{ text: string; done: boolean }>; attachments: number; comments: number; kpiRef?: string }> = [
  { title: 'Снять 4 Reels для аккаунта ANUAR', description: 'Съёмка и монтаж 4 роликов по контент-плану на неделю.', status: 'in_progress', priority: 'high', assignee: 'u2', reporter: 'u1', deadline: '2026-07-22', tags: ['SMM', 'Контент'], checklist: [{ text: 'Написать сценарии', done: true }, { text: 'Съёмка', done: true }, { text: 'Монтаж', done: false }, { text: 'Публикация', done: false }], attachments: 2, comments: 3, kpiRef: 'ANUAR · Рилсы' },
  { title: 'Перезапустить кампанию «Брокеридж»', description: 'CPL выше плана, обновить креативы и аудитории.', status: 'in_progress', priority: 'urgent', assignee: 'u3', reporter: 'u1', deadline: '2026-07-20', tags: ['Таргет', 'FR-002'], checklist: [{ text: 'Новые креативы (3 шт.)', done: true }, { text: 'Настроить аудитории', done: false }, { text: 'Запуск A/B', done: false }], attachments: 1, comments: 5, kpiRef: 'Кампания FR-002' },
  { title: 'Упаковка GREEK FOOD — операционный блок', description: 'Чек-листы открытия, бизнес-процессы, аудиторский регламент.', status: 'in_progress', priority: 'medium', assignee: 'u5', reporter: 'u4', deadline: '2026-07-25', tags: ['Упаковка', 'Проект'], checklist: [{ text: 'Чек-лист открытия', done: true }, { text: 'Бизнес-процессы', done: true }, { text: 'Аудиторский регламент', done: false }], attachments: 6, comments: 2 },
  { title: 'Обзвонить заявки по «Упаковке франшизы»', description: '22 новых заявки с прошлой недели.', status: 'assigned', priority: 'high', assignee: 'u4', reporter: 'u1', deadline: '2026-07-21', tags: ['Продажи'], checklist: [], attachments: 0, comments: 0 },
  { title: 'Подготовить 24 сторис FRANCHONE на неделю', status: 'assigned', priority: 'medium', assignee: 'u2', reporter: 'u1', deadline: '2026-07-23', tags: ['SMM', 'Контент'], checklist: [], attachments: 0, comments: 1, kpiRef: 'FRANCHONE · Сторис' },
  { title: 'Свести отчёт по CPL за июль', status: 'assigned', priority: 'low', assignee: 'u3', reporter: 'u4', deadline: '2026-07-31', tags: ['Таргет', 'Отчёт'], checklist: [], attachments: 0, comments: 0 },
  { title: 'Финмодель для франшизы Panda Lamian', status: 'done', priority: 'medium', assignee: 'u5', reporter: 'u4', deadline: '2026-07-15', tags: ['Упаковка', 'Финансы'], checklist: [{ text: 'Смета', done: true }, { text: 'Сценарии рентабельности', done: true }], attachments: 3, comments: 4 },
  { title: 'Брендбук BLV — правки после ревью', status: 'done', priority: 'low', assignee: 'u5', reporter: 'u4', deadline: '2026-07-12', tags: ['Упаковка', 'Бренд'], checklist: [], attachments: 2, comments: 1 },
  { title: 'Карусель «5 мифов о франчайзинге»', status: 'in_progress', priority: 'medium', assignee: 'u2', reporter: 'u1', deadline: '2026-07-17', tags: ['SMM', 'Контент'], checklist: [{ text: 'Дизайн 8 слайдов', done: true }], attachments: 1, comments: 2, kpiRef: 'FRANCHONE · Карусели' },
]

export const run = mutation({
  args: {},
  handler: async (ctx) => {
    const already = await ctx.db.query('employees').first()
    if (already) return { skipped: true, reason: 'База уже наполнена' }

    const idByKey: Record<string, Id<'employees'>> = {}
    for (const e of EMPLOYEES) {
      const { key, ...rest } = e
      idByKey[key] = await ctx.db.insert('employees', { ...rest, status: 'active' })
    }

    for (const m of SMM) {
      const { emp, ...rest } = m
      await ctx.db.insert('smmMetrics', { employeeId: idByKey[emp], ...rest })
    }

    for (const t of TASKS) {
      const { assignee, reporter, ...rest } = t
      await ctx.db.insert('tasks', {
        ...rest,
        assigneeId: idByKey[assignee],
        reporterId: idByKey[reporter],
      })
    }

    await ctx.db.insert('settings', {
      key: 'global',
      leadWeight: 0.7,
      cplWeight: 0.3,
      reportMonth: 'Июль 2026',
    })

    return { seeded: true, employees: EMPLOYEES.length, tasks: TASKS.length }
  },
})
