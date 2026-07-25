// Convex-документы → доменные типы приложения (src/types.ts).
// Так компоненты не меняются: id вместо _id, checklist получает id по индексу.
import type { Doc } from '../../convex/_generated/dataModel'
import type { Campaign, Employee, SmmMetric, Task } from '@/types'

export const mapEmployee = (d: Doc<'employees'>): Employee => ({
  id: d._id,
  name: d.name,
  role: d.role,
  position: d.position,
  positionLabel: d.positionLabel,
  department: d.department,
  salary: d.salary,
  email: d.email,
  phone: d.phone,
  avatarColor: d.avatarColor,
  initials: d.initials,
  status: d.status,
  hiredAt: d.hiredAt,
  telegram: d.telegram,
})

export const mapTask = (d: Doc<'tasks'>): Task => ({
  id: d._id,
  title: d.title,
  description: d.description,
  status: d.status,
  priority: d.priority,
  assigneeId: d.assigneeId,
  reporterId: d.reporterId,
  deadline: d.deadline,
  completedAt: d.completedAt,
  completedOnTime: d.completedOnTime,
  tags: d.tags,
  checklist: d.checklist.map((c, i) => ({ id: String(i), text: c.text, done: c.done })),
  attachments: d.attachments,
  comments: d.comments,
  kpiRef: d.kpiRef,
})

// На вход идёт не документ, а строка из campaigns.list: карточка из реестра,
// склеенная с месячным планом и фактом из ежедневных отчётов.
type CampaignRow = Omit<Campaign, 'id'> & { code: string }

export const mapCampaign = (d: CampaignRow): Campaign => ({
  id: d.code,
  account: d.account,
  category: d.category,
  brand: d.brand,
  campaign: d.campaign,
  moneySource: d.moneySource,
  status: d.status,
  weight: d.weight,
  planBudget: d.planBudget,
  planLeads: d.planLeads,
  factBudget: d.factBudget,
  factLeads: d.factLeads,
})

export const mapSmm = (d: Doc<'smmMetrics'>): SmmMetric => ({
  id: d._id,
  account: d.account,
  format: d.format,
  weight: d.weight,
  weekPlans: d.weekPlans,
  weekFacts: d.weekFacts,
})
