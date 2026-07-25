import { query, mutation, internalAction } from './_generated/server'
import { v, ConvexError } from 'convex/values'
import { internal } from './_generated/api'
import { Resend as ResendAPI } from 'resend'
import { inviteEmail } from './emails'
import { currentEmployee } from './lib'
import { requireCan, inScope } from './permissions'

// Палитра аватаров — цвет назначается детерминированно по имени (без random,
// т.к. мутации Convex должны быть детерминированными).
const AVATAR_PALETTE = [
  '#057269', '#0a857a', '#20915a', '#4db3a6',
  '#3a2e28', '#5f646c', '#c05621', '#2563eb',
]
function colorFor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length]
}

// Список сотрудников для фронта — скрытые служебные аккаунты не отдаём.
//
// Запрос нужен всем (аватары и имена исполнителей в задачах, на дашборде), но
// оклад, почта и телефон — только руководству. Роутер прячет «Команду» лишь
// как экран: любой авторизованный может дёрнуть запрос напрямую, поэтому
// чувствительные поля вычищаем на сервере, а не на фронте.
export const list = query({
  args: {},
  handler: async (ctx) => {
    const me = await currentEmployee(ctx)
    const rows = (await ctx.db.query('employees').collect()).filter((e) => !e.hidden)
    const strip = (e: (typeof rows)[number]) => ({ ...e, salary: 0, email: '', phone: '' })
    // Владелец — всё; руководитель — оклады/контакты только своего отдела;
    // сотрудник — без чувствительных полей (нужны только имена/аватары).
    if (me?.role === 'owner') return rows
    if (me?.role === 'head') return rows.map((e) => (e.department === me.department ? e : strip(e)))
    return rows.map(strip)
  },
})

export const create = mutation({
  args: {
    name: v.string(),
    role: v.union(v.literal('owner'), v.literal('head'), v.literal('employee')),
    position: v.string(), // slug из справочника должностей
    positionLabel: v.string(),
    department: v.string(),
    salary: v.number(),
    email: v.string(),
    phone: v.string(),
    avatarColor: v.string(),
    initials: v.string(),
    hiredAt: v.string(),
  },
  handler: async (ctx, args) => {
    const me = await requireCan(ctx, 'team', 'create')
    // Владельца может назначить только владелец: иначе руководитель отдела
    // выписал бы себе полный доступ через создание второго аккаунта.
    if (args.role === 'owner' && me.role !== 'owner') {
      throw new ConvexError('Роль владельца назначает только владелец')
    }
    return await ctx.db.insert('employees', { ...args, status: 'active' })
  },
})

export const update = mutation({
  args: {
    id: v.id('employees'),
    patch: v.object({
      name: v.optional(v.string()),
      positionLabel: v.optional(v.string()),
      department: v.optional(v.string()),
      salary: v.optional(v.number()),
      email: v.optional(v.string()),
      phone: v.optional(v.string()),
      role: v.optional(
        v.union(v.literal('owner'), v.literal('head'), v.literal('employee')),
      ),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const me = await requireCan(ctx, 'team', 'edit')
    const target = await ctx.db.get(id)
    if (!target) throw new ConvexError('Сотрудник не найден')
    if (!inScope(me, target)) {
      throw new ConvexError('Можно менять только сотрудников в вашем доступе')
    }
    // Инвариант: роль и оклад — только владелец (матрица их не переопределяет).
    if (patch.role !== undefined && me.role !== 'owner') {
      throw new ConvexError('Роль меняет только владелец')
    }
    if (patch.salary !== undefined && me.role !== 'owner') {
      throw new ConvexError('Оклад меняет только владелец')
    }
    if (patch.role !== undefined && target.role === 'owner' && me._id !== id) {
      throw new ConvexError('Нельзя менять роль владельца')
    }
    await ctx.db.patch(id, patch)
  },
})

export const archive = mutation({
  args: { id: v.id('employees') },
  handler: async (ctx, { id }) => {
    const me = await requireCan(ctx, 'team', 'delete')
    if (me._id === id) throw new ConvexError('Нельзя архивировать самого себя')
    const target = await ctx.db.get(id)
    if (!target) throw new ConvexError('Сотрудник не найден')
    if (target.role === 'owner') throw new ConvexError('Нельзя архивировать владельца')
    if (!inScope(me, target)) throw new ConvexError('Можно архивировать только сотрудников в вашем доступе')
    await ctx.db.patch(id, { status: 'archived' })
  },
})

// Редактирование участника команды — тот же набор полей, что и в приглашении.
// Роль, оклад, дату найма и цвет аватара здесь намеренно не трогаем.
export const updateMember = mutation({
  args: {
    id: v.id('employees'),
    firstName: v.string(),
    lastName: v.string(),
    email: v.string(),
    phone: v.string(),
    // Должность необязательна: если её не прислали — не трогаем. Так не
    // затирается кастомный титул (напр. «Руководитель отдела продаж»), когда
    // правят только имя или телефон.
    position: v.optional(v.string()),
    positionLabel: v.optional(v.string()),
    department: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const me = await requireCan(ctx, 'team', 'edit')
    const target = await ctx.db.get(args.id)
    if (!target) throw new ConvexError('Сотрудник не найден')
    if (!inScope(me, target)) {
      throw new ConvexError('Можно редактировать только сотрудников в вашем доступе')
    }

    const firstName = args.firstName.trim()
    const lastName = args.lastName.trim()
    const email = args.email.trim().toLowerCase()
    if (!firstName) throw new ConvexError('Укажите имя')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new ConvexError('Некорректный email')
    }

    // email — это логин, он обязан остаться уникальным
    const clash = await ctx.db
      .query('employees')
      .withIndex('by_email', (q) => q.eq('email', email))
      .first()
    if (clash && clash._id !== args.id) {
      throw new ConvexError('Сотрудник с таким email уже есть')
    }

    const name = `${firstName} ${lastName}`.trim()
    const base = {
      name,
      initials: ((firstName[0] ?? '') + (lastName[0] ?? '')).toUpperCase() || '—',
      email,
      phone: args.phone.trim(),
    }

    // Отдел меняется у любого (включая владельца). Должность — не у владельца:
    // в его position лежит техническое значение (модель KPI), а титул —
    // в positionLabel («Владелец / основатель»), пикер бы его затёр.
    const patch: Record<string, unknown> = { ...base }
    if (args.position && target.role !== 'owner') {
      patch.position = args.position
      patch.positionLabel = args.positionLabel ?? target.positionLabel
    }
    if (args.department !== undefined) patch.department = args.department
    await ctx.db.patch(args.id, patch)
  },
})

// Деактивация / возврат в строй. Мягкая: данные сохраняются, но вход закрыт
// (авторизация пускает только сотрудников со статусом active).
export const setActive = mutation({
  args: { id: v.id('employees'), active: v.boolean() },
  handler: async (ctx, { id, active }) => {
    const me = await requireCan(ctx, 'team', 'delete')
    if (me._id === id) throw new ConvexError('Нельзя деактивировать самого себя')
    const target = await ctx.db.get(id)
    if (!target) throw new ConvexError('Сотрудник не найден')
    if (!active && target.role === 'owner') {
      throw new ConvexError('Нельзя деактивировать владельца')
    }
    if (!inScope(me, target)) throw new ConvexError('Можно менять только сотрудников в вашем доступе')
    await ctx.db.patch(id, { status: active ? 'active' : 'archived' })
  },
})

// ——— Приглашение сотрудника ———
// Создаёт сотрудника (это и есть инвайт: вход инвайт-онли по совпадению email)
// и планирует отправку письма-приглашения через Resend. Вход по коду, без пароля.
export const invite = mutation({
  args: {
    firstName: v.string(),
    lastName: v.string(),
    email: v.string(),
    phone: v.string(),
    position: v.string(), // slug из справочника должностей
    positionLabel: v.string(),
    department: v.string(),
    role: v.union(v.literal('head'), v.literal('employee')),
    salary: v.number(),
    hiredAt: v.string(),
  },
  handler: async (ctx, args) => {
    const me = await requireCan(ctx, 'team', 'create')
    // Руководитель приглашает только в свой отдел.
    if (me.role === 'head' && args.department !== me.department) {
      throw new ConvexError('Можно приглашать только в свой отдел')
    }

    const firstName = args.firstName.trim()
    const lastName = args.lastName.trim()
    const email = args.email.trim().toLowerCase()
    if (!firstName) throw new ConvexError('Укажите имя')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new ConvexError('Некорректный email')
    }

    const existing = await ctx.db
      .query('employees')
      .withIndex('by_email', (q) => q.eq('email', email))
      .first()
    if (existing) throw new ConvexError('Сотрудник с таким email уже есть')

    const name = `${firstName} ${lastName}`.trim()
    const initials = ((firstName[0] ?? '') + (lastName[0] ?? '')).toUpperCase() || '—'

    const id = await ctx.db.insert('employees', {
      name,
      role: args.role,
      position: args.position,
      positionLabel: args.positionLabel,
      department: args.department,
      salary: args.salary,
      email,
      phone: args.phone.trim(),
      avatarColor: colorFor(name),
      initials,
      status: 'active',
      hiredAt: args.hiredAt,
    })

    // Письмо-приглашение шлём фоновой action'ой (сеть недоступна из мутации).
    await ctx.scheduler.runAfter(0, internal.employees.sendInvite, { email, name })
    return id
  },
})

// Фоновая отправка письма-приглашения через Resend.
export const sendInvite = internalAction({
  args: { email: v.string(), name: v.string() },
  handler: async (_ctx, { email, name }) => {
    const apiKey = process.env.AUTH_RESEND_KEY ?? process.env.RESEND_API_KEY
    const { subject, html, text } = inviteEmail(name)
    if (!apiKey) {
      // dev-режим без Resend — печатаем в логи (npx convex logs).
      console.log(`[DEV INVITE] ${name} <${email}>: ${subject}`)
      return
    }
    const resend = new ResendAPI(apiKey)
    const { error } = await resend.emails.send({
      from: process.env.AUTH_EMAIL_FROM ?? 'FRANCHONE <onboarding@resend.dev>',
      to: [email],
      subject,
      html,
      text,
    })
    if (error) {
      throw new Error('Не удалось отправить приглашение: ' + JSON.stringify(error))
    }
  },
})
