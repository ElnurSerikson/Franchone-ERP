// §10.1 и §10.3: верхняя зона кабинета клиента и блок «Требуется от вас».
//
// Главный вопрос клиента: что уже готово, что происходит сейчас и что
// требуется от меня. На него страница и отвечает — в таком порядке.

import { Link } from 'react-router-dom'
import { useQuery } from 'convex/react'
import {
  ArrowRight, Check, CheckCircle2, Clock, FileUp, Gift, Loader2, MessageSquare,
  PuzzleIcon as Puzzle_, Sparkles, type LucideIcon,
} from 'lucide-react'
import { api } from '../../../convex/_generated/api'
import { ProgressRing } from '@/components/ui/Progress'
import { longDate } from '@/lib/format'
import { STAGE_STATUS } from '../../../convex/packModel'
import { Deadline, HealthChip } from '@/components/packs/ui'
import { useClientPack } from './ClientApp'

export default function ClientHome() {
  const packId = useClientPack()
  const data = useQuery(api.packClient.dashboard, {})
  const todo = useQuery(api.packClient.todo, packId ? { packId } : 'skip')

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
                  Открыть документы <ArrowRight size={14} />
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* §6.1, §7: линейка из пяти этапов с их статусами */}
        <div className="mt-6">
          <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-3">
            Пять этапов упаковки
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

      {/* §6.1, §7: блок пазла — собранные части, активная и закрытые. */}
      <Puzzle puzzle={data.puzzle} gift={data.gift} />

      {/* §6.1: блок «Требуется ваше внимание» */}
      <section className="card p-5 mb-5">
        <div className="flex items-center gap-2 mb-4">
          <Sparkles size={16} className="text-green" />
          <h2 className="sec-title">Требуется ваше внимание</h2>
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

    </>
  )
}

// §7: пазл из пяти частей. Часть открывается за принятый в срок основной
// этап; нулевой этап части не открывает (§4.2). Факт начисления приходит с
// сервера, поэтому повторное открытие страницы ничего не начисляет (§7.1).
function Puzzle({
  puzzle,
  gift,
}: {
  puzzle: {
    total: number
    collected: number
    parts: {
      index: number
      title: string
      open: boolean
      active: boolean
      missed: boolean
    }[]
  }
  gift: { earned: boolean }
}) {
  return (
    <section className="card p-5 mb-5">
      <div className="flex items-center gap-2 flex-wrap mb-1">
        <Puzzle_ size={16} className="text-green" />
        <h2 className="sec-title">Пазл</h2>
        <span
          className={`chip ${
            puzzle.collected === puzzle.total
              ? 'bg-[#e2f2ef] text-green-d'
              : 'bg-chip text-ink-2'
          }`}
        >
          собрано {puzzle.collected} из {puzzle.total}
        </span>
      </div>
      <p className="text-xs text-muted mb-4">
        Каждая часть открывается, когда вы принимаете этап в срок. Полный пазл — гарантированный
        персональный подарок от FRANCHONE.
      </p>

      <div className="grid grid-cols-5 gap-2 max-w-md">
        {puzzle.parts.map((p) => (
          <div
            key={p.index}
            title={p.title}
            className={`aspect-square rounded-xl grid place-items-center text-lg font-bold transition-all duration-500 ${
              p.open
                ? 'bg-green text-white shadow-soft scale-100'
                : p.missed
                  ? 'bg-[#fdeaea] text-[#c53030]'
                  : p.active
                    ? 'bg-[#e2f2ef] text-green-d ring-2 ring-green-light animate-pulse'
                    : 'hatch text-muted-2'
            }`}
          >
            {p.open ? <Check size={20} /> : p.index}
          </div>
        ))}
      </div>

      {gift.earned ? (
        <div className="mt-4 rounded-xl bg-[#e2f2ef] p-3 flex items-start gap-2.5">
          <Gift size={16} className="text-green-d shrink-0 mt-0.5" />
          <div className="text-sm text-green-d">
            Пазл собран полностью. За вами закреплён гарантированный персональный подарок от
            FRANCHONE — мы подберём его под ваш бизнес и свяжемся отдельно.
          </div>
        </div>
      ) : (
        <div className="mt-4 text-[11px] text-muted-2">
          Осталось собрать частей: {puzzle.total - puzzle.collected}. Подготовительный этап в
          пазле не участвует.
        </div>
      )}
    </section>
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
