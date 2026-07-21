import { convexAuth } from '@convex-dev/auth/server'
import { ConvexError } from 'convex/values'
import { ResendOTP } from './ResendOTP'

const WEEK_MS = 1000 * 60 * 60 * 24 * 7

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [ResendOTP],

  // Сессия: 7 дней. Пока пользователь активен — продлевается, иначе выход.
  session: {
    totalDurationMs: WEEK_MS,
    inactiveDurationMs: WEEK_MS,
  },

  // Ограничение попыток ввода кода (защита от перебора).
  signIn: {
    maxFailedAttempsPerHour: 10,
  },

  callbacks: {
    // Инвайт-онли: войти может ТОЛЬКО тот, чей email есть в разделе «Команда».
    // Здесь же фиксируем время входа сотрудника.
    async createOrUpdateUser(ctx, { existingUserId, profile }) {
      const email = String(profile.email ?? '')
        .toLowerCase()
        .trim()

      // ctx здесь типизирован как AnyDataModel, поэтому фильтром, а не индексом.
      const employee = email
        ? await ctx.db
            .query('employees')
            .filter((q) => q.eq(q.field('email'), email))
            .first()
        : null

      if (!employee || employee.status !== 'active') {
        throw new ConvexError(
          'Нет доступа. Обратитесь к владельцу, чтобы вас добавили в команду.',
        )
      }

      await ctx.db.patch(employee._id, { lastLoginAt: Date.now() })

      if (existingUserId) {
        await ctx.db.patch(existingUserId, { email, name: employee.name })
        return existingUserId
      }
      return ctx.db.insert('users', { email, name: employee.name })
    },
  },
})
