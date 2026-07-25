import { query, mutation } from './_generated/server'
import { v, ConvexError } from 'convex/values'
import { requireManager } from './lib'

// Справочник должностей (§11). slug кладётся в employees.position; kpiModel —
// какая формула KPI считается. Новые должности без модели ('none').

export const list = query({
  args: {},
  handler: async (ctx) =>
    (await ctx.db.query('positions').collect()).sort((a, b) => a.label.localeCompare(b.label)),
})

// Детерминированный slug из названия (транслит кириллицы). Без random —
// мутации Convex должны быть детерминированными.
const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i',
  й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '',
  э: 'e', ю: 'yu', я: 'ya', ' ': '-',
}
function slugify(label: string): string {
  const s = label
    .toLowerCase()
    .split('')
    .map((c) => TRANSLIT[c] ?? c)
    .join('')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return s || 'position'
}

async function requireOwner(ctx: Parameters<typeof requireManager>[0]) {
  const me = await requireManager(ctx)
  if (me.role !== 'owner') throw new ConvexError('Должности ведёт владелец')
  return me
}

export const create = mutation({
  args: { label: v.string() },
  handler: async (ctx, { label }) => {
    await requireOwner(ctx)
    const clean = label.trim()
    if (!clean) throw new ConvexError('Укажите название должности')
    const all = await ctx.db.query('positions').collect()
    let slug = slugify(clean)
    if (all.some((p) => p.slug === slug)) {
      let n = 2
      while (all.some((p) => p.slug === `${slug}-${n}`)) n++
      slug = `${slug}-${n}`
    }
    // Новая должность — без KPI-модели (добавляется кодом).
    return await ctx.db.insert('positions', { slug, label: clean, kpiModel: 'none' })
  },
})

export const rename = mutation({
  args: { id: v.id('positions'), label: v.string() },
  handler: async (ctx, { id, label }) => {
    await requireOwner(ctx)
    const clean = label.trim()
    if (!clean) throw new ConvexError('Укажите название')
    const pos = await ctx.db.get(id)
    if (!pos) throw new ConvexError('Должность не найдена')
    await ctx.db.patch(id, { label: clean })
    // Синхронизируем подпись у сотрудников этой должности (кроме владельца —
    // у него кастомный титул, напр. «Владелец / основатель»).
    for (const e of await ctx.db.query('employees').collect()) {
      if (e.position === pos.slug && e.role !== 'owner') {
        await ctx.db.patch(e._id, { positionLabel: clean })
      }
    }
  },
})

export const remove = mutation({
  args: { id: v.id('positions') },
  handler: async (ctx, { id }) => {
    await requireOwner(ctx)
    const pos = await ctx.db.get(id)
    if (!pos) return
    if (pos.builtin) throw new ConvexError('Встроенную должность (с KPI) удалить нельзя')
    const inUse = (await ctx.db.query('employees').collect()).some((e) => e.position === pos.slug)
    if (inUse) throw new ConvexError('Должность занята — сначала переведите сотрудников')
    await ctx.db.delete(id)
  },
})
