import { useEffect, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { Check, CircleCheck, Inbox, Loader2 } from 'lucide-react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { errMessage } from '@/lib/errors'
import { num } from '@/lib/format'

// Второй ежедневный отчёт таргетолога: сколько новых заявок пришло по каждому
// активному объекту продаж за день (ТАРГЕТ 1.6 §6).
//
// Заявки не разносятся по кампаниям, целям, каналам связи и источникам (§2.2,
// §6): одно число на объект за день. Именно поэтому нет двойного учёта и
// ложной атрибуции — сопоставляется общий расход по объекту с общим числом
// заявок по нему же за тот же период.

type Row = {
  objectId: Id<'salesObjects'>
  name: string
  type: string
  leads: number | null
  updatedAt: number | null
}

const inputCls =
  'w-full h-9 px-2.5 rounded-lg border border-line-2 text-sm text-right text-ink tabular-nums focus:outline-none focus:border-green-light disabled:bg-chip disabled:text-muted'

export default function TargetLeadsForm({
  date,
  employeeId,
}: {
  date: string
  // Задан — администратор вносит за сотрудника; пусто — таргетолог за себя.
  employeeId?: Id<'employees'>
}) {
  const data = useQuery(api.targetLeads.day, { date, ...(employeeId ? { employeeId } : {}) })
  const save = useMutation(api.targetLeads.saveDay)

  const [vals, setVals] = useState<Record<string, string>>({})
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const rows = (data?.rows ?? []) as Row[]

  // Значения подтягиваются при смене даты и после сохранения. Пока поле
  // правят, вход не перетираем — иначе пропадали бы нажатые цифры.
  useEffect(() => {
    if (!data || dirty) return
    setVals(
      Object.fromEntries(
        (data.rows as Row[]).map((r) => [r.objectId, r.leads === null ? '' : String(r.leads)]),
      ),
    )
  }, [data, dirty])

  if (data === undefined) {
    return (
      <div className="card p-6 grid place-items-center text-muted">
        <Loader2 className="animate-spin" size={18} />
      </div>
    )
  }
  if (rows.length === 0) {
    return (
      <div className="card p-5">
        <h3 className="sec-title mb-1">Заявки по объектам продаж</h3>
        <p className="text-sm text-muted">
          Активных объектов продаж нет — вносить заявки не по чему.
        </p>
      </div>
    )
  }

  // §6.1: пустое поле — отчёт по объекту не заполнен, «0» — заполнен, заявок
  // не было. Итог и счётчик считаются от введённого, а не от сохранённого.
  const parsed = rows.map((r) => {
    const raw = (vals[r.objectId] ?? '').trim()
    return { r, raw, value: raw === '' ? null : Math.max(0, Math.round(Number(raw) || 0)) }
  })
  const filled = parsed.filter((p) => p.value !== null).length
  const totalLeads = parsed.reduce((s, p) => s + (p.value ?? 0), 0)
  const complete = filled === rows.length

  const submit = async () => {
    setError('')
    setBusy(true)
    try {
      await save({
        date,
        ...(employeeId ? { employeeId } : {}),
        rows: parsed.map((p) => ({ objectId: p.r.objectId, leads: p.value })),
      })
      setDirty(false)
      setSaved(true)
    } catch (e) {
      setError(errMessage(e, 'Не удалось сохранить заявки.'))
    } finally {
      setBusy(false)
    }
  }

  const readOnly = !data.editable

  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <Inbox size={17} className="text-green" />
        <h3 className="sec-title flex-1">Заявки по объектам продаж</h3>
        {/* §6.1: статус заполнения и визуальная отметка полного заполнения. */}
        <span
          className={`chip whitespace-nowrap ${
            complete ? 'bg-[#e2f2ef] text-green-d' : 'bg-[#fff6e6] text-[#b7791f]'
          }`}
        >
          {complete && <CircleCheck size={12} />} отчётов {filled} из {rows.length}
        </span>
      </div>
      <p className="text-xs text-muted mb-4">
        Одно число на объект за день — без каналов связи, источников, целей и кампаний.
        Заявка — новое обращение человека с конкретным запросом по объекту, любым способом:
        WhatsApp, Instagram Direct, сайт, лид-форма, звонок. Начало диалога с чат-ботом
        заявкой не считается; повторное обращение того же человека по тому же объекту новой
        заявки не создаёт.
      </p>

      <div className="flex flex-col gap-2">
        {parsed.map(({ r, raw }) => (
          <div key={r.objectId} className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-ink truncate">{r.name}</div>
              <div className="text-[11px] text-muted">
                {raw.trim() === '' ? 'не заполнено' : raw.trim() === '0' ? 'заявок не было' : 'заполнено'}
              </div>
            </div>
            <div className="w-28 shrink-0">
              <input
                className={inputCls}
                inputMode="numeric"
                placeholder="—"
                value={vals[r.objectId] ?? ''}
                disabled={readOnly}
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => {
                  setVals((p) => ({ ...p, [r.objectId]: e.target.value }))
                  setDirty(true)
                  setSaved(false)
                }}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 pt-3 border-t border-line flex items-center justify-between gap-3 flex-wrap">
        <span className="text-sm text-muted">Всего заявок за день</span>
        <span className="text-lg font-bold text-ink tabular-nums">{num(totalLeads)}</span>
      </div>

      {error && <p className="text-sm text-[#c53030] mt-3">{error}</p>}

      {!readOnly && (
        <div className="mt-4 flex items-center gap-2">
          <button
            onClick={submit}
            disabled={busy}
            className="btn btn-green h-9 px-4 text-sm disabled:opacity-60"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            Сохранить заявки
          </button>
          {saved && !dirty && <span className="text-sm text-green-d">Сохранено</span>}
        </div>
      )}
    </div>
  )
}
