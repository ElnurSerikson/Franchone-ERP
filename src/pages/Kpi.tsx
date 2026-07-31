import { useState, type ReactNode } from 'react'
import { useQuery } from 'convex/react'
import {
  TrendingUp, Wallet, Building2, User, Target,
  Percent, Loader2, ChevronLeft, ChevronRight, type LucideIcon,
} from 'lucide-react'
import { api } from '../../convex/_generated/api'
import { useApp, useCurrentUser } from '@/store'
import PageHeader from '@/components/PageHeader'
import StatCard from '@/components/ui/StatCard'
import SalesDashboardBlock from '@/components/sales/SalesDashboardBlock'
import TargetologDashboard from '@/components/campaigns/TargetologDashboard'
import { computeSmm } from '@/lib/kpi'
import { mapSmm } from '@/lib/mappers'
import { useData } from '@/lib/useData'
import { personalPlan } from '@/lib/selectors'
import { kzt, num, pct } from '@/lib/format'
import { CURRENT_MONTH, addMonth, formatMonth } from '@/lib/month'

// Базы выплат и веса берутся из настроек (ячейки «Оклад» и B6/B7 на дашбордах
// KPI_SMM / KPI_TARGETOLOG). Выплата = оклад × Итоговый KPI.


type Dept = 'smm' | 'targetolog' | 'sales'
const DEPTS: { id: Dept; label: string }[] = [
  { id: 'smm', label: 'SMM' },
  { id: 'targetolog', label: 'Таргетолог' },
  { id: 'sales', label: 'Отдел продаж' },
]

const acctShort = (a: string) => (a === 'FRANCHONE' ? 'FR' : a === 'ANUAR' ? 'Anuar' : a)

export default function Kpi() {
  const { role } = useApp()
  const me = useCurrentUser()
  const [dept, setDept] = useState<Dept>('smm')
  const [month, setMonth] = useState(CURRENT_MONTH)
  const monthLabel = formatMonth(month)
  const atCurrent = month >= CURRENT_MONTH

  // Переключатель отделов — только у руководства. Сотрудник видит KPI своей
  // должности и ничей больше: в карточках есть суммы выплат.
  const canSeeAll = role === 'owner' || role === 'head'
  const ownDept = DEPTS.find((d) => d.id === (me.position as Dept))?.id ?? null
  const active: Dept | null = canSeeAll ? dept : ownDept

  const subtitle =
    active === 'smm'
      ? `Контент · FRANCHONE + ANUAR · ${monthLabel}`
      : active === 'targetolog'
        ? `Реклама · кампании · ${monthLabel}`
        : active === 'sales'
          ? `Отдел продаж · ${monthLabel}`
          : monthLabel

  return (
    <>
      <PageHeader
        title="KPI"
        subtitle={subtitle}
        actions={
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setMonth(addMonth(month, -1))}
              className="ico-btn w-9 h-9"
              aria-label="Предыдущий месяц"
              title="Предыдущий месяц"
            >
              <ChevronLeft size={16} />
            </button>
            <div className="btn btn-green min-w-[132px] justify-center cursor-default select-none">
              {monthLabel}
            </div>
            <button
              onClick={() => setMonth(addMonth(month, 1))}
              disabled={atCurrent}
              className="ico-btn w-9 h-9 disabled:opacity-40 disabled:cursor-default disabled:hover:bg-white"
              aria-label="Следующий месяц"
              title={atCurrent ? 'Текущий месяц' : 'Следующий месяц'}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        }
      />

      {/* Переключатель отделов (по должности, без имён) */}
      {canSeeAll && (
      <div className="flex items-center gap-1 p-1 bg-chip rounded-xl w-full sm:w-fit mb-5">
        {DEPTS.map((d) => (
          <button
            key={d.id}
            onClick={() => setDept(d.id)}
            className={`h-9 px-4 rounded-lg text-sm font-semibold transition-colors flex-1 sm:flex-none ${
              dept === d.id
                ? 'bg-white text-ink shadow-card'
                : // Неактивные — своя светло-серая плашка, чтобы читались как кнопки.
                  'bg-line text-ink-2/70 hover:bg-line-2 hover:text-ink'
            }`}
          >
            {d.label}
          </button>
        ))}
      </div>
      )}

      {active === 'smm' && <SmmKpi month={month} />}
      {active === 'targetolog' && <TargetologKpi />}
      {active === 'sales' && <SalesKpi month={month} />}
      {active === null && (
        <EmptyKpi
          icon={Target}
          title="KPI для вашей должности не настроен"
          hint="Показатели считаются для SMM, таргетолога и отдела продаж. Если это ошибка — обратитесь к руководителю."
        />
      )}
    </>
  )
}

function Loading() {
  return (
    <div className="card p-10 grid place-items-center text-muted">
      <Loader2 className="animate-spin" size={20} />
    </div>
  )
}

// ——— SMM: контент-KPI (FRANCHONE + ANUAR) ———
function SmmKpi({ month }: { month: string }) {
  const raw = useQuery(api.smm.list, { month })
  // Выплата — из авторитетного персонального расчёта, а не оклад×KPI по настройкам
  // (оклад теперь у каждого свой). Суммируем строки SMM за месяц.
  const payroll = useQuery(api.payroll.month, { month })
  if (raw === undefined || payroll === undefined) return <Loading />
  const smmMetrics = raw.map(mapSmm)
  if (smmMetrics.length === 0)
    return (
      <EmptyKpi
        icon={TrendingUp}
        title="Нет данных за этот месяц"
        hint="Контент-показатели SMM за выбранный месяц ещё не заведены. Переключите месяц или добавьте план и факт."
      />
    )

  const smm = computeSmm(smmMetrics)
  const payoutVal = (payroll?.rows ?? [])
    .filter((r) => r.position === 'smm')
    .reduce((s, r) => s + r.payout, 0)

  const rows = smm.rows.map((r) => ({
    id: r.metric.id,
    label: `${acctShort(r.metric.account)} — ${r.metric.format}`,
    plan: r.plan,
    done: r.plan ? r.fact / r.plan : 0,
  }))

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4 mb-5">
        <StatCard highlight label="Общий KPI" value={pct(smm.totalKpi, 1)} foot="FRANCHONE + ANUAR" icon={TrendingUp} />
        <StatCard label="К выплате" value={kzt(payoutVal)} foot="оклад × KPI" icon={Wallet} />
        <StatCard label="KPI FRANCHONE" value={pct(smm.kpiFranchone, 1)} foot="Аккаунт компании" icon={Building2} />
        <StatCard label="KPI ANUAR" value={pct(smm.kpiAnuar, 1)} foot="Личный аккаунт" icon={User} />
      </div>

      <div className="card grid grid-cols-3 divide-x divide-line mb-5">
        <MiniMetric label="План на месяц" value={num(smm.totalPlan)} />
        <MiniMetric label="Опубликовано" value={num(smm.totalFact)} accent />
        <MiniMetric label="Осталось" value={num(Math.max(smm.totalPlan - smm.totalFact, 0))} />
      </div>

      <div className="card overflow-hidden mb-5">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[440px]">
            <thead>
              <tr className="bg-[#e2f2ef]">
                <Th>Показатель</Th>
                <Th right>План</Th>
                <Th right>Выполнение</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-line hover:bg-chip/40 transition-colors">
                  <td className="px-5 py-3 text-sm text-ink-2">{r.label}</td>
                  <td className="px-5 py-3 text-sm text-ink-2 text-right tabular-nums">{r.plan}</td>
                  <td className="px-5 py-3 text-right">
                    <PctChip value={r.done} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

// ——— Таргетолог: аналитика рекламы по новому ТЗ ———
// Раздел KPI для этой должности заменён дашбордом модуля: в ТЗ таргетолога
// нет ни плана, ни веса, ни процента KPI — только бюджет, результат и цена.
function TargetologKpi() {
  return <TargetologDashboard />
}

// KPI отдела продаж — основной экран аналитики (дополнение 1.4, п.1 и п.2).
// Сюда переехало всё, что раньше жило на Дашборде: карточки, LIVE-воронка,
// таблица по объектам и блок активности. У менеджера сверху добавляются его
// личный KPI и предварительный заработок; у руководства их нет — оно смотрит
// агрегат по отделу с фильтрами по менеджеру и объекту.
function SalesKpi({ month }: { month: string }) {
  const { role } = useApp()
  const me = useCurrentUser()
  const { activeEmployees } = useData()
  const manager = role === 'owner' || role === 'head'
  const pay = useQuery(api.payroll.month, manager ? 'skip' : { month })
  const plan = manager ? null : personalPlan(me, pay?.rows?.[0])

  return (
    <>
      {plan && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 mb-5">
          <StatCard highlight label="Мой KPI" value={pct(plan.kpi, 1)} foot={`за ${formatMonth(month)}`} icon={Target} />
          <StatCard
            label="Заработано"
            value={kzt(plan.earned)}
            foot={`предварительно · оклад ${kzt(plan.salary)}`}
            icon={Wallet}
          />
          <StatCard
            label="Выполнение плана"
            value={pct(plan.ratio)}
            foot={`${num(plan.fact)} из ${num(plan.target)} · ${plan.caption}`}
            icon={Percent}
          />
        </div>
      )}

      <SalesDashboardBlock role={role} me={me} employees={activeEmployees} month={month} />
    </>
  )
}

function MiniMetric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="px-4 py-5 text-center">
      <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-1.5">{label}</div>
      <div className={`text-2xl font-bold ${accent ? 'text-green-d' : 'text-ink'}`}>{value}</div>
    </div>
  )
}

function EmptyKpi({ icon: Icon, title, hint }: { icon: LucideIcon; title: string; hint: string }) {
  return (
    <div className="card p-12 text-center">
      <div className="w-14 h-14 rounded-2xl bg-chip grid place-items-center mx-auto mb-4 text-muted">
        <Icon size={24} />
      </div>
      <div className="text-ink font-semibold text-lg mb-1">{title}</div>
      <p className="text-sm text-muted max-w-sm mx-auto">{hint}</p>
    </div>
  )
}

function Th({ children, right }: { children: ReactNode; right?: boolean }) {
  return (
    <th
      className={`px-5 py-3 text-[11px] font-semibold text-green-d uppercase tracking-wide ${
        right ? 'text-right' : 'text-left'
      }`}
    >
      {children}
    </th>
  )
}

// Процент выполнения плана — чипом в тех же цветах, что статусы в «Команде».
function PctChip({ value }: { value: number }) {
  return (
    <span
      className={`chip tabular-nums ${value >= 1 ? 'bg-[#e2f2ef] text-green-d' : 'bg-chip text-ink-2'}`}
    >
      {pct(value, 1)}
    </span>
  )
}

