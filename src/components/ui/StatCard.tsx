import { ArrowUpRight, type LucideIcon } from 'lucide-react'

interface StatCardProps {
  label: string
  value: string
  foot?: string
  icon?: LucideIcon
  highlight?: boolean
}

// Стат-карта: первая (highlight) — тёмно-зелёная, как в demo.
export default function StatCard({ label, value, foot, icon: Icon, highlight }: StatCardProps) {
  return (
    <div
      className={`rounded-card border p-5 flex flex-col gap-3 ${
        highlight ? 'bg-green text-white border-green' : 'bg-card border-line'
      }`}
    >
      <div className="flex items-start justify-between">
        <span className={`text-sm ${highlight ? 'text-white/85' : 'text-muted'}`}>{label}</span>
        <span
          className={`w-7 h-7 rounded-full flex items-center justify-center ${
            highlight ? 'bg-white/20 text-white' : 'bg-chip text-ink-2'
          }`}
        >
          {Icon ? <Icon size={15} /> : <ArrowUpRight size={15} />}
        </span>
      </div>
      <div className={`text-[32px] leading-none font-bold ${highlight ? 'text-white' : 'text-ink'}`}>
        {value}
      </div>
      {foot && (
        <div className={`text-xs ${highlight ? 'text-white/80' : 'text-muted'}`}>{foot}</div>
      )}
    </div>
  )
}
