// §10.1 и §10.3: верхняя зона кабинета клиента и блок «Требуется от вас».
//
// Главный вопрос клиента: что уже готово, что происходит сейчас и что
// требуется от меня. На него страница и отвечает — в таком порядке.

import { Link } from 'react-router-dom'
import { useMutation, useQuery } from 'convex/react'
import {
  ArrowRight, CheckCircle2, Clock, FileUp, Gift, Loader2, MessageSquare, Send, Sparkles,
  type LucideIcon,
} from 'lucide-react'
import { useState } from 'react'
import { api } from '../../../convex/_generated/api'
import { ProgressRing } from '@/components/ui/Progress'
import { errMessage } from '@/lib/errors'
import { longDate } from '@/lib/format'
import { STAGE_STATUS } from '../../../convex/packModel'
import { Deadline, HealthChip, RewardChip, areaCls } from '@/components/packs/ui'
import { useClientPack } from './ClientApp'

export default function ClientHome() {
  const packId = useClientPack()
  const data = useQuery(api.packClient.dashboard, {})
  const todo = useQuery(api.packClient.todo, packId ? { packId } : 'skip')
  const contact = useMutation(api.packClient.contactTeam)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  if (!data?.pack || !packId) {
    return (
      <div className="card p-10 grid place-items-center text-muted">
        <Loader2 className="animate-spin" size={20} />
      </div>
    )
  }
  const p = data.pack

  return (
    <>
      {/* §10.1: верхняя зона */}
      <section className="card p-5 sm:p-6 mb-5">
        <div className="flex flex-col sm:flex-row items-start gap-6">
          <div className="mx-auto sm:mx-0 shrink-0">
            <ProgressRing
              value={p.progress / 100}
              size={140}
              stroke={14}
              caption="готовность"
            />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold text-ink">{p.title}</h1>
            <div className="flex items-center gap-2 flex-wrap mt-2">
              <HealthChip health={p.health} reason={p.healthReason} />
              {p.currentStage && (
                <span className="chip bg-chip text-ink-2">
                  сейчас: {p.currentStage.title}
                </span>
              )}
              <span className="chip bg-chip text-muted">
                плановое завершение {longDate(p.dueDate)}
              </span>
            </div>
            <p className="text-sm text-ink-2 mt-3">{p.nextAction}</p>
            {p.pausedReason && (
              <p className="text-sm text-[#b7791f] mt-1">Проект на паузе: {p.pausedReason}</p>
            )}

            {/* §10.1: таймер текущего согласования */}
            {p.timerDueAt && (
              <div className="mt-3 rounded-xl bg-[#e8effd] p-3 flex items-center gap-2 flex-wrap">
                <Clock size={15} className="text-[#2563eb]" />
                <span className="text-sm text-[#1d4ed8]">
                  Ответ по этапу «{p.awaitingStage?.title}» —{' '}
                  <Deadline at={p.timerDueAt} now={data.now} />
                </span>
                <Link to="/stages" className="btn btn-green h-8 px-3 text-sm ml-auto">
                  Открыть этап <ArrowRight size={14} />
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* §10.1: визуальный путь / Season Pass */}
        <div className="mt-6">
          <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-3">
            Ваш путь
          </div>
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar pb-1 -mx-5 px-5 sm:mx-0 sm:px-0">
            {p.path.map((s, i) => {
              const done = s.status === 'approved'
              const active = !done && p.currentStage?._id === s._id
              return (
                <div key={s._id} className="flex items-center shrink-0">
                  <div className="flex flex-col items-center gap-1.5 w-[124px]">
                    <div
                      className={`w-10 h-10 rounded-full grid place-items-center text-sm font-bold ${
                        done
                          ? 'bg-green text-white'
                          : active
                            ? 'bg-[#e2f2ef] text-green-d ring-2 ring-green-light'
                            : 'bg-chip text-muted'
                      }`}
                    >
                      {done ? <CheckCircle2 size={18} /> : i + 1}
                    </div>
                    <div className="text-[11px] text-center leading-tight text-ink-2 line-clamp-2">
                      {s.title}
                    </div>
                    <div className="text-[10px] text-muted-2">
                      {s.weight}% · {STAGE_STATUS[s.status].label}
                    </div>
                  </div>
                  {i < p.path.length - 1 && (
                    <div className={`h-1 w-6 rounded-full ${done ? 'bg-green' : 'bg-line'}`} />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* §10.3: блок «Требуется от вас» */}
      <section className="card p-5 mb-5">
        <div className="flex items-center gap-2 mb-4">
          <Sparkles size={16} className="text-green" />
          <h2 className="sec-title">Требуется от вас</h2>
        </div>

        {todo === undefined ? (
          <div className="grid place-items-center py-6 text-muted">
            <Loader2 className="animate-spin" size={18} />
          </div>
        ) : !todo ? null : todo.awaitingStages.length === 0 &&
          todo.uploads.length === 0 &&
          todo.openComments.length === 0 ? (
          <p className="text-sm text-muted">
            Сейчас от вас ничего не требуется. Команда FRANCHONE работает над проектом — как только
            этап будет готов, он придёт вам на проверку.
          </p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-3">
            <Block
              icon={CheckCircle2}
              title="Этапы на проверке"
              empty="Этапов на проверке нет."
              count={todo.awaitingStages.length}
            >
              {todo.awaitingStages.map((s) => (
                <Link
                  key={s._id}
                  to="/stages"
                  className="block rounded-xl border border-line p-3 hover:bg-chip/60 transition-colors"
                >
                  <div className="text-[13px] font-semibold text-ink">{s.title}</div>
                  {s.note && <div className="text-[11px] text-muted mt-0.5 line-clamp-2">{s.note}</div>}
                  <div className="text-[11px] mt-1">
                    <Deadline at={s.dueAt} now={todo.now} />
                    {s.repeat && ' · повторная проверка'}
                  </div>
                </Link>
              ))}
            </Block>

            <Block
              icon={FileUp}
              title="Загрузить материалы"
              empty="Ничего загружать не нужно."
              count={todo.uploads.length}
            >
              {todo.uploads.map((m) => (
                <Link
                  key={m._id}
                  to="/stages"
                  className="block rounded-xl border border-line p-3 hover:bg-chip/60 transition-colors"
                >
                  <div className="text-[13px] font-semibold text-ink">{m.title}</div>
                  <div className="text-[11px] text-muted mt-0.5">
                    {m.stage}
                    {m.dueDate ? ` · до ${m.dueDate}` : ''}
                    {m.required ? ' · обязательный' : ''}
                  </div>
                </Link>
              ))}
            </Block>

            <Block
              icon={MessageSquare}
              title="Неотвеченные комментарии"
              empty="Открытых вопросов нет."
              count={todo.openComments.length}
            >
              {todo.openComments.slice(0, 5).map((c) => (
                <Link
                  key={c._id}
                  to="/stages"
                  className="block rounded-xl border border-line p-3 hover:bg-chip/60 transition-colors"
                >
                  <div className="text-[12px] text-ink-2 line-clamp-3">{c.text}</div>
                  {c.stage && <div className="text-[11px] text-muted mt-0.5">{c.stage}</div>}
                </Link>
              ))}
            </Block>
          </div>
        )}

        {todo && todo.deadlines.length > 0 && (
          <div className="mt-4 pt-4 border-t border-line">
            <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-2">
              Ближайшие сроки
            </div>
            <div className="flex flex-wrap gap-2">
              {todo.deadlines.map((d, i) => (
                <span
                  key={i}
                  className={`chip ${d.mine ? 'bg-[#e8effd] text-[#2563eb]' : 'bg-chip text-muted'}`}
                >
                  <Clock size={11} /> {d.title} · <Deadline at={d.dueAt} now={todo.now} />
                </span>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* §10.1: текущая и будущие награды */}
      {data.rewards.length > 0 && (
        <section className="card p-5 mb-5">
          <div className="flex items-center gap-2 mb-3">
            <Gift size={16} className="text-green" />
            <h2 className="sec-title">Награды</h2>
            <Link to="/rewards" className="text-[12px] text-green-d underline ml-auto">
              все награды
            </Link>
          </div>
          <div className="flex flex-wrap gap-2">
            {data.rewards.slice(0, 6).map((r) => (
              <span key={r._id} className="inline-flex items-center gap-2 chip bg-chip text-ink-2">
                {r.title} <RewardChip status={r.status} />
              </span>
            ))}
          </div>
        </section>
      )}

      {/* §10.4: канал обращения к команде FRANCHONE */}
      <section className="card p-5">
        <div className="flex items-center gap-2 mb-3">
          <Send size={16} className="text-green" />
          <h2 className="sec-title">Написать команде FRANCHONE</h2>
        </div>
        <textarea
          className={areaCls}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Вопрос, пожелание или уточнение по проекту"
        />
        {error && <p className="text-sm text-[#c53030] mt-2">{error}</p>}
        {sent && <p className="text-sm text-green-d mt-2">Сообщение отправлено команде.</p>}
        <div className="mt-3">
          <button
            onClick={async () => {
              setBusy(true)
              setError('')
              setSent(false)
              try {
                await contact({ packId, text: message })
                setMessage('')
                setSent(true)
              } catch (e) {
                setError(errMessage(e, 'Не удалось отправить сообщение.'))
              } finally {
                setBusy(false)
              }
            }}
            disabled={busy || !message.trim()}
            className="btn btn-green h-9 px-4 text-sm disabled:opacity-50"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Отправить
          </button>
        </div>
      </section>
    </>
  )
}

function Block({
  icon: Icon,
  title,
  count,
  empty,
  children,
}: {
  icon: LucideIcon
  title: string
  count: number
  empty: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <Icon size={14} className="text-muted" />
        <span className="text-sm font-semibold text-ink">{title}</span>
        {count > 0 && <span className="chip bg-[#e2f2ef] text-green-d">{count}</span>}
      </div>
      {count === 0 ? (
        <p className="text-[12px] text-muted">{empty}</p>
      ) : (
        <div className="flex flex-col gap-2">{children}</div>
      )}
    </div>
  )
}
