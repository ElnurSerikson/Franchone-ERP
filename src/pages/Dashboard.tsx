import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AdminTargetLeadsBlock,
  MyTargetLeadsBlock,
} from '@/components/campaigns/TargetLeadsBlocks'
import { useMutation, useQuery } from 'convex/react'
import {
  Wallet, TrendingUp, AlertTriangle, ClipboardList, CheckSquare, Pencil,
  ChevronLeft, ChevronRight, Loader2, Check,
} from 'lucide-react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import PageHeader from '@/components/PageHeader'
import StatCard from '@/components/ui/StatCard'
import Avatar from '@/components/ui/Avatar'
import { ProgressBar } from '@/components/ui/Progress'
import { KpiChip, PriorityChip } from '@/components/ui/StatusChip'
import { useApp, useCurrentUser } from '@/store'
import { useData } from '@/lib/useData'
import {
  taskCounts, isOverdue, isDueToday, isDueSoon, monthTaskStats,
} from '@/lib/selectors'
import { REPORT_STATUS, type ReportStatus } from '@/lib/reports'
import { kzt, pct, plural, shortDate } from '@/lib/format'
import { CURRENT_MONTH, addMonth, formatMonth } from '@/lib/month'
import { TODAY } from '@/lib/constants'
import { th, thRight, td, theadRow } from '@/lib/table'
import { errMessage } from '@/lib/errors'
import type { Employee, Task } from '@/types'

const DUE_SOON_DAYS = 3

// Дашборд один, начинка разная: руководство видит команду, сотрудник — себя
// (§4 ТЗ: «сотрудник должен видеть только собственные показатели»).
export default function Dashboard() {
  const { role } = useApp()
  const me = useCurrentUser()
  return role === 'owner' || role === 'head' ? <ManagerView me={me} /> : <PersonalView me={me} />
}

// ————————————————————————————————————————————————
// Личный дашборд сотрудника (§4)
// ————————————————————————————————————————————————
function PersonalView({ me }: { me: Employee }) {
  const { tasks } = useData()
  const disc = useQuery(api.reports.myDiscipline, { days: 14 })

  // tasks уже приходят отфильтрованными по сотруднику — фильтрует сервер.
  const counts = taskCounts(tasks)
  const overdue = tasks.filter(isOverdue)
  const dueToday = tasks.filter(isDueToday).length
  const dueSoon = tasks.filter((t) => isDueSoon(t, DUE_SOON_DAYS)).length
  const stats = monthTaskStats(tasks, CURRENT_MONTH)

  return (
    <>
      <PageHeader
        title="Дашборд"
        subtitle={`${me.positionLabel} · ${formatMonth(CURRENT_MONTH)}`}
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4 mb-5">
        <StatCard
          highlight
          label="Задачи на сегодня"
          value={String(dueToday)}
          foot={`ближайшие ${DUE_SOON_DAYS} дня: ${dueSoon}`}
          icon={CheckSquare}
        />
        <StatCard
          label="Активные задачи"
          value={String(counts.active)}
          foot={counts.overdue > 0 ? `просрочено: ${counts.overdue}` : 'просрочек нет'}
          icon={CheckSquare}
        />
        <StatCard
          label="Выполнение задач"
          value={pct(stats.completionPct)}
          foot={`в срок ${stats.onTime} · с опозданием ${stats.late}`}
          icon={TrendingUp}
        />
        <StatCard
          label="Заполняемость отчётов"
          value={disc?.reporting ? pct(disc.fillRate) : '—'}
          foot={
            disc?.reporting
              ? `в срок ${disc.onTime} · опозданий ${disc.late} · пропусков ${disc.missed}`
              : 'отчёт не предусмотрен'
          }
          icon={ClipboardList}
        />
      </div>

      {/* ТАРГЕТ 1.6 §12: компактный KPI-блок таргетолога за текущий месяц.
          Компонент сам решает, показываться ли: у других должностей запрос
          возвращает пусто. */}
      <div className="mb-5">
        <MyTargetLeadsBlock />
      </div>

      {/* График сдачи: что нужно сдать сегодня и как шли дела последние две
          недели. Показателей продаж и конверсий здесь нет — они живут в KPI
          (дополнение 1.4, п.1). */}
      {disc?.reporting && <TodayReports me={me} />}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 mb-5">
        <div className="card p-5">
          <h3 className="sec-title mb-1">Задачи</h3>
          <p className="text-xs text-muted mb-4">успеваемость за {formatMonth(CURRENT_MONTH)}</p>

          {/* Ближайшая работа — §4 «на сегодня / приближается / просрочено». */}
          <div className="grid grid-cols-3 gap-2 mb-5">
            <Mini label="На сегодня" value={dueToday} />
            <Mini label={`Ближайшие ${DUE_SOON_DAYS} дня`} value={dueSoon} />
            <Mini label="Просрочено" value={counts.overdue} tone={counts.overdue > 0 ? 'red' : undefined} />
          </div>

          {/* Прогресс-бары успеваемости — §1: процент выполнения и соблюдения сроков. */}
          <Meter
            label="Выполнено"
            pctValue={stats.completionPct}
            caption={`${stats.done} из ${stats.total} ${plural(stats.total, 'задачи', 'задач', 'задач')}`}
          />
          <div className="mt-3">
            <Meter
              label="Соблюдение сроков"
              pctValue={stats.onTimePct}
              caption={stats.done ? `вовремя ${stats.onTime} · с опозданием ${stats.late}` : 'нет выполненных'}
            />
          </div>
          {stats.total === 0 && (
            <p className="text-[11px] text-muted-2 mt-3">
              На этот месяц задач со сроком не назначено.
            </p>
          )}
        </div>

        {disc?.reporting && (
          <ReportStrip
            title="График сдачи отчётов"
            caption={`последние ${disc.dates.length} дней · дедлайн ${disc.deadlineTime}`}
            cells={disc.cells}
          />
        )}
      </div>

      <OverdueList tasks={overdue} title="Просроченные задачи" />
    </>
  )
}

// ————————————————————————————————————————————————
// Управленческий дашборд: те же блоки, но по всей команде
// ————————————————————————————————————————————————
function ManagerView({ me }: { me: Employee }) {
  const { activeEmployees, employees, tasks, reportMonth } = useData()
  const disc = useQuery(api.reports.discipline, { days: 14 })
  // KPI/начисления — из авторитетного персонального расчёта.
  const pay = useQuery(api.payroll.month, { month: CURRENT_MONTH })

  // Руководитель отдела видит только свой отдел; владелец — всю команду.
  const scoped =
    me.role === 'head' ? activeEmployees.filter((e) => e.department === me.department) : activeEmployees
  const ids = new Set(scoped.map((e) => e.id))
  const scopedTasks = me.role === 'head' ? tasks.filter((t) => ids.has(t.assigneeId)) : tasks

  // Владельца в списке KPI нет: у него нет ни плана, ни выплаты. KPI берём
  // персональный, по строке начислений сотрудника.
  const kpiById = new Map((pay?.rows ?? []).map((r) => [r.employeeId as string, r]))
  const roster = scoped.filter((e) => e.role !== 'owner')
  const withKpi = roster.map((e) => kpiById.get(e.id)).filter((r): r is NonNullable<typeof r> => !!r)
  const teamKpi = withKpi.length ? withKpi.reduce((s, r) => s + r.kpi, 0) / withKpi.length : 0
  const totalPayout = withKpi.reduce((s, r) => s + r.payout, 0)

  const counts = taskCounts(scopedTasks)
  const overdue = scopedTasks.filter(isOverdue)

  // Кто ещё не сдал отчёт за сегодня.
  const discRows = (disc?.rows ?? []).filter((r) => me.role !== 'head' || ids.has(r.employeeId))
  const todayCell = (r: (typeof discRows)[number]) => r.cells[r.cells.length - 1]
  const submitted = discRows.filter((r) => ['onTime', 'late'].includes(todayCell(r)?.status ?? '')).length
  const pendingRows = discRows.filter((r) => !['onTime', 'late', 'na'].includes(todayCell(r)?.status ?? ''))

  return (
    <>
      <PageHeader
        title="Дашборд"
        subtitle={`${me.role === 'head' ? me.department : 'Вся команда'} · ${reportMonth}`}
      />


      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4 mb-5">
        <StatCard
          highlight
          label="Средний KPI команды"
          value={pct(teamKpi, 1)}
          foot={
            withKpi.length
              ? `по ${withKpi.length} ${plural(withKpi.length, 'сотруднику', 'сотрудникам', 'сотрудникам')} с KPI`
              : 'KPI ещё не настроен'
          }
          icon={TrendingUp}
        />
        <StatCard label="К выплате за месяц" value={kzt(totalPayout)} foot="оклад × KPI" icon={Wallet} />
        <StatCard
          label="Активные задачи"
          value={String(counts.active)}
          foot={counts.overdue > 0 ? `просрочено: ${counts.overdue}` : 'просрочек нет'}
          icon={CheckSquare}
        />
        <StatCard
          label="Отчёты за сегодня"
          value={`${submitted} / ${discRows.length}`}
          foot={pendingRows.length ? `не сдали: ${pendingRows.length}` : 'все сдали'}
          icon={ClipboardList}
        />
      </div>

      {/* ТАРГЕТ 1.6 §13: управленческий блок по каждому объекту продаж и
          сводный результат по компании за выбранный период. */}
      <AdminTargetLeadsBlock />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3 mb-5">
        <div className="card p-5">
          <h3 className="sec-title mb-1">Не сдали отчёт сегодня</h3>
          <p className="text-xs text-muted mb-4">дедлайн {disc?.deadlineTime ?? '14:00'} следующего дня</p>
          {pendingRows.length === 0 ? (
            <p className="text-sm text-muted">
              {discRows.length ? 'Все отчёты за сегодня сданы.' : 'Никто не на ежедневной отчётности.'}
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {pendingRows.map((r) => {
                const missed = todayCell(r)?.status === 'missed'
                return (
                  <div key={r.employeeId} className="flex items-center gap-3 rounded-xl border border-line p-2.5">
                    <Avatar initials={r.initials} color={r.avatarColor} size={30} />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium text-ink truncate">{r.name}</div>
                      <div className="text-[11px] text-muted truncate">{r.positionLabel}</div>
                    </div>
                    <span className={`chip ${missed ? REPORT_STATUS.missed.chip : REPORT_STATUS.pending.chip}`}>
                      {missed ? 'Пропущен' : 'Ожидается'}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <OverdueList tasks={overdue} title="Просроченные задачи" employees={employees} />
      </div>

      <div className="mb-5">
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="sec-title">KPI по сотрудникам</h3>
            <span className="text-xs text-muted">за {reportMonth}</span>
          </div>
          {roster.length === 0 ? (
            <p className="text-sm text-muted py-4">В отделе пока нет сотрудников.</p>
          ) : (
            <div className="flex flex-col divide-y divide-line">
              {roster.map((e) => {
                const kpi = kpiById.get(e.id)?.kpi ?? null
                return (
                <div key={e.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-center gap-3 sm:gap-4">
                    <Avatar initials={e.initials} color={e.avatarColor} size={38} />
                    <div className="min-w-0 flex-1 sm:w-44 sm:flex-none">
                      <div className="text-sm font-semibold text-ink truncate">{e.name}</div>
                      <div className="text-xs text-muted truncate">{e.positionLabel}</div>
                    </div>
                    <div className="hidden sm:block flex-1 min-w-0">
                      {kpi === null ? (
                        <div className="text-xs text-muted-2">
                          {e.role === 'owner' ? 'Руководитель' : 'KPI-модель не настроена'}
                        </div>
                      ) : (
                        <ProgressBar value={kpi} color={barColor(kpi)} />
                      )}
                    </div>
                    <div className="w-12 sm:w-14 text-right text-sm font-bold text-ink">
                      {kpi === null ? '—' : pct(kpi)}
                    </div>
                    <div className="hidden sm:flex w-28 justify-end">
                      {kpi === null ? null : <KpiChip value={kpi} />}
                    </div>
                  </div>
                  <div className="sm:hidden mt-2">
                    {kpi !== null && <ProgressBar value={kpi} color={barColor(kpi)} />}
                  </div>
                </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <PayrollTable employees={scoped} />
    </>
  )
}

// ————————————————————————————————————————————————
// Общие куски
// ————————————————————————————————————————————————

const barColor = (v: number) => (v >= 0.9 ? '#057269' : v >= 0.7 ? '#d69e2e' : '#c53030')

// Прогресс-бар успеваемости: подпись, процент и пояснение под полосой.
// Начисления за месяц (§5). Пока месяц открыт — предварительный расчёт,
// после закрытия — зафиксированный архив.
function PayrollTable({ employees }: { employees: Employee[] }) {
  // Свой переключатель месяцев: закрытые месяцы — это и есть архив начислений,
  // и попасть в него можно только отсюда.
  const [month, setMonth] = useState(CURRENT_MONTH)
  const atCurrent = month >= CURRENT_MONTH
  const data = useQuery(api.payroll.month, { month })
  const close = useMutation(api.payroll.close)
  const reopen = useMutation(api.payroll.reopen)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Скрывать карточку целиком нельзя: вместе с ней исчезли бы стрелки месяцев,
  // и из пустого месяца было бы не вернуться. Пустоту показываем внутри.
  if (data === null) return null

  const byId = new Map(employees.map((e) => [e.id, e]))
  // Сотрудник без плана KPI просто исчезал из таблицы, и понять, почему в
  // выплатах пусто, было нельзя. Называем таких поимённо: почти всегда это
  // значит, что план на месяц ещё не задан или не закреплён за человеком.
  const shown = new Set((data?.rows ?? []).map((r) => r.employeeId as string))
  const missing =
    data && !data.closed ? employees.filter((e) => e.role !== 'owner' && !shown.has(e.id)) : []
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError(errMessage(e, 'Не удалось выполнить действие.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {/* Заголовок и пикер — вне карточки: зелёная шапка таблицы должна быть
          её первой строкой, как в «Команде» и «Кампаниях». */}
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <Wallet size={16} className="text-green" />
        <h3 className="sec-title">Начисления · {formatMonth(month)}</h3>
        {data === undefined ? null : data.closed ? (
          <span className="chip bg-[#e2f2ef] text-green-d">
            Закрыт{data.auto ? ' автоматически' : ''}
          </span>
        ) : (
          <span className="chip bg-[#fff6e6] text-[#b7791f]">Предварительно</span>
        )}
        <div className="flex-1" />
        {data?.canManage && data.closed && (
          <button onClick={() => run(() => reopen({ month }))} disabled={busy} className="mini-btn">
            Переоткрыть
          </button>
        )}
        {data?.canManage && !data.closed && !atCurrent && (
          <button onClick={() => run(() => close({ month }))} disabled={busy} className="mini-btn">
            Закрыть месяц
          </button>
        )}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setMonth(addMonth(month, -1))}
            className="ico-btn w-10 h-10"
            title="Предыдущий месяц"
            aria-label="Предыдущий месяц"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={() => setMonth(addMonth(month, 1))}
            disabled={atCurrent}
            className="ico-btn w-10 h-10 disabled:opacity-40 disabled:cursor-default disabled:hover:bg-white"
            title={atCurrent ? 'Текущий месяц' : 'Следующий месяц'}
            aria-label="Следующий месяц"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-[#c53030] mb-3">{error}</p>}

      <div className="card overflow-hidden">
      {data === undefined ? (
        <div className="p-10 grid place-items-center text-muted">
          <Loader2 className="animate-spin" size={20} />
        </div>
      ) : data.rows.length === 0 ? (
        <div className="p-10 text-center">
          <div className="sec-title mb-1">За этот месяц начислений нет</div>
          <p className="text-sm text-muted max-w-md mx-auto">
            {data.closed
              ? 'Месяц закрыт без начислений — данных по KPI за него не было.'
              : 'Начисления появятся, когда у должностей будут заданы планы и сданы отчёты.'}
          </p>
        </div>
      ) : (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px]">
          <thead>
            <tr className={theadRow}>
              <th className={th}>Сотрудник</th>
              <th className={th}>Должность</th>
              <th className={thRight}>KPI</th>
              <th className={thRight}>Оклад</th>
              <th className={thRight}>К выплате</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => {
              const e = byId.get(r.employeeId as string)
              return (
                <tr key={r.employeeId} className="hover:bg-chip/40 transition-colors">
                  <td className={td}>
                    <div className="flex items-center gap-3">
                      {e && <Avatar initials={e.initials} color={e.avatarColor} size={34} />}
                      <span className="font-semibold text-ink whitespace-nowrap">{r.name}</span>
                    </div>
                  </td>
                  <td className={td}>{r.positionLabel}</td>
                  <td className={`${td} text-right`}>
                    <span
                      className={`chip tabular-nums ${
                        r.kpi >= 1 ? 'bg-[#e2f2ef] text-green-d' : 'bg-chip text-ink-2'
                      }`}
                    >
                      {pct(r.kpi, 1)}
                    </span>
                  </td>
                  <td className={`${td} text-right`}>
                    <SalaryCell
                      value={r.salary}
                      employeeId={r.employeeId}
                      // Закрытый месяц уже начислен — оклад в нём не правим.
                      editable={data.canManage && !data.closed}
                    />
                  </td>
                  <td className={`${td} text-right font-bold text-ink tabular-nums`}>
                    {kzt(r.payout)}
                  </td>
                </tr>
              )
            })}
            <tr className="bg-chip/40">
              <td className={`${td} font-semibold text-ink`} colSpan={4}>
                Итого
              </td>
              <td className={`${td} text-right font-bold text-green-d tabular-nums`}>
                {kzt(data.total)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      )}

      {missing.length > 0 && (
        <div className="px-4 py-3 border-t border-line bg-[#fff6e6]">
          <div className="text-[11px] font-semibold text-[#b7791f] mb-1">
            Без плана на {formatMonth(month)} — в расчёт не попали
          </div>
          <div className="text-[11px] text-ink-2">
            {missing.map((e) => `${e.name} (${e.positionLabel})`).join(', ')}. Задайте план в
            Настройках, а по кампаниям — закрепите его за таргетологом в «Отчётности → Кампании».
          </div>
        </div>
      )}

      {data !== undefined && (
        <div className="px-4 py-3 border-t border-line text-[11px] text-muted">
          {data.closed
            ? 'Суммы зафиксированы: правки отчётов за этот месяц больше не принимаются.'
            : atCurrent
              ? 'Расчёт по текущим данным. Месяц закроется автоматически 1-го числа.'
              : 'Месяц ещё не закрыт — суммы могут измениться.'}
        </div>
      )}
      </div>
    </>
  )
}

// Оклад правится прямо в таблице. Он персональный (employees.salary) — именно
// оттуда его берёт payroll.computeMonth. Раньше ячейка писала в
// settings.salarySmm/Targetolog/Sales: те поля не читает никто, кроме старых
// миграций, поэтому правка «сохранялась», а выплата не менялась.
function SalaryCell({
  value,
  employeeId,
  editable,
}: {
  value: number
  employeeId: Id<'employees'>
  editable: boolean
}) {
  const update = useMutation(api.employees.update)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(value))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  if (!editable) {
    return <span className="tabular-nums">{kzt(value)}</span>
  }

  const commit = async () => {
    const next = Number(draft)
    setEditing(false)
    if (!Number.isFinite(next) || next < 0 || next === value) return
    setSaving(true)
    setError('')
    try {
      await update({ id: employeeId, patch: { salary: next } })
    } catch (e) {
      // Оклад меняет только владелец — молча терять отказ сервера нельзя.
      setError(errMessage(e, 'Не удалось изменить оклад.'))
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <input
        autoFocus
        type="number"
        min={0}
        step={10000}
        value={draft}
        onChange={(ev) => setDraft(ev.target.value)}
        onBlur={commit}
        onKeyDown={(ev) => {
          if (ev.key === 'Enter') commit()
          if (ev.key === 'Escape') {
            setDraft(String(value))
            setEditing(false)
          }
        }}
        className="w-32 h-8 px-2 rounded-lg border border-green-light text-sm text-right tabular-nums focus:outline-none"
      />
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setDraft(String(value))
          setEditing(true)
        }}
        disabled={saving}
        title="Изменить оклад сотрудника"
        className="inline-flex items-center gap-1.5 px-2 py-1 -mr-2 rounded-lg tabular-nums hover:bg-chip transition-colors group"
      >
        {kzt(value)}
        <Pencil size={12} className="text-muted-2 group-hover:text-green" />
      </button>
      {error && <div className="text-[11px] text-[#c53030] mt-1">{error}</div>}
    </>
  )
}

function Meter({
  label,
  pctValue,
  caption,
}: {
  label: string
  pctValue: number
  caption: string
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-sm text-ink-2">{label}</span>
        <span className="text-sm font-bold text-ink tabular-nums">{pct(pctValue)}</span>
      </div>
      <ProgressBar value={pctValue} color={barColor(pctValue)} />
      <div className="text-[11px] text-muted mt-1">{caption}</div>
    </div>
  )
}

function Mini({ label, value, tone }: { label: string; value: number; tone?: 'red' }) {
  return (
    <div className="rounded-xl bg-chip p-3 text-center">
      <div className={`text-xl font-bold ${tone === 'red' ? 'text-[#c53030]' : 'text-ink'}`}>{value}</div>
      <div className="text-[11px] text-muted mt-0.5 leading-tight">{label}</div>
    </div>
  )
}

// Полоска дисциплины за окно дней — своя строка из сетки «Отчётности».
// §2.5: квадраты кликабельны. Зелёный и жёлтый открывают свой отчёт за эту
// дату; красный только объясняет, что день пропущен — самостоятельно внести
// его задним числом сотрудник не может, это делает администратор.
function ReportStrip({
  title,
  caption,
  cells,
}: {
  title: string
  caption: string
  cells: { date: string; status: string }[]
}) {
  const navigate = useNavigate()
  const [missedNote, setMissedNote] = useState<string | null>(null)
  return (
    <div className="card p-5">
      <h3 className="sec-title mb-1">{title}</h3>
      <p className="text-xs text-muted mb-4">{caption}</p>
      <div className="flex items-end gap-1.5 flex-wrap mb-4">
        {cells.map((c) => {
          const st = REPORT_STATUS[c.status as ReportStatus]
          const filled = c.status === 'onTime' || c.status === 'late'
          const missed = c.status === 'missed'
          return (
            <div key={c.date} className="flex flex-col items-center gap-1">
              <button
                type="button"
                disabled={!filled && !missed}
                onClick={() => {
                  if (filled) navigate(`/reports?date=${c.date}`)
                  else setMissedNote(c.date)
                }}
                className={`w-7 h-7 rounded-md border border-line transition-transform ${
                  filled || missed ? 'cursor-pointer hover:scale-110' : 'cursor-default'
                }`}
                style={{ background: st.cell }}
                title={
                  filled
                    ? `${st.label} · открыть отчёт`
                    : missed
                      ? `${st.label} · отчёт не сдан`
                      : st.label
                }
              />
              <span className="text-[10px] text-muted-2">{c.date.slice(8)}</span>
            </div>
          )
        })}
      </div>
      {missedNote && (
        <div className="rounded-xl border border-[#f3d9a4] bg-[#fff6e6] p-3 mb-4 flex items-start gap-2.5">
          <AlertTriangle size={16} className="text-[#b7791f] shrink-0 mt-0.5" />
          <div className="text-sm text-[#8a5a12] flex-1">
            Отчёт за {shortDate(missedNote)} не сдан. Внести его задним числом самостоятельно
            нельзя — обратитесь к администратору.
          </div>
          <button onClick={() => setMissedNote(null)} className="text-[#8a5a12] text-sm shrink-0">
            Понятно
          </button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {/* Только те статусы, что реально есть в полоске: у новичка почти все
            клетки — «ещё не работал», и легенда без него ничего не объясняет. */}
        {(['onTime', 'late', 'missed', 'pending', 'na'] as ReportStatus[])
          .filter((s) => cells.some((c) => c.status === s))
          .map((s) => (
            <div key={s} className="flex items-center gap-1.5 text-[11px] text-muted">
              <span className="w-3 h-3 rounded border border-line" style={{ background: REPORT_STATUS[s].cell }} />
              {REPORT_STATUS[s].label}
            </div>
          ))}
      </div>
    </div>
  )
}

// Что сотрудник должен сдать сегодня (дополнение 1.4, п.1: «какие отчёты и
// когда должен предоставить менеджер»). У продаж отчёт свой на каждый объект,
// поэтому показываем поимённый список; у остальных должностей отчёт один на
// день, и ситуацию исчерпывающе описывает полоска графика сдачи.
function TodayReports({ me }: { me: Employee }) {
  const objects = useQuery(
    api.sales.assignedObjects,
    me.position === 'sales' ? { date: TODAY } : 'skip',
  )
  if (me.position !== 'sales' || objects === undefined || objects.length === 0) return null

  const done = objects.filter((o) => o.submitted).length
  const allDone = done === objects.length

  return (
    <div className="card p-5 mb-5">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div>
          <h3 className="sec-title mb-1">Отчёты на сегодня</h3>
          <p className="text-xs text-muted">по каждому назначенному объекту продаж</p>
        </div>
        <span className={`chip ${allDone ? 'bg-[#e2f2ef] text-green-d' : 'bg-[#fff6e6] text-[#b7791f]'}`}>
          Сдано отчётов: {done} из {objects.length}
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {objects.map((o) => (
          <div
            key={o._id}
            className={`rounded-xl border p-3 flex items-center gap-2 ${
              o.submitted ? 'border-green-light bg-[#e2f2ef]' : 'border-line bg-white'
            }`}
          >
            {o.submitted ? (
              <Check size={15} className="text-green shrink-0" />
            ) : (
              <span className="w-[15px] h-[15px] rounded-full border-2 border-muted-2 shrink-0" />
            )}
            <span className={`text-sm flex-1 truncate ${o.submitted ? 'text-green-d' : 'text-ink-2'}`}>
              {o.name}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// Список просрочек. Без исполнителя у сотрудника — там все задачи его.
function OverdueList({
  tasks,
  title,
  employees,
}: {
  tasks: Task[]
  title: string
  employees?: Employee[]
}) {
  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-4">
        <AlertTriangle size={16} className={tasks.length ? 'text-[#c53030]' : 'text-muted'} />
        <h3 className="sec-title flex-1">{title}</h3>
        {tasks.length > 0 && (
          <span className="chip bg-[#fdeaea] text-[#c53030]">{tasks.length}</span>
        )}
      </div>
      {tasks.length === 0 ? (
        <p className="text-sm text-muted">Просроченных задач нет.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {tasks.slice(0, 5).map((t) => {
            const a = employees?.find((e) => e.id === t.assigneeId)
            return (
              <div key={t.id} className="flex items-center gap-3 rounded-xl border border-line p-2.5">
                {a && <Avatar initials={a.initials} color={a.avatarColor} size={30} />}
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-ink truncate">{t.title}</div>
                  <div className="text-[11px] text-[#c53030] font-semibold">
                    Просрочено · {t.deadline ? shortDate(t.deadline) : '—'}
                  </div>
                </div>
                <PriorityChip priority={t.priority} />
              </div>
            )
          })}
          {tasks.length > 5 && (
            <p className="text-[11px] text-muted-2 pt-1">и ещё {tasks.length - 5}</p>
          )}
        </div>
      )}
    </div>
  )
}
