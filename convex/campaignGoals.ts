// Цели рекламных кампаний и их метрики (ТЗ таргетолога, §8). Цель выбирается
// при создании кампании и неизменна после появления отчётных данных: она
// определяет, что именно таргетолог вписывает в отчёт и по какой формуле
// считается стоимость результата. Импортируется сервером и фронтом.
//
// Критическое правило §8: сообщения Instagram и WhatsApp — РАЗНЫЕ переменные.
// Результаты разных целей нельзя складывать в один общий показатель, поэтому
// «итого результатов» по смешанному списку кампаний нигде не выводится.

export type CampaignGoalSlug =
  | 'msg_inst'
  | 'msg_wa'
  | 'reach'
  | 'profile'
  | 'site_leads'
  | 'engagement'

export interface CampaignGoal {
  slug: CampaignGoalSlug
  label: string // как называется цель в пикере
  metric: string // единица результата: что вписывают в отчёт
  planLabel: string // подпись поля плана (старая модель KPI)
  costLabel: string // подпись стоимости результата
  // Охваты меряются за тысячу: цена = расход ÷ охват × 1000. У остальных
  // целей делитель — сам результат.
  per: 1 | 1000
}

export const CAMPAIGN_GOALS: CampaignGoal[] = [
  {
    slug: 'msg_inst',
    label: 'Переписки Instagram',
    metric: 'Начатые переписки',
    planLabel: 'План сообщений',
    costLabel: 'Цена сообщения',
    per: 1,
  },
  {
    slug: 'msg_wa',
    label: 'Переписки WhatsApp',
    metric: 'Начатые переписки',
    planLabel: 'План сообщений',
    costLabel: 'Цена сообщения',
    per: 1,
  },
  {
    slug: 'site_leads',
    label: 'Лидогенерация',
    metric: 'Заполненные лид-формы',
    planLabel: 'План лидов',
    costLabel: 'Цена лида',
    per: 1,
  },
  {
    slug: 'reach',
    label: 'Охват',
    metric: 'Охваченные пользователи',
    planLabel: 'План охвата',
    costLabel: 'Стоимость 1 000 охватов',
    per: 1000,
  },
  {
    slug: 'profile',
    label: 'Трафик',
    metric: 'Переходы / клики',
    planLabel: 'План переходов',
    costLabel: 'Цена перехода',
    per: 1,
  },
  {
    // Добавлена по §2.1 ТАРГЕТ 1.6 — в первой версии модуля этой цели не было.
    slug: 'engagement',
    label: 'Вовлечённость',
    metric: 'Взаимодействия',
    planLabel: 'План взаимодействий',
    costLabel: 'Цена взаимодействия',
    per: 1,
  },
]

export const CAMPAIGN_GOAL_SLUGS = CAMPAIGN_GOALS.map((g) => g.slug)

// Пока цель не задана (кампании, заведённые до появления поля) — нейтральные
// подписи и обычная формула «расход ÷ результат».
const UNSET: Omit<CampaignGoal, 'slug'> = {
  label: 'Цель не задана',
  metric: 'Результат',
  planLabel: 'План результата',
  costLabel: 'Цена за результат',
  per: 1,
}

export function goalMeta(slug?: string): Omit<CampaignGoal, 'slug'> {
  return CAMPAIGN_GOALS.find((g) => g.slug === slug) ?? UNSET
}

// ——— Деньги ———
// Бюджеты храним в центах целым числом. Причина: §15 ТЗ запрещает тип float
// для денег, а в Convex единственный числовой тип — float64. Целые центы дают
// точную арифметику и делают структурно невозможным округление до целого
// доллара, которое ТЗ тоже запрещает.

export const dollarsToCents = (dollars: number) => Math.round(dollars * 100)
export const centsToDollars = (cents: number) => cents / 100

// Стоимость результата в центах. Считается с полной точностью — округляем
// только при выводе (§8.1: внутренняя точность не менее четырёх знаков).
// null означает «Нет результата»: при нулевом результате цену показывать
// нельзя, и $0.00 здесь был бы ложью.
export function resultCostCents(
  budgetCents: number,
  result: number,
  goal?: string,
): number | null {
  if (result <= 0) return null
  return (budgetCents * goalMeta(goal).per) / result
}

// Итоговая цена за период считается как сумма расходов ÷ сумма результатов
// (§8.1), а не как среднее дневных цен: среднее уже округлённых цен даёт
// другую цифру и в ТЗ прямо запрещено (пример §8.2: $3.66, а не $3.55).
export const aggregateCostCents = resultCostCents
