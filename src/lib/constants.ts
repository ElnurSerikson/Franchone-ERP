// «Сегодня» (реальная дата) для расчёта просрочек и дисциплины.
export const TODAY = new Date().toISOString().slice(0, 10)
export const REPORT_MONTH_FALLBACK = 'Июль 2026'

// ——— Ежедневная отчётность (§3) ———
// Должности, для которых предусмотрена форма ежедневного отчёта.
export const REPORTING_POSITIONS = ['smm', 'targetolog', 'sales'] as const
// Страницы/проекты и типы контента для отчёта SMM (§3.1).
export const REPORT_PAGES = ['FRANCHONE', 'ANUAR'] as const
export const CONTENT_TYPES = ['Reels', 'Stories', 'Посты', 'Карусели'] as const
