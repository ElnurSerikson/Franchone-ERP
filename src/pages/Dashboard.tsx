import { useQuery } from 'convex/react'
import { Wallet, TrendingUp, AlertTriangle, ClipboardList, CheckSquare } from 'lucide-react'
import { api } from '../../convex/_generated/api'
import PageHeader from '@/components/PageHeader'
import StatCard from '@/components/ui/StatCard'
import Avatar from '@/components/ui/Avatar'
import { ProgressBar } from '@/components/ui/Progress'
import { KpiChip, PriorityChip } from '@/components/ui/StatusChip'
import { useApp, useCurrentUser } from '@/store'
import { useData } from '@/lib/useData'
import { computeSmm, computeTargetolog, DEFAULT_WEIGHTS } from '@/lib/kpi'
import {
  employeeKpi, taskCounts, isOverdue, isDueToday, isDueSoon, monthTaskStats,
} from '@/lib/selectors'
import { REPORT_STATUS, type ReportStatus } from '@/lib/reports'
import { kzt, num, pct, plural, shortDate } from '@/lib/format'
import { CURRENT_MONTH, formatMonth } from '@/lib/month'
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
  const { tasks, smmMetrics, campaigns } = useData()
  const settings = useQuery(api.settings.get, {})
  const disc = useQuery(api.reports.myDiscipline, { days: 14 })

  // tasks уже приходят отфильтрованными по сотруднику — фильтрует сервер.
  const counts = taskCounts(tasks)
  const overdue = tasks.filter(isOverdue)
  const dueToday = tasks.filter(isDueToday).length
  const dueSoon = tasks.filter((t) => isDueSoon(t, DUE_SOON_DAYS)).length
  const stats = monthTaskStats(tasks, CURRENT_MONTH)

  // KPI и план — только для должностей с моделью. Остальным блоки не показываем.
  const plan = planFor(me, smmMetrics, campaigns, settings)

  return (
    <>
      <PageHeader
        title="Дашборд"
        subtitle={`${me.positionLabel} · ${formatMonth(CURRENT_MONTH)}`}
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4 mb-5">
        {plan ? (
          <>
            <StatCard highlight label="Мой KPI" value={pct(plan.kpi, 1)} foot="за текущий месяц" icon={TrendingUp} />
            <StatCard
              label="Заработано"
              value={kzt(plan.earned)}
              foot={`предварительно · оклад ${kzt(plan.salary)}`}
              icon={Wallet}
            />
          </>
        ) : (
          <StatCard highlight label="Задачи на сегодня" value={String(dueToday)} foot={`ближайшие ${DUE_SOON_DAYS} дня: ${dueSoon}`} icon={CheckSquare} />
        )}
        <StatCard
          label="Активные задачи"
          value={String(counts.active)}
          foot={counts.overdue > 0 ? `просрочено: ${counts.overdue}` : 'просрочек нет'}
          icon={CheckSquare}
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

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 mb-5">
        {plan && (
          <div className="card p-5">
            <h3 className="sec-title mb-1">Выполнение плана</h3>
            <p className="text-xs text-muted mb-4">{plan.caption}</p>
            <div className="flex items-baseline gap-2 mb-2">
              <span className="text-[28px] font-bold text-ink leading-none">{pct(plan.ratio)}</span>
              <span className="text-sm text-muted">
                {num(plan.fact)} из {num(plan.target)}
              </span>
            </div>
            <ProgressBar value={plan.ratio} color={barColor(plan.ratio)} height={10} />
            {plan.fact === 0 && (
              <p className="text-[11px] text-muted-2 mt-3">
                Данные появятся, как только вы начнёте сдавать ежедневные отчёты.
              </p>
            )}
          </div>
        )}

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
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {disc?.reporting && (
          <ReportStrip
            title="Отчётность"
            caption={`последние ${disc.dates.length} дней`}
            cells={disc.cells}
          />
        )}
        <OverdueList tasks={overdue} title="Просроченные задачи" />
      </div>
    </>
  )
}

// ————————————————————————————————————————————————
// Управленческий дашборд: те же блоки, но по всей команде
// ————————————————————————————————————————————————
function ManagerView({ me }: { me: Employee }) {
  const { activeEmployees, employees, tasks, smmMetrics, campaigns, reportMonth } = useData()
  const settings = useQuery(api.settings.get, {})
  const disc = useQuery(api.reports.discipline, { days: 14 })

  // Руководитель отдела видит только свой отдел; владелец — всю команду.
  const scoped =
    me.role === 'head' ? activeEmployees.filter((e) => e.department === me.department) : activeEmployees
  const ids = new Set(scoped.map((e) => e.id))
  const scopedTasks = me.role === 'head' ? tasks.filter((t) => ids.has(t.assigneeId)) : tasks

  const kpis = scoped.map((e) => employeeKpi(e, smmMetrics, campaigns))
  const withKpi = kpis.filter((k) => k.kpi !== null)
  const teamKpi = withKpi.reduce((s, k) => s + (k.kpi ?? 0), 0) / (withKpi.length || 1)
  const totalPayout = withKpi.reduce((s, k) => s + (k.payout ?? 0), 0)

  const tg = computeTargetolog(campaigns, {
    leadWeight: settings?.leadWeight ?? DEFAULT_WEIGHTS.leadWeight,
    cplWeight: settings?.cplWeight ?? DEFAULT_WEIGHTS.cplWeight,
  })
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

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3 mb-5">
        <div className="card p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="sec-title">KPI по сотрудникам</h3>
            <span className="text-xs text-muted">за {reportMonth}</span>
          </div>
          {kpis.length === 0 ? (
            <p className="text-sm text-muted py-4">В отделе пока нет сотрудников.</p>
          ) : (
            <div className="flex flex-col divide-y divide-line">
              {kpis.map(({ employee: e, kpi }) => (
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
              ))}
            </div>
          )}
        </div>

        <div className="card p-5">
          <h3 className="sec-title mb-4">Выплаты к начислению</h3>
          {withKpi.length === 0 ? (
            <p className="text-sm text-muted">Пока не по кому считать выплату.</p>
          ) : (
            <div className="flex flex-col divide-y divide-line">
              {withKpi.map(({ employee: e, payout }) => (
                <div key={e.id} className="flex items-center justify-between py-3 first:pt-0">
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar initials={e.initials} color={e.avatarColor} size={34} />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-ink truncate">{e.name}</div>
                      <div className="text-[11px] text-muted">оклад {kzt(e.salary)}</div>
                    </div>
                  </div>
                  <div className="text-sm font-bold text-ink whitespace-nowrap">{kzt(payout ?? 0)}</div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-4 pt-4 border-t border-line flex items-center justify-between">
            <span className="text-sm text-muted">Итого</span>
            <span className="text-lg font-bold text-green-d">{kzt(totalPayout)}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="card p-5">
          <h3 className="sec-title mb-1">Не сдали отчёт сегодня</h3>
          <p className="text-xs text-muted mb-4">дедлайн {disc?.deadlineTime ?? '20:00'}</p>
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

        <div className="card p-5">
          <h3 className="sec-title mb-1">Реклама</h3>
          <p className="text-xs text-muted mb-4">расход за {reportMonth}</p>
          <div className="text-[28px] font-bold text-ink leading-none mb-3">{kzt(tg.totalSpend)}</div>
          <div className="flex flex-col gap-2 text-sm">
            <Row label="Заявок" value={num(tg.totalLeads)} />
            <Row label="Средний CPL" value={tg.totalLeads ? kzt(tg.avgCpl) : '—'} />
            <Row label="Кампаний в плане" value={String(campaigns.length)} />
          </div>
          {campaigns.length === 0 && (
            <p className="text-[11px] text-muted-2 mt-3">
              На этот месяц кампаниям не заданы планы — задайте их в «Отчётности → Кампании».
            </p>
          )}
        </div>

        <OverdueList tasks={overdue} title="Просроченные задачи" employees={employees} />
      </div>
    </>
  )
}

// ————————————————————————————————————————————————
// Общие куски
// ————————————————————————————————————————————————

// План месяца по модели должности. null — модели нет, блоки не показываем.
function planFor(
  me: Employee,
  smmMetrics: ReturnType<typeof useData>['smmMetrics'],
  campaigns: ReturnType<typeof useData>['campaigns'],
  settings: { salarySmm?: number; salaryTargetolog?: number; leadWeight?: number; cplWeight?: number } | undefined,
) {
  if (me.position === 'smm' && smmMetrics.length > 0) {
    const r = computeSmm(smmMetrics)
    const salary = settings?.salarySmm ?? 0
    return {
      kpi: r.totalKpi,
      ratio: r.totalPlan ? Math.min(r.totalFact / r.totalPlan, 1) : 0,
      fact: r.totalFact,
      target: r.totalPlan,
      caption: 'публикаций по плану месяца',
      salary,
      earned: Math.round(salary * r.totalKpi),
    }
  }
  if (me.position === 'targetolog' && campaigns.length > 0) {
    const r = computeTargetolog(campaigns, {
      leadWeight: settings?.leadWeight ?? DEFAULT_WEIGHTS.leadWeight,
      cplWeight: settings?.cplWeight ?? DEFAULT_WEIGHTS.cplWeight,
    })
    const planLeads = campaigns.reduce((s, c) => s + c.planLeads, 0)
    const salary = settings?.salaryTargetolog ?? 0
    return {
      kpi: r.totalKpi,
      ratio: planLeads ? Math.min(r.totalLeads / planLeads, 1) : 0,
      fact: r.totalLeads,
      target: planLeads,
      caption: 'заявок по плану месяца',
      salary,
      earned: Math.round(salary * r.totalKpi),
    }
  }
  return null
}

const barColor = (v: number) => (v >= 0.9 ? '#057269' : v >= 0.7 ? '#d69e2e' : '#c53030')

// Прогресс-бар успеваемости: подпись, процент и пояснение под полосой.
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted">{label}</span>
      <span className="font-semibold text-ink tabular-nums">{value}</span>
    </div>
  )
}

// Полоска дисциплины за окно дней — своя строка из сетки «Отчётности».
function ReportStrip({
  title,
  caption,
  cells,
}: {
  title: string
  caption: string
  cells: { date: string; status: string }[]
}) {
  return (
    <div className="card p-5">
      <h3 className="sec-title mb-1">{title}</h3>
      <p className="text-xs text-muted mb-4">{caption}</p>
      <div className="flex items-end gap-1.5 flex-wrap mb-4">
        {cells.map((c) => {
          const st = REPORT_STATUS[c.status as ReportStatus]
          return (
            <div key={c.date} className="flex flex-col items-center gap-1">
              <span
                className="w-7 h-7 rounded-md border border-line"
                style={{ background: st.cell }}
                title={`${c.date} · ${st.label}`}
              />
              <span className="text-[10px] text-muted-2">{c.date.slice(8)}</span>
            </div>
          )
        })}
      </div>
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
                    Просрочено · {shortDate(t.deadline)}
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
