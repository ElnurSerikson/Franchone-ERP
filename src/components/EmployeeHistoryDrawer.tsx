import { useEffect, useState } from 'react'
import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { X, Loader2, CheckSquare, ClipboardList, Wallet, LogIn, Mail, Phone, Send, CalendarDays } from 'lucide-react'
import Avatar from './ui/Avatar'
import { kzt, pct } from '@/lib/format'
import { CURRENT_MONTH } from '@/lib/month'
import { REPORT_STATUS, reportTime, cellDate } from '@/lib/reports'

// Сводная карточка-история сотрудника (§11): задачи, отчёты, KPI, входы.
export default function EmployeeHistoryDrawer({
  employeeId,
  onClose,
}: {
  employeeId: string
  onClose: () => void
}) {
  const data = useQuery(api.employees.history, { employeeId: employeeId as Id<'employees'> })
  const pay = useQuery(api.payroll.month, { month: CURRENT_MONTH })
  const kpiRow = pay?.rows.find((r) => r.employeeId === employeeId) ?? null

  const [shown, setShown] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(id)
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const close = () => {
    setShown(false)
    setTimeout(onClose, 200)
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        onClick={close}
        className={`absolute inset-0 bg-black/30 transition-opacity duration-200 ${shown ? 'opacity-100' : 'opacity-0'}`}
      />
      <div
        className={`relative w-full max-w-md h-full bg-bg overflow-y-auto shadow-soft transition-transform duration-200 ${shown ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="sticky top-0 z-10 bg-white border-b border-line px-5 py-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-ink">История сотрудника</h2>
          <button onClick={close} className="ico-btn w-9 h-9" title="Закрыть">
            <X size={16} />
          </button>
        </div>

        {data === undefined ? (
          <div className="grid place-items-center py-16 text-muted">
            <Loader2 className="animate-spin" size={20} />
          </div>
        ) : data === null ? (
          <p className="p-6 text-sm text-muted">Нет доступа к истории этого сотрудника.</p>
        ) : (
          <div className="p-5 flex flex-col gap-5">
            {/* Профиль */}
            <div className="flex items-center gap-3">
              <Avatar id={data.employee.id} initials={data.employee.initials} color={data.employee.avatarColor} size={48} />
              <div className="min-w-0">
                <div className="text-base font-bold text-ink truncate">{data.employee.name}</div>
                <div className="text-sm text-muted truncate">
                  {data.employee.positionLabel} · {data.employee.department}
                </div>
              </div>
              {data.employee.status === 'archived' && (
                <span className="chip bg-[#fdeaea] text-[#c53030] ml-auto">В архиве</span>
              )}
            </div>

            <div className="card p-4 flex flex-col gap-2 text-sm">
              <Line icon={Mail} label="Почта" value={data.employee.email || '—'} />
              <Line icon={Phone} label="Телефон" value={data.employee.phone || '—'} />
              <Line icon={Send} label="Telegram" value={data.employee.telegram || '—'} />
              <Line icon={CalendarDays} label="В команде с" value={data.employee.hiredAt} />
            </div>

            {/* KPI / выплата */}
            {kpiRow && (
              <Section icon={Wallet} title={`KPI · ${CURRENT_MONTH}`}>
                <div className="grid grid-cols-3 gap-3">
                  <Metric label="KPI" value={pct(kpiRow.kpi, 1)} />
                  <Metric label="Оклад" value={kzt(kpiRow.salary)} />
                  <Metric label="К выплате" value={kzt(kpiRow.payout)} accent />
                </div>
              </Section>
            )}

            {/* Задачи */}
            <Section icon={CheckSquare} title="Задачи">
              <div className="grid grid-cols-3 gap-3">
                <Metric label="Активные" value={String(data.tasks.active)} />
                <Metric label="Выполнено" value={String(data.tasks.done)} />
                <Metric label="Просрочено" value={String(data.tasks.overdue)} tone={data.tasks.overdue ? 'red' : undefined} />
              </div>
              <p className="text-[11px] text-muted-2 mt-2">
                В срок {data.tasks.onTime} · с опозданием {data.tasks.late} · всего поставлено {data.tasks.total}
              </p>
            </Section>

            {/* Отчёты */}
            <Section icon={ClipboardList} title="Отчётность">
              <div className="grid grid-cols-3 gap-3 mb-3">
                <Metric label="В срок" value={String(data.reports.onTime)} />
                <Metric label="С опозданием" value={String(data.reports.late)} />
                <Metric label="Всего" value={String(data.reports.total)} />
              </div>
              {data.reports.recent.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {data.reports.recent.map((r) => {
                    const st = REPORT_STATUS[r.reopened ? 'missed' : r.onTime ? 'onTime' : 'late']
                    const d = cellDate(r.date)
                    return (
                      <span
                        key={r.date}
                        title={`${d.dm} · ${st.label}`}
                        className="w-8 h-8 rounded-md grid place-items-center text-[10px] font-semibold"
                        style={{ background: st.cell, color: st.dot }}
                      >
                        {d.dm.slice(0, 2)}
                      </span>
                    )
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted-2">Отчётов пока нет.</p>
              )}
            </Section>

            {/* Входы */}
            <Section icon={LogIn} title="Активность входа">
              <div className="grid grid-cols-3 gap-3 mb-2">
                <Metric label="За 7 дней" value={String(data.login.count7d)} />
                <Metric label="За 30 дней" value={String(data.login.count30d)} />
                <Metric label="Последний" value={data.login.last ? reportTime(data.login.last) : '—'} small />
              </div>
            </Section>
          </div>
        )}
      </div>
    </div>
  )
}

function Line({ icon: Icon, label, value }: { icon: typeof Mail; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <Icon size={15} className="text-muted shrink-0" />
      <span className="text-muted w-24 shrink-0">{label}</span>
      <span className="text-ink-2 truncate">{value}</span>
    </div>
  )
}

function Section({ icon: Icon, title, children }: { icon: typeof Wallet; title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted uppercase tracking-wide mb-2">
        <Icon size={13} /> {title}
      </div>
      {children}
    </div>
  )
}

function Metric({
  label,
  value,
  accent,
  tone,
  small,
}: {
  label: string
  value: string
  accent?: boolean
  tone?: 'red'
  small?: boolean
}) {
  return (
    <div className="bg-line-2 rounded-lg p-2.5">
      <div className="text-[11px] text-muted mb-0.5">{label}</div>
      <div
        className={`${small ? 'text-xs' : 'text-lg'} font-bold ${
          tone === 'red' ? 'text-[#c53030]' : accent ? 'text-green-d' : 'text-ink'
        }`}
      >
        {value}
      </div>
    </div>
  )
}
