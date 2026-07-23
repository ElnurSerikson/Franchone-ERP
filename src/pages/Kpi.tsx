import type { ReactNode } from 'react'
import { TrendingUp, Wallet, Building2, User } from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import StatCard from '@/components/ui/StatCard'
import { useData } from '@/lib/useData'
import { computeSmm } from '@/lib/kpi'
import { kzt, pct } from '@/lib/format'

// База выплаты за контент (KPI_SMM). Выплата = база × Итоговый KPI.
const SMM_BASE = 600000

const acctShort = (a: string) => (a === 'FRANCHONE' ? 'FR' : a === 'ANUAR' ? 'Anuar' : a)

export default function Kpi() {
  const { smmMetrics, reportMonth } = useData()
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
      <PageHeader
        title="KPI"
        subtitle={`Контент · FRANCHONE + ANUAR · ${reportMonth}`}
        actions={<button className="btn btn-green">{reportMonth}</button>}
      />

      {/* ——— 4 большие метрики ——— */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4 mb-5">
        <StatCard highlight label="Общий KPI" value={pct(smm.totalKpi, 1)} foot="FRANCHONE + ANUAR" icon={TrendingUp} />
        <StatCard label="К выплате" value={kzt(payoutVal)} foot="600 000 × KPI" icon={Wallet} />
        <StatCard label="KPI FRANCHONE" value={pct(smm.kpiFranchone, 1)} foot="Аккаунт компании" icon={Building2} />
        <StatCard label="KPI ANUAR" value={pct(smm.kpiAnuar, 1)} foot="Личный аккаунт" icon={User} />
      </div>

      {/* ——— Таблица: план / выполнение ——— */}
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
                  <td className="px-5 py-3 text-sm font-bold text-right tabular-nums" style={{ color: r.done >= 1 ? '#057269' : '#1c1d22' }}>
                    {pct(r.done, 1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ——— График: выполнение по форматам ——— */}
      <div className="card p-5">
        <h3 className="sec-title mb-4">Выполнение плана по форматам</h3>
        <BarChart rows={rows} />
      </div>
    </>
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
