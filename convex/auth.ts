import { convexAuth } from '@convex-dev/auth/server'
import { ConvexError } from 'convex/values'
import { ResendOTP } from './ResendOTP'

const WEEK_MS = 1000 * 60 * 60 * 24 * 7
// Окно одного визита: повторные срабатывания колбэка внутри него — тот же вход.
export const LOGIN_WINDOW_MS = 1000 * 60 * 5

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

      const now = Date.now()
      await ctx.db.patch(employee._id, { lastLoginAt: now })
      // Колбэк срабатывает несколько раз за один вход (проверка кода, создание
      // сессии) — в базе появлялись дубли с разницей в 10–30 секунд, и счётчик
      // входов задваивался. Пишем событие, только если в окне визита пусто.
      // Индекс здесь недоступен: ctx колбэка типизирован обобщённо, как и
      // в запросе сотрудника выше — поэтому фильтром.
      const since = now - LOGIN_WINDOW_MS
      const recent = await ctx.db
        .query('loginEvents')
        .filter((q) =>
          q.and(q.eq(q.field('employeeId'), employee._id), q.gte(q.field('at'), since)),
        )
        .first()
      if (!recent) {
        await ctx.db.insert('loginEvents', { employeeId: employee._id, at: now })
      }

      if (existingUserId) {
        await ctx.db.patch(existingUserId, { email, name: employee.name })
        return existingUserId
      }
      return ctx.db.insert('users', { email, name: employee.name })
    },
  },
})
