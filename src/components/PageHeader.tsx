import { useContext, type ReactNode } from 'react'
import { Menu } from 'lucide-react'
import { LayoutContext } from './Layout'

export default function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
}) {
  const { openDrawer } = useContext(LayoutContext)
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4 mb-5 md:mb-6">
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={openDrawer}
          aria-label="Меню"
          className="md:hidden inline-flex items-center justify-center w-10 h-10 rounded-xl border border-line-2 bg-card text-ink-2 hover:bg-chip transition-colors shrink-0"
        >
          <Menu size={20} />
        </button>
        <div className="min-w-0">
          <h1 className="text-xl md:text-2xl font-bold tracking-tight text-ink">{title}</h1>
          {subtitle && <p className="text-sm text-muted mt-1">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0 flex-wrap">{actions}</div>}
    </div>
  )
}
