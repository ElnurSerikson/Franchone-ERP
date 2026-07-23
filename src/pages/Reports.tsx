import { useState, type ReactNode } from 'react'
import { ClipboardList, LayoutGrid, type LucideIcon } from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import ReportForm from '@/components/reports/ReportForm'
import DisciplineGrid from '@/components/reports/DisciplineGrid'
import { useApp, useCurrentUser } from '@/store'
import { reportsDaily } from '@/lib/constants'

type Tab = 'mine' | 'discipline'

export default function Reports() {
  const { role } = useApp()
  const me = useCurrentUser()
  const showMine = reportsDaily(me.role, me.position) // сдаёт отчёт только не-владелец с профильной должностью
  const showDiscipline = role === 'owner' || role === 'head'
  const both = showMine && showDiscipline

  const [tab, setTab] = useState<Tab>(showMine ? 'mine' : 'discipline')
  const view: Tab = both ? tab : showMine ? 'mine' : 'discipline'

  if (!showMine && !showDiscipline)
    return (
      <>
        <PageHeader title="Ежедневная отчётность" subtitle="Форма ежедневного отчёта" />
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
        title="Ежедневная отчётность"
        subtitle={
          view === 'mine'
            ? 'Ваш отчёт за сегодня и история сдачи'
            : 'Регулярность и дисциплина заполнения по команде'
        }
        actions={
          both ? (
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
