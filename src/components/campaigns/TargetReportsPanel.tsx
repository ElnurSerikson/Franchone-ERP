import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { History, Loader2, Pencil, X, ShieldAlert } from 'lucide-react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { goalMeta, dollarsToCents } from '../../../convex/campaignGoals'
import { num, usd, usdCost, longDate } from '@/lib/format'
import { reportTime } from '@/lib/reports'
import { errMessage } from '@/lib/errors'
import { th, thRight, td, theadRow } from '@/lib/table'

// Отправленные отчёты таргетолога и административные исправления
// (ТЗ таргетолога §9.3, §14, §16). Отправленный отчёт правит только владелец
// и только с указанием причины; старое и новое значение остаются в журнале.

export default function TargetReportsPanel() {
  const history = useQuery(api.target.history, { limit: 30 })
  const [openId, setOpenId] = useState<Id<'targetReports'> | null>(null)

  return (
    <section className="card overflow-hidden">
      <div className="px-5 py-3 border-b border-line flex items-center gap-2">
        <History size={17} className="text-green" />
        <h3 className="sec-title flex-1">Отправленные отчёты</h3>
      </div>

      {history === undefined ? (
        <div className="p-8 grid place-items-center text-muted">
          <Loader2 className="animate-spin" size={18} />
        </div>
      ) : history.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted">
          Отправленных отчётов пока нет.
        </div>
      ) : (
        <div className="divide-y divide-line">
          {history.map((h) => (
            <button
              key={h._id}
              type="button"
              onClick={() => setOpenId(h._id)}
              className="w-full px-5 py-3 flex items-center gap-3 text-left hover:bg-chip/40 transition-colors"
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-ink">{longDate(h.date)}</div>
                <div className="text-[11px] text-muted">
                  {h.author} · {reportTime(h.submittedAt ?? 0)}
                </div>
              </div>
              <span className="chip bg-chip text-muted-2 shrink-0">Открыть</span>
            </button>
          ))}
        </div>
      )}

      {openId && <ReportDrawer reportId={openId} onClose={() => setOpenId(null)} />}
    </section>
  )
}

function ReportDrawer({
  reportId,
  onClose,
}: {
  reportId: Id<'targetReports'>
  onClose: () => void
}) {
  const data = useQuery(api.target.reportDetail, { reportId })
  const correct = useMutation(api.target.correctRow)
  const [editing, setEditing] = useState<string | null>(null)
  const [budget, setBudget] = useState('')
  const [result, setResult] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const save = async (rowId: Id<'targetReportRows'>) => {
    setError('')
    if (!reason.trim()) {
      setError('Укажите причину исправления — без неё правка не сохраняется.')
      return
    }
    setSaving(true)
    try {
      await correct({
        rowId,
        budgetCents: dollarsToCents(Number(budget) || 0),
        result: Math.max(0, Math.floor(Number(result) || 0)),
        reason,
      })
      setEditing(null)
      setReason('')
    } catch (e) {
      setError(errMessage(e, 'Не удалось сохранить исправление.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-2xl h-full bg-bg flex flex-col">
        <div className="shrink-0 bg-white border-b border-line px-5 sm:px-6 py-4 flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold text-ink truncate">
              {data ? longDate(data.date) : 'Отчёт'}
            </h2>
            <p className="text-[11px] text-muted">
              {data ? `${data.author} · отправлен ${reportTime(data.submittedAt ?? 0)}` : '—'}
            </p>
          </div>
          <button onClick={onClose} className="ico-btn w-9 h-9" aria-label="Закрыть">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-5">
          {data === undefined ? (
            <div className="py-10 grid place-items-center text-muted">
              <Loader2 className="animate-spin" size={18} />
            </div>
          ) : data === null ? (
            <p className="text-sm text-muted">Отчёт не найден или недоступен.</p>
          ) : (
            <>
              {data.canCorrect && (
                <div className="rounded-xl bg-[#fff6e6] px-4 py-3 mb-4 text-sm text-[#b7791f] flex items-start gap-2">
                  <ShieldAlert size={16} className="mt-0.5 shrink-0" />
                  <span>
                    Исправление отправленного отчёта требует причины. Старое и новое значения
                    сохранятся в журнале и останутся видны здесь.
                  </span>
                </div>
              )}

              <div className="card overflow-hidden mb-4">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px]">
                    <thead>
                      <tr className={theadRow}>
                        <th className={th}>Кампания</th>
                        <th className={thRight}>Бюджет</th>
                        <th className={thRight}>Результат</th>
                        <th className={thRight}>Цена</th>
                        {data.canCorrect && <th className={th} />}
                      </tr>
                    </thead>
                    <tbody>
                      {data.rows.map((r) => (
                        <tr key={r.rowId} className="align-top">
                          <td className={td}>
                            <div className="font-medium text-ink whitespace-nowrap">
                              {r.objectName ?? r.name}
                            </div>
                            <div className="text-[11px] text-muted whitespace-nowrap">
                              {r.name} · {goalMeta(r.goal ?? undefined).metric}
                            </div>
                          </td>
                          <td className={`${td} text-right tabular-nums`}>{usd(r.budgetCents)}</td>
                          <td className={`${td} text-right tabular-nums`}>{num(r.result)}</td>
                          <td className={`${td} text-right tabular-nums font-semibold text-ink whitespace-nowrap`}>
                            {usdCost(r.costCents)}
                          </td>
                          {data.canCorrect && (
                            <td className={td}>
                              <button
                                onClick={() => {
                                  setEditing(r.rowId)
                                  setBudget((r.budgetCents / 100).toFixed(2))
                                  setResult(String(r.result))
                                  setReason('')
                                  setError('')
                                }}
                                className="ico-btn w-8 h-8"
                                title="Исправить"
                                aria-label="Исправить строку"
                              >
                                <Pencil size={14} />
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {editing && (
                <div className="card p-4 mb-4">
                  <div className="text-sm font-semibold text-ink mb-3">Исправление строки</div>
                  <div className="grid gap-3 sm:grid-cols-2 mb-3">
                    <label className="block">
                      <span className="text-[11px] font-semibold text-muted uppercase tracking-wide">
                        Бюджет, $
                      </span>
                      <input
                        type="number"
                        step="0.01"
                        min={0}
                        value={budget}
                        onChange={(e) => setBudget(e.target.value)}
                        className="w-full h-9 mt-1 px-2 rounded-lg border border-line-2 text-sm focus:outline-none focus:border-green-light"
                      />
                    </label>
                    <label className="block">
                      <span className="text-[11px] font-semibold text-muted uppercase tracking-wide">
                        Результат
                      </span>
                      <input
                        type="number"
                        min={0}
                        value={result}
                        onChange={(e) => setResult(e.target.value)}
                        className="w-full h-9 mt-1 px-2 rounded-lg border border-line-2 text-sm focus:outline-none focus:border-green-light"
                      />
                    </label>
                  </div>
                  <label className="block mb-3">
                    <span className="text-[11px] font-semibold text-muted uppercase tracking-wide">
                      Причина исправления
                    </span>
                    <input
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Например: таргетолог ошибся на порядок в бюджете"
                      className="w-full h-9 mt-1 px-2 rounded-lg border border-line-2 text-sm focus:outline-none focus:border-green-light"
                    />
                  </label>
                  {error && <p className="text-sm text-[#c53030] mb-3">{error}</p>}
                  <div className="flex gap-2">
                    <button onClick={() => setEditing(null)} className="btn btn-ghost h-9 px-3 text-sm">
                      Отмена
                    </button>
                    <button
                      onClick={() => save(editing as Id<'targetReportRows'>)}
                      disabled={saving}
                      className="btn btn-green h-9 px-3 text-sm disabled:opacity-60"
                    >
                      {saving && <Loader2 size={14} className="animate-spin" />}
                      Сохранить исправление
                    </button>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between gap-3 mb-4 px-1">
                <span className="text-sm text-muted">Общий бюджет за день</span>
                <span className="text-lg font-bold text-ink tabular-nums">
                  {usd(data.totalBudgetCents)}
                </span>
              </div>

              {data.comment && (
                <div className="rounded-xl bg-chip px-4 py-3 mb-4">
                  <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-1">
                    Комментарий
                  </div>
                  <div className="text-sm text-ink-2">{data.comment}</div>
                </div>
              )}

              {/* Журнал аудита: показываем только там, где правки были. */}
              {data.rows.some((r) => r.audit.length > 0) && (
                <div className="card p-4">
                  <div className="text-sm font-semibold text-ink mb-3">Журнал исправлений</div>
                  <div className="flex flex-col gap-3">
                    {data.rows.flatMap((r) =>
                      r.audit.map((a, i) => (
                        <div key={`${r.rowId}:${i}`} className="border-l-2 border-line-2 pl-3">
                          <div className="text-sm text-ink">
                            <b>{r.name}</b> · {usd(a.fromBudgetCents)} / {num(a.fromResult)} →{' '}
                            {usd(a.toBudgetCents)} / {num(a.toResult)}
                          </div>
                          <div className="text-[11px] text-muted">
                            {a.by} · {reportTime(a.at)} · {a.reason}
                          </div>
                        </div>
                      )),
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
