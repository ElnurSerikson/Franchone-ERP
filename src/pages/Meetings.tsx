import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import {
  AlertTriangle, CalendarDays, Check, CircleCheck, Clock, History, Loader2, MapPin,
  MessageSquare, Plus, RefreshCw, Users, X, XCircle,
} from 'lucide-react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import PageHeader from '@/components/PageHeader'
import Avatar from '@/components/ui/Avatar'
import Select from '@/components/ui/Select'
import DatePicker from '@/components/ui/DatePicker'
import { errMessage } from '@/lib/errors'
import { longDate } from '@/lib/format'
import { TODAY } from '@/lib/constants'
import { useApp, useCurrentUser } from '@/store'

// Раздел «Встречи» (ТЗ СИСТЕМА §4).
//
// Внутренняя напоминалка: сотрудник создаёт встречу, приглашает коллег, и она
// появляется у них в этом же разделе. История хранится бессрочно — прошедшие
// встречи не удаляются, их видно через выбор даты или периода (§4.5).
//
// §4.8: статусов встречи, подтверждения участия, повторов и внешних
// календарей в первой версии нет. Приглашение — это приглашение, а не
// подтверждение присутствия (§4.6).

type Person = {
  _id: Id<'employees'>
  name: string
  initials: string
  avatarColor: string
  positionLabel: string
}

type Meeting = {
  _id: Id<'meetings'>
  status: 'planned' | 'held' | 'cancelled'
  // §2.2: время прошло, результат не выбран. Это признак, а не состояние.
  awaiting: boolean
  originalDate: string | null
  originalTime: string | null
  rescheduleCount: number
  title: string
  date: string
  time: string
  place: string | null
  mapUrl: string | null
  comment: string | null
  createdAt: number
  createdBy: Person
  participants: Person[]
}

// §2: три состояния встречи.
const STATE: Record<Meeting['status'], { label: string; chip: string }> = {
  planned: { label: 'Запланирована', chip: 'bg-chip text-muted' },
  held: { label: 'Состоялась', chip: 'bg-[#e2f2ef] text-green-d' },
  cancelled: { label: 'Отменена', chip: 'bg-[#fdeaea] text-[#c53030]' },
}

const inputCls =
  'w-full h-9 rounded-lg border border-line-2 px-3 text-sm text-ink placeholder:text-muted focus:outline-none focus:border-green-light bg-white'

type View = 'upcoming' | 'range'

export default function Meetings() {
  const me = useCurrentUser()
  const { role } = useApp()
  const [view, setView] = useState<View>('upcoming')
  const [from, setFrom] = useState(TODAY)
  const [to, setTo] = useState(TODAY)
  const [scope, setScope] = useState<'mine' | 'all'>('mine')
  const [creating, setCreating] = useState(false)
  // §4: отменённая встреча не удаляется и должна быть видна в календаре и
  // истории. В предстоящих ей делать нечего, поэтому показываем её при
  // просмотре периода.
  const [showCancelled, setShowCancelled] = useState(false)

  const args =
    view === 'range'
      ? from <= to
        ? { from, to }
        : { from: to, to: from }
      : // §4.3: по умолчанию — предстоящие, от ближайшей к более поздней.
        { from: TODAY }

  const data = useQuery(api.meetings.list, {
    ...args,
    scope,
    includeCancelled: view === 'range' && showCancelled,
  })
  const stats = useQuery(api.meetings.stats, {})

  const rows = (data?.rows ?? []) as Meeting[]
  const awaiting = (data?.awaiting ?? []) as Meeting[]
  const canSeeAll = data?.canSeeAll ?? false

  // §4.3: внутри выбранного периода — по дате и времени. Группируем по дню,
  // чтобы список читался как календарь.
  const byDate = new Map<string, Meeting[]>()
  for (const m of rows) {
    const arr = byDate.get(m.date) ?? []
    arr.push(m)
    byDate.set(m.date, arr)
  }

  return (
    <>
      <PageHeader
        title="Встречи"
        subtitle="Напоминания о встречах и история приглашений"
        actions={
          <button onClick={() => setCreating(true)} className="btn btn-green">
            <Plus size={16} /> Новая встреча
          </button>
        }
      />

      <section className="card p-5 mb-5">
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Показать">
            <Select
              value={view}
              onChange={(v) => setView(v as View)}
              options={[
                { value: 'upcoming', label: 'Предстоящие' },
                { value: 'range', label: 'Дата или период' },
              ]}
            />
          </Field>
          {view === 'range' && (
            <>
              <Field label="С даты">
                <DatePicker value={from} onChange={setFrom} />
              </Field>
              <Field label="По дату">
                <DatePicker value={to} onChange={setTo} />
              </Field>
            </>
          )}
          {/* §4.7: администратор может смотреть все встречи компании. */}
          {canSeeAll && view !== 'range' && (
            <Field label="Чьи встречи">
              <Select
                value={scope}
                onChange={(v) => setScope(v as 'mine' | 'all')}
                options={[
                  { value: 'mine', label: 'Мои и куда пригласили' },
                  { value: 'all', label: 'Все встречи компании' },
                ]}
              />
            </Field>
          )}
        </div>
        {view === 'range' && (
          <label className="mt-3 flex items-center gap-2 text-sm text-ink-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showCancelled}
              onChange={(e) => setShowCancelled(e.target.checked)}
            />
            Показывать отменённые встречи
          </label>
        )}
        {canSeeAll && view === 'range' && (
          <div className="mt-3 max-w-xs">
            <Field label="Чьи встречи">
              <Select
                value={scope}
                onChange={(v) => setScope(v as 'mine' | 'all')}
                options={[
                  { value: 'mine', label: 'Мои и куда пригласили' },
                  { value: 'all', label: 'Все встречи компании' },
                ]}
              />
            </Field>
          </div>
        )}

        {/* §4.6: статистика различает созданные встречи и приглашения. */}
        {stats && (
          <div className="mt-4 pt-4 border-t border-line flex items-center gap-4 flex-wrap text-sm">
            <span className="text-muted">
              Создано мной: <b className="text-ink">{stats.created}</b>
            </span>
            <span className="text-muted">
              Приглашений: <b className="text-ink">{stats.invited}</b>
            </span>
            <span className="text-[11px] text-muted-2">
              приглашение фиксирует факт приглашения, а не присутствие на встрече
            </span>
          </div>
        )}
      </section>

      {/* §2.1 и §2.2: прошедшие встречи без результата организатор видит
          отдельно и выбирает одно из трёх действий. */}
      {awaiting.length > 0 && (
        <section className="mb-5">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={16} className="text-[#b7791f]" />
            <h3 className="sec-title">Ожидают подтверждения</h3>
            <span className="chip bg-[#fff6e6] text-[#b7791f]">{awaiting.length}</span>
          </div>
          <p className="text-xs text-muted mb-3">
            Время встречи прошло. Отметьте, что произошло — это нужно только для статистики,
            оценивать встречу не требуется.
          </p>
          <div className="flex flex-col gap-3">
            {awaiting.map((m) => (
              <MeetingCard key={m._id} meeting={m} meId={me.id} isOwner={role === 'owner'} />
            ))}
          </div>
        </section>
      )}

      {data === undefined ? (
        <div className="card p-10 grid place-items-center text-muted">
          <Loader2 className="animate-spin" size={20} />
        </div>
      ) : rows.length === 0 ? (
        <div className="card p-10 text-center">
          <span className="w-12 h-12 rounded-full bg-chip text-muted grid place-items-center mx-auto mb-3">
            <CalendarDays size={20} />
          </span>
          <div className="sec-title mb-1">
            {view === 'upcoming' ? 'Предстоящих встреч нет' : 'За выбранный период встреч нет'}
          </div>
          <p className="text-sm text-muted max-w-md mx-auto">
            Создайте встречу и пригласите коллег — она появится у них в этом разделе как
            напоминание.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {[...byDate.entries()].map(([date, list]) => (
            <section key={date}>
              <div className="flex items-center gap-2 mb-3">
                <h3 className="sec-title">{longDate(date)}</h3>
                {date === TODAY && <span className="chip bg-[#e2f2ef] text-green-d">сегодня</span>}
                {date < TODAY && <span className="chip bg-chip text-muted">прошедшая</span>}
              </div>
              <div className="flex flex-col gap-3">
                {list.map((m) => (
                  <MeetingCard key={m._id} meeting={m} meId={me.id} isOwner={role === 'owner'} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {creating && (
        <MeetingDrawer
          employees={(data?.employees ?? []) as Person[]}
          onClose={() => setCreating(false)}
        />
      )}
    </>
  )
}

// §4.4: карточка встречи — название, дата и время, место, ссылка 2GIS,
// комментарий, создатель и список участников.
function MeetingCard({
  meeting,
  meId,
  isOwner,
}: {
  meeting: Meeting
  meId: string
  isOwner: boolean
}) {
  const markHeld = useMutation(api.meetings.markHeld)
  const cancel = useMutation(api.meetings.cancel)
  const reschedule = useMutation(api.meetings.reschedule)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [moving, setMoving] = useState(false)
  const [newDate, setNewDate] = useState(meeting.date)
  const [newTime, setNewTime] = useState(meeting.time)
  // §2.1: при переносе при необходимости обновляются место, ссылка и
  // комментарий — не только дата и время.
  const [newPlace, setNewPlace] = useState(meeting.place ?? '')
  const [newUrl, setNewUrl] = useState(meeting.mapUrl ?? '')
  const [newComment, setNewComment] = useState(meeting.comment ?? '')
  const [showHistory, setShowHistory] = useState(false)
  const mine = meeting.createdBy._id === meId

  const act = async (name: string, fn: () => Promise<unknown>) => {
    setBusy(name)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError(errMessage(e, 'Не удалось выполнить действие.'))
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="card p-5">
      <div className="flex items-start gap-3 flex-wrap">
        <span className="w-10 h-10 rounded-xl bg-[#e2f2ef] text-green-d grid place-items-center shrink-0">
          <CalendarDays size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-base font-semibold text-ink">{meeting.title}</span>
            <span className={`chip whitespace-nowrap ${STATE[meeting.status].chip}`}>
              {STATE[meeting.status].label}
            </span>
            {meeting.awaiting && (
              <span className="chip bg-[#fff6e6] text-[#b7791f] whitespace-nowrap">
                ожидает подтверждения
              </span>
            )}
            {meeting.rescheduleCount > 0 && (
              <button
                onClick={() => setShowHistory((v) => !v)}
                className="chip bg-chip text-muted whitespace-nowrap"
                title="История переносов"
              >
                <History size={11} /> переносов: {meeting.rescheduleCount}
              </button>
            )}
          </div>
          <div className="flex items-center gap-3 flex-wrap text-sm text-muted mt-1">
            <span className="inline-flex items-center gap-1.5">
              <Clock size={14} /> {meeting.time}
            </span>
            {meeting.place && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin size={14} /> {meeting.place}
              </span>
            )}
            {meeting.mapUrl && (
              <a
                href={meeting.mapUrl}
                target="_blank"
                rel="noreferrer"
                className="text-green-d underline inline-flex items-center gap-1.5"
              >
                <MapPin size={14} /> 2GIS
              </a>
            )}
          </div>
        </div>
        {/* §2.1: три действия. Доступны организатору и администратору (§5). */}
        {(mine || isOwner) && meeting.status === 'planned' && (
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            {meeting.awaiting && (
              <button
                onClick={() => act('held', () => markHeld({ id: meeting._id }))}
                disabled={!!busy}
                className="btn btn-green h-8 px-3 text-sm disabled:opacity-60"
              >
                {busy === 'held' ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <CircleCheck size={13} />
                )}
                Состоялась
              </button>
            )}
            <button onClick={() => setMoving((v) => !v)} className="btn btn-ghost h-8 px-3 text-sm">
              <RefreshCw size={13} /> Перенести
            </button>
            <button
              onClick={() => act('cancel', () => cancel({ id: meeting._id }))}
              disabled={!!busy}
              className="btn btn-ghost h-8 px-3 text-sm text-[#c53030]"
            >
              {busy === 'cancel' ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <XCircle size={13} />
              )}
              Отменить
            </button>
          </div>
        )}
      </div>

      {/* §3: перенос правит ту же запись — новая встреча не создаётся. */}
      {moving && (
        <div className="mt-3 rounded-xl border border-line p-3 flex flex-col gap-3">
          <div className="text-sm font-medium text-ink">Перенести встречу</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-1.5">
                Новая дата
              </div>
              <DatePicker value={newDate} onChange={setNewDate} />
            </div>
            <div>
              <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-1.5">
                Новое время
              </div>
              <input
                type="time"
                value={newTime}
                onChange={(e) => setNewTime(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-1.5">
                Место
              </div>
              <input
                className={inputCls}
                placeholder="Не указано"
                value={newPlace}
                onChange={(e) => setNewPlace(e.target.value)}
              />
            </div>
            <div>
              <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-1.5">
                Ссылка на 2GIS
              </div>
              <input
                className={inputCls}
                placeholder="Не указана"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
              />
            </div>
          </div>
          <div>
            <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-1.5">
              Комментарий
            </div>
            <textarea
              className={`${inputCls} h-auto min-h-[64px] py-2 resize-y`}
              placeholder="Необязательно"
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
            />
          </div>
          <p className="text-[11px] text-muted-2">
            Изменения поменяются сразу у всех участников, им уйдёт уведомление со старым и
            новым временем. Запись остаётся той же — от переноса число встреч не растёт.
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() =>
                act('move', async () => {
                  await reschedule({
                    id: meeting._id,
                    date: newDate,
                    time: newTime,
                    place: newPlace,
                    mapUrl: newUrl,
                    comment: newComment,
                  })
                  setMoving(false)
                })
              }
              disabled={!!busy}
              className="btn btn-green h-8 px-3 text-sm disabled:opacity-60"
            >
              {busy === 'move' ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Check size={13} />
              )}
              Перенести
            </button>
            <button onClick={() => setMoving(false)} className="btn btn-ghost h-8 px-3 text-sm">
              Отмена
            </button>
          </div>
        </div>
      )}

      {/* §6: журнал действий по встрече. */}
      {showHistory && <MeetingHistory id={meeting._id} />}

      {error && <p className="text-sm text-[#c53030] mt-2">{error}</p>}

      {meeting.comment && (
        <div className="mt-3 rounded-xl bg-chip p-3 text-sm text-ink-2 flex items-start gap-2">
          <MessageSquare size={14} className="text-muted shrink-0 mt-0.5" />
          <span>{meeting.comment}</span>
        </div>
      )}

      <div className="mt-3 pt-3 border-t border-line flex items-center gap-2 flex-wrap">
        <Users size={14} className="text-muted shrink-0" />
        {meeting.participants.map((p) => (
          <span
            key={p._id}
            className="inline-flex items-center gap-1.5 chip bg-chip text-ink-2"
            title={p.positionLabel}
          >
            <Avatar initials={p.initials} color={p.avatarColor} size={18} />
            {p.name}
            {p._id === meeting.createdBy._id && (
              <span className="text-[10px] text-muted">создатель</span>
            )}
          </span>
        ))}
      </div>
    </div>
  )
}

// §6: журнал действий по встрече — исходные и актуальные параметры, все
// переносы, кто и когда действовал.
function MeetingHistory({ id }: { id: Id<'meetings'> }) {
  const data = useQuery(api.meetings.history, { id })
  if (!data) return null

  const LABEL: Record<string, string> = {
    created: 'создана',
    rescheduled: 'перенесена',
    updated: 'изменена',
    participants: 'состав участников',
    held: 'подтверждено проведение',
    cancelled: 'отменена',
  }

  return (
    <div className="mt-3 rounded-xl bg-chip p-3">
      <div className="text-sm font-medium text-ink mb-2">История</div>
      {data.original && data.original !== data.current && (
        <div className="text-[11px] text-muted mb-2">
          Первоначально: {data.original} · сейчас: {data.current}
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        {data.events.map((e) => (
          <div key={e._id} className="text-[11px] text-ink-2 flex gap-2 flex-wrap">
            <span className="text-muted shrink-0">
              {new Date(e.at).toLocaleString('ru-RU', { timeZone: 'Asia/Almaty' })}
            </span>
            <span className="font-medium">{LABEL[e.type] ?? e.type}</span>
            {e.from && e.to && (
              <span className="text-muted">
                {e.from} → {e.to}
              </span>
            )}
            {e.changes && <span className="text-muted">{e.changes}</span>}
            <span className="text-muted-2">— {e.by}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// §4.1: форма создания встречи.
function MeetingDrawer({ employees, onClose }: { employees: Person[]; onClose: () => void }) {
  const create = useMutation(api.meetings.create)
  const me = useCurrentUser()

  const [title, setTitle] = useState('')
  const [date, setDate] = useState(TODAY)
  const [time, setTime] = useState('10:00')
  const [place, setPlace] = useState('')
  const [mapUrl, setMapUrl] = useState('')
  const [comment, setComment] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const save = async () => {
    setError('')
    if (!title.trim()) {
      setError('Укажите название встречи.')
      return
    }
    setBusy(true)
    try {
      await create({
        title: title.trim(),
        date,
        time,
        place,
        mapUrl,
        comment,
        participantIds: picked as Id<'employees'>[],
      })
      onClose()
    } catch (e) {
      setError(errMessage(e, 'Не удалось создать встречу.'))
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-md h-full bg-bg flex flex-col">
        <div className="shrink-0 bg-white border-b border-line px-5 sm:px-6 py-4 flex items-center gap-3">
          <span className="w-9 h-9 rounded-xl bg-[#e2f2ef] text-green-d grid place-items-center shrink-0">
            <CalendarDays size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold text-ink truncate">Новая встреча</h2>
            <p className="text-[11px] text-muted">Появится у всех участников как напоминание</p>
          </div>
          <button onClick={onClose} className="ico-btn w-9 h-9" aria-label="Закрыть">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-5 flex flex-col gap-4">
          <Field label="Название встречи">
            <input
              className={inputCls}
              placeholder="Планёрка по франшизе"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Дата">
              <DatePicker value={date} onChange={setDate} />
            </Field>
            <Field label="Время">
              <input
                className={inputCls}
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            </Field>
          </div>

          <Field label="Место встречи">
            <input
              className={inputCls}
              placeholder="Офис, 3 этаж"
              value={place}
              onChange={(e) => setPlace(e.target.value)}
            />
          </Field>

          <Field label="Ссылка на 2GIS">
            <input
              className={inputCls}
              placeholder="https://2gis.kz/..."
              value={mapUrl}
              onChange={(e) => setMapUrl(e.target.value)}
            />
          </Field>

          <Field label="Комментарий">
            <textarea
              className={`${inputCls} h-auto min-h-[76px] py-2 resize-y`}
              placeholder="Что обсуждаем"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </Field>

          <div>
            <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-1.5">
              Участники
            </div>
            <p className="text-[11px] text-muted-2 mb-2">
              Вы участвуете автоматически как создатель. Выберите коллег, которых приглашаете.
            </p>
            <div className="flex flex-wrap gap-2">
              {employees
                .filter((e) => e._id !== me.id)
                .map((e) => {
                  const on = picked.includes(e._id)
                  return (
                    <button
                      key={e._id}
                      type="button"
                      onClick={() =>
                        setPicked((p) =>
                          p.includes(e._id) ? p.filter((x) => x !== e._id) : [...p, e._id],
                        )
                      }
                      className={`inline-flex items-center gap-1.5 chip transition-colors ${
                        on ? 'bg-[#e2f2ef] text-green-d' : 'bg-chip text-muted hover:text-ink-2'
                      }`}
                    >
                      <Avatar initials={e.initials} color={e.avatarColor} size={18} />
                      {e.name}
                      {on && <Check size={12} />}
                    </button>
                  )
                })}
            </div>
          </div>
        </div>

        <div className="shrink-0 bg-white border-t border-line px-5 sm:px-6 py-4 flex flex-col gap-3">
          {error && <p className="text-sm text-[#c53030]">{error}</p>}
          <div className="flex gap-2">
            <button onClick={onClose} className="btn btn-ghost flex-1">
              Отмена
            </button>
            <button onClick={save} disabled={busy} className="btn btn-green flex-1 disabled:opacity-60">
              {busy && <Loader2 size={15} className="animate-spin" />}
              Создать
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-1.5">
        {label}
      </div>
      {children}
    </div>
  )
}
