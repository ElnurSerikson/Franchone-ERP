import { useState } from 'react'
import { useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { Users, CalendarCheck, AlertTriangle, TrendingUp, X, Loader2 } from 'lucide-react'
import StatCard from '@/components/ui/StatCard'
import Avatar from '@/components/ui/Avatar'
import { ProgressBar } from '@/components/ui/Progress'
import { pct } from '@/lib/format'
import { REPORT_STATUS, cellDate, reportTime, type ReportStatus } from '@/lib/reports'
import { useApp } from '@/store'
import ReportView from './ReportView'

const th = 'text-[11px] font-semibold text-green-d uppercase tracking-wide px-3 py-2'

interface Sel {
  employeeId: Id<'employees'>
  name: string
  positionLabel: string
  date: string
}

export default function DisciplineGrid() {
  const data = useQuery(api.reports.discipline, { days: 14 })
  const [sel, setSel] = useState<Sel | null>(null)
  // Владелец может открыть и пропущенный/переоткрытый день — чтобы внести
  // отчёт за сотрудника. Остальным доступны только заполненные ячейки.
  const { role } = useApp()
  const isOwner = role === 'owner'

  if (data === undefined)
    return (
      <div className="card p-10 grid place-items-center text-muted">
        <Loader2 className="animate-spin" size={20} />
      </div>
    )

  const { dates, rows, today, deadlineTime } = data
  const filledToday = rows.filter((r) => {
    const c = r.cells[r.cells.length - 1]
    return c.status === 'onTime' || c.status === 'late'
  }).length
  const totalMissed = rows.reduce((s, r) => s + r.missed, 0)
  const avgFill = rows.length ? rows.reduce((s, r) => s + r.fillRate, 0) / rows.length : 0

  return (
    <>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4 mb-5">
        <StatCard highlight label="На отчётности" value={String(rows.length)} foot="SMM · таргет · продажи" icon={Users} />
        <StatCard label="Заполнено сегодня" value={`${filledToday} / ${rows.length}`} foot={`дедлайн ${deadlineTime}`} icon={CalendarCheck} />
        <StatCard label="Пропусков" value={String(totalMissed)} foot={`за ${dates.length} дней`} icon={AlertTriangle} />
        <StatCard label="Заполняемость" value={pct(avgFill)} foot="в среднем по команде" icon={TrendingUp} />
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-[#e2f2ef]">
                <th className={`${th} text-left sticky left-0 bg-[#e2f2ef] z-10 min-w-[150px] sm:min-w-[200px] border-r border-line`}>Сотрудник</th>
                {dates.map((d) => {
                  const c = cellDate(d)
                  const isToday = d === today
                  return (
                    <th
                      key={d}
                      className={`${th} text-center whitespace-nowrap ${
                        c.weekend ? 'text-green-d/50' : ''
                      } ${isToday ? 'bg-[#cfe9e4]' : ''}`}
                    >
                      <div className={`leading-tight ${isToday ? 'font-bold' : ''}`}>
                        <div className="text-[10px] uppercase">{c.wd}</div>
                        <div>{c.dm}</div>
                      </div>
                    </th>
                  )
                })}
                <th className={`${th} text-left min-w-[150px]`}>Заполняемость</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.employeeId} className="hover:bg-chip/30 transition-colors">
                  <td className="px-3 py-2.5 border-t border-r border-line sticky left-0 bg-card z-10">
                    <div className="flex items-center gap-2.5">
                      <Avatar id={r.employeeId} initials={r.initials} color={r.avatarColor} size={32} />
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-ink truncate">{r.name}</div>
                        <div className="text-[11px] text-muted truncate">{r.positionLabel}</div>
                      </div>
                    </div>
                  </td>
                  {r.cells.map((c) => {
                    const st = REPORT_STATUS[c.status as ReportStatus]
                    const filled = c.status === 'onTime' || c.status === 'late'
                    // Владелец вносит и за пропущенный (в т.ч. переоткрытый) день.
                    // «pending» — сегодня до дедлайна или будущее: это дело сотрудника.
                    const ownerFillable = isOwner && c.status === 'missed'
                    const clickable = filled || ownerFillable
                    const title = filled
                      ? `${st.label} · ${reportTime((c as { submittedAt: number }).submittedAt)}`
                      : ownerFillable
                        ? `${st.label} · внести за сотрудника`
                        : st.label
                    return (
                      <td key={c.date} className="border-t border-line text-center px-1.5 py-2.5">
                        <button
                          type="button"
                          disabled={!clickable}
                          title={title}
                          onClick={() =>
                            clickable &&
                            setSel({ employeeId: r.employeeId, name: r.name, positionLabel: r.positionLabel, date: c.date })
                          }
                          className={`w-7 h-7 rounded-md mx-auto grid place-items-center transition-transform ${
                            clickable ? 'cursor-pointer hover:scale-110 hover:ring-2 hover:ring-line-2' : 'cursor-default'
                          }`}
                          style={{ background: st.cell }}
                        >
                          {c.status === 'missed' && <span className="w-2.5 h-0.5 rounded-full" style={{ background: st.dot }} />}
                          {(c as { edited?: boolean }).edited && (
                            <span className="w-1.5 h-1.5 rounded-full" style={{ background: st.dot }} />
                          )}
                        </button>
                      </td>
                    )
                  })}
                  <td className="border-t border-line px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="w-24">
                        <ProgressBar
                          value={r.fillRate}
                          color={r.fillRate >= 0.9 ? '#057269' : r.fillRate >= 0.7 ? '#d69e2e' : '#c53030'}
                        />
                      </div>
                      <span className="text-xs font-semibold text-ink w-9 text-right">{pct(r.fillRate)}</span>
                    </div>
                    <div className="text-[11px] text-muted-2 mt-1">
                      <span className="text-green-d">{r.onTime} в срок</span> ·{' '}
                      <span className="text-[#b7791f]">{r.late} опозд.</span> ·{' '}
                      <span className="text-[#c53030]">{r.missed} проп.</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center gap-4 px-4 py-3 border-t border-line">
          {(['onTime', 'late', 'missed', 'pending', 'na'] as ReportStatus[]).map((s) => (
            <div key={s} className="flex items-center gap-1.5 text-xs text-muted">
              <span
                className="w-4 h-4 rounded border border-line"
                style={{ background: REPORT_STATUS[s].cell }}
              />
              {REPORT_STATUS[s].label}
            </div>
          ))}
          <span className="text-[11px] text-muted-2 ml-auto">Клик по заполненной ячейке — открыть отчёт</span>
        </div>
      </div>

      {sel && <CellModal sel={sel} onClose={() => setSel(null)} />}
    </>
  )
}

function CellModal({ sel, onClose }: { sel: Sel; onClose: () => void }) {
  const data = useQuery(api.reports.reportFor, { employeeId: sel.employeeId, date: sel.date })
  const dateLabel = new Date(`${sel.date}T12:00:00+05:00`).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    weekday: 'long',
    timeZone: 'Asia/Almaty',
  })

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30 p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-3xl bg-white rounded-t-card sm:rounded-card shadow-soft max-h-[92vh] sm:max-h-[85vh] overflow-y-auto [padding-bottom:env(safe-area-inset-bottom)] sm:pb-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white flex items-center justify-between px-5 sm:px-6 py-4 border-b border-line">
          <div>
            <h2 className="text-lg font-bold text-ink">{sel.name}</h2>
            <div className="text-sm text-muted capitalize">
              {sel.positionLabel} · {dateLabel}
            </div>
          </div>
          <button onClick={onClose} className="ico-btn w-9 h-9">
            <X size={16} />
          </button>
        </div>
        <div className="p-6">
          {data === undefined ? (
            <div className="grid place-items-center py-8 text-muted">
              <Loader2 className="animate-spin" size={20} />
            </div>
          ) : data ? (
            <ReportView data={data} employeeId={sel.employeeId} date={sel.date} onClose={onClose} />
          ) : (
            <p className="text-sm text-muted">Нет доступа к этому отчёту.</p>
          )}
        </div>
      </div>
    </div>
  )
}
