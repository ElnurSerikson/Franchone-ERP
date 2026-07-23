import type { Priority, TaskStatus } from '@/types'

const statusStyle: Record<TaskStatus, { label: string; cls: string; dot: string }> = {
  assigned: { label: 'Назначено', cls: 'bg-chip text-ink-2', dot: '#9498a1' },
  in_progress: { label: 'В работе', cls: 'bg-[#eef4ff] text-[#2563eb]', dot: '#2563eb' },
  done: { label: 'Готово', cls: 'bg-[#e2f2ef] text-green-d', dot: '#057269' },
}

export function StatusChip({ status }: { status: TaskStatus }) {
  const s = statusStyle[status]
  return (
    <span className={`chip ${s.cls}`}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: s.dot }} />
      {s.label}
    </span>
  )
}

export const statusMeta = statusStyle

const priorityStyle: Record<Priority, { label: string; cls: string }> = {
  low: { label: 'Низкий', cls: 'bg-chip text-muted' },
  medium: { label: 'Средний', cls: 'bg-[#eef4ff] text-[#2563eb]' },
  high: { label: 'Высокий', cls: 'bg-[#fff1e6] text-[#c05621]' },
  urgent: { label: 'Срочный', cls: 'bg-[#fdeaea] text-[#c53030]' },
}

export function PriorityChip({ priority }: { priority: Priority }) {
  const p = priorityStyle[priority]
  return <span className={`chip ${p.cls}`}>{p.label}</span>
}

// KPI-статус по порогам (🟢 ≥90 / 🟡 70–89 / 🔴 <70)
export function KpiChip({ value }: { value: number }) {
  const p = value * 100
  const { cls, label } =
    p >= 90
      ? { cls: 'bg-[#e2f2ef] text-green-d', label: 'Отлично' }
      : p >= 70
        ? { cls: 'bg-[#fff6e6] text-[#b7791f]', label: 'В норме' }
        : { cls: 'bg-[#fdeaea] text-[#c53030]', label: 'Ниже плана' }
  return <span className={`chip ${cls}`}>{label}</span>
}
