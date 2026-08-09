// §7.4: KPI упаковщика по каждому проекту и динамика начислений по месяцам.
//
// Живёт в разделе «KPI», а не в панели упаковщика: KPI всех должностей
// собран в одном месте. Цифры всегда за всё время — период здесь не
// фильтруется, потому что строка проекта показывает его полный итог.

import { useQuery } from 'convex/react'
import { Target } from 'lucide-react'
import { api } from '../../../convex/_generated/api'
import { ProgressBar } from '@/components/ui/Progress'
import { kzt } from '@/lib/format'

export default function PackProjectsKpi() {
  const kpi = useQuery(api.packs.kpi, {})
  if (!kpi || kpi.rows.length === 0) return null

  return (
    <section className="card p-5">
      <div className="flex items-center gap-2 mb-4">
        <Target size={16} className="text-green" />
        <h3 className="sec-title">KPI по проектам</h3>
      </div>
      <div className="flex flex-col divide-y divide-line">
        {kpi.rows.map((r) => (
          <div key={r._id} className="py-3 first:pt-0 last:pb-0 flex items-center gap-3 flex-wrap">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-ink truncate">{r.title}</div>
              <div className="text-[11px] text-muted truncate">
                {r.client?.name ?? 'без клиента'} · этапов {r.approvedStages}/{r.mainStages}
              </div>
            </div>
            <div className="w-40 hidden sm:block">
              <ProgressBar value={r.kpi / 100} />
            </div>
            <div className="w-14 text-right text-sm font-bold text-ink tabular-nums">{r.kpi}%</div>
            <div className="w-44 text-right tabular-nums">
              <div className="text-sm font-semibold text-green-d">{kzt(r.accrued)}</div>
              <div className="text-[11px] text-muted">
                выплачено {kzt(r.paid)} · осталось {kzt(Math.max(0, r.left))}
              </div>
            </div>
          </div>
        ))}
      </div>
      {kpi.months.length > 0 && (
        <div className="mt-4 pt-4 border-t border-line">
          <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-2">
            Динамика начислений по месяцам
          </div>
          <div className="flex items-end gap-2 flex-wrap">
            {kpi.months.map((m) => (
              <div key={m.month} className="text-center">
                <div
                  className="w-10 rounded-t-md bg-green"
                  style={{
                    height: Math.max(6, (m.sum / Math.max(...kpi.months.map((x) => x.sum), 1)) * 64),
                  }}
                  title={kzt(m.sum)}
                />
                <div className="text-[10px] text-muted-2 mt-1">{m.month.slice(5)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
