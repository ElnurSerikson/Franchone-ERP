// Календарь проекта (§6.2), журнал действий (§14.2), награды (§12) и
// связанные задачи и встречи (§9.4). Мелкие вкладки карточки проекта живут
// вместе — каждая из них короче собственного файла.

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery } from 'convex/react'
import {
  CalendarDays, CheckSquare, Check, Gift, History, ListTree, Loader2, Plus, Rows3, Trash2, Users,
  Wallet,
} from 'lucide-react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import Select from '@/components/ui/Select'
import DatePicker from '@/components/ui/DatePicker'
import { errMessage } from '@/lib/errors'
import { kzt, longDate } from '@/lib/format'
import { EVENT_LABEL, MILESTONE_KIND_LABEL, REWARD_STATUS } from '../../../convex/packModel'
import { Empty, Field, RewardChip, areaCls, dateTime, inputCls, tabStrip } from './ui'

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

// ——— §14.2: журнал действий ———

export function PackJournalTab({ packId }: { packId: Id<'packs'> }) {
  const rows = useQuery(api.packs.journal, { id: packId })
  if (rows === undefined) {
    return (
      <div className="card p-10 grid place-items-center text-muted">
        <Loader2 className="animate-spin" size={20} />
      </div>
    )
  }
  if (rows.length === 0) {
    return <Empty icon={History} title="Журнал пуст" text="Здесь появятся все действия по проекту." />
  }
  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-4">
        <History size={16} className="text-green" />
        <h3 className="sec-title">Журнал действий</h3>
        <span className="chip bg-chip text-muted">{rows.length}</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {rows.map((e) => (
          <div key={e._id} className="text-[12px] text-ink-2 flex gap-2 flex-wrap py-1.5 border-b border-line last:border-0">
            <span className="text-muted-2 shrink-0 w-32">{dateTime(e.at)}</span>
            <span className="font-medium">{EVENT_LABEL[e.type] ?? e.type}</span>
            {e.stage && <span className="text-muted">· {e.stage}</span>}
            {e.field && <span className="text-muted">· {e.field}</span>}
            {(e.from || e.to) && (
              <span className="text-muted">
                {e.from ?? '—'} → {e.to ?? '—'}
              </span>
            )}
            {e.reason && <span className="text-[#b7791f]">причина: {e.reason}</span>}
            {e.note && <span className="text-muted">{e.note}</span>}
            {e.financial && <span className="chip bg-[#fff6e6] text-[#b7791f]">финансы</span>}
            <span className="text-muted-2">— {e.by}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ——— §12: награды проекта ———

export function PackRewardsTab({
  packId,
  isOwner,
}: {
  packId: Id<'packs'>
  isOwner: boolean
}) {
  const rows = useQuery(api.packExtras.rewards, { packId })
  const board = useQuery(api.packStages.board, { packId })
  const create = useMutation(api.packExtras.createReward)
  const update = useMutation(api.packExtras.updateReward)
  const remove = useMutation(api.packExtras.removeReward)

  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [condition, setCondition] = useState('')
  const [stageId, setStageId] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (rows === undefined) {
    return (
      <div className="card p-10 grid place-items-center text-muted">
        <Loader2 className="animate-spin" size={20} />
      </div>
    )
  }

  return (
    <>
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <Gift size={16} className="text-green" />
        <h3 className="sec-title">Награды клиента</h3>
        <span className="chip bg-chip text-muted">{rows.length}</span>
        <div className="flex-1" />
        {isOwner && (
          <button onClick={() => setOpen((v) => !v)} className="btn btn-green h-9 px-3 text-sm">
            <Plus size={15} /> Добавить награду
          </button>
        )}
      </div>

      <div className="rounded-xl bg-chip p-3 text-[12px] text-ink-2 mb-4">
        §5.4: награда сохраняется, если клиент в срок либо утверждает этап, либо присылает
        замечания. Возврат на доработку награду не отнимает — иначе система подталкивала бы
        принимать результат без проверки.
      </div>

      {open && isOwner && (
        <section className="card p-5 mb-4 flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Название награды">
              <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Разбор воронки продаж" />
            </Field>
            <Field label="За какой этап">
              <Select
                value={stageId}
                onChange={setStageId}
                options={[
                  { value: '', label: 'Без привязки к этапу' },
                  ...(board?.stages ?? []).map((s) => ({ value: s._id as string, label: s.title })),
                ]}
              />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Условие получения">
              <input className={inputCls} value={condition} onChange={(e) => setCondition(e.target.value)} placeholder="Ответить по этапу в срок" />
            </Field>
            {/* §12: «срок выполнения условия». Пусто — срок берётся от этапа. */}
            <Field label="Срок условия" hint="Пусто — столько же, сколько у клиента на ответ по этапу.">
              <DatePicker value={dueDate} onChange={setDueDate} />
            </Field>
          </div>
          <Field label="Описание">
            <textarea className={areaCls} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <Field label="Ссылка на изображение">
            <input className={inputCls} value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://" />
          </Field>
          {error && <p className="text-sm text-[#c53030]">{error}</p>}
          <div>
            <button
              onClick={async () => {
                setBusy(true)
                setError('')
                try {
                  await create({
                    packId,
                    stageId: stageId ? (stageId as Id<'packStages'>) : undefined,
                    title,
                    description: description || undefined,
                    imageUrl: imageUrl || undefined,
                    condition: condition || undefined,
                    dueDate: dueDate || undefined,
                  })
                  setOpen(false)
                  setTitle('')
                  setDescription('')
                  setCondition('')
                  setImageUrl('')
                } catch (e) {
                  setError(errMessage(e, 'Не удалось создать награду.'))
                } finally {
                  setBusy(false)
                }
              }}
              disabled={busy}
              className="btn btn-green disabled:opacity-60"
            >
              {busy && <Loader2 size={15} className="animate-spin" />} Создать
            </button>
          </div>
        </section>
      )}

      {rows.length === 0 ? (
        <Empty
          icon={Gift}
          title="Наград нет"
          text="Награда мотивирует клиента быстро давать обратную связь. Состав и ценность определяются отдельно."
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map((r) => (
            <div key={r._id} className="card p-4">
              <div className="flex items-start gap-2 flex-wrap">
                <span className="text-sm font-semibold text-ink flex-1">{r.title}</span>
                <RewardChip status={r.status} />
              </div>
              <div className="text-[11px] text-muted mt-1">
                {r.stage ? `этап: ${r.stage}` : 'без привязки к этапу'}
                {r.condition ? ` · ${r.condition}` : ''}
              </div>
              {r.description && <p className="text-[13px] text-ink-2 mt-2">{r.description}</p>}
              {r.earnedAt && (
                <div className="text-[11px] text-green-d mt-1">заработана {dateTime(r.earnedAt)}</div>
              )}
              {isOwner && (
                <div className="mt-3 pt-3 border-t border-line flex items-center gap-2 flex-wrap">
                  <Select
                    variant="ghost"
                    value={r.status}
                    onChange={(v) => void update({ id: r._id, status: v as 'granted' })}
                    options={Object.entries(REWARD_STATUS).map(([value, x]) => ({ value, label: x.label }))}
                  />
                  <button onClick={() => void remove({ id: r._id })} className="mini-btn text-[#c53030]">
                    <Trash2 size={12} /> Удалить
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  )
}

// ——— §9.4: связанные задачи и встречи ———

export function PackWorkTab({ packId }: { packId: Id<'packs'> }) {
  const data = useQuery(api.packExtras.linkedWork, { packId })
  const board = useQuery(api.packStages.board, { packId })
  const packers = useQuery(api.packs.list, {})
  const create = useMutation(api.packExtras.createStageTask)
  const createMeeting = useMutation(api.packExtras.createStageMeeting)

  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [stageId, setStageId] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [deadline, setDeadline] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // §9.4: вторая форма — связанная встреча.
  const [meetOpen, setMeetOpen] = useState(false)
  const [mTitle, setMTitle] = useState('')
  const [mStageId, setMStageId] = useState('')
  const [mDate, setMDate] = useState('')
  const [mTime, setMTime] = useState('10:00')
  const [mPlace, setMPlace] = useState('')
  const [withClient, setWithClient] = useState(false)
  const [mBusy, setMBusy] = useState(false)
  const [mError, setMError] = useState('')

  if (data === undefined) {
    return (
      <div className="card p-10 grid place-items-center text-muted">
        <Loader2 className="animate-spin" size={20} />
      </div>
    )
  }
  if (!data) return null

  return (
    <>
      <div className="rounded-xl bg-chip p-3 text-[12px] text-ink-2 mb-4">
        BR-09: задача — это задача, а этап — это этап. Завершение задачи само по себе не начисляет
        KPI и не закрывает этап, пока его не утвердил клиент.
      </div>

      <section className="card p-5 mb-4">
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <CheckSquare size={16} className="text-green" />
          <h3 className="sec-title">Задачи по проекту</h3>
          <span className="chip bg-chip text-muted">{data.tasks.length}</span>
          <div className="flex-1" />
          <button onClick={() => setOpen((v) => !v)} className="mini-btn">
            <Plus size={12} /> Создать из этапа
          </button>
        </div>

        {open && (
          <div className="rounded-xl border border-line p-3 mb-3 flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Что сделать">
                <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} />
              </Field>
              <Field label="Этап">
                <Select
                  value={stageId}
                  onChange={setStageId}
                  placeholder="Выберите этап"
                  options={(board?.stages ?? []).map((s) => ({ value: s._id as string, label: s.title }))}
                />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Исполнитель">
                <Select
                  value={assigneeId}
                  onChange={setAssigneeId}
                  placeholder="Кому поручить"
                  options={(packers?.packers ?? []).map((p) => ({ value: p._id as string, label: p.name }))}
                />
              </Field>
              <Field label="Срок">
                <DatePicker value={deadline} onChange={setDeadline} />
              </Field>
            </div>
            {error && <p className="text-sm text-[#c53030]">{error}</p>}
            <div>
              <button
                onClick={async () => {
                  setBusy(true)
                  setError('')
                  try {
                    await create({
                      stageId: stageId as Id<'packStages'>,
                      title,
                      assigneeId: assigneeId as Id<'employees'>,
                      deadline: deadline || undefined,
                    })
                    setOpen(false)
                    setTitle('')
                  } catch (e) {
                    setError(errMessage(e, 'Не удалось создать задачу.'))
                  } finally {
                    setBusy(false)
                  }
                }}
                disabled={busy || !title.trim() || !stageId || !assigneeId}
                className="btn btn-green h-8 px-3 text-sm disabled:opacity-50"
              >
                {busy && <Loader2 size={13} className="animate-spin" />} Создать задачу
              </button>
            </div>
          </div>
        )}

        {data.tasks.length === 0 ? (
          <p className="text-sm text-muted">Связанных задач нет.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {data.tasks.map((t) => (
              <Link key={t._id} to="/tasks" className="rounded-xl border border-line p-3 hover:bg-chip/60 transition-colors">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[13px] font-medium text-ink flex-1">{t.title}</span>
                  <span className="chip bg-chip text-muted">{t.assignee}</span>
                  {t.deadline && <span className="text-[11px] text-muted">до {t.deadline}</span>}
                  <span
                    className={`chip ${t.status === 'done' ? 'bg-[#e2f2ef] text-green-d' : 'bg-chip text-ink-2'}`}
                  >
                    {t.status === 'done' ? 'выполнена' : t.status === 'in_progress' ? 'в работе' : 'назначена'}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="card p-5">
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <Users size={16} className="text-green" />
          <h3 className="sec-title">Встречи команды проекта</h3>
          <span className="chip bg-chip text-muted">{data.meetings.length}</span>
          <div className="flex-1" />
          <button onClick={() => setMeetOpen((v) => !v)} className="mini-btn">
            <Plus size={12} /> Встреча по этапу
          </button>
        </div>

        {/* §9.4: из карточки этапа создаётся связанная встреча. Она живёт в
            общем модуле «Встречи», и приглашённые получают уведомление по
            общей логике ERP. */}
        {meetOpen && (
          <div className="rounded-xl border border-line p-3 mb-3 flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Тема встречи">
                <input className={inputCls} value={mTitle} onChange={(e) => setMTitle(e.target.value)} />
              </Field>
              <Field label="Этап">
                <Select
                  value={mStageId}
                  onChange={setMStageId}
                  placeholder="Выберите этап"
                  options={(board?.stages ?? []).map((s) => ({ value: s._id as string, label: s.title }))}
                />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Дата">
                <DatePicker value={mDate} onChange={setMDate} />
              </Field>
              <Field label="Время">
                <input
                  className={inputCls}
                  type="time"
                  value={mTime}
                  onChange={(e) => setMTime(e.target.value)}
                />
              </Field>
              <Field label="Место">
                <input className={inputCls} value={mPlace} onChange={(e) => setMPlace(e.target.value)} placeholder="Офис / Zoom" />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm text-ink-2 cursor-pointer">
              <input
                type="checkbox"
                checked={withClient}
                onChange={(e) => setWithClient(e.target.checked)}
              />
              Пригласить клиента
            </label>
            {mError && <p className="text-sm text-[#c53030]">{mError}</p>}
            <div className="flex gap-2">
              <button
                onClick={async () => {
                  setMBusy(true)
                  setMError('')
                  try {
                    await createMeeting({
                      stageId: mStageId as Id<'packStages'>,
                      title: mTitle,
                      date: mDate,
                      time: mTime,
                      place: mPlace || undefined,
                      withClient,
                    })
                    setMeetOpen(false)
                    setMTitle('')
                  } catch (e) {
                    setMError(errMessage(e, 'Не удалось создать встречу.'))
                  } finally {
                    setMBusy(false)
                  }
                }}
                disabled={mBusy || !mTitle.trim() || !mStageId || !mDate}
                className="btn btn-green h-8 px-3 text-sm disabled:opacity-50"
              >
                {mBusy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Создать встречу
              </button>
              <button onClick={() => setMeetOpen(false)} className="btn btn-ghost h-8 px-3 text-sm">
                Отмена
              </button>
            </div>
          </div>
        )}
        {data.meetings.length === 0 ? (
          <p className="text-sm text-muted">Встреч нет.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {data.meetings.map((m) => (
              <Link key={m._id} to="/meetings" className="chip bg-chip text-ink-2 hover:bg-line-2">
                <CalendarDays size={11} /> {m.date} {m.time} · {m.title}
              </Link>
            ))}
          </div>
        )}
      </section>
    </>
  )
}
