import { getAuthUserId } from '@convex-dev/auth/server'
import type { QueryCtx, MutationCtx } from './_generated/server'
import type { Doc } from './_generated/dataModel'

// Сотрудник, соответствующий вошедшему пользователю (матчинг по email).
export async function currentEmployee(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<'employees'> | null> {
  const userId = await getAuthUserId(ctx)
  if (!userId) return null
  const user = await ctx.db.get(userId)
  const email = user?.email?.toLowerCase()
  if (!email) return null
  return await ctx.db
    .query('employees')
    .withIndex('by_email', (q) => q.eq('email', email))
    .first()
}

// То же, но кидает ошибку если не авторизован (для мутаций).
export async function requireEmployee(ctx: MutationCtx): Promise<Doc<'employees'>> {
  const me = await currentEmployee(ctx)
  if (!me) throw new Error('Не авторизован')
  return me
}

// В срок ли завершена задача: дата завершения <= срок (по календарной дате).
export function isOnTime(completedAtMs: number, deadline: string): boolean {
  const d = new Date(completedAtMs)
  const done = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`
  return done <= deadline
}
