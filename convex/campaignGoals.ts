// Цели рекламных кампаний и их метрики (§3.2). Цель выбирается при создании
// кампании и неизменна. Она определяет главную метрику, которую таргетолог
// вписывает в отчёт, и лейблы плана/цены. Импортируется сервером и фронтом.

export type CampaignGoalSlug = 'msg_inst' | 'msg_wa' | 'reach' | 'profile' | 'site_leads'

export interface CampaignGoal {
  slug: CampaignGoalSlug
  label: string // как называется цель в пикере
  metric: string // главная метрика (что вписывают в отчёт)
  planLabel: string // подпись поля плана
  costLabel: string // подпись «цены за результат» = бюджет ÷ метрика
}

export const CAMPAIGN_GOALS: CampaignGoal[] = [
  { slug: 'msg_inst', label: 'Максимум переписок INST', metric: 'Заявки', planLabel: 'План заявок', costLabel: 'Цена за заявку' },
  { slug: 'msg_wa', label: 'Максимум переписок WhatsApp', metric: 'Заявки', planLabel: 'План заявок', costLabel: 'Цена за заявку' },
  { slug: 'reach', label: 'Максимальные охваты', metric: 'Охваты', planLabel: 'План охватов', costLabel: 'Цена за охват' },
  { slug: 'profile', label: 'Посещения профиля', metric: 'Переходы', planLabel: 'План переходов', costLabel: 'Цена за переход' },
  { slug: 'site_leads', label: 'Лиды на сайт', metric: 'Лиды', planLabel: 'План лидов', costLabel: 'Цена за лид' },
]

export const CAMPAIGN_GOAL_SLUGS = CAMPAIGN_GOALS.map((g) => g.slug)

// Пока цель не задана (старые кампании) — нейтральные подписи.
const UNSET = { label: 'Цель не задана', metric: 'Результат', planLabel: 'План результата', costLabel: 'Цена за результат' }

export function goalMeta(slug?: string): {
  label: string
  metric: string
  planLabel: string
  costLabel: string
} {
  return CAMPAIGN_GOALS.find((g) => g.slug === slug) ?? UNSET
}
