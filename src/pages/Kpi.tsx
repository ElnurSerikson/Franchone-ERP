import { useState, type ReactNode } from 'react'
import { useQuery } from 'convex/react'
import {
  TrendingUp, Wallet, Building2, User, Users, Target,
  ShoppingCart, Percent, Receipt, Loader2, type LucideIcon,
} from 'lucide-react'
import { api } from '../../convex/_generated/api'
import type { Campaign, SmmMetric } from '@/types'
import PageHeader from '@/components/PageHeader'
import StatCard from '@/components/ui/StatCard'
import { useData } from '@/lib/useData'
import { computeSmm, computeTargetolog, spendBySource } from '@/lib/kpi'
import { kzt, num, pct } from '@/lib/format'

// Базы выплат (KPI_SMM / KPI_TARGETOLOG). Выплата = база × Итоговый KPI.
const SMM_BASE = 600000
const TARGETOLOG_BASE = 200000

type Dept = 'smm' | 'targetolog' | 'sales'
const DEPTS: { id: Dept; label: string }[] = [
  { id: 'smm', label: 'SMM' },
  { id: 'targetolog', label: 'Таргетолог' },
  { id: 'sales', label: 'Отдел продаж' },
]

const acctShort = (a: string) => (a === 'FRANCHONE' ? 'FR' : a === 'ANUAR' ? 'Anuar' : a)

export default function Kpi() {
  const [dept, setDept] = useState<Dept>('smm')
  const { smmMetrics, campaigns, reportMonth } = useData()

  const subtitle =
    dept === 'smm'
      ? `Контент · FRANCHONE + ANUAR · ${reportMonth}`
      : dept === 'targetolog'
        ? `Реклама · кампании · ${reportMonth}`
        : `Отдел продаж · ${reportMonth}`

  return (
    <>
      <PageHeader
        title="KPI"
        subtitle={subtitle}
        actions={<button className="btn btn-green">{reportMonth}</button>}
      />

      {/* Переключатель отделов (по должности, без имён) */}
      <div className="flex items-center gap-1 p-1 bg-chip rounded-xl w-full sm:w-fit mb-5">
        {DEPTS.map((d) => (
          <button
            key={d.id}
            onClick={() => setDept(d.id)}
            className={`h-9 px-4 rounded-lg text-sm font-semibold transition-colors flex-1 sm:flex-none ${
              dept === d.id ? 'bg-white text-ink shadow-card' : 'text-muted hover:text-ink'
            }`}
          >
            {d.label}
          </button>
        ))}
      </div>

      {dept === 'smm' && <SmmKpi smmMetrics={smmMetrics} reportMonth={reportMonth} />}
      {dept === 'targetolog' && <TargetologKpi campaigns={campaigns} reportMonth={reportMonth} />}
      {dept === 'sales' && <SalesKpi reportMonth={reportMonth} />}
    </>
  )
}

// ——— SMM: контент-KPI (FRANCHONE + ANUAR) ———
function SmmKpi({ smmMetrics, reportMonth }: { smmMetrics: SmmMetric[]; reportMonth: string }) {
  const smm = computeSmm(smmMetrics)
  const payoutVal = Math.round(SMM_BASE * smm.totalKpi)

  const rows = smm.rows.map((r) => ({
    id: r.metric.id,
    label: `${acctShort(r.metric.account)} — ${r.metric.format}`,
    plan: r.plan,
    done: r.plan ? r.fact / r.plan : 0, // выполнение (может быть >100%)
    ratio: r.ratio, // ограничено 100% — для графика
  }))

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4 mb-5">
        <StatCard highlight label="Общий KPI" value={pct(smm.totalKpi, 1)} foot="FRANCHONE + ANUAR" icon={TrendingUp} />
        <StatCard label="К выплате" value={kzt(payoutVal)} foot="600 000 × KPI" icon={Wallet} />
        <StatCard label="KPI FRANCHONE" value={pct(smm.kpiFranchone, 1)} foot="Аккаунт компании" icon={Building2} />
        <StatCard label="KPI ANUAR" value={pct(smm.kpiAnuar, 1)} foot="Личный аккаунт" icon={User} />
      </div>

      <div className="card overflow-hidden mb-5">
        <div className="px-5 py-3.5 border-b border-line">
          <h3 className="sec-title">План и выполнение · {reportMonth}</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[440px]">
            <thead>
              <tr style={{ background: '#04332e' }}>
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
                  <td
                    className="px-5 py-3 text-sm font-bold text-right tabular-nums"
                    style={{ color: r.done >= 1 ? '#057269' : '#1c1d22' }}
                  >
                    {pct(r.done, 1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card p-5">
        <h3 className="sec-title mb-4">Выполнение плана по форматам</h3>
        <BarChart rows={rows} />
      </div>
    </>
  )
}

// ——— Таргетолог: KPI по рекламным кампаниям ———
function TargetologKpi({ campaigns, reportMonth }: { campaigns: Campaign[]; reportMonth: string }) {
  const tg = computeTargetolog(campaigns)
  const src = spendBySource(campaigns)
  const payoutVal = Math.round(TARGETOLOG_BASE * tg.totalKpi)

  return (
    <>
      {/* Главные метрики */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4 mb-5">
        <StatCard highlight label="Общий расход" value={kzt(tg.totalSpend)} foot="реклама за месяц" icon={Wallet} />
        <StatCard label="Деньги FRANCHONE" value={kzt(src.FRANCHONE.spend)} foot="свои услуги" icon={Building2} />
        <StatCard label="Деньги партнёров" value={kzt(src.Партнёр.spend)} foot="партнёрские проекты" icon={Users} />
        <StatCard label="Заявки" value={num(tg.totalLeads)} foot="всего за месяц" icon={Target} />
      </div>

      {/* Доп. метрики — компактной полосой */}
      <div className="card grid grid-cols-3 divide-x divide-line mb-5">
        <MiniMetric label="Средний CPL" value={kzt(tg.avgCpl)} />
        <MiniMetric label="Общий KPI" value={pct(tg.totalKpi, 1)} accent />
        <MiniMetric label="Выплата" value={kzt(payoutVal)} />
      </div>

      {/* Кампании */}
      <div className="card overflow-hidden">
        <div className="px-5 py-3.5 border-b border-line">
          <h3 className="sec-title">Кампании · {reportMonth}</h3>
        </div>
        {campaigns.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted">
            Нет активных кампаний. Добавьте кампании, чтобы наполнить показатели.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px]">
              <thead>
                <tr style={{ background: '#04332e' }}>
                  <Th>Кампания</Th>
                  <Th>Источник</Th>
                  <Th right>Бюджет</Th>
                  <Th right>Заявки</Th>
                  <Th right>CPL</Th>
                  <Th right>KPI</Th>
                </tr>
              </thead>
              <tbody>
                {tg.rows.map((r) => (
                  <tr key={r.campaign.id} className="border-t border-line hover:bg-chip/40 transition-colors">
                    <td className="px-5 py-3 text-sm text-ink-2">
                      <span className="font-medium text-ink">{r.campaign.brand}</span>
                      <span className="text-xs text-muted ml-1.5">{r.campaign.id}</span>
                    </td>
                    <td className="px-5 py-3 text-sm">
                      <span
                        className={`chip ${
                          r.campaign.moneySource === 'FRANCHONE' ? 'bg-[#e2f2ef] text-green-d' : 'bg-chip text-ink-2'
                        }`}
                      >
                        {r.campaign.moneySource}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-sm text-ink-2 text-right tabular-nums">{kzt(r.campaign.factBudget)}</td>
                    <td className="px-5 py-3 text-sm text-ink-2 text-right tabular-nums">{num(r.campaign.factLeads)}</td>
                    <td className="px-5 py-3 text-sm text-ink-2 text-right tabular-nums">{kzt(r.factCpl)}</td>
                    <td className="px-5 py-3 text-sm font-bold text-ink text-right tabular-nums">{pct(r.kpi, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}

// ——— Отдел продаж: результаты + воронка (данные из ежедневных отчётов §3.3) ———
function SalesKpi({ reportMonth }: { reportMonth: string }) {
  const s = useQuery(api.sales.summary, {})
  if (s === undefined)
    return (
      <div className="card p-10 grid place-items-center text-muted">
        <Loader2 className="animate-spin" size={20} />
      </div>
    )

  const { leads, meetings, deals, revenue, days } = s

  if (days === 0)
    return (
      <EmptyKpi
        icon={ShoppingCart}
        title="Пока нет данных по продажам"
        hint="Показатели соберутся из ежедневных отчётов отдела продаж (§3.3): заявки, звонки/встречи, сделки и выручка."
      />
    )

  const conv = leads ? deals / leads : 0
  const avgCheck = deals ? revenue / deals : 0
  const funnel = [
    { label: 'Заявки', value: leads, color: '#057269' },
    { label: 'Звонки / встречи', value: meetings, color: '#0a857a' },
    { label: 'Сделки', value: deals, color: '#4db3a6' },
  ]

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4 mb-5">
        <StatCard highlight label="Выручка" value={kzt(revenue)} foot="за месяц" icon={Wallet} />
        <StatCard label="Сделок" value={num(deals)} foot="закрыто за месяц" icon={ShoppingCart} />
        <StatCard label="Конверсия" value={pct(conv, 1)} foot="заявка → сделка" icon={Percent} />
        <StatCard label="Средний чек" value={kzt(avgCheck)} foot="выручка / сделки" icon={Receipt} />
      </div>

      <div className="card grid grid-cols-3 divide-x divide-line mb-5">
        <MiniMetric label="Заявка → встреча" value={pct(leads ? meetings / leads : 0, 0)} />
        <MiniMetric label="Встреча → сделка" value={pct(meetings ? deals / meetings : 0, 0)} accent />
        <MiniMetric label="Сделок за месяц" value={num(deals)} />
      </div>

      <div className="card p-5">
        <h3 className="sec-title mb-4">Воронка продаж · {reportMonth}</h3>
        <div className="flex flex-col gap-3.5">
          {funnel.map((st, i) => (
            <div key={st.label}>
              <div className="flex items-baseline justify-between text-sm mb-1.5">
                <span className="text-ink-2">{st.label}</span>
                <span className="font-semibold text-ink tabular-nums">
                  {num(st.value)}
                  {i > 0 && leads ? (
                    <span className="text-muted font-normal"> · {pct(st.value / leads, 0)}</span>
                  ) : null}
                </span>
              </div>
              <div className="h-3.5 rounded-full bg-line overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${leads ? Math.max((st.value / leads) * 100, 2) : 0}%`, background: st.color }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
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
      className={`px-5 py-3 text-[11px] font-semibold text-white/85 uppercase tracking-wide ${
        right ? 'text-right' : 'text-left'
      }`}
    >
      {children}
    </th>
  )
}

// Лёгкий SVG-столбчатый график (без внешних библиотек). Высоты — по r.ratio
// (ограничено 100%, как в KPI); подпись оси Y 0…100%.
function BarChart({ rows }: { rows: { id: string; label: string; ratio: number }[] }) {
  const W = 760
  const H = 300
  const padL = 42
  const padR = 14
  const padT = 16
  const padB = 52
  const plotW = W - padL - padR
  const plotH = H - padT - padB
  const yOf = (v: number) => padT + plotH * (1 - v)
  const bw = (plotW / rows.length) * 0.5
  const grid = [0, 0.25, 0.5, 0.75, 1]

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[520px]" role="img" aria-label="Выполнение плана по форматам">
        {grid.map((g) => (
          <g key={g}>
            <line x1={padL} y1={yOf(g)} x2={W - padR} y2={yOf(g)} stroke="#eef0f1" strokeWidth={1} />
            <text x={padL - 8} y={yOf(g) + 4} textAnchor="end" fontSize={11} fill="#9498a1">
              {Math.round(g * 100)}%
            </text>
          </g>
        ))}

        {rows.map((r, i) => {
          const cx = padL + (plotW * (i + 0.5)) / rows.length
          const h = plotH * r.ratio
          return (
            <g key={r.id}>
              <rect x={cx - bw / 2} y={yOf(r.ratio)} width={bw} height={h} rx={3} fill="#057269" />
              <text x={cx} y={H - padB + 20} textAnchor="middle" fontSize={10.5} fill="#3a3d44">
                {r.label}
              </text>
            </g>
          )
        })}

        <line x1={padL} y1={yOf(0)} x2={W - padR} y2={yOf(0)} stroke="#d7dade" strokeWidth={1} />
      </svg>
    </div>
  )
}
