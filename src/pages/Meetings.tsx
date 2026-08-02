import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import {
  CalendarDays, Check, Clock, Loader2, MapPin, MessageSquare, Plus, Trash2, Users, X,
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

  const args =
    view === 'range'
      ? from <= to
        ? { from, to }
        : { from: to, to: from }
      : // §4.3: по умолчанию — предстоящие, от ближайшей к более поздней.
        { from: TODAY }

  const data = useQuery(api.meetings.list, { ...args, scope })
  const stats = useQuery(api.meetings.stats, {})

  const rows = (data?.rows ?? []) as Meeting[]
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
  const remove = useMutation(api.meetings.remove)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const mine = meeting.createdBy._id === meId

  return (
    <div className="card p-5">
      <div className="flex items-start gap-3 flex-wrap">
        <span className="w-10 h-10 rounded-xl bg-[#e2f2ef] text-green-d grid place-items-center shrink-0">
          <CalendarDays size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-base font-semibold text-ink">{meeting.title}</div>
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
        {(mine || isOwner) &&
          (confirm ? (
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={async () => {
                  setBusy(true)
                  try {
                    await remove({ id: meeting._id })
                  } finally {
                    setBusy(false)
                  }
                }}
                disabled={busy}
                className="btn h-8 px-3 text-sm bg-[#c53030] text-white disabled:opacity-60"
              >
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                Удалить
              </button>
              <button onClick={() => setConfirm(false)} className="btn btn-ghost h-8 px-3 text-sm">
                Отмена
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirm(true)}
              className="ico-btn w-8 h-8 text-[#c53030] shrink-0"
              title="Удалить встречу"
              aria-label="Удалить встречу"
            >
              <Trash2 size={14} />
            </button>
          ))}
      </div>

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
