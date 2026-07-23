import { useState, type ReactNode } from 'react'
import { ClipboardList, LayoutGrid, type LucideIcon } from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import ReportForm from '@/components/reports/ReportForm'
import DisciplineGrid from '@/components/reports/DisciplineGrid'
import { useApp, useCurrentUser } from '@/store'
import { REPORTING_POSITIONS } from '@/lib/constants'

type Tab = 'mine' | 'discipline'

export default function Reports() {
  const { role } = useApp()
  const user = useCurrentUser()
  const isManager = role === 'owner' || role === 'head'
  const reporting = (REPORTING_POSITIONS as readonly string[]).includes(user.position)
  const [tab, setTab] = useState<Tab>(isManager && !reporting ? 'discipline' : 'mine')

  const view: Tab = isManager ? tab : 'mine'

  return (
    <>
      <PageHeader
        title="Ежедневная отчётность"
        subtitle={
          view === 'mine'
            ? 'Ваш отчёт за сегодня и история сдачи'
            : 'Регулярность и дисциплина заполнения по команде'
        }
        actions={
          isManager ? (
            <div className="flex items-center gap-1 p-1 bg-chip rounded-xl">
              <TabBtn active={view === 'mine'} onClick={() => setTab('mine')} icon={ClipboardList}>
                Мой отчёт
              </TabBtn>
              <TabBtn active={view === 'discipline'} onClick={() => setTab('discipline')} icon={LayoutGrid}>
                Дисциплина
              </TabBtn>
            </div>
          ) : undefined
        }
      />

      {view === 'mine' ? <ReportForm /> : <DisciplineGrid />}
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
