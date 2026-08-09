// Календарь проекта (§6.2), журнал действий (§14.2), награды (§12) и
// связанные задачи и встречи (§9.4). Мелкие вкладки карточки проекта живут
// вместе — каждая из них короче собственного файла.

import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import {
  CalendarDays, Check, ListTree, Loader2, Plus,
  PuzzleIcon, Rows3, Trash2, Wallet,
} from 'lucide-react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import Select from '@/components/ui/Select'
import DatePicker from '@/components/ui/DatePicker'
import { errMessage } from '@/lib/errors'
import { kzt, longDate } from '@/lib/format'
import { MILESTONE_KIND_LABEL } from '../../../convex/packModel'
import { Field, inputCls, tabStrip } from './ui'

// ——— §6.2: календарь проекта ———

const KIND_COLOR: Record<string, string> = {
  start: '#057269',
  due: '#c53030',
  stage_start: '#9498a1',
  stage_end: '#2563eb',
  handover: '#6b5ce7',
  client_deadline: '#2563eb',
  team_deadline: '#6b5ce7',
  approved: '#057269',
  meeting: '#c05621',
  payment: '#c05621',
  control: '#b7791f',
  finished: '#057269',
}

export function PackCalendarTab({ packId, canManage }: { packId: Id<'packs'>; canManage: boolean }) {
  const data = useQuery(api.packStages.calendar, { packId })
  const [view, setView] = useState<'list' | 'timeline'>('list')

  if (data === undefined) {
    return (
      <div className="card p-10 grid place-items-center text-muted">
        <Loader2 className="animate-spin" size={20} />
      </div>
    )
  }
  if (!data) return null

  const byDate = new Map<string, typeof data.items>()
  for (const i of data.items) {
    const arr = byDate.get(i.date) ?? []
    arr.push(i)
    byDate.set(i.date, arr)
  }

  const span = Math.max(
    1,
    (Date.parse(data.dueDate) - Date.parse(data.startDate)) / 86400000,
  )
  const offset = (d: string) =>
    Math.min(100, Math.max(0, ((Date.parse(d) - Date.parse(data.startDate)) / 86400000 / span) * 100))

  return (
    <>
      <div className={`${tabStrip} mb-4`}>
        <button
          onClick={() => setView('list')}
          className={`chip ${view === 'list' ? 'bg-green text-white' : 'bg-chip text-muted'}`}
        >
          <Rows3 size={12} /> Список
        </button>
        <button
          onClick={() => setView('timeline')}
          className={`chip ${view === 'timeline' ? 'bg-green text-white' : 'bg-chip text-muted'}`}
        >
          <ListTree size={12} /> Временная шкала
        </button>
        <div className="flex-1" />
        <span className="text-[11px] text-muted-2">
          плановые и фактические даты, проверки, доработки и контрольные точки
        </span>
      </div>

      {canManage && <Milestones packId={packId} />}

      {view === 'timeline' ? (
        <div className="card p-5">
          <div className="relative h-2 rounded-full bg-line mb-6">
            {data.items.map((i, k) => (
              <span
                key={k}
                className="absolute -top-1 w-3 h-3 rounded-full border-2 border-white"
                style={{ left: `${offset(i.date)}%`, background: KIND_COLOR[i.kind] ?? '#9498a1' }}
                title={`${i.date} · ${i.title}`}
              />
            ))}
            <span
              className="absolute -top-2 w-0.5 h-6 bg-[#c53030]"
              style={{ left: `${offset(data.today)}%` }}
              title={`сегодня ${data.today}`}
            />
          </div>
          <div className="flex justify-between text-[11px] text-muted">
            <span>{data.startDate}</span>
            <span>сегодня {data.today}</span>
            <span>{data.dueDate}</span>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {[...byDate.entries()].map(([date, items]) => (
            <div key={date} className="card p-4">
              <div className="flex items-center gap-2 mb-2">
                <CalendarDays size={14} className="text-green" />
                <span className="text-sm font-semibold text-ink">{longDate(date)}</span>
                {date === data.today && (
                  <span className="chip bg-[#e2f2ef] text-green-d">сегодня</span>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                {items.map((i, k) => (
                  <div key={k} className="flex items-center gap-2 text-[13px]">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ background: KIND_COLOR[i.kind] ?? '#9498a1' }}
                    />
                    <span className="text-ink-2">{i.title}</span>
                    <span className="text-[11px] text-muted-2">{i.fact ? 'факт' : 'план'}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

// §6.1: «платежные и иные контрольные даты». Сумма платежа — внутреннее поле,
// клиенту уходит только название и дата, и то лишь если точка помечена видимой.
function Milestones({ packId }: { packId: Id<'packs'> }) {
  const rows = useQuery(api.packs.milestones, { packId })
  const add = useMutation(api.packs.addMilestone)
  const update = useMutation(api.packs.updateMilestone)
  const remove = useMutation(api.packs.removeMilestone)

  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [date, setDate] = useState('')
  const [kind, setKind] = useState<'payment' | 'control'>('payment')
  const [amount, setAmount] = useState('')
  const [clientVisible, setClientVisible] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (!rows) return null

  return (
    <section className="card p-5 mb-4">
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <Wallet size={16} className="text-green" />
        <h3 className="sec-title">Платежи и контрольные даты</h3>
        <span className="chip bg-chip text-muted">{rows.length}</span>
        <div className="flex-1" />
        <button onClick={() => setOpen((v) => !v)} className="mini-btn">
          <Plus size={12} /> Добавить
        </button>
      </div>

      {open && (
        <div className="rounded-xl border border-line p-3 mb-3 flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Название">
              <input
                className={inputCls}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Второй платёж по договору"
              />
            </Field>
            <Field label="Тип">
              <Select
                value={kind}
                onChange={(v) => setKind(v as 'payment')}
                options={Object.entries(MILESTONE_KIND_LABEL).map(([value, label]) => ({ value, label }))}
              />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Дата">
              <DatePicker value={date} onChange={setDate} />
            </Field>
            {kind === 'payment' && (
              <Field label="Сумма, ₸" hint="Внутреннее поле — клиенту не показывается.">
                <input
                  className={inputCls}
                  type="number"
                  min={0}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </Field>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm text-ink-2 cursor-pointer">
            <input
              type="checkbox"
              checked={clientVisible}
              onChange={(e) => setClientVisible(e.target.checked)}
            />
            Показывать клиенту в календаре (без суммы)
          </label>
          {error && <p className="text-sm text-[#c53030]">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={async () => {
                setBusy(true)
                setError('')
                try {
                  await add({
                    packId,
                    title,
                    date,
                    kind,
                    amount: amount ? Number(amount) : undefined,
                    clientVisible,
                  })
                  setOpen(false)
                  setTitle('')
                  setAmount('')
                } catch (e) {
                  setError(errMessage(e, 'Не удалось добавить контрольную дату.'))
                } finally {
                  setBusy(false)
                }
              }}
              disabled={busy || !title.trim() || !date}
              className="btn btn-green h-8 px-3 text-sm disabled:opacity-50"
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Добавить
            </button>
            <button onClick={() => setOpen(false)} className="btn btn-ghost h-8 px-3 text-sm">
              Отмена
            </button>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-muted">
          Платёжных и контрольных дат нет. Добавленные появятся в календаре проекта.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((m) => (
            <div key={m._id} className="rounded-xl border border-line p-3 flex items-center gap-3 flex-wrap">
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ background: KIND_COLOR[m.kind] }}
              />
              <span className="text-[13px] font-semibold text-ink">{m.title}</span>
              <span className="chip bg-chip text-muted">{MILESTONE_KIND_LABEL[m.kind]}</span>
              <span className="text-[12px] text-muted">{m.date}</span>
              {m.amount !== null && (
                <span className="text-[12px] font-semibold text-ink-2 tabular-nums">{kzt(m.amount)}</span>
              )}
              {!m.clientVisible && <span className="chip bg-chip text-muted">только внутри</span>}
              <div className="flex-1" />
              <button
                onClick={() => void update({ id: m._id, done: !m.done })}
                className={`mini-btn ${m.done ? 'text-green-d' : ''}`}
              >
                <Check size={12} /> {m.done ? 'выполнено' : 'отметить'}
              </button>
              <button onClick={() => void remove({ id: m._id })} className="mini-btn text-[#c53030]">
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

// §15.1, §16: подробного журнала пользователю не показываем — события
// продолжают сохраняться в базе, потому что на них держится логика.

// §7, §11.3: состояние пазла и персонального подарка. Администратор видит
// право на подарок и внутренний статус, может вручную сохранить или
// восстановить право на часть пазла в исключительной ситуации.
export function PackRewardsTab({
  packId,
  isOwner,
}: {
  packId: Id<'packs'>
  isOwner: boolean
}) {
  const pack = useQuery(api.packs.get, { id: packId })
  const setPart = useMutation(api.packs.setPuzzlePart)
  const [reason, setReason] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (!pack) {
    return (
      <div className="card p-10 grid place-items-center text-muted">
        <Loader2 className="animate-spin" size={20} />
      </div>
    )
  }

  return (
    <>
      <section className="card p-5 mb-4">
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <PuzzleIcon size={16} className="text-green" />
          <h3 className="sec-title">Пазл заказчика</h3>
          <span
            className={`chip ${
              pack.puzzle.collected === pack.puzzle.total
                ? 'bg-[#e2f2ef] text-green-d'
                : 'bg-chip text-ink-2'
            }`}
          >
            {pack.puzzle.collected} из {pack.puzzle.total}
          </span>
        </div>
        <p className="text-[12px] text-muted mb-4">
          Часть открывается, когда заказчик принимает основной этап в пределах срока приёмки.
          Нулевой этап части не открывает. Принял после срока — часть автоматически не выдаётся,
          но администратор может применить исключение.
        </p>

        <div className="flex flex-col gap-2">
          {pack.puzzle.parts.map((p) => (
            <div key={p.stageId} className="rounded-xl border border-line p-3 flex items-center gap-3 flex-wrap">
              <span
                className={`w-9 h-9 rounded-xl grid place-items-center text-sm font-bold shrink-0 ${
                  p.awarded ? 'bg-green text-white' : 'hatch text-muted-2'
                }`}
              >
                {p.index}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold text-ink truncate">{p.title}</div>
                <div className="text-[11px] text-muted">
                  {p.awarded ? 'часть открыта' : p.accepted ? 'этап принят после срока' : 'этап ещё не принят'}
                  {p.manual ? ' · вручную' : ''}
                  {p.reason ? ` · ${p.reason}` : ''}
                </div>
              </div>
              {isOwner && (
                <button
                  onClick={() => {
                    setEditing(editing === (p.stageId as string) ? null : (p.stageId as string))
                    setReason('')
                  }}
                  className="mini-btn"
                >
                  {p.awarded ? 'Снять часть' : 'Выдать часть'}
                </button>
              )}
              {isOwner && editing === (p.stageId as string) && (
                <div className="w-full flex flex-col gap-2 pt-2 border-t border-line">
                  <Field label="Административная причина" hint="Обязательна для ручной корректировки.">
                    <input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} />
                  </Field>
                  <div className="flex gap-2">
                    <button
                      onClick={async () => {
                        setBusy(true)
                        setError('')
                        try {
                          await setPart({ stageId: p.stageId, awarded: !p.awarded, reason })
                          setEditing(null)
                        } catch (e) {
                          setError(errMessage(e, 'Не удалось изменить часть пазла.'))
                        } finally {
                          setBusy(false)
                        }
                      }}
                      disabled={busy || !reason.trim()}
                      className="btn btn-green h-8 px-3 text-sm disabled:opacity-50"
                    >
                      {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Сохранить
                    </button>
                    <button onClick={() => setEditing(null)} className="btn btn-ghost h-8 px-3 text-sm">
                      Отмена
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
        {error && <p className="text-sm text-[#c53030] mt-3">{error}</p>}
      </section>
    </>
  )
}
