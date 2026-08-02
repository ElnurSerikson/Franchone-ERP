import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { X, Loader2, Megaphone, Plus, Link2 } from 'lucide-react'
import CampaignDrawer from './CampaignDrawer'
import { errMessage } from '@/lib/errors'
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
  name: string
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
  name: string
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
  // Реестр нужен, чтобы предложить уже существующие кампании: у части из них
  // объект не выбран, и владельцу проще привязать их отсюда, чем искать в
  // реестре и открывать каждую карточку.
  const registry = useQuery(api.target.registry, {})
  const update = useMutation(api.target.updateCampaign)
  const [creating, setCreating] = useState(false)
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const linkable = (registry ?? []).filter((c) => c.objectId !== objectId)
  const link = async (id: Id<'campaigns'>) => {
    setBusy(id)
    setError('')
    try {
      await update({ id, objectId })
      setPicking(false)
    } catch (e) {
      setError(errMessage(e, 'Не удалось привязать кампанию.'))
    } finally {
      setBusy('')
    }
  }

  const series: ChartSeries[] = ((data?.series ?? []) as SeriesRow[]).map((s) => ({
    id: s.campaignId,
    label: `${s.name} · ${goalMeta(s.goal ?? undefined).metric}`,
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
          <button
            onClick={() => setPicking((v) => !v)}
            className="btn btn-ghost h-9 px-3 text-xs shrink-0"
            title="Привязать существующую кампанию"
          >
            <Link2 size={14} /> Привязать
          </button>
          <button
            onClick={() => setCreating(true)}
            className="btn btn-green h-9 px-3 text-xs shrink-0"
            title="Завести кампанию на этот объект"
          >
            <Plus size={14} /> Кампания
          </button>
          <button onClick={onClose} className="ico-btn w-9 h-9" aria-label="Закрыть">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-5 flex flex-col gap-5">
          {error && <p className="text-sm text-[#c53030]">{error}</p>}

          {picking && (
            <section className="card p-5">
              <h3 className="sec-title mb-1">Привязать существующую кампанию</h3>
              <p className="text-xs text-muted mb-4">
                Кампании без объекта показаны первыми. Если у кампании уже есть другой объект,
                привязка перенесёт её сюда вместе со всей накопленной историей.
              </p>
              {linkable.length === 0 ? (
                <p className="text-sm text-muted">Свободных кампаний нет — заведите новую.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {[...linkable]
                    .sort((a, b) => Number(!!a.objectId) - Number(!!b.objectId))
                    .map((c) => (
                      <div
                        key={c._id}
                        className="flex items-center gap-2 rounded-xl border border-line p-2.5"
                      >
                        <span className="chip bg-[#e2f2ef] text-green-d whitespace-nowrap">
                          {c.name}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm text-ink truncate">
                            {goalMeta(c.goal).label}
                          </div>
                          <div className="text-[11px] text-muted truncate">
                            {c.objectName ? `сейчас: ${c.objectName}` : 'объект не выбран'} ·{' '}
                            {c.account} · {c.status}
                          </div>
                        </div>
                        <button
                          onClick={() => link(c._id)}
                          disabled={busy === c._id}
                          className="btn btn-ghost h-8 px-3 text-xs shrink-0 disabled:opacity-60"
                        >
                          {busy === c._id ? <Loader2 size={13} className="animate-spin" /> : null}
                          Привязать
                        </button>
                      </div>
                    ))}
                </div>
              )}
            </section>
          )}

          {data === undefined ? (
            <div className="py-10 grid place-items-center text-muted">
              <Loader2 className="animate-spin" size={18} />
            </div>
          ) : campaigns.length === 0 ? (
            <div className="card p-8 text-center">
              <div className="sec-title mb-1">На этот объект реклама не запускалась</div>
              <p className="text-sm text-muted max-w-md mx-auto">
                Заведите кампанию кнопкой сверху или привяжите уже существующую — например ту,
                у которой объект ещё не выбран.
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
                                {c.name}
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
                          <span className="chip bg-[#e2f2ef] text-green-d shrink-0">{c.name}</span>
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

      {creating && (
        <CampaignDrawer
          campaign={null}
          presetObjectId={objectId}
          onClose={() => setCreating(false)}
        />
      )}
    </div>
  )
}
