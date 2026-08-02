import { useState } from 'react'
import { useQuery } from 'convex/react'
import { CalendarRange, Loader2, X } from 'lucide-react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import PageHeader from '@/components/PageHeader'
import Avatar from '@/components/ui/Avatar'
import Select from '@/components/ui/Select'
import DatePicker from '@/components/ui/DatePicker'
import { ProgressBar } from '@/components/ui/Progress'
import { num, pctAuto, longDate } from '@/lib/format'
import { TODAY } from '@/lib/constants'
import { CURRENT_MONTH, addMonth, formatMonth } from '@/lib/month'
import { th, thRight, td, theadRow } from '@/lib/table'

// Раздел «Эффективность» (ТЗ СИСТЕМА §3).
//
// Ничего здесь не заполняется вручную: раздел объединяет уже существующие
// сведения по задачам и ежедневным отчётам и показывает их в разрезе
// сотрудников и времени. Новых статусов не вводится.

type ReportStats = {
  required: number
  onTime: number
  lateByAdmin: number
  missing: number
  onTimeRate: number | null
}
type TaskStats = {
  total: number
  done: number
  notDone: number
  doneOnTime: number
  doneLate: number
  overdue: number
  completionRate: number | null
}
type Row = {
  employeeId: Id<'employees'>
  name: string
  initials: string
  avatarColor: string
  positionLabel: string
  department: string
  reports: ReportStats
  tasks: TaskStats
}

// §3.2: месяц, несколько месяцев или произвольный диапазон.
type Mode = 'month' | 'months' | 'range'
const MODES: { value: Mode; label: string }[] = [
  { value: 'month', label: 'Конкретный месяц' },
  { value: 'months', label: 'Несколько месяцев' },
  { value: 'range', label: 'Произвольный диапазон' },
]
const ALL = 'all'

function monthEnd(ym: string) {
  const [y, m] = ym.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}

// Список месяцев для пикеров. §1.3: конечного списка нет — окно строится от
// текущего месяца, поэтому новые периоды открываются сами.
function monthOptions() {
  const out: { value: string; label: string }[] = []
  for (let i = -23; i <= 1; i++) {
    const m = addMonth(CURRENT_MONTH, i)
    out.push({ value: m, label: formatMonth(m) })
  }
  return out.reverse()
}

export default function Effectiveness() {
  const [mode, setMode] = useState<Mode>('month')
  const [month, setMonth] = useState(CURRENT_MONTH)
  const [monthTo, setMonthTo] = useState(CURRENT_MONTH)
  const [from, setFrom] = useState(`${CURRENT_MONTH}-01`)
  const [to, setTo] = useState(TODAY)
  const [employeeId, setEmployeeId] = useState(ALL)
  const [department, setDepartment] = useState(ALL)
  const [position, setPosition] = useState(ALL)
  const [card, setCard] = useState<Id<'employees'> | null>(null)

  const range =
    mode === 'month'
      ? { from: `${month}-01`, to: monthEnd(month) }
      : mode === 'months'
        ? month <= monthTo
          ? { from: `${month}-01`, to: monthEnd(monthTo) }
          : { from: `${monthTo}-01`, to: monthEnd(month) }
        : from <= to
          ? { from, to }
          : { from: to, to: from }

  const data = useQuery(api.effectiveness.summary, {
    from: range.from,
    to: range.to,
    ...(employeeId !== ALL ? { employeeId: employeeId as Id<'employees'> } : {}),
    ...(department !== ALL ? { department } : {}),
    ...(position !== ALL ? { position } : {}),
  })

  const rows = (data?.rows ?? []) as Row[]
  const months = monthOptions()

  return (
    <>
      <PageHeader
        title="Эффективность"
        subtitle="Задачи и отчётная дисциплина по сотрудникам за период"
      />

      <section className="card p-5 mb-5">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Период">
            <Select value={mode} onChange={(v) => setMode(v as Mode)} options={MODES} />
          </Field>
          <Field label="Сотрудник">
            <Select
              value={employeeId}
              onChange={setEmployeeId}
              options={[
                { value: ALL, label: 'Все сотрудники' },
                ...(data?.employees ?? []).map((e) => ({ value: e._id, label: e.name })),
              ]}
            />
          </Field>
          <Field label="Отдел">
            <Select
              value={department}
              onChange={setDepartment}
              options={[
                { value: ALL, label: 'Все отделы' },
                ...(data?.departments ?? []).map((d) => ({ value: d, label: d })),
              ]}
            />
          </Field>
          <Field label="Должность">
            <Select
              value={position}
              onChange={setPosition}
              options={[
                { value: ALL, label: 'Все должности' },
                ...(data?.positions ?? []).map((p) => ({ value: p.slug, label: p.label })),
              ]}
            />
          </Field>
        </div>

        {mode === 'month' && (
          <div className="mt-3 max-w-xs">
            <Field label="Месяц">
              <Select value={month} onChange={setMonth} options={months} />
            </Field>
          </div>
        )}
        {mode === 'months' && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 max-w-xl">
            <Field label="С месяца">
              <Select value={month} onChange={setMonth} options={months} />
            </Field>
            <Field label="По месяц">
              <Select value={monthTo} onChange={setMonthTo} options={months} />
            </Field>
          </div>
        )}
        {mode === 'range' && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 max-w-xl">
            <Field label="С даты">
              <DatePicker value={from} onChange={setFrom} max={TODAY} />
            </Field>
            <Field label="По дату">
              <DatePicker value={to} onChange={setTo} max={TODAY} />
            </Field>
          </div>
        )}

        <div className="mt-3 flex items-center gap-2 text-sm text-muted">
          <CalendarRange size={15} className="text-green shrink-0" />
          <span>
            Период:{' '}
            <b className="text-ink font-medium">
              {longDate(range.from)} — {longDate(range.to)}
            </b>
          </span>
        </div>
      </section>

      {data === undefined ? (
        <div className="card p-10 grid place-items-center text-muted">
          <Loader2 className="animate-spin" size={20} />
        </div>
      ) : rows.length === 0 ? (
        <div className="card p-10 text-center">
          <div className="text-ink font-semibold mb-1">Нет данных за выбранный период</div>
          <p className="text-sm text-muted max-w-md mx-auto">
            Измените период или снимите фильтры.
          </p>
        </div>
      ) : (
        <>
          <section className="mb-5">
            <h3 className="sec-title mb-3">Сводка по сотрудникам</h3>
            <div className="card overflow-hidden overflow-x-auto">
              <table className="w-full min-w-[900px]">
                <thead>
                  <tr className={theadRow}>
                    <th className={th}>Сотрудник</th>
                    <th className={thRight}>Выполнение задач</th>
                    <th className={thRight}>Задачи в срок</th>
                    <th className={thRight}>Отчёты вовремя</th>
                    <th className={thRight}>После блокировки</th>
                    <th className={thRight}>Не внесено</th>
                    <th className={th} />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.employeeId}
                      className="hover:bg-chip/40 transition-colors cursor-pointer"
                      onClick={() => setCard(r.employeeId)}
                    >
                      <td className={td}>
                        <div className="flex items-center gap-2.5">
                          <Avatar initials={r.initials} color={r.avatarColor} size={32} />
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-ink truncate">{r.name}</div>
                            <div className="text-[11px] text-muted truncate">
                              {r.positionLabel} · {r.department}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className={`${td} text-right`}>
                        <div className="font-semibold text-ink tabular-nums">
                          {r.tasks.completionRate === null ? '—' : pctAuto(r.tasks.completionRate)}
                        </div>
                        <div className="text-[11px] text-muted tabular-nums">
                          {num(r.tasks.done)} из {num(r.tasks.total)}
                        </div>
                      </td>
                      <td className={`${td} text-right`}>
                        <div className="font-semibold text-ink tabular-nums">
                          {r.tasks.done === 0 ? '—' : pctAuto(r.tasks.doneOnTime / r.tasks.done)}
                        </div>
                        <div className="text-[11px] text-muted tabular-nums">
                          {num(r.tasks.doneOnTime)} в срок · {num(r.tasks.doneLate)} позже
                          {r.tasks.overdue > 0 && ` · ${num(r.tasks.overdue)} просрочено`}
                        </div>
                      </td>
                      <td className={`${td} text-right`}>
                        <div className="font-semibold text-ink tabular-nums">
                          {r.reports.onTimeRate === null ? '—' : pctAuto(r.reports.onTimeRate)}
                        </div>
                        <div className="text-[11px] text-muted tabular-nums">
                          {num(r.reports.onTime)} из {num(r.reports.required)}
                        </div>
                      </td>
                      <td className={`${td} text-right tabular-nums`}>
                        {r.reports.required === 0 ? '—' : num(r.reports.lateByAdmin)}
                      </td>
                      <td className={`${td} text-right tabular-nums`}>
                        <span className={r.reports.missing > 0 ? 'text-[#c53030] font-semibold' : ''}>
                          {r.reports.required === 0 ? '—' : num(r.reports.missing)}
                        </span>
                      </td>
                      <td className={`${td} text-right`}>
                        <span className="mini-btn whitespace-nowrap">Динамика</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted mt-2">
              «После блокировки» — отчёты, внесённые администратором за сотрудника уже после
              дедлайна. Раздел ничего не считает заново: он собирает то, что система уже
              знает из задач и отчётов.
            </p>
          </section>
        </>
      )}

      {card && <EmployeeCard employeeId={card} onClose={() => setCard(null)} />}
    </>
  )
}

// §3.5: карточка сотрудника с динамикой по месяцам за всё время работы.
function EmployeeCard({
  employeeId,
  onClose,
}: {
  employeeId: Id<'employees'>
  onClose: () => void
}) {
  const data = useQuery(api.effectiveness.employeeHistory, { employeeId })

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-3xl h-full bg-bg flex flex-col">
        <div className="shrink-0 bg-white border-b border-line px-5 sm:px-6 py-4 flex items-center gap-3">
          {data && <Avatar initials={data.initials} color={data.avatarColor} size={36} />}
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold text-ink truncate">{data?.name ?? 'Сотрудник'}</h2>
            <p className="text-[11px] text-muted">
              {data ? `${data.positionLabel} · в компании с ${longDate(data.hiredAt)}` : ''}
            </p>
          </div>
          <button onClick={onClose} className="ico-btn w-9 h-9" aria-label="Закрыть">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-5">
          {data === undefined ? (
            <div className="py-10 grid place-items-center text-muted">
              <Loader2 className="animate-spin" size={18} />
            </div>
          ) : data === null ? (
            <p className="text-sm text-muted">Нет доступа к этому сотруднику.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {data.months.map((m) => (
                <div key={m.month} className="card p-4">
                  <div className="flex items-center gap-2 mb-3 flex-wrap">
                    <span className="text-sm font-semibold text-ink">{formatMonth(m.month)}</span>
                    <div className="flex-1" />
                    {m.reports.missing > 0 && (
                      <span className="chip bg-[#fdeaea] text-[#c53030]">
                        не внесено {m.reports.missing}
                      </span>
                    )}
                    {m.reports.lateByAdmin > 0 && (
                      <span className="chip bg-[#fff6e6] text-[#b7791f]">
                        после блокировки {m.reports.lateByAdmin}
                      </span>
                    )}
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <div className="flex items-center justify-between text-xs mb-1.5">
                        <span className="text-muted">Отчёты вовремя</span>
                        <span className="font-semibold text-ink tabular-nums">
                          {m.reports.onTimeRate === null ? '—' : pctAuto(m.reports.onTimeRate)}
                        </span>
                      </div>
                      <ProgressBar value={m.reports.onTimeRate ?? 0} />
                      <div className="text-[11px] text-muted-2 mt-1 tabular-nums">
                        {num(m.reports.onTime)} из {num(m.reports.required)} обязательных
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center justify-between text-xs mb-1.5">
                        <span className="text-muted">Выполнение задач</span>
                        <span className="font-semibold text-ink tabular-nums">
                          {m.tasks.completionRate === null ? '—' : pctAuto(m.tasks.completionRate)}
                        </span>
                      </div>
                      <ProgressBar value={m.tasks.completionRate ?? 0} />
                      <div className="text-[11px] text-muted-2 mt-1 tabular-nums">
                        {num(m.tasks.done)} из {num(m.tasks.total)} · в срок{' '}
                        {num(m.tasks.doneOnTime)}
                        {m.tasks.overdue > 0 && ` · просрочено ${num(m.tasks.overdue)}`}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              {data.months.length === 0 && (
                <p className="text-sm text-muted">История пока пуста.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-1.5">
        {label}
      </div>
      {children}
    </div>
  )
}
