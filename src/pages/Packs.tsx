// Раздел «Упаковки» — модуль «Производство и запуск франшизы» (ТЗ Упаковка).
//
// Один раздел, четыре взгляда на одни данные: дашборд владельца (§8), панель
// упаковщика (§9), клиенты (§3, §4.1), библиотека контента и постпроектных
// сценариев (§13) и аналитика (§14.3). Что видно — решает доступ: упаковщик
// открывает свою панель и свои проекты, владелец — всё.

import { useState } from 'react'
import { useQuery } from 'convex/react'
import { BarChart3, Boxes, Library, Loader2, Plus, UserRound, UserSquare2 } from 'lucide-react'
import { api } from '../../convex/_generated/api'
import PageHeader from '@/components/PageHeader'
import PacksBoard from '@/components/packs/PacksBoard'
import PackerPanel from '@/components/packs/PackerPanel'
import PackClientsTab from '@/components/packs/PackClientsTab'
import PackLibrary from '@/components/packs/PackLibrary'
import PackAnalyticsTab from '@/components/packs/PackAnalyticsTab'
import PackWizard from '@/components/packs/PackWizard'
import { tabStrip } from '@/components/packs/ui'

type Tab = 'panel' | 'board' | 'clients' | 'library' | 'analytics'

export default function Packs() {
  const access = useQuery(api.packs.access, {})
  const [tab, setTab] = useState<Tab>('panel')
  const [creating, setCreating] = useState(false)

  if (access === undefined) {
    return (
      <div className="card p-10 grid place-items-center text-muted">
        <Loader2 className="animate-spin" size={20} />
      </div>
    )
  }

  const tabs: { key: Tab; label: string; icon: typeof Boxes; show: boolean }[] = [
    { key: 'panel', label: 'Моя панель', icon: UserSquare2, show: true },
    { key: 'board', label: 'Все проекты', icon: Boxes, show: true },
    { key: 'clients', label: 'Клиенты', icon: UserRound, show: access.canCreate || access.isOwner },
    { key: 'library', label: 'Контент и сценарии', icon: Library, show: access.isOwner },
    { key: 'analytics', label: 'Аналитика', icon: BarChart3, show: true },
  ]

  return (
    <>
      <PageHeader
        title="Упаковки франшиз"
        subtitle="Производство, согласование с клиентом, сроки и KPI упаковщика"
        actions={
          access.canCreate ? (
            <button onClick={() => setCreating(true)} className="btn btn-green">
              <Plus size={16} /> Создать упаковку
            </button>
          ) : undefined
        }
      />

      <div className={`${tabStrip} mb-5`}>
        {tabs
          .filter((t) => t.show)
          .map((t) => {
            const Icon = t.icon
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`chip whitespace-nowrap transition-colors ${
                  tab === t.key ? 'bg-green text-white' : 'bg-chip text-muted hover:text-ink-2'
                }`}
              >
                <Icon size={12} /> {t.label}
              </button>
            )
          })}
      </div>

      {tab === 'panel' && <PackerPanel />}
      {tab === 'board' && <PacksBoard onCreate={() => setCreating(true)} />}
      {tab === 'clients' && <PackClientsTab />}
      {tab === 'library' && <PackLibrary />}
      {tab === 'analytics' && <PackAnalyticsTab isOwner={access.isOwner} />}

      {creating && <PackWizard onClose={() => setCreating(false)} />}
    </>
  )
}
