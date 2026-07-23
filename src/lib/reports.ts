// Общие цвета/подписи статусов отчётности + мелкие форматтеры.
export type ReportStatus = 'onTime' | 'late' | 'missed' | 'pending'

export const REPORT_STATUS: Record<
  ReportStatus,
  { label: string; chip: string; dot: string; cell: string }
> = {
  onTime: { label: 'В срок', chip: 'bg-[#e3f6ee] text-green-d', dot: '#1c7d4d', cell: '#cdebdd' },
  late: { label: 'С опозданием', chip: 'bg-[#fff6e6] text-[#b7791f]', dot: '#d69e2e', cell: '#fbe6ba' },
  missed: { label: 'Пропущен', chip: 'bg-[#fdeaea] text-[#c53030]', dot: '#c53030', cell: '#f6cbcb' },
  pending: { label: 'Ожидается', chip: 'bg-chip text-muted', dot: '#c9ccd1', cell: '#eaecef' },
}

// Дата+время отправки в часовом поясе Алматы.
export function reportTime(ms: number): string {
  return new Date(ms).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Almaty',
  })
}

// Короткая дата ячейки: «23.07» + день недели.
export function cellDate(date: string): { dm: string; wd: string; weekend: boolean } {
  const d = new Date(`${date}T12:00:00+05:00`)
  const dm = d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', timeZone: 'Asia/Almaty' })
  const wd = d.toLocaleDateString('ru-RU', { weekday: 'short', timeZone: 'Asia/Almaty' })
  const dow = d.getDay()
  return { dm, wd, weekend: dow === 0 || dow === 6 }
}

// Стоимость заявки (CPL): бюджет / заявки.
export function cpl(budget: number, leads: number): number {
  return leads > 0 ? budget / leads : 0
}
