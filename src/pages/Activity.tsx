import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { LogIn, AlertTriangle, Clock, CalendarCheck } from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import StatCard from '@/components/ui/StatCard'
import Avatar from '@/components/ui/Avatar'
import { ProgressBar } from '@/components/ui/Progress'
import { useData } from '@/lib/useData'
import { taskStatsByEmployee } from '@/lib/selectors'
import { pct } from '@/lib/format'
import { th, td, theadRow } from '@/lib/table'


function ago(ms: number | null): { text: string; stale: boolean; today: boolean } {
  if (!ms) return { text: 'никогда', stale: true, today: false }
  const days = Math.floor((Date.now() - ms) / 86400000)
  const stale = days >= 5
  if (days <= 0) return { text: 'сегодня', stale, today: true }
  if (days === 1) return { text: 'вчера', stale, today: false }
  return { text: `${days} дн. назад`, stale, today: false }
}

export default function Activity() {
  // Контроль активности — только по действующим сотрудникам.
  const { tasks, activeEmployees } = useData()
  const activity = useQuery(api.activity.overview, {}) ?? []

  const statsMap = new Map(
    taskStatsByEmployee(tasks, activeEmployees).map((s) => [s.employee.id, s]),
  )
  const actMap = new Map(activity.map((a) => [a.employeeId as string, a]))

  const rows = activeEmployees.map((e) => {
    const act = actMap.get(e.id)
    const stats = statsMap.get(e.id)
    const a = ago(act?.lastLoginAt ?? null)
    return { employee: e, act, stats, a }
  })

  const today = rows.filter((r) => r.a.today).length
  const stale = rows.filter((r) => r.a.stale).length
  const overdue = rows.reduce((s, r) => s + (r.stats?.overdue ?? 0), 0)
  const late = rows.reduce((s, r) => s + (r.stats?.late ?? 0), 0)

  return (
    <>
      <PageHeader
        title="Активность и дисциплина"
        subtitle="Входы сотрудников, соблюдение сроков и нарушения — за последние 30 дней"
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4 mb-5">
        <StatCard highlight label="Заходили сегодня" value={String(today)} foot={`из ${rows.length} сотрудников`} icon={CalendarCheck} />
        <StatCard label="Давно не заходили" value={String(stale)} foot="5+ дней без входа" icon={LogIn} />
        <StatCard label="Просроченных задач" value={String(overdue)} foot="активные, срок прошёл" icon={AlertTriangle} />
        <StatCard label="Выполнено с опозданием" value={String(late)} foot="за период" icon={Clock} />
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px]">
            <thead>
              <tr className={theadRow}>
                <th className={`${th} sticky left-0 z-20 bg-[#e2f2ef] border-r border-line`}>Сотрудник</th>
                <th className={th}>Последний вход</th>
                <th className={th}>Входов (7 / 30 дн)</th>
                <th className={th}>Просрочено</th>
                <th className={th}>Опоздания</th>
                <th className={th}>Соблюдение сроков</th>
                <th className={th}>Статус</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ employee: e, act, stats, a }) => {
                const bad = a.stale || (stats?.overdue ?? 0) > 0
                const warn = !bad && ((stats?.late ?? 0) > 0 || (stats ? stats.onTimePct < 0.7 && stats.done > 0 : false))
                return (
                  <tr key={e.id} className="hover:bg-chip/40 transition-colors">
                    <td className={`${td} sticky left-0 z-10 bg-card border-r border-line`}>
                      <div className="flex items-center gap-3">
                        <Avatar initials={e.initials} color={e.avatarColor} size={36} />
                        <div className="min-w-0">
                          <div className="font-semibold text-ink whitespace-nowrap">{e.name}</div>
                          <div className="text-[11px] text-muted whitespace-nowrap">{e.positionLabel}</div>
                        </div>
                      </div>
                    </td>
                    <td className={td}>
                      <span className={a.stale ? 'text-[#c53030] font-semibold' : a.today ? 'text-green-d' : ''}>
                        {a.text}
                      </span>
                    </td>
                    <td className={td}>
                      <span className="font-medium text-ink">{act?.loginCount7d ?? 0}</span>
                      <span className="text-muted"> / {act?.loginCount30d ?? 0}</span>
                    </td>
                    <td className={td}>
                      {stats?.overdue ? <span className="text-[#c53030] font-semibold">{stats.overdue}</span> : '—'}
                    </td>
                    <td className={td}>
                      {stats?.late ? <span className="text-[#c05621] font-semibold">{stats.late}</span> : '—'}
                    </td>
                    <td className={td}>
                      {stats && stats.done > 0 ? (
                        <div className="flex items-center gap-2 w-36">
                          <ProgressBar value={stats.onTimePct} color={stats.onTimePct >= 0.9 ? '#057269' : stats.onTimePct >= 0.7 ? '#d69e2e' : '#c53030'} />
                          <span className="text-xs font-semibold text-ink w-10 text-right">{pct(stats.onTimePct)}</span>
                        </div>
                      ) : (
                        <span className="text-muted-2">—</span>
                      )}
                    </td>
                    <td className={td}>
                      {bad ? (
                        <span className="chip bg-[#fdeaea] text-[#c53030]">Внимание</span>
                      ) : warn ? (
                        <span className="chip bg-[#fff6e6] text-[#b7791f]">Замечания</span>
                      ) : (
                        <span className="chip bg-[#e2f2ef] text-green-d">В норме</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
