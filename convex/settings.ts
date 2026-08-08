import { query, mutation } from './_generated/server'
import { v } from 'convex/values'
import { currentEmployee, isManager, requireEmployee } from './lib'

// Значения по умолчанию — из дашбордов KPI_SMM.xlsx и KPI_TARGETOLOG.xlsx.
// Живые здесь только веса и настройки отчётности: оклады и план продаж стали
// персональными (employees.salary, salesPlans) и оставлены ради старых записей
// и миграций — payroll их не читает, см. комментарий в schema.ts.
const DEFAULTS = {
  leadWeight: 0.7,
  cplWeight: 0.3,
  salarySmm: 600000,
  salaryTargetolog: 200000,
  salarySales: 0,
  planRevenueSales: 0,
  reportMonth: 'Июль 2026',
  // ТЗ СИСТЕМА §2: 14:00 следующего календарного дня.
  reportDeadlineTime: '14:00',
  // Telegram-модуль (§8.2). Токен бота сюда не попадает — он в окружении.
  tgBotUsername: '',
  tgTimezone: 'Asia/Almaty',
  tgInviteTtlHours: 24,
  tgMeetingRemindMin: 60,
  tgReportRemindMin: 60,
  tgTaskRemindAt: '10:00',
  tgTaskEscalateAuthor: true,
  tgTranscriptKeepDays: 90,
  tgKpiOverachieve: false,
  // Утренняя сводка и окно, в которое бот вправе писать первым.
  tgDigestAt: '09:00',
  tgDigestOn: true,
  tgQuietFrom: '09:00',
  tgQuietTo: '20:00',
  tgEveningAt: '19:00',
  tgEveningOn: true,
  tgKpiRiskOn: true,
}

export const get = query({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db
      .query('settings')
      .withIndex('by_key', (q) => q.eq('key', 'global'))
      .first()
    // Отдаём с подставленными умолчаниями, чтобы фронт не дублировал числа.
    const all = { ...DEFAULTS, ...(row ?? {}) }

    const me = await currentEmployee(ctx)
    if (isManager(me)) return all
    // Сотруднику — только база его собственной должности: своя выплата в KPI
    // считаться должна, а чужой оклад его не касается.
    return {
      ...all,
      salarySmm: me?.position === 'smm' ? all.salarySmm : 0,
      salaryTargetolog: me?.position === 'targetolog' ? all.salaryTargetolog : 0,
      salarySales: me?.position === 'sales' ? all.salarySales : 0,
    }
  },
})

export const update = mutation({
  args: {
    leadWeight: v.optional(v.number()),
    cplWeight: v.optional(v.number()),
    salarySmm: v.optional(v.number()),
    salaryTargetolog: v.optional(v.number()),
    salarySales: v.optional(v.number()),
    planRevenueSales: v.optional(v.number()),
    reportMonth: v.optional(v.string()),
    reportDeadlineTime: v.optional(v.string()),
    // ——— Telegram-модуль (§8.2) ———
    tgBotUsername: v.optional(v.string()),
    tgTimezone: v.optional(v.string()),
    tgInviteTtlHours: v.optional(v.number()),
    tgMeetingRemindMin: v.optional(v.number()),
    tgReportRemindMin: v.optional(v.number()),
    tgTaskRemindAt: v.optional(v.string()),
    tgTaskEscalateAuthor: v.optional(v.boolean()),
    tgTranscriptKeepDays: v.optional(v.number()),
    tgReportRecipients: v.optional(v.array(v.id('employees'))),
    tgDisabledCategories: v.optional(v.array(v.string())),
    tgKpiTexts: v.optional(v.array(v.object({ threshold: v.number(), text: v.string() }))),
    tgKpiOverachieve: v.optional(v.boolean()),
    tgDigestAt: v.optional(v.string()),
    tgDigestOn: v.optional(v.boolean()),
    tgQuietFrom: v.optional(v.string()),
    tgQuietTo: v.optional(v.string()),
    tgEveningAt: v.optional(v.string()),
    tgEveningOn: v.optional(v.boolean()),
    tgKpiRiskOn: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const me = await requireEmployee(ctx)
    if (me.role !== 'owner' && me.role !== 'head') {
      throw new Error('Настройки меняет руководитель')
    }
    // Патчим только переданные поля: undefined в Convex стирает значение,
    // и частичное сохранение не должно обнулять соседние настройки.
    const patch = Object.fromEntries(
      Object.entries(args).filter(([, value]) => value !== undefined),
    )
    const existing = await ctx.db
      .query('settings')
      .withIndex('by_key', (q) => q.eq('key', 'global'))
      .first()
    if (existing) await ctx.db.patch(existing._id, patch)
    else await ctx.db.insert('settings', { key: 'global', ...DEFAULTS, ...patch })
  },
})
