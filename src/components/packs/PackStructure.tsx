// §4.2, §4.3, §7.1: настройка этапов, весов, сроков и экономики проекта плюс
// проверки перед запуском. До запуска правится свободно; после — вес, финансы
// и уже начавшиеся сроки требуют причины и уходят в журнал (§4.4, BR-08).

import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import {
  AlertTriangle, ArrowDown, ArrowUp, Check, CircleCheck, Loader2, Plus, Scale, Settings2, Sparkles,
  Trash2, Wallet,
} from 'lucide-react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import DatePicker from '@/components/ui/DatePicker'
import { errMessage } from '@/lib/errors'
import { kzt } from '@/lib/format'
import { Field, areaCls, dateOnly, inputCls } from './ui'

export default function PackStructure({
  packId,
  canManage,
  launched,
}: {
  packId: Id<'packs'>
  canManage: boolean
  launched: boolean
}) {
  const pack = useQuery(api.packs.get, { id: packId })
  const board = useQuery(api.packStages.board, { packId })
  const checks = useQuery(api.packs.checks, { id: packId })
  const addStage = useMutation(api.packStages.addStage)
  const equalize = useMutation(api.packStages.equalizeWeights)
  const reorder = useMutation(api.packStages.reorderStages)

  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  if (!pack || !board) {
    return (
      <div className="card p-10 grid place-items-center text-muted">
        <Loader2 className="animate-spin" size={20} />
      </div>
    )
  }

  const move = async (index: number, dir: -1 | 1) => {
    const ids = board.stages.map((s) => s._id)
    const j = index + dir
    if (j < 0 || j >= ids.length) return
    ;[ids[index], ids[j]] = [ids[j], ids[index]]
    setError('')
    try {
      await reorder({ packId, ids })
    } catch (e) {
      setError(errMessage(e, 'Не удалось изменить порядок.'))
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* §4.3: проверки перед запуском */}
      {checks && !checks.launched && (
        <section className="card p-5">
          <div className="flex items-center gap-2 mb-3">
            <CircleCheck size={16} className={checks.canLaunch ? 'text-green' : 'text-[#c53030]'} />
            <h3 className="sec-title">Проверки перед запуском</h3>
          </div>
          {checks.issues.length === 0 ? (
            <p className="text-sm text-green-d">
              Всё готово: сумма весов 100%, участники и экономика заданы. Можно открывать проект
              клиенту.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {checks.issues.map((i, k) => (
                <div
                  key={k}
                  className={`rounded-xl p-3 flex items-start gap-2 ${
                    i.level === 'error' ? 'bg-[#fdeaea]' : 'bg-[#fff6e6]'
                  }`}
                >
                  <AlertTriangle
                    size={14}
                    className={`shrink-0 mt-0.5 ${i.level === 'error' ? 'text-[#c53030]' : 'text-[#b7791f]'}`}
                  />
                  <span className={`text-[13px] ${i.level === 'error' ? 'text-[#8a2020]' : 'text-[#8a5a12]'}`}>
                    {i.text}
                  </span>
                </div>
              ))}
              {checks.canLaunch && (
                <p className="text-[12px] text-muted">
                  Предупреждения запуск не блокируют — блокируют только ошибки.
                </p>
              )}
            </div>
          )}
        </section>
      )}

      {/* §7.1: экономика проекта */}
      {canManage && <Economy packId={packId} pack={pack} launched={launched} />}

      {/* §7.3, §7.4: выплаты вознаграждения */}
      {canManage && <Payouts packId={packId} />}

      {/* §4.1, §13.1: свойства проекта и заметка итогового хаба */}
      {canManage && <Properties packId={packId} pack={pack} />}

      {/* §4.2: этапы */}
      <section className="card p-5">
        <div className="flex items-center gap-2 flex-wrap mb-4">
          <Scale size={16} className="text-green" />
          <h3 className="sec-title">Этапы и веса</h3>
          <span
            className={`chip ${board.weightSum === 100 ? 'bg-[#e2f2ef] text-green-d' : 'bg-[#fdeaea] text-[#c53030]'}`}
          >
            сумма весов {board.weightSum}%
          </span>
          <div className="flex-1" />
          {canManage && !launched && (
            <>
              <button
                onClick={async () => {
                  setBusy('eq')
                  setError('')
                  try {
                    await equalize({ packId })
                  } catch (e) {
                    setError(errMessage(e, 'Не удалось выровнять веса.'))
                  } finally {
                    setBusy('')
                  }
                }}
                disabled={busy === 'eq'}
                className="mini-btn"
              >
                {busy === 'eq' ? <Loader2 size={12} className="animate-spin" /> : <Scale size={12} />}
                Разложить поровну
              </button>
              <button
                onClick={async () => {
                  setError('')
                  try {
                    await addStage({ packId, title: 'Новый этап', kind: 'main', weight: 0 })
                  } catch (e) {
                    setError(errMessage(e, 'Не удалось добавить этап.'))
                  }
                }}
                className="mini-btn"
              >
                <Plus size={12} /> Добавить этап
              </button>
            </>
          )}
        </div>

        {error && <p className="text-sm text-[#c53030] mb-3">{error}</p>}

        <div className="flex flex-col gap-3">
          {board.stages.map((s, i) => (
            <StageEditor
              key={s._id}
              stage={s}
              canManage={canManage}
              launched={launched}
              onUp={i > 0 && !launched ? () => void move(i, -1) : undefined}
              onDown={i < board.stages.length - 1 && !launched ? () => void move(i, 1) : undefined}
            />
          ))}
        </div>

        <p className="text-[11px] text-muted-2 mt-4">
          §4.2: сумма весов всех активных этапов, включая нулевой, обязана быть ровно 100% —
          иначе проект не активируется. Принятый нулевой этап входит в прогресс и фактический
          KPI, но части пазла не открывает.
        </p>
      </section>
    </div>
  )
}

function Economy({
  packId,
  pack,
  launched,
}: {
  packId: Id<'packs'>
  pack: NonNullable<ReturnType<typeof useQuery<typeof api.packs.get>>>
  launched: boolean
}) {
  const update = useMutation(api.packs.update)
  // ТЗ v1.1 §2, §9.2: стоимость и процент задаёт только администратор.
  // Упаковщику они показываются как есть, без полей и кнопки сохранения —
  // сервер его правку всё равно отклонит.
  const readOnly = !pack.isOwner
  const [price, setPrice] = useState(String(pack.price))
  const [percent, setPercent] = useState(String(pack.packerPercent))
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const dirty = Number(price) !== pack.price || Number(percent) !== pack.packerPercent
  const reward = Math.round((Number(price || 0) * Number(percent || 0)) / 100)

  return (
    <section className="card p-5">
      <div className="flex items-center gap-2 mb-4">
        <Wallet size={16} className="text-green" />
        <h3 className="sec-title">Экономика проекта</h3>
        <span className="chip bg-[#fff6e6] text-[#b7791f]">клиент этого не видит</span>
        {readOnly && <span className="chip bg-chip text-muted">задаёт администратор</span>}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Стоимость проекта, ₸ (P)">
          {readOnly ? (
            <div className="text-sm font-semibold text-ink tabular-nums py-2">{kzt(pack.price)}</div>
          ) : (
            <input className={inputCls} type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} />
          )}
        </Field>
        <Field label="Процент упаковщика, % (R)">
          {readOnly ? (
            <div className="text-sm font-semibold text-ink tabular-nums py-2">{pack.packerPercent}%</div>
          ) : (
            <input className={inputCls} type="number" min={0} max={100} value={percent} onChange={(e) => setPercent(e.target.value)} />
          )}
        </Field>
        <div className="rounded-xl bg-chip p-3">
          <div className="text-[11px] text-muted">Полное вознаграждение · W = P × R / 100</div>
          <div className="text-lg font-bold text-ink tabular-nums">{kzt(reward)}</div>
          <div className="text-[11px] text-muted mt-0.5">
            начислено {kzt(pack.accrued)} при KPI {pack.progress}%
          </div>
        </div>
      </div>
      {!readOnly && launched && dirty && (
        <div className="mt-3">
          <Field
            label="Причина изменения"
            hint="Проект запущен: старое и новое значение с причиной уйдут в журнал (BR-08)."
          >
            <input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Например: пересмотрели бюджет по договорённости с клиентом" />
          </Field>
        </div>
      )}
      {error && <p className="text-sm text-[#c53030] mt-3">{error}</p>}
      {!readOnly && (
        <div className="mt-4 flex items-center gap-2">
          <button
            onClick={async () => {
              setBusy(true)
              setError('')
              try {
                await update({
                  id: packId,
                  price: Number(price),
                  packerPercent: Number(percent),
                  reason: reason || undefined,
                })
                setSaved(true)
                setReason('')
                setTimeout(() => setSaved(false), 2000)
              } catch (e) {
                setError(errMessage(e, 'Не удалось сохранить экономику.'))
              } finally {
                setBusy(false)
              }
            }}
            disabled={busy || !dirty}
            className="btn btn-green h-9 px-3 text-sm disabled:opacity-50"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Сохранить
          </button>
          {saved && <span className="text-sm text-green-d">Сохранено</span>}
        </div>
      )}
    </section>
  )
}

// §7.3: плановое, начисленное и выплаченное вознаграждение — отдельно.
// Начисление производное (A = W × K/100), выплата — факт, который отмечает
// владелец. Поэтому храним историю выплат, а не одно число.
function Payouts({ packId }: { packId: Id<'packs'> }) {
  const data = useQuery(api.packs.payouts, { packId })
  const add = useMutation(api.packs.addPayout)
  const remove = useMutation(api.packs.removePayout)
  const [amount, setAmount] = useState('')
  const [paidAt, setPaidAt] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (!data) return null

  return (
    <section className="card p-5">
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <Wallet size={16} className="text-green" />
        <h3 className="sec-title">Выплаты упаковщику</h3>
        <span className="chip bg-[#fff6e6] text-[#b7791f]">клиент этого не видит</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Cell label="Плановое (W)" value={kzt(data.reward)} />
        <Cell label="Начислено (A)" value={kzt(data.accrued)} tone="green" />
        <Cell label="Выплачено" value={kzt(data.paid)} />
        <Cell
          label="К выплате"
          value={kzt(Math.max(0, data.unpaid))}
          tone={data.unpaid > 0 ? 'amber' : undefined}
        />
      </div>

      {data.rows.length > 0 && (
        <div className="mt-4 flex flex-col gap-2">
          {data.rows.map((r) => (
            <div key={r._id} className="rounded-xl border border-line p-3 flex items-center gap-3 flex-wrap">
              <span className="text-sm font-semibold text-ink tabular-nums">{kzt(r.amount)}</span>
              <span className="text-[12px] text-muted">{r.paidAt}</span>
              {r.note && <span className="text-[12px] text-ink-2">{r.note}</span>}
              <div className="flex-1" />
              <span className="text-[11px] text-muted-2">отметил {r.by} · {dateOnly(r.at)}</span>
              {data.canEdit && (
                <button onClick={() => void remove({ id: r._id })} className="mini-btn text-[#c53030]">
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {data.canEdit && (
        <>
          <div className="mt-4 pt-4 border-t border-line grid gap-3 sm:grid-cols-3">
            <Field label="Сумма выплаты, ₸">
              <input
                className={inputCls}
                type="number"
                min={0}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={String(Math.max(0, data.unpaid))}
              />
            </Field>
            <Field label="Дата выплаты">
              <DatePicker value={paidAt} onChange={setPaidAt} />
            </Field>
            <Field label="Комментарий">
              <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Необязательно" />
            </Field>
          </div>
          {error && <p className="text-sm text-[#c53030] mt-3">{error}</p>}
          <div className="mt-3">
            <button
              onClick={async () => {
                setBusy(true)
                setError('')
                try {
                  await add({ packId, amount: Number(amount), paidAt, note: note || undefined })
                  setAmount('')
                  setNote('')
                } catch (e) {
                  setError(errMessage(e, 'Не удалось отметить выплату.'))
                } finally {
                  setBusy(false)
                }
              }}
              disabled={busy || !amount || !paidAt}
              className="btn btn-green h-9 px-3 text-sm disabled:opacity-50"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Отметить выплату
            </button>
          </div>
        </>
      )}
    </section>
  )
}

function Cell({ label, value, tone }: { label: string; value: string; tone?: 'green' | 'amber' }) {
  const color = tone === 'green' ? 'text-green-d' : tone === 'amber' ? 'text-[#b7791f]' : 'text-ink'
  return (
    <div className="rounded-xl bg-chip p-3">
      <div className="text-[11px] text-muted">{label}</div>
      <div className={`text-lg font-bold tabular-nums ${color}`}>{value}</div>
    </div>
  )
}

// §4.1 «Шаблон упаковки» и §13.1 «итоговый хаб»: свойства, которые не про
// структуру и не про деньги, но живут на этом же экране.
function Properties({
  packId,
  pack,
}: {
  packId: Id<'packs'>
  pack: NonNullable<ReturnType<typeof useQuery<typeof api.packs.get>>>
}) {
  const update = useMutation(api.packs.update)
  const [hubNote, setHubNote] = useState(pack.hubNote ?? '')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  return (
    <section className="card p-5">
      <div className="flex items-center gap-2 mb-4">
        <Settings2 size={16} className="text-green" />
        <h3 className="sec-title">Свойства проекта</h3>
      </div>

      <label className="flex items-start gap-2 text-sm text-ink-2 cursor-pointer">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={pack.isTemplate}
          onChange={(e) => void update({ id: packId, isTemplate: e.target.checked })}
        />
        <span>
          Использовать как шаблон
          <span className="block text-[11px] text-muted-2">
            Структура этапов этого проекта будет предлагаться первой при создании новой упаковки.
          </span>
        </span>
      </label>

      <div className="mt-4">
        <Field
          label="Заметка в итоговом хабе"
          hint="Видна клиенту в постоянном кабинете готовой франшизы после завершения проекта."
        >
          <textarea className={areaCls} value={hubNote} onChange={(e) => setHubNote(e.target.value)} />
        </Field>
        {error && <p className="text-sm text-[#c53030] mt-2">{error}</p>}
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={async () => {
              setBusy(true)
              setError('')
              try {
                await update({ id: packId, hubNote })
                setSaved(true)
                setTimeout(() => setSaved(false), 2000)
              } catch (e) {
                setError(errMessage(e, 'Не удалось сохранить заметку.'))
              } finally {
                setBusy(false)
              }
            }}
            disabled={busy || hubNote === (pack.hubNote ?? '')}
            className="btn btn-green h-9 px-3 text-sm disabled:opacity-50"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Сохранить
          </button>
          {saved && <span className="text-sm text-green-d">Сохранено</span>}
        </div>
      </div>
    </section>
  )
}

type BoardStage = NonNullable<ReturnType<typeof useQuery<typeof api.packStages.board>>>['stages'][number]

function StageEditor({
  stage,
  canManage,
  launched,
  onUp,
  onDown,
}: {
  stage: BoardStage
  canManage: boolean
  launched: boolean
  onUp?: () => void
  onDown?: () => void
}) {
  const update = useMutation(api.packStages.updateStage)
  const remove = useMutation(api.packStages.removeStage)
  const [open, setOpen] = useState(false)
  const [d, setD] = useState({
    title: stage.title,
    weight: String(stage.weight),
    startDate: stage.startDate ?? '',
    endDate: stage.endDate ?? '',
    clientNote: stage.clientNote ?? '',
    internalNote: stage.internalNote ?? '',
    doneCondition: stage.doneCondition ?? '',
    reviewDays: String(stage.reviewDays),
    rereviewDays: String(stage.rereviewDays),
    fixDays: String(stage.fixDays),
  })
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const save = async () => {
    setBusy(true)
    setError('')
    try {
      await update({
        id: stage._id,
        title: d.title,
        weight: Number(d.weight),
        startDate: d.startDate || undefined,
        endDate: d.endDate || undefined,
        clientNote: d.clientNote,
        internalNote: d.internalNote,
        doneCondition: d.doneCondition,
        reviewDays: Number(d.reviewDays),
        rereviewDays: Number(d.rereviewDays),
        fixDays: Number(d.fixDays),
        reason: reason || undefined,
      })
      setOpen(false)
      setReason('')
    } catch (e) {
      setError(errMessage(e, 'Не удалось сохранить этап.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-line p-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[13px] font-semibold text-ink flex-1 min-w-0 truncate">
          {stage.order}. {stage.title}
        </span>
        {stage.kind === 'zero' && <span className="chip bg-chip text-muted">нулевой</span>}
        <span className="chip bg-chip text-ink-2">{stage.weight}%</span>
        <span className="text-[11px] text-muted whitespace-nowrap">
          {stage.startDate ?? '—'} → {stage.endDate ?? '—'}
        </span>
        {canManage && (
          <div className="flex items-center gap-1">
            {onUp && (
              <button onClick={onUp} className="ico-btn w-7 h-7" title="Выше">
                <ArrowUp size={12} />
              </button>
            )}
            {onDown && (
              <button onClick={onDown} className="ico-btn w-7 h-7" title="Ниже">
                <ArrowDown size={12} />
              </button>
            )}
            <button onClick={() => setOpen((v) => !v)} className="mini-btn">
              {open ? 'Свернуть' : 'Изменить'}
            </button>
          </div>
        )}
      </div>

      {open && (
        <div className="mt-3 pt-3 border-t border-line flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Название">
              <input className={inputCls} value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} />
            </Field>
            {(
              <Field label="Вес в прогрессе и KPI, %">
                <input
                  className={inputCls}
                  type="number"
                  min={0}
                  max={100}
                  value={d.weight}
                  onChange={(e) => setD({ ...d, weight: e.target.value })}
                />
              </Field>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Дата начала">
              <DatePicker value={d.startDate} onChange={(v) => setD({ ...d, startDate: v })} />
            </Field>
            <Field label="Дата завершения">
              <DatePicker value={d.endDate} onChange={(v) => setD({ ...d, endDate: v })} />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Первичная проверка, дней">
              <input className={inputCls} type="number" min={1} value={d.reviewDays} onChange={(e) => setD({ ...d, reviewDays: e.target.value })} />
            </Field>
            <Field label="Повторная проверка, дней">
              <input className={inputCls} type="number" min={1} value={d.rereviewDays} onChange={(e) => setD({ ...d, rereviewDays: e.target.value })} />
            </Field>
            <Field label="Доработка, дней">
              <input className={inputCls} type="number" min={1} value={d.fixDays} onChange={(e) => setD({ ...d, fixDays: e.target.value })} />
            </Field>
          </div>
          <Field label="Описание для клиента">
            <textarea className={areaCls} value={d.clientNote} onChange={(e) => setD({ ...d, clientNote: e.target.value })} />
          </Field>
          <Field label="Внутренний комментарий" hint="Клиент его не увидит никогда.">
            <textarea className={areaCls} value={d.internalNote} onChange={(e) => setD({ ...d, internalNote: e.target.value })} />
          </Field>
          <Field label="Условия завершения этапа">
            <textarea className={areaCls} value={d.doneCondition} onChange={(e) => setD({ ...d, doneCondition: e.target.value })} />
          </Field>
          {launched && (
            <Field label="Причина изменения" hint="Обязательна для веса и сроков после запуска.">
              <input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          )}
          {error && <p className="text-sm text-[#c53030]">{error}</p>}
          <div className="flex items-center gap-2">
            <button onClick={save} disabled={busy} className="btn btn-green h-8 px-3 text-sm disabled:opacity-60">
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Сохранить
            </button>
            <button onClick={() => setOpen(false)} className="btn btn-ghost h-8 px-3 text-sm">
              Отмена
            </button>
            <div className="flex-1" />
            {stage.status !== 'approved' && (
              <button
                onClick={async () => {
                  setError('')
                  try {
                    await remove({ id: stage._id, reason: reason || undefined })
                  } catch (e) {
                    setError(errMessage(e, 'Не удалось удалить этап.'))
                  }
                }}
                className="mini-btn text-[#c53030]"
              >
                <Trash2 size={12} /> Удалить этап
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
