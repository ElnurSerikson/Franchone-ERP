// §10.4 и §13.1: дополнительные разделы кабинета клиента — все материалы и
// история версий, календарь проекта, награды, обучающие материалы,
// уведомления и итоговый хаб готовой франшизы.

import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery } from 'convex/react'
import {
  ArrowLeft, BookOpen, CalendarDays, CheckCircle2, FolderOpen, Gift, Loader2, Play, Sparkles,
} from 'lucide-react'
import { api } from '../../../convex/_generated/api'
import { longDate, shortDate } from '@/lib/format'
import { ProgressRing } from '@/components/ui/Progress'
import Confetti, { useCelebrate } from '@/components/ui/Confetti'
import type { Id } from '../../../convex/_generated/dataModel'
import { errMessage } from '@/lib/errors'
import {
  CONTENT_KIND_LABEL, EVENT_LABEL, MATERIAL_KIND_LABEL, youtubeId,
} from '../../../convex/packModel'
import { AttachmentLink, Empty, MaterialChip, dateTime } from '@/components/packs/ui'
import { useClientPack } from './ClientApp'

function Loading() {
  return (
    <div className="card p-10 grid place-items-center text-muted">
      <Loader2 className="animate-spin" size={20} />
    </div>
  )
}

// §10.4: все материалы и история версий.
export function ClientMaterials() {
  const packId = useClientPack()
  const rows = useQuery(api.packClient.materials, packId ? { packId } : 'skip')
  if (!packId || rows === undefined) return <Loading />

  const byStage = new Map<string, typeof rows>()
  for (const m of rows) {
    const arr = byStage.get(m.stage) ?? []
    arr.push(m)
    byStage.set(m.stage, arr)
  }

  return (
    <>
      <h1 className="text-2xl font-bold text-ink mb-1">Материалы проекта</h1>
      <p className="text-[15px] text-muted mb-5">
        Все доступные вам материалы и полная история версий.
      </p>
      {rows.length === 0 ? (
        <Empty
          icon={FolderOpen}
          title="Материалов пока нет"
          text="Они появятся, когда команда передаст первый этап на проверку."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {[...byStage.entries()].map(([stage, items]) => (
            <section key={stage} className="card p-5">
              <h2 className="sec-title mb-3">{stage}</h2>
              <div className="flex flex-col gap-2">
                {items.map((m) => (
                  <div key={m._id} className="rounded-xl border border-line p-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[15px] font-semibold text-ink flex-1">{m.title}</span>
                      <MaterialChip status={m.status} />
                      <span className="chip bg-chip text-muted">
                        {MATERIAL_KIND_LABEL[m.kind] ?? m.kind}
                      </span>
                    </div>
                    {m.description && (
                      <p className="text-[13px] text-muted mt-1">{m.description}</p>
                    )}
                    {m.versions.length > 0 && (
                      <div className="flex flex-col gap-1.5 mt-2">
                        {m.versions.map((v) => (
                          <div key={v._id} className="flex items-center gap-2 flex-wrap text-[13px]">
                            <span className="chip bg-chip text-ink-2">v{v.version}</span>
                            <AttachmentLink kind={v.kind} name={v.name} url={v.url} />
                            <span className="text-muted-2">{dateTime(v.at)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  )
}

// §6.2, §10.4: календарь проекта глазами клиента.
//
// Раньше здесь была карточка на каждую дату и подпись «план/факт» у каждой
// строки — вместе с плановыми началами всех этапов это давало стену, в
// которой не найти собственный срок. Теперь впереди только то, что ещё
// предстоит, прошедшее убрано под один клик, а смысл события несёт точка
// слева, а не слово справа.

// Плановое начало этапа — внутреннее планирование производства. Заказчику
// важен срок, к которому этап закончат и передадут, а не когда за него сели.
const CALENDAR_SKIP = ['stage_start']

// Цвет точки: синяя — ждут вас, красная — общий срок проекта, жёлтая —
// деньги и контрольные точки, зелёная — уже сделано, серая — плановые вехи.
const DOT: Record<string, string> = {
  client_deadline: 'bg-[#2563eb]',
  due: 'bg-[#c53030]',
  payment: 'bg-[#d69e2e]',
  control: 'bg-[#d69e2e]',
  meeting: 'bg-green',
  start: 'bg-green-light',
  handover: 'bg-green-light',
  approved: 'bg-green-light',
  finished: 'bg-green-light',
}

type CalendarItem = { date: string; kind: string; title: string; fact: boolean }

export function ClientCalendar() {
  const packId = useClientPack()
  const data = useQuery(api.packStages.calendar, packId ? { packId } : 'skip')
  const [showPast, setShowPast] = useState(false)
  if (!packId || data === undefined) return <Loading />
  if (!data) return null

  const items = data.items.filter((i) => !CALENDAR_SKIP.includes(i.kind))
  const upcoming = items.filter((i) => i.date >= data.today)
  // Прошедшее — от свежего к старому: последнее событие интереснее первого.
  const past = items.filter((i) => i.date < data.today).reverse()

  return (
    <>
      <h1 className="text-3xl font-extrabold title-gradient mb-1 rise">Сроки</h1>
      <p className="text-[15px] text-muted mb-5 rise d1">Что и когда предстоит по проекту.</p>

      <section className="card rise d2 p-5 mb-3">
        {upcoming.length === 0 ? (
          <p className="text-[15px] text-muted">Впереди сроков нет.</p>
        ) : (
          <Timeline items={upcoming} today={data.today} />
        )}
      </section>

      {past.length > 0 && (
        <section className="card rise d3 p-5">
          <button
            onClick={() => setShowPast((v) => !v)}
            className="flex items-center gap-2 text-[15px] font-semibold text-ink-2 hover:text-ink"
          >
            <CalendarDays size={15} className="text-muted-2" />
            Уже прошло
            <span className="chip bg-chip text-muted">{past.length}</span>
          </button>
          {showPast && (
            <div className="mt-4">
              <Timeline items={past} today={data.today} />
            </div>
          )}
        </section>
      )}
    </>
  )
}

// Дата слева одной колонкой, события справа — глаз идёт по одной линии и
// не спотыкается о рамку вокруг каждого дня.
function Timeline({ items, today }: { items: CalendarItem[]; today: string }) {
  const byDate = new Map<string, CalendarItem[]>()
  for (const i of items) {
    const arr = byDate.get(i.date) ?? []
    arr.push(i)
    byDate.set(i.date, arr)
  }

  return (
    <div className="flex flex-col">
      {[...byDate.entries()].map(([date, rows], gi) => (
        <div
          key={date}
          className={`flex gap-4 ${gi > 0 ? 'border-t border-line pt-3 mt-3' : ''}`}
        >
          <div className="w-[76px] shrink-0">
            <div
              className={`text-[13px] font-semibold ${
                date === today ? 'text-green-d' : 'text-ink-2'
              }`}
            >
              {shortDate(date)}
            </div>
            {date === today && (
              <div className="mt-0.5 inline-flex text-[11px] font-bold text-white bg-gradient-to-r from-green-2 to-green-d px-2 py-0.5 rounded-full">
                сегодня
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1 flex flex-col gap-1.5">
            {rows.map((i, k) => {
              // «Этап 2 — передан на проверку»: слева суть, справа приглушённое
              // уточнение. Читается быстрее одной длинной строки.
              const [head, ...rest] = i.title.split(' — ')
              return (
                <div key={k} className="flex items-baseline gap-2">
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 translate-y-[-2px] ring-4 ring-white shadow-sm ${
                      DOT[i.kind] ?? 'bg-muted-2'
                    } ${i.kind === 'client_deadline' ? 'dot-pulse' : ''}`}
                  />
                  <span className="text-[15px] text-ink-2">{head}</span>
                  {rest.length > 0 && (
                    <span className="text-[13px] text-muted">{rest.join(' — ')}</span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

// §8: полезные материалы — видео, статьи и тесты. Блок самостоятельный: на
// прогресс, KPI, сроки приёмки и пазл он не влияет.
export function ClientLearn() {
  const packId = useClientPack()
  const rows = useQuery(api.packClient.content, packId ? { packId } : 'skip')
  // Открытый материал — это адрес, а не состояние компонента. Иначе на
  // телефоне системный жест «назад» уносит из раздела целиком: браузер о
  // раскрытой карточке не знает и отматывает историю на шаг раньше. С
  // параметром в адресе жест закрывает материал и возвращает к списку —
  // ровно то, чего человек и ждёт.
  const [params, setParams] = useSearchParams()
  const openId = params.get('m')
  if (!packId || rows === undefined) return <Loading />

  const active = rows.find((c) => (c._id as string) === openId) ?? null

  return (
    <>
      <h1 className="text-3xl font-extrabold title-gradient mb-1 rise">Полезные материалы</h1>
      <p className="text-[15px] text-muted mb-5 rise d1">
        Видео, статьи и тесты от команды FRANCHONE. На ход проекта они не влияют — это польза
        сверх упаковки.
      </p>

      {active ? (
        <ContentView
          content={active}
          packId={packId}
          // Кнопка не добавляет новый шаг в историю, а снимает текущий:
          // иначе после «Ко всем материалам» жест «назад» снова открывал бы
          // только что закрытый материал.
          onBack={() => setParams({}, { replace: true })}
        />
      ) : rows.length === 0 ? (
        <Empty
          icon={BookOpen}
          title="Материалов пока нет"
          text="Часть открывается по мере прохождения этапов, часть — после завершения проекта."
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((c, i) => (
            <button
              key={c._id}
              onClick={() => setParams({ m: c._id as string })}
              className={`card lift group overflow-hidden text-left rise ${
                ['d1', 'd2', 'd3', 'd4', 'd5'][Math.min(i, 4)]
              }`}
            >
              <div className="relative w-full h-40 overflow-hidden">
                {c.coverUrl ? (
                  <img
                    src={c.coverUrl}
                    alt=""
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                ) : (
                  // Обложки нет — рисуем её сами: цвет по типу материала,
                  // так сетка не проваливается в серую штриховку.
                  <div
                    className={`w-full h-full grid place-items-center text-white bg-gradient-to-br ${
                      c.kind === 'video'
                        ? 'from-[#2563eb] to-[#7c5cd6]'
                        : c.kind === 'test'
                          ? 'from-[#d6336c] to-[#7c5cd6]'
                          : 'from-green-2 to-green-d'
                    }`}
                  >
                    {c.kind === 'video' ? <Play size={34} /> : <BookOpen size={34} />}
                  </div>
                )}
                {c.kind === 'video' && (
                  <span className="absolute inset-0 grid place-items-center">
                    <span className="w-12 h-12 rounded-full bg-white/90 text-green-d grid place-items-center shadow-soft transition-transform group-hover:scale-110">
                      <Play size={20} />
                    </span>
                  </span>
                )}
              </div>
              <div className="p-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="chip bg-chip text-muted">
                    {CONTENT_KIND_LABEL[c.kind] ?? c.kind}
                  </span>
                  {c.result && (
                    <span className="chip bg-[#e2f2ef] text-green-d">
                      результат {c.result.correct}/{c.result.total}
                    </span>
                  )}
                </div>
                <div className="text-[15px] font-semibold text-ink mt-2">{c.title}</div>
                {c.summary && (
                  <p className="text-[13px] text-muted mt-1 line-clamp-2">{c.summary}</p>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </>
  )
}

type ContentRow = NonNullable<ReturnType<typeof useQuery<typeof api.packClient.content>>>[number]

// §8: видео проигрывается внутри ERP, статья читается внутри ERP, тест
// проходится внутри ERP — без обязательного перехода на внешний сайт.
function ContentView({
  content,
  packId,
  onBack,
}: {
  content: ContentRow
  packId: Id<'packs'>
  onBack: () => void
}) {
  const video = youtubeId(content.url)
  return (
    <>
      <button onClick={onBack} className="btn btn-ghost h-9 px-3 text-[15px] mb-4">
        <ArrowLeft size={14} /> Ко всем материалам
      </button>

      <article className="card p-5 sm:p-6">
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <span className="chip bg-chip text-muted">
            {CONTENT_KIND_LABEL[content.kind] ?? content.kind}
          </span>
        </div>
        <h2 className="text-xl font-bold text-ink">{content.title}</h2>
        {content.summary && <p className="text-[15px] text-muted mt-1">{content.summary}</p>}

        {content.coverUrl && content.kind !== 'video' && (
          <img src={content.coverUrl} alt="" className="w-full rounded-xl mt-4 max-h-80 object-cover" />
        )}

        {content.kind === 'video' && (
          <div className="mt-4">
            {video ? (
              <div className="relative w-full overflow-hidden rounded-xl" style={{ paddingTop: '56.25%' }}>
                <iframe
                  className="absolute inset-0 w-full h-full"
                  src={`https://www.youtube.com/embed/${video}`}
                  title={content.title}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            ) : (
              <p className="text-[15px] text-muted">Ссылка на видео не распознана.</p>
            )}
          </div>
        )}

        {content.body && (
          <div className="text-[14px] text-ink-2 mt-4 whitespace-pre-line leading-relaxed">
            {content.body}
          </div>
        )}

        {content.kind === 'test' && content.questions.length > 0 && (
          <TestRunner content={content} packId={packId} />
        )}
      </article>
    </>
  )
}

// §8.1: прохождение теста и подсчёт результата после завершения.
function TestRunner({ content, packId }: { content: ContentRow; packId: Id<'packs'> }) {
  const submit = useMutation(api.packClient.submitTest)
  const [answers, setAnswers] = useState<number[][]>(() => content.questions.map(() => []))
  const [result, setResult] = useState<{ correct: number; total: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const toggle = (qi: number, oi: number, multiple: boolean) => {
    setAnswers((prev) => {
      const next = prev.map((x) => [...x])
      if (multiple) {
        next[qi] = next[qi].includes(oi) ? next[qi].filter((k) => k !== oi) : [...next[qi], oi]
      } else {
        next[qi] = next[qi][0] === oi ? [] : [oi]
      }
      return next
    })
  }

  if (result) {
    return (
      <div className="mt-5 rounded-2xl bg-gradient-to-br from-[#e2f2ef] to-white p-5 relative overflow-hidden text-center">
        <Confetti show={result.correct === result.total} />
        <div className="grid place-items-center">
          <ProgressRing
            value={result.total ? result.correct / result.total : 0}
            size={140}
            stroke={12}
            label={`${result.correct}/${result.total}`}
            caption="верных ответов"
            labelClass="text-3xl text-green-d"
            captionClass="text-[13px] text-green-d"
            gradient={['#4db3a6', '#057269']}
            animate
          />
        </div>
        <div className="text-[15px] font-semibold text-green-d mt-2">Тест пройден</div>
        <button
          onClick={() => {
            setResult(null)
            setAnswers(content.questions.map(() => []))
          }}
          className="btn btn-ghost h-9 px-3.5 text-[15px] mt-3"
        >
          Пройти заново
        </button>
      </div>
    )
  }

  const answered = answers.filter((a) => a.length > 0).length
  return (
    <div className="mt-5 flex flex-col gap-4">
      {/* Видно, сколько осталось: длинный тест без этого выглядит бесконечным. */}
      <div>
        <div className="flex items-baseline justify-between mb-1.5">
          <span className="text-[13px] font-semibold text-ink-2">
            Отвечено {answered} из {content.questions.length}
          </span>
          <span className="text-[13px] text-muted tabular-nums">
            {Math.round((answered / Math.max(1, content.questions.length)) * 100)}%
          </span>
        </div>
        <div className="w-full rounded-full bg-line overflow-hidden h-2">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[#7c5cd6] to-[#d6336c] transition-all duration-500"
            style={{ width: `${(answered / Math.max(1, content.questions.length)) * 100}%` }}
          />
        </div>
      </div>
      {content.questions.map((q, qi) => (
        <div key={qi} className="rounded-xl border border-line p-4">
          <div className="text-[15px] font-semibold text-ink">
            {qi + 1}. {q.text}
          </div>
          {q.imageUrl && (
            <img src={q.imageUrl} alt="" className="rounded-lg mt-3 max-h-56 object-contain" />
          )}
          <div className="mt-3 flex flex-col gap-2">
            {q.options.map((o, oi) => {
              const on = answers[qi]?.includes(oi)
              return (
                <button
                  key={oi}
                  onClick={() => toggle(qi, oi, q.multiple)}
                  className={`text-left rounded-lg border p-2.5 transition-colors flex items-start gap-2.5 ${
                    on
                      ? 'border-[#7c5cd6] bg-[#f1ecfd] shadow-[0_6px_16px_-10px_rgba(124,92,214,0.8)]'
                      : 'border-line hover:bg-chip'
                  }`}
                >
                  <span
                    className={`w-4 h-4 shrink-0 mt-0.5 grid place-items-center border ${
                      q.multiple ? 'rounded' : 'rounded-full'
                    } ${on ? 'bg-[#7c5cd6] border-[#7c5cd6] text-white' : 'border-muted-2'}`}
                  >
                    {on && <CheckCircle2 size={10} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="text-[15px] text-ink-2">{o.text}</span>
                    {o.imageUrl && (
                      <img src={o.imageUrl} alt="" className="rounded-md mt-2 max-h-40 object-contain" />
                    )}
                  </span>
                </button>
              )
            })}
          </div>
          {q.multiple && (
            <div className="text-[13px] text-muted-2 mt-2">Можно выбрать несколько вариантов</div>
          )}
        </div>
      ))}
      {error && <p className="text-[15px] text-[#c53030]">{error}</p>}
      <div>
        <button
          onClick={async () => {
            setBusy(true)
            setError('')
            try {
              const r = await submit({ contentId: content._id, packId, answers })
              setResult(r)
            } catch (e) {
              setError(errMessage(e, 'Не удалось отправить ответы.'))
            } finally {
              setBusy(false)
            }
          }}
          disabled={busy}
          className="btn btn-green disabled:opacity-60"
        >
          {busy && <Loader2 size={15} className="animate-spin" />} Завершить тест
        </button>
      </div>
    </div>
  )
}

// §13.1: итоговый хаб — постоянный кабинет готовой франшизы.
export function ClientHub() {
  const packId = useClientPack()
  const data = useQuery(api.packClient.hub, packId ? { packId } : 'skip')
  // Финальный салют — один раз на проект, при первом открытии хаба.
  const cheer = useCelebrate(`hub:${packId}`, data?.open ? 1 : 0)
  if (!packId || data === undefined) return <Loading />
  if (!data) return null

  if (!data.open) {
    return (
      <Empty
        icon={Sparkles}
        title="Итоговый хаб откроется после завершения"
        text="Когда проект достигнет 100%, здесь появятся все итоговые документы, актуальные версии, история согласований и полученные награды. Кабинет останется у вас навсегда."
      />
    )
  }

  return (
    <>
      <section className="hero-dark card border-transparent rise p-6 mb-5 text-center relative overflow-hidden">
        <Confetti show={cheer} />
        <div className="text-[13px] uppercase tracking-widest text-white/50">FRANCHONE</div>
        <h1 className="text-3xl font-extrabold text-white mt-1">Франшиза упакована</h1>
        <p className="text-[15px] text-white/70 mt-2 max-w-xl mx-auto">
          Всё, что мы сделали вместе, останется здесь навсегда — документы, версии и награды.
        </p>
      </section>

      <h2 className="sr-only">Итоговый хаб · {data.title}</h2>
      <p className="text-[15px] text-muted mb-5 rise d1">
        Проект завершён{data.finishedAt ? ` ${longDate(new Date(data.finishedAt).toISOString().slice(0, 10))}` : ''}. Всё
        нужное остаётся здесь.
      </p>

      {data.note && <div className="card p-4 mb-4 text-[15px] text-ink-2">{data.note}</div>}

      <section className="card rise d2 p-5 mb-4">
        <div className="flex items-center gap-2 mb-3">
          <FolderOpen size={16} className="text-green" />
          <h2 className="sec-title">Итоговые документы</h2>
          <span className="chip bg-chip text-muted">{data.materials.length}</span>
        </div>
        {data.materials.length === 0 ? (
          <p className="text-[15px] text-muted">Документов нет.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {data.materials.map((m) => (
              <div key={m._id} className="rounded-xl border border-line p-3 flex items-center gap-2 flex-wrap">
                <span className="text-[15px] font-semibold text-ink flex-1">{m.title}</span>
                <span className="chip bg-chip text-muted">{m.stage}</span>
                {m.latest && (
                  <AttachmentLink kind={m.latest.kind} name={m.latest.name} url={m.latest.url} />
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {data.rewards.length > 0 && (
        <section className="card rise d3 p-5 mb-4 bg-gradient-to-br from-[#f1ecfd] to-white">
          <div className="flex items-center gap-2 mb-3">
            <Gift size={16} className="text-[#7c5cd6]" />
            <h2 className="sec-title">Полученные награды</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {data.rewards.map((r) => (
              <span key={r._id} className="inline-flex items-center gap-2 chip bg-chip text-ink-2">
                <CheckCircle2 size={12} className="text-green" /> {r.title}
              </span>
            ))}
          </div>
        </section>
      )}

      <section className="card p-5">
        <div className="flex items-center gap-2 mb-3">
          <CalendarDays size={16} className="text-green" />
          <h2 className="sec-title">История проекта и согласований</h2>
        </div>
        <div className="flex flex-col gap-1.5">
          {data.events.map((e) => (
            <div key={e._id} className="text-[13px] text-ink-2 flex gap-2 flex-wrap py-1 border-b border-line last:border-0">
              <span className="text-muted-2 w-32 shrink-0">{dateTime(e.at)}</span>
              <span className="font-medium">{EVENT_LABEL[e.type] ?? e.type}</span>
              {e.stage && <span className="text-muted">· {e.stage}</span>}
              {e.note && <span className="text-muted">{e.note}</span>}
            </div>
          ))}
        </div>
      </section>
    </>
  )
}
