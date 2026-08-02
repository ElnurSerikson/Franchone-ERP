import { useState } from 'react'
import { useMutation } from 'convex/react'
import { AlertTriangle, Check, FilePlus2, Loader2, PencilLine } from 'lucide-react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { goalMeta, resultCostCents } from '../../../convex/campaignGoals'
import { errMessage } from '@/lib/errors'
import { num, usd, usdCost } from '@/lib/format'
import { th, thRight, td, theadRow } from '@/lib/table'
import TargetLeadsForm from './TargetLeadsForm'

// Отчёт таргетолога в модалке администратора (дополнение §2.5, §2.6).
// Отдельный компонент, потому что отчёт таргетолога живёт в собственных
// таблицах модуля, а не в legacy-dailyReports, вокруг которого построен
// ReportView. Здесь администратор видит фактически сданные цифры и может
// внести отчёт за пропущенный день или исправить сданный с указанием причины.

export type TargetDay = {
  date: string
  submittedAt: number | null
  comment: string
  totalBudgetCents: number
  rows: {
    campaignId: string
    name: string
    goal: string | null
    account: string
    moneySource: string
    objectName: string | null
    budgetCents: number
    result: number
    costCents: number | null
    filled: boolean
  }[]
}

const inputCls =
  'w-full h-8 px-2 rounded-lg border border-line-2 text-sm text-right text-ink tabular-nums focus:outline-none focus:border-green-light'

export default function TargetDayAdmin({
  employeeId,
  date,
  target,
  canEdit,
}: {
  employeeId: Id<'employees'>
  date: string
  target: TargetDay
  canEdit: boolean
}) {
  const submitted = target.submittedAt !== null
  const [editing, setEditing] = useState(false)

  if (editing) {
    return (
      <Editor
        employeeId={employeeId}
        date={date}
        target={target}
        // Правка отправленного отчёта требует причины (§9.3); внесение
        // пропущенного — нет, это восстановление, а не подмена цифр.
        needReason={submitted}
        onDone={() => setEditing(false)}
      />
    )
  }

  if (!submitted) {
    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-xl border border-[#f3d9a4] bg-[#fff6e6] p-4 flex flex-col gap-3">
          <div className="flex items-start gap-2.5">
            <AlertTriangle size={18} className="text-[#b7791f] shrink-0 mt-0.5" />
            <div className="text-sm text-[#8a5a12]">
              Отчёт за этот день не сдан. Вы можете внести цифры за сотрудника — отчёт будет
              отмечен «с опозданием».
            </div>
          </div>
          {canEdit && (
            <button onClick={() => setEditing(true)} className="btn btn-green h-9 px-4 text-sm self-start">
              <FilePlus2 size={14} /> Внести отчёт
            </button>
          )}
        </div>
        {target.rows.length === 0 && (
          <p className="text-sm text-muted">
            На эту дату активных кампаний не было — вносить нечего.
          </p>
        )}
        <TargetLeadsForm date={date} employeeId={employeeId} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm text-muted">Кампаний в отчёте: {target.rows.length}</span>
        <div className="flex-1" />
        {canEdit && (
          <button onClick={() => setEditing(true)} className="mini-btn">
            <PencilLine size={13} /> Редактировать
          </button>
        )}
      </div>

      <div className="rounded-xl border border-line overflow-hidden overflow-x-auto">
        <table className="w-full min-w-[560px]">
          <thead>
            <tr className={theadRow}>
              <th className={th}>Кампания</th>
              <th className={thRight}>Бюджет</th>
              <th className={thRight}>Результат</th>
              <th className={thRight}>Цена</th>
            </tr>
          </thead>
          <tbody>
            {target.rows.map((r) => (
              <tr key={r.campaignId}>
                <td className={td}>
                  <div className="font-medium text-ink">{r.name}</div>
                  <div className="text-[11px] text-muted">
                    {r.objectName ? `${r.objectName} · ` : ''}
                    {goalMeta(r.goal ?? undefined).metric}
                  </div>
                </td>
                <td className={`${td} text-right tabular-nums`}>{usd(r.budgetCents)}</td>
                <td className={`${td} text-right tabular-nums`}>{num(r.result)}</td>
                <td className={`${td} text-right tabular-nums font-semibold text-ink whitespace-nowrap`}>
                  {usdCost(r.costCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span className="text-sm text-muted">Общий бюджет за день</span>
        <span className="text-lg font-bold text-ink tabular-nums">{usd(target.totalBudgetCents)}</span>
      </div>

      {target.comment && (
        <div className="rounded-xl bg-chip p-3 text-sm text-ink-2">{target.comment}</div>
      )}

      {/* §6, §15: заявки по объектам за тот же день — администратор может их
          и посмотреть, и исправить. */}
      <TargetLeadsForm date={date} employeeId={employeeId} />
    </div>
  )
}

function Editor({
  employeeId,
  date,
  target,
  needReason,
  onDone,
}: {
  employeeId: Id<'employees'>
  date: string
  target: TargetDay
  needReason: boolean
  onDone: () => void
}) {
  const save = useMutation(api.target.adminSetDay)
  const [vals, setVals] = useState<Record<string, { budget: string; result: string }>>(() =>
    Object.fromEntries(
      target.rows.map((r) => [
        r.campaignId,
        {
          budget: r.filled ? (r.budgetCents / 100).toString() : '',
          result: r.filled ? String(r.result) : '',
        },
      ]),
    ),
  )
  const [comment, setComment] = useState(target.comment)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const parsed = target.rows.map((r) => {
    const raw = vals[r.campaignId] ?? { budget: '', result: '' }
    // Доллары к центам: в базе деньги целыми центами, иначе копейки поплывут.
    const budgetCents = Math.round((Number(raw.budget.replace(',', '.')) || 0) * 100)
    const result = Math.max(0, Math.round(Number(raw.result) || 0))
    return { r, raw, budgetCents, result }
  })
  const totalBudgetCents = parsed.reduce((s, p) => s + p.budgetCents, 0)

  const setVal = (id: string, patch: Partial<{ budget: string; result: string }>) =>
    setVals((p) => ({ ...p, [id]: { ...(p[id] ?? { budget: '', result: '' }), ...patch } }))

  const submit = async () => {
    setError('')
    if (needReason && !reason.trim()) {
      setError('Укажите причину исправления — она сохранится в журнале.')
      return
    }
    setBusy(true)
    try {
      await save({
        employeeId,
        date,
        comment,
        ...(needReason ? { reason: reason.trim() } : {}),
        rows: parsed.map((p) => ({
          campaignId: p.r.campaignId as Id<'campaigns'>,
          budgetCents: p.budgetCents,
          result: p.result,
        })),
      })
      onDone()
    } catch (e) {
      setError(errMessage(e, 'Не удалось сохранить отчёт.'))
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto">
        <div className="min-w-[520px]">
          <div className="grid grid-cols-[1fr_96px_84px_120px] gap-2 px-1 mb-1.5">
            <Lbl>Кампания · объект · цель</Lbl>
            <Lbl right>Бюджет, $</Lbl>
            <Lbl right>Результат</Lbl>
            <Lbl right>Цена</Lbl>
          </div>
          <div className="flex flex-col gap-2">
            {parsed.map(({ r, raw, budgetCents, result }) => (
              <div key={r.campaignId} className="grid grid-cols-[1fr_96px_84px_120px] gap-2 items-center">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink truncate">{r.name}</div>
                  <div className="text-[11px] text-muted truncate">
                    {r.objectName ? `${r.objectName} · ` : ''}
                    <span className="text-green-d font-medium">
                      {goalMeta(r.goal ?? undefined).metric}
                    </span>
                  </div>
                </div>
                <input
                  className={inputCls}
                  inputMode="decimal"
                  placeholder="0"
                  value={raw.budget}
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => setVal(r.campaignId, { budget: e.target.value })}
                />
                <input
                  className={inputCls}
                  inputMode="numeric"
                  placeholder="0"
                  value={raw.result}
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => setVal(r.campaignId, { result: e.target.value })}
                />
                <div className="h-8 flex items-center justify-end px-2.5 text-sm font-semibold text-ink-2 rounded-lg bg-chip whitespace-nowrap">
                  {usdCost(resultCostCents(budgetCents, result, r.goal ?? undefined))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap pt-2 border-t border-line">
        <span className="text-sm text-muted">Общий бюджет за день</span>
        <span className="text-lg font-bold text-ink tabular-nums">{usd(totalBudgetCents)}</span>
      </div>

      <div>
        <Lbl>Комментарий</Lbl>
        <textarea
          rows={2}
          className="w-full rounded-lg border border-line-2 px-3 py-2 text-sm text-ink mt-1 resize-y focus:outline-none focus:border-green-light"
          placeholder="Необязательно"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
      </div>

      {needReason && (
        <div>
          <Lbl>Причина исправления</Lbl>
          <input
            className="w-full h-9 rounded-lg border border-line-2 px-3 text-sm text-ink mt-1 focus:outline-none focus:border-green-light"
            placeholder="Например: таргетолог перепутал бюджет между кампаниями"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <p className="text-[11px] text-muted-2 mt-1">
            Сохранится в журнале вместе со старыми и новыми значениями.
          </p>
        </div>
      )}

      {error && <p className="text-sm text-[#c53030]">{error}</p>}

      <div className="flex items-center gap-2">
        <button onClick={submit} disabled={busy} className="btn btn-green h-9 px-4 text-sm disabled:opacity-60">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Сохранить
        </button>
        <button onClick={onDone} disabled={busy} className="btn btn-ghost h-9 px-4 text-sm">
          Отмена
        </button>
      </div>
    </div>
  )
}

function Lbl({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <span
      className={`text-[11px] font-semibold text-muted uppercase tracking-wide ${right ? 'text-right' : ''}`}
    >
      {children}
    </span>
  )
}
