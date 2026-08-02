import { useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ClipboardList, LayoutGrid, CalendarRange, Megaphone, type LucideIcon } from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import ReportForm from '@/components/reports/ReportForm'
import DisciplineGrid from '@/components/reports/DisciplineGrid'
import WeeklyWindows from '@/components/reports/WeeklyWindows'
import CampaignsTab from '@/components/campaigns/CampaignsTab'
import { useApp, useCurrentUser } from '@/store'
import { reportsDaily } from '@/lib/constants'

type Tab = 'mine' | 'discipline' | 'weekly' | 'campaigns'

const SUBTITLE: Record<Tab, string> = {
  mine: 'Ваш отчёт за сегодня и история сдачи',
  discipline: 'Регулярность и дисциплина заполнения по команде',
  weekly: 'Выполнение плана по неделям месяца',
  campaigns: 'Реестр рекламных кампаний по объектам продаж',
}

export default function Reports() {
  const { role } = useApp()
  const me = useCurrentUser()
  const showMine = reportsDaily(me.role, me.position) // сдаёт отчёт только не-владелец с профильной должностью
  const showDiscipline = role === 'owner' || role === 'head'
  // Недельные окна описаны только в модели SMM: у таргетолога и продаж
  // недельного плана нет, показывать им пустой экран незачем.
  const showWeekly = showDiscipline || me.position === 'smm'
  // Реестр ведут руководство и сам таргетолог — он запускает кампании.
  const showCampaigns = showDiscipline || me.position === 'targetolog'

  const available: Tab[] = [
    ...(showMine ? (['mine'] as const) : []),
    ...(showDiscipline ? (['discipline'] as const) : []),
    ...(showWeekly ? (['weekly'] as const) : []),
    ...(showCampaigns ? (['campaigns'] as const) : []),
  ]

  // §2.1: таргетолог открывает «Отчёты» на вкладке «Кампании» — он приходит
  // сюда вести реестр, а не заполнять форму. «Мой отчёт» остаётся рядом.
  // Исключение — переход по конкретной дате из графика сдачи (§2.5): там
  // человек идёт именно за своим отчётом.
  const [params] = useSearchParams()
  const initial: Tab =
    params.get('date') && available.includes('mine')
      ? 'mine'
      : me.position === 'targetolog' && available.includes('campaigns')
        ? 'campaigns'
        : (available[0] ?? 'mine')
  const [tab, setTab] = useState<Tab>(initial)
  const view: Tab = available.includes(tab) ? tab : initial

  if (available.length === 0)
    return (
      <>
        <PageHeader title="Отчётность команды" subtitle="Форма ежедневного отчёта" />
        <div className="card p-10 text-center">
          <div className="text-ink font-semibold mb-1">Ежедневный отчёт не предусмотрен</div>
          <p className="text-sm text-muted max-w-md mx-auto">
            Для вашей должности форма ежедневной отчётности не настроена.
          </p>
        </div>
      </>
    )

  return (
    <>
      <PageHeader
        title="Отчётность команды"
        subtitle={SUBTITLE[view]}
        actions={
          available.length > 1 ? (
            <div className="flex items-center gap-1 p-1 bg-chip rounded-xl">
              {showMine && (
                <TabBtn active={view === 'mine'} onClick={() => setTab('mine')} icon={ClipboardList}>
                  Мой отчёт
                </TabBtn>
              )}
              {showDiscipline && (
                <TabBtn
                  active={view === 'discipline'}
                  onClick={() => setTab('discipline')}
                  icon={LayoutGrid}
                >
                  Дисциплина
                </TabBtn>
              )}
              {showWeekly && (
                <TabBtn active={view === 'weekly'} onClick={() => setTab('weekly')} icon={CalendarRange}>
                  По неделям
                </TabBtn>
              )}
              {showCampaigns && (
                <TabBtn active={view === 'campaigns'} onClick={() => setTab('campaigns')} icon={Megaphone}>
                  Кампании
                </TabBtn>
              )}
            </div>
          ) : undefined
        }
      />

      {view === 'mine' && <ReportForm />}
      {view === 'discipline' && <DisciplineGrid />}
      {view === 'weekly' && <WeeklyWindows />}
      {view === 'campaigns' && <CampaignsTab />}
    </>
  )
}

function TabBtn({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean
  onClick: () => void
  icon: LucideIcon
  children: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`h-8 px-3 rounded-lg text-sm font-semibold inline-flex items-center gap-1.5 transition-colors ${
        active ? 'bg-white text-ink shadow-card' : 'text-muted hover:text-ink'
      }`}
    >
      <Icon size={15} /> {children}
    </button>
  )
}
