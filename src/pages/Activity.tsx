import { useState } from 'react'
import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { LogIn, AlertTriangle, Clock, CalendarCheck, History, X, Loader2 } from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import StatCard from '@/components/ui/StatCard'
import Avatar from '@/components/ui/Avatar'
import { ProgressBar } from '@/components/ui/Progress'
import { useData } from '@/lib/useData'
import { taskStatsByEmployee } from '@/lib/selectors'
import { pct, plural } from '@/lib/format'
import { reportTime } from '@/lib/reports'
import type { Employee } from '@/types'
import type { Id } from '../../convex/_generated/dataModel'
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
  const [historyOf, setHistoryOf] = useState<Employee | null>(null)

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
                      {/* §10 требует и дату, и время последнего входа —
                          относительной подписи «N дн. назад» для этого мало. */}
                      <span className={a.stale ? 'text-[#c53030] font-semibold' : a.today ? 'text-green-d' : ''}>
                        {a.text}
                      </span>
                      {act?.lastLoginAt ? (
                        <div className="text-[11px] text-muted whitespace-nowrap">
                          {reportTime(act.lastLoginAt)}
                        </div>
                      ) : null}
                    </td>
                    <td className={td}>
                      <button
                        type="button"
                        disabled={!act?.loginTotal}
                        onClick={() => setHistoryOf(e)}
                        className="inline-flex items-center gap-1.5 text-left disabled:cursor-default group"
                        title={act?.loginTotal ? 'Показать историю входов' : 'Входов ещё не было'}
                      >
                        <span>
                          <span className="font-medium text-ink">{act?.loginCount7d ?? 0}</span>
                          <span className="text-muted"> / {act?.loginCount30d ?? 0}</span>
                        </span>
                        {act?.loginTotal ? (
                          <History size={13} className="text-muted-2 group-hover:text-green" />
                        ) : null}
                      </button>
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

      {historyOf && <LoginHistoryModal employee={historyOf} onClose={() => setHistoryOf(null)} />}
    </>
  )
}

// История входов сотрудника (§10). Открывается кликом по счётчику входов.
function LoginHistoryModal({ employee, onClose }: { employee: Employee; onClose: () => void }) {
  const times = useQuery(api.activity.loginHistory, {
    employeeId: employee.id as Id<'employees'>,
  })

  // Группируем по календарной дате: за день часто несколько входов подряд.
  const byDay = new Map<string, number[]>()
  for (const t of times ?? []) {
    const day = new Date(t + 5 * 3600 * 1000).toISOString().slice(0, 10)
    byDay.set(day, [...(byDay.get(day) ?? []), t])
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md max-h-[80vh] flex flex-col bg-white rounded-card shadow-soft"
      >
        <div className="shrink-0 px-5 py-4 border-b border-line flex items-center gap-3">
          <Avatar initials={employee.initials} color={employee.avatarColor} size={38} />
          <div className="min-w-0 flex-1">
            <h2 className="font-bold text-ink leading-tight">История входов</h2>
            <p className="text-[13px] text-muted truncate">{employee.name}</p>
          </div>
          <button onClick={onClose} className="ico-btn w-9 h-9 shrink-0" title="Закрыть">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {times === undefined ? (
            <div className="py-8 grid place-items-center text-muted">
              <Loader2 className="animate-spin" size={20} />
            </div>
          ) : times.length === 0 ? (
            <p className="text-sm text-muted py-4 text-center">Входов пока не было.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {[...byDay.entries()].map(([day, list]) => (
                <div key={day}>
                  <div className="text-[11px] font-semibold text-muted-2 uppercase tracking-wide mb-1.5">
                    {longDay(day)}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {list.map((t) => (
                      <span key={t} className="chip bg-chip text-ink-2 tabular-nums">
                        {onlyTime(t)}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {times && times.length > 0 && (
          <div className="shrink-0 px-5 py-3 border-t border-line text-[11px] text-muted">
            Показаны последние {times.length}{' '}
            {plural(times.length, 'вход', 'входа', 'входов')} · время по Алматы
          </div>
        )}
      </div>
    </div>
  )
}

const longDay = (date: string) =>
  new Date(`${date}T12:00:00+05:00`).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    weekday: 'long',
    timeZone: 'Asia/Almaty',
  })

const onlyTime = (ms: number) =>
  new Date(ms).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Almaty',
  })
