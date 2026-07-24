import { useState } from 'react'
import { useQuery } from 'convex/react'
import { ChevronLeft, ChevronRight, Loader2, CalendarRange } from 'lucide-react'
import { api } from '../../../convex/_generated/api'
import { computeSmm } from '@/lib/kpi'
import { mapSmm } from '@/lib/mappers'
import { num, pct } from '@/lib/format'
import { CURRENT_MONTH, addMonth, formatMonth } from '@/lib/month'
import { th, thRight, td, theadRow } from '@/lib/table'

// Недельные окна из KPI_SMM.xlsx: блоки «НЕДЕЛЯ 1…5» на дашборде плюс
// разбивка листа «Недельные планы» по каждому из шести форматов.
// KPI недели = Σ[МИН(факт/план;1) × вес] / Σ[вес где план>0] — нормировка
// нужна, чтобы неделя без плана по формату не занижала результат.
export default function WeeklyWindows() {
  const [month, setMonth] = useState(CURRENT_MONTH)
  const raw = useQuery(api.smm.list, { month })
  const atCurrent = month >= CURRENT_MONTH

  const metrics = (raw ?? []).map(mapSmm)
  const res = metrics.length ? computeSmm(metrics) : null

  const weeks = [0, 1, 2, 3, 4].map((w) => ({
    idx: w,
    plan: metrics.reduce((s, m) => s + (m.weekPlans[w] ?? 0), 0),
    fact: metrics.reduce((s, m) => s + (m.weekFacts[w] ?? 0), 0),
    kpi: res?.weekKpi[w] ?? 0,
  }))

  return (
    <div className="flex flex-col gap-5">
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <CalendarRange size={18} className="text-green" />
          <h3 className="sec-title flex-1">Недели месяца · {formatMonth(month)}</h3>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setMonth(addMonth(month, -1))}
              className="ico-btn w-9 h-9"
              aria-label="Предыдущий месяц"
              title="Предыдущий месяц"
            >
              <ChevronLeft size={16} />
            </button>
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
        </div>

        {raw === undefined ? (
          <div className="p-8 grid place-items-center text-muted">
            <Loader2 className="animate-spin" size={20} />
          </div>
        ) : metrics.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted">
            За этот месяц недельные планы не заведены. Задайте их в «Настройках» — блок
            «Планы и веса KPI · SMM».
          </p>
        ) : (
          <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
            {weeks.map((w) => (
              <WeekCard key={w.idx} n={w.idx + 1} kpi={w.kpi} fact={w.fact} plan={w.plan} />
            ))}
          </div>
        )}
      </div>

      {metrics.length > 0 && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px]">
              <thead>
                <tr className={theadRow}>
                  <th className={th}>Показатель</th>
                  {weeks.map((w) => (
                    <th key={w.idx} className={thRight}>
                      Нед. {w.idx + 1}
                    </th>
                  ))}
                  <th className={thRight}>Мес.</th>
                </tr>
              </thead>
              <tbody>
                {metrics.map((m) => (
                  <tr key={m.id} className="hover:bg-chip/40 transition-colors">
                    <td className={td}>
                      <span className="font-medium text-ink">{m.account}</span> · {m.format}
                    </td>
                    {weeks.map((w) => (
                      <td key={w.idx} className={`${td} text-right tabular-nums`}>
                        <WeekCell fact={m.weekFacts[w.idx] ?? 0} plan={m.weekPlans[w.idx] ?? 0} />
                      </td>
                    ))}
                    <td className={`${td} text-right tabular-nums`}>
                      <WeekCell
                        fact={m.weekFacts.reduce((s, x) => s + x, 0)}
                        plan={m.weekPlans.reduce((s, x) => s + x, 0)}
                        strong
                      />
                    </td>
                  </tr>
                ))}
                <tr className="bg-chip/40">
                  <td className={`${td} font-semibold text-ink`}>KPI недели</td>
                  {weeks.map((w) => (
                    <td key={w.idx} className={`${td} text-right font-bold text-green-d tabular-nums`}>
                      {pct(w.kpi, 1)}
                    </td>
                  ))}
                  <td className={`${td} text-right font-bold text-green-d tabular-nums`}>
                    {pct(res?.totalKpi ?? 0, 1)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function WeekCard({ n, kpi, fact, plan }: { n: number; kpi: number; fact: number; plan: number }) {
  // Неделя без плана не считается провалом — она просто ещё не наступила
  // либо намеренно оставлена пустой (пятая неделя в модели).
  const idle = plan === 0
  return (
    <div className={`rounded-2xl border p-4 ${idle ? 'border-line bg-chip/40' : 'border-line'}`}>
      <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-1.5">
        Неделя {n}
      </div>
      <div className={`text-2xl font-extrabold leading-none ${idle ? 'text-muted-2' : 'text-ink'}`}>
        {idle ? '—' : pct(kpi, 1)}
      </div>
      <div className="text-[11px] text-muted mt-2 tabular-nums">
        Факт {num(fact)} / План {num(plan)}
      </div>
    </div>
  )
}

function WeekCell({ fact, plan, strong }: { fact: number; plan: number; strong?: boolean }) {
  if (plan === 0 && fact === 0) return <span className="text-muted-2">—</span>
  return (
    <span className={strong ? 'font-semibold text-ink' : ''}>
      {num(fact)}
      <span className="text-muted font-normal"> / {num(plan)}</span>
    </span>
  )
}
