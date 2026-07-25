import { query, mutation } from './_generated/server'
import { v, ConvexError } from 'convex/values'
import type { QueryCtx, MutationCtx } from './_generated/server'
import type { Doc } from './_generated/dataModel'
import { currentEmployee, requireEmployee } from './lib'
import { DEFAULT_PERMS, ALL_PERM_KEYS, permKey, type PermRole } from './permModel'

// Разрешённые ключи для роли: из БД, иначе дефолты.
async function allowedFor(ctx: QueryCtx | MutationCtx, role: PermRole): Promise<Set<string>> {
  const row = await ctx.db
    .query('rolePermissions')
    .withIndex('by_role', (q) => q.eq('role', role))
    .first()
  return new Set(row?.allowed ?? DEFAULT_PERMS[role])
}

// Может ли текущий пользователь выполнить действие. Владелец — всегда да.
export async function can(
  ctx: QueryCtx | MutationCtx,
  section: string,
  action: string,
): Promise<boolean> {
  const me = await currentEmployee(ctx)
  if (!me) return false
  if (me.role === 'owner') return true
  if (me.role !== 'head' && me.role !== 'employee') return false
  const set = await allowedFor(ctx, me.role)
  return set.has(permKey(section, action))
}

// Требует право; иначе бросает. Возвращает сотрудника (для скоупа в мутации).
export async function requireCan(
  ctx: MutationCtx,
  section: string,
  action: string,
): Promise<Doc<'employees'>> {
  const me = await requireEmployee(ctx)
  if (me.role === 'owner') return me
  if (me.role === 'head' || me.role === 'employee') {
    const set = await allowedFor(ctx, me.role)
    if (set.has(permKey(section, action))) return me
  }
  throw new ConvexError('Недостаточно прав для этого действия')
}

// Скоуп данных: владелец — все, руководитель — свой отдел, сотрудник — только
// сам. Проверка «можно ли действовать над этим сотрудником/его данными».
export function inScope(me: Doc<'employees'>, target: Doc<'employees'>): boolean {
  if (me.role === 'owner') return true
  if (me.role === 'head') return target.department === me.department
  return target._id === me._id
}

// Права текущего пользователя — для гейтинга интерфейса.
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const me = await currentEmployee(ctx)
    if (!me) return { role: null as string | null, allowed: [] as string[], isOwner: false }
    if (me.role === 'owner') return { role: 'owner', allowed: ALL_PERM_KEYS, isOwner: true }
    if (me.role === 'head' || me.role === 'employee') {
      return { role: me.role, allowed: [...(await allowedFor(ctx, me.role))], isOwner: false }
    }
    return { role: me.role, allowed: [], isOwner: false }
  },
})

// Полная матрица (экран настроек) — только владелец.
export const matrix = query({
  args: {},
  handler: async (ctx) => {
    const me = await currentEmployee(ctx)
    if (me?.role !== 'owner') return null
    return {
      head: [...(await allowedFor(ctx, 'head'))],
      employee: [...(await allowedFor(ctx, 'employee'))],
    }
  },
})

export const setMatrix = mutation({
  args: {
    role: v.union(v.literal('head'), v.literal('employee')),
    allowed: v.array(v.string()),
  },
  handler: async (ctx, { role, allowed }) => {
    const me = await requireEmployee(ctx)
    // Инвариант: саму матрицу правит только владелец.
    if (me.role !== 'owner') throw new ConvexError('Матрицу прав меняет только владелец')
    const clean = allowed.filter((k) => ALL_PERM_KEYS.includes(k))
    const row = await ctx.db
      .query('rolePermissions')
      .withIndex('by_role', (q) => q.eq('role', role))
      .first()
    if (row) await ctx.db.patch(row._id, { allowed: clean })
    else await ctx.db.insert('rolePermissions', { role, allowed: clean })
  },
})
