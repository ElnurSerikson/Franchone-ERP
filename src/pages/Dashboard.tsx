import { Wallet, TrendingUp, Megaphone, AlertTriangle, Download, ArrowUpRight } from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import StatCard from '@/components/ui/StatCard'
import Avatar from '@/components/ui/Avatar'
import { ProgressBar } from '@/components/ui/Progress'
import { KpiChip, PriorityChip } from '@/components/ui/StatusChip'
import { useData } from '@/lib/useData'
import { computeTargetolog, spendBySource } from '@/lib/kpi'
import { employeeKpi, taskCounts, isOverdue } from '@/lib/selectors'
import { kzt, num, pct, shortDate } from '@/lib/format'

export default function Dashboard() {
  const { employees, campaigns, tasks, smmMetrics, reportMonth } = useData()
  const kpis = employees.map((e) => employeeKpi(e, smmMetrics, campaigns))
  const withKpi = kpis.filter((k) => k.kpi !== null)
  const teamKpi = withKpi.reduce((s, k) => s + (k.kpi ?? 0), 0) / (withKpi.length || 1)
  const totalPayout = withKpi.reduce((s, k) => s + (k.payout ?? 0), 0)

  const tg = computeTargetolog(campaigns)
  const src = spendBySource(campaigns)
  const counts = taskCounts(tasks)
  const overdue = tasks.filter(isOverdue)
  const maxSpend = Math.max(...campaigns.map((c) => c.factBudget))

  return (
    <>
      <PageHeader
        title="Дашборд"
        subtitle={`Обзор команды и KPI · ${reportMonth}`}
        actions={
          <>
            <button className="btn btn-ghost">
              <Download size={16} /> Экспорт
            </button>
            <button className="btn btn-green">{reportMonth}</button>
          </>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4 mb-5">
        <StatCard
          highlight
          label="Общий KPI команды"
          value={pct(teamKpi)}
          foot={`Средний по ${withKpi.length} сотрудникам с KPI`}
          icon={TrendingUp}
        />
        <StatCard label="К выплате за месяц" value={kzt(totalPayout)} foot="Оклад × KPI" icon={Wallet} />
        <StatCard
          label="Расход на рекламу"
          value={kzt(tg.totalSpend)}
          foot={`Заявок ${num(tg.totalLeads)} · CPL ${kzt(tg.avgCpl)}`}
          icon={Megaphone}
        />
        <StatCard
          label="Просроченные задачи"
          value={String(counts.overdue)}
          foot={`Активных задач: ${counts.active}`}
          icon={AlertTriangle}
        />
      </div>

      {/* KPI per employee + payouts */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3 mb-5">
        <div className="card p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="sec-title">KPI по сотрудникам</h3>
            <span className="text-xs text-muted">план / факт за месяц</span>
          </div>
          <div className="flex flex-col divide-y divide-line">
            {kpis.map(({ employee: e, kpi }) => {
              const barColor = kpi != null ? (kpi >= 0.9 ? '#057269' : kpi >= 0.7 ? '#d69e2e' : '#c53030') : ''
              const emptyLabel = e.role === 'owner' ? 'Руководитель' : 'KPI-модель в разработке'
              return (
                <div key={e.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-center gap-3 sm:gap-4">
                    <Avatar initials={e.initials} color={e.avatarColor} size={38} />
                    <div className="min-w-0 flex-1 sm:w-44 sm:flex-none">
                      <div className="text-sm font-semibold text-ink truncate">{e.name}</div>
                      <div className="text-xs text-muted truncate">{e.positionLabel}</div>
                    </div>
                    {/* прогресс-бар — в строке на sm+, отдельной строкой на телефоне */}
                    <div className="hidden sm:block flex-1 min-w-0">
                      {kpi === null ? (
                        <div className="text-xs text-muted-2">{emptyLabel}</div>
                      ) : (
                        <ProgressBar value={kpi} color={barColor} />
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
                    {kpi === null ? (
                      <div className="text-xs text-muted-2">{emptyLabel}</div>
                    ) : (
                      <ProgressBar value={kpi} color={barColor} />
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Payouts */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="sec-title">Выплаты к начислению</h3>
          </div>
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
          <div className="mt-4 pt-4 border-t border-line flex items-center justify-between">
            <span className="text-sm text-muted">Итого за {reportMonth}</span>
            <span className="text-lg font-bold text-green-d">{kzt(totalPayout)}</span>
          </div>
        </div>
      </div>

      {/* Ads + tasks */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="sec-title">Реклама: расход / заявки / CPL</h3>
            <span className="text-xs text-muted">источник денег</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 mb-5">
            {(['FRANCHONE', 'Партнёр'] as const).map((s) => (
              <div key={s} className="rounded-2xl border border-line p-4 min-w-0">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-ink">{s}</span>
                  <span
                    className={`w-2.5 h-2.5 rounded-full shrink-0 ${s === 'FRANCHONE' ? 'bg-green' : 'bg-green-light'}`}
                  />
                </div>
                <div className="text-2xl font-bold text-ink truncate">{kzt(src[s].spend)}</div>
                <div className="text-xs text-muted mt-1">
                  Заявок {num(src[s].leads)} · CPL {kzt(src[s].cpl)}
                </div>
              </div>
            ))}
          </div>

          <div className="text-xs font-semibold text-muted-2 tracking-wide mb-2">РАСХОД ПО КАМПАНИЯМ</div>
          <div className="flex flex-col gap-2.5">
            {campaigns.map((c) => (
              <div key={c.id} className="flex items-center gap-2.5 sm:gap-3">
                <div className="w-24 sm:w-40 text-xs text-ink-2 truncate shrink-0">{c.brand}</div>
                <div className="flex-1 min-w-0">
                  <ProgressBar
                    value={c.factBudget / maxSpend}
                    color={c.moneySource === 'FRANCHONE' ? '#057269' : '#4db3a6'}
                  />
                </div>
                <div className="w-20 sm:w-24 text-right text-[11px] sm:text-xs font-semibold text-ink shrink-0">
                  {kzt(c.factBudget)}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Tasks & overdue */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="sec-title">Задачи и просрочки</h3>
            <ArrowUpRight size={16} className="text-muted" />
          </div>
          <div className="grid grid-cols-3 gap-2 mb-4">
            {[
              { l: 'Активные', v: counts.active, c: 'text-ink' },
              { l: 'Просрочка', v: counts.overdue, c: 'text-[#c53030]' },
              { l: 'Готово', v: counts.done, c: 'text-green-d' },
            ].map((s) => (
              <div key={s.l} className="rounded-xl bg-chip p-3 text-center">
                <div className={`text-xl font-bold ${s.c}`}>{s.v}</div>
                <div className="text-[11px] text-muted mt-0.5">{s.l}</div>
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-2">
            {overdue.concat(tasks.filter((t) => !isOverdue(t) && t.status !== 'done')).slice(0, 4).map((t) => {
              const a = employees.find((e) => e.id === t.assigneeId)!
              const over = isOverdue(t)
              return (
                <div key={t.id} className="flex items-center gap-3 rounded-xl border border-line p-2.5">
                  <Avatar initials={a.initials} color={a.avatarColor} size={30} />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium text-ink truncate">{t.title}</div>
                    <div className={`text-[11px] ${over ? 'text-[#c53030] font-semibold' : 'text-muted'}`}>
                      {over ? 'Просрочено · ' : 'До '}
                      {shortDate(t.deadline)}
                    </div>
                  </div>
                  <PriorityChip priority={t.priority} />
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </>
  )
}
