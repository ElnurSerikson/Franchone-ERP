import { getAuthUserId } from '@convex-dev/auth/server'
import { ConvexError } from 'convex/values'
import type { QueryCtx, MutationCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'

// id скрытых служебных аккаунтов (напр. тестовый сотрудник). Их ежедневные
// отчёты НЕ должны попадать в общий факт роли и искажать реальный KPI команды:
// hidden = невидим во всех списках И исключён из подсчёта показателей.
export async function hiddenEmployeeIds(
  ctx: QueryCtx | MutationCtx,
): Promise<Set<Id<'employees'>>> {
  const all = await ctx.db.query('employees').collect()
  return new Set(all.filter((e) => e.hidden).map((e) => e._id))
}

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
// Деактивированный сотрудник (status !== 'active') сюда не проходит: сессия
// живёт до 7 дней и сама не рвётся, поэтому доступ режем на каждой мутации —
// иначе выключение было бы только на уровне UI и обходилось бы из консоли.
export async function requireEmployee(ctx: MutationCtx): Promise<Doc<'employees'>> {
  const me = await currentEmployee(ctx)
  if (!me) throw new ConvexError('Не авторизован')
  if (me.status !== 'active') {
    throw new ConvexError('Доступ отключён. Обратитесь к руководителю.')
  }
  return me
}

// Руководство — владелец и руководитель отдела.
export function isManager(me: Doc<'employees'> | null | undefined): boolean {
  return me?.role === 'owner' || me?.role === 'head'
}

// Сотрудник компании, а не заказчик упаковки (ТЗ Упаковка §3). Клиент лежит в
// той же таблице — только так он входит в ERP тем же email-кодом, — но он не
// член команды: ему нечего делать в «Команде», выплатах, дисциплине, выборе
// исполнителя задачи и списке приглашённых на внутреннюю встречу.
export function isStaff(e: Doc<'employees'> | null | undefined): boolean {
  return !!e && e.role !== 'client'
}

// Заказчик упаковки. Прав в ERP у него нет ни одного: матрица описывает
// только head и employee, поэтому can()/requireCan() роль 'client' не
// пропускают. Доступ к своему проекту он получает через packClient.*.
export function isClient(e: Doc<'employees'> | null | undefined): boolean {
  return e?.role === 'client'
}

// Мутация только для руководства. Роутер прячет экраны, но запросы и мутации
// доступны любому авторизованному напрямую — значит право проверяем здесь.
export async function requireManager(ctx: MutationCtx): Promise<Doc<'employees'>> {
  const me = await requireEmployee(ctx)
  if (!isManager(me)) throw new ConvexError('Недостаточно прав')
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
