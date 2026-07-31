import { useQuery } from 'convex/react'
import { X, Loader2, Megaphone } from 'lucide-react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import LineChart, { type ChartSeries } from '@/components/ui/LineChart'
import { goalMeta } from '../../../convex/campaignGoals'
import { num, usd, usdCost, longDate } from '@/lib/format'
import { reportTime } from '@/lib/reports'
import { th, thRight, td, theadRow } from '@/lib/table'

// Связанные кампании и история показателей объекта продаж (ТЗ таргетолога
// §6.3). Период намеренно не ограничен: §10 требует, чтобы по объекту можно
// было восстановить всю маркетинговую активность за любой срок.

const STATUS_CHIP: Record<string, string> = {
  Активна: 'bg-[#e2f2ef] text-green-d',
  Пауза: 'bg-[#fff6e6] text-[#b7791f]',
  Завершена: 'bg-chip text-muted',
}

type CampaignRow = {
  _id: string
  code: string
  goal: string | null
  account: string
  moneySource: string
  status: string
  archived: boolean
  startedAt: string | null
  endedAt: string | null
  days: number
  budgetCents: number
  result: number
  costCents: number | null
  statusHistory: { from: string | null; to: string; at: number }[]
}

type SeriesRow = {
  campaignId: string
  code: string
  goal: string | null
  points: { date: string; budgetCents: number; result: number; costCents: number | null }[]
}

export default function SalesObjectHistoryDrawer({
  objectId,
  onClose,
}: {
  objectId: Id<'salesObjects'>
  onClose: () => void
}) {
  const data = useQuery(api.target.objectHistory, { objectId })

  const series: ChartSeries[] = ((data?.series ?? []) as SeriesRow[]).map((s) => ({
    id: s.campaignId,
    label: `${s.code} · ${goalMeta(s.goal ?? undefined).metric}`,
    points: s.points.map((p) => ({
      x: p.date,
      y: p.costCents === null ? null : p.costCents / 100,
      hint: `${usd(p.budgetCents)} · ${num(p.result)} → ${usdCost(p.costCents)}`,
    })),
  }))

  const campaigns = (data?.campaigns ?? []) as CampaignRow[]

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-5xl h-full bg-bg flex flex-col">
        <div className="shrink-0 bg-white border-b border-line px-5 sm:px-6 py-4 flex items-center gap-3">
          <span className="w-9 h-9 rounded-xl bg-[#e2f2ef] text-green-d grid place-items-center shrink-0">
            <Megaphone size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold text-ink truncate">
              {data?.objectName || 'Объект продаж'}
            </h2>
            <p className="text-[11px] text-muted">Кампании и история показателей за всё время</p>
          </div>
          <button onClick={onClose} className="ico-btn w-9 h-9" aria-label="Закрыть">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-5 flex flex-col gap-5">
          {data === undefined ? (
            <div className="py-10 grid place-items-center text-muted">
              <Loader2 className="animate-spin" size={18} />
            </div>
          ) : campaigns.length === 0 ? (
            <div className="card p-8 text-center">
              <div className="sec-title mb-1">На этот объект реклама не запускалась</div>
              <p className="text-sm text-muted max-w-md mx-auto">
                Кампании появятся здесь, как только таргетолог заведёт их в реестре и выберет
                этот объект продаж.
              </p>
            </div>
          ) : (
            <>
              <div className="rounded-2xl border border-line bg-white p-4 flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                    Потрачено на объект за всё время
                  </div>
                  <div className="text-[11px] text-muted-2 mt-0.5">
                    {campaigns.length} {campaigns.length === 1 ? 'кампания' : 'кампаний'}
                  </div>
                </div>
                <div className="text-2xl font-bold text-ink tabular-nums">
                  {usd(data.totalBudgetCents)}
                </div>
              </div>

              <section>
                {/* Заголовок вне карточки: иначе над зелёной шапкой таблицы
                    остаётся белая полоса. */}
                <h3 className="sec-title mb-3">Связанные кампании</h3>
                <div className="card overflow-hidden overflow-x-auto">
                  <table className="w-full min-w-[760px]">
                    <thead>
                      <tr className={theadRow}>
                        <th className={th}>Кампания</th>
                        <th className={th}>Аккаунт</th>
                        <th className={th}>Деньги</th>
                        <th className={th}>Период</th>
                        <th className={thRight}>Расход</th>
                        <th className={thRight}>Результат</th>
                        <th className={thRight}>Цена</th>
                      </tr>
                    </thead>
                    <tbody>
                      {campaigns.map((c) => (
                        <tr key={c._id}>
                          <td className={td}>
                            <div className="flex items-center gap-2">
                              <span className="chip bg-[#e2f2ef] text-green-d whitespace-nowrap">
                                {c.code}
                              </span>
                              <span
                                className={`chip whitespace-nowrap ${STATUS_CHIP[c.status] ?? 'bg-chip text-ink-2'}`}
                              >
                                {c.status}
                              </span>
                            </div>
                            <div className="text-[11px] text-muted mt-1 whitespace-nowrap">
                              {goalMeta(c.goal ?? undefined).label}
                            </div>
                          </td>
                          <td className={td}>{c.account}</td>
                          <td className={td}>
                            <span
                              className={`chip ${
                                c.moneySource === 'FRANCHONE'
                                  ? 'bg-[#e2f2ef] text-green-d'
                                  : 'bg-chip text-ink-2'
                              }`}
                            >
                              {c.moneySource}
                            </span>
                          </td>
                          <td className={`${td} whitespace-nowrap`}>
                            <div>{c.startedAt ? longDate(c.startedAt) : '—'}</div>
                            <div className="text-[11px] text-muted">
                              {c.endedAt ? `по ${longDate(c.endedAt)}` : `дней с данными: ${c.days}`}
                            </div>
                          </td>
                          <td className={`${td} text-right tabular-nums`}>{usd(c.budgetCents)}</td>
                          <td className={`${td} text-right tabular-nums`}>
                            <div>{num(c.result)}</div>
                            <div className="text-[11px] text-muted whitespace-nowrap">
                              {goalMeta(c.goal ?? undefined).metric}
                            </div>
                          </td>
                          <td className={`${td} text-right tabular-nums font-semibold text-ink whitespace-nowrap`}>
                            {usdCost(c.costCents)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="card p-5">
                <h3 className="sec-title mb-1">История стоимости результата</h3>
                <p className="text-xs text-muted mb-4">
                  Линия на кампанию. Разные цели сравниваем визуально — их результаты
                  несопоставимы по единицам.
                </p>
                <LineChart
                  series={series}
                  formatY={(v) => '$' + v.toFixed(2)}
                  emptyHint="По этому объекту отчётов ещё нет"
                />
              </section>

              {/* §10.1: для статуса кампании хранится дата и время изменения —
                  по ним видно, когда именно реклама работала. */}
              {campaigns.some((c) => c.statusHistory.length > 0) && (
                <section className="card p-5">
                  <h3 className="sec-title mb-3">История статусов</h3>
                  <div className="flex flex-col gap-2">
                    {campaigns.flatMap((c) =>
                      c.statusHistory.map((h, i) => (
                        <div key={`${c._id}:${i}`} className="text-sm text-ink-2 flex gap-2">
                          <span className="chip bg-[#e2f2ef] text-green-d shrink-0">{c.code}</span>
                          <span className="flex-1">
                            {h.from ? `${h.from} → ${h.to}` : `запуск · ${h.to}`}
                          </span>
                          <span className="text-[11px] text-muted shrink-0">{reportTime(h.at)}</span>
                        </div>
                      )),
                    )}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
