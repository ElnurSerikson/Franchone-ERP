import { query, internalQuery } from './_generated/server'
import { v } from 'convex/values'
import { getAuthUserId } from '@convex-dev/auth/server'

// Сотрудник, соответствующий вошедшему пользователю (матчинг по email).
// null, если не авторизован или email не привязан к сотруднику.
export const currentEmployee = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) return null
    const user = await ctx.db.get(userId)
    const email = user?.email?.toLowerCase()
    if (!email) return null
    return await ctx.db
      .query('employees')
      .withIndex('by_email', (q) => q.eq('email', email))
      .first()
  },
})

// Приглашён ли email (есть ли активный сотрудник с таким email).
// Используется гейтом до отправки кода — чтобы не слать письма чужим.
export const isInvited = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const e = await ctx.db
      .query('employees')
      .withIndex('by_email', (q) => q.eq('email', email.toLowerCase().trim()))
      .first()
    return !!e && e.status === 'active'
  },
})
