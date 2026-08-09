// §10.1 и §10.3: верхняя зона кабинета клиента и блок «Требуется от вас».
//
// Главный вопрос клиента: что уже готово, что происходит сейчас и что
// требуется от меня. На него страница и отвечает — в таком порядке.

import { Link } from 'react-router-dom'
import { useQuery } from 'convex/react'
import {
  ArrowRight, BookOpen, CalendarClock, Check, CheckCircle2, Clock, FolderOpen, Gauge, Gift,
  Loader2, PuzzleIcon as Puzzle_, Route, Sparkles, type LucideIcon,
} from 'lucide-react'
import { api } from '../../../convex/_generated/api'
import { ProgressRing } from '@/components/ui/Progress'
import Confetti, { useCelebrate } from '@/components/ui/Confetti'
import { longDate } from '@/lib/format'
import { Deadline, HealthChip } from '@/components/packs/ui'
import { useClientPack } from './ClientApp'

// Общий каркас двух верхних карточек. Графика в обеих живёт в одном и том же
// квадрате и по центру, подпись — одинаковым мелким текстом снизу. Классы
// вынесены, чтобы «привести к одному стандарту» означало одну правку, а не
// две симметричные.
const FIGURE = 'my-5 flex-1 grid place-items-center'
const CAPTION = 'text-center text-[13px] leading-snug text-muted'

// §7: пазл — это одна картинка, разрезанная на пять частей, поэтому плитки
// стоят вплотную, без зазоров. Каждая открытая часть показывает ровно свой
// кусок общего изображения: col/row — место в сетке 3×3, cs/rs — сколько
// ячеек занимает. Отсюда же считаются размер и сдвиг картинки внутри плитки.
// `corner` — плитка стоит в углу квадрата и обязана повторить его радиус:
// иначе обводка активной части упирается в скругление контейнера и её
// срезает по прямой.
const PUZZLE_IMAGE = '/puzzle-globe.svg'
const CELLS = [
  { span: 'col-span-2 row-span-2', corner: 'rounded-tl-2xl', col: 0, row: 0, cs: 2, rs: 2 },
  { span: '', corner: 'rounded-tr-2xl', col: 2, row: 0, cs: 1, rs: 1 },
  { span: '', corner: '', col: 2, row: 1, cs: 1, rs: 1 },
  { span: 'col-span-2', corner: 'rounded-bl-2xl', col: 0, row: 2, cs: 2, rs: 1 },
  { span: '', corner: 'rounded-br-2xl', col: 2, row: 2, cs: 1, rs: 1 },
]

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
  // Салют на финише: один раз, когда готовность впервые дошла до 100%.
  const finished = useCelebrate(`done:${packId}`, p.progress >= 100 ? 1 : 0)

  return (
    <>
      {/* §10.1: верхняя зона — тёмный герой. Две карточки одного устройства:
          заголовок с чипом, пояснение, квадрат с графикой, подпись внизу.
          Порядок и размеры совпадают, поэтому строки читаются парами. */}
      <div className="grid gap-5 lg:grid-cols-2 mb-5">
        {/* Готовность проекта */}
        <section className="hero-dark card border-transparent rise p-5 sm:p-6 flex flex-col relative">
          <Confetti show={finished} />
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <Gauge size={16} className="text-[#7fd4c4]" />
            <h2 className="sec-title text-white">{p.title}</h2>
            <HealthChip health={p.health} reason={p.healthReason} />
          </div>
          <p className="text-[13px] text-white/60">
            Готовность считается по утверждённым этапам. Плановое завершение —{' '}
            {longDate(p.dueDate)}.
          </p>

          <div className={FIGURE}>
            <div className={p.health === 'red' || p.health === 'yellow' ? 'rounded-full halo' : ''}>
              <ProgressRing
                value={p.progress / 100}
                size={264}
                stroke={20}
                caption="готовность"
                labelClass="text-[52px] text-white"
                captionClass="text-[15px] text-white"
                track="rgba(255,255,255,0.12)"
                gradient={['#7fd4c4', '#4db3a6']}
                animate
                glow
              />
            </div>
          </div>

          <div className={`${CAPTION} text-white/60`}>
            {p.currentStage && (
              <div className="font-semibold text-white/90">Сейчас: {p.currentStage.title}</div>
            )}
            {p.pausedReason && (
              <div className="mt-0.5 text-[#f6c66b]">Проект на паузе: {p.pausedReason}</div>
            )}
          </div>

          {/* §10.1: таймер текущего согласования — единственное место, где
              заказчика зовут действовать прямо с обзора. */}
          {p.timerDueAt && (
            <div className="mt-3 rounded-xl bg-white/10 ring-1 ring-white/20 backdrop-blur p-3 flex items-center gap-2 flex-wrap justify-center">
              <Clock size={15} className="text-[#9dc0ff] shrink-0" />
              <span className="text-[15px] text-white/90">
                Ответ по этапу «{p.awaitingStage?.title}» —{' '}
                <Deadline at={p.timerDueAt} now={data.now} />
              </span>
              <Link
                to="/stages"
                className="btn h-9 px-3.5 text-[15px] bg-white text-green-d hover:bg-white/90"
              >
                Открыть документы <ArrowRight size={14} />
              </Link>
            </div>
          )}
        </section>

        {/* §6.1, §7: пазл — собранные части, активная и закрытые. */}
        <Puzzle puzzle={data.puzzle} gift={data.gift} packId={packId as string} />
      </div>

      {/* §6.1, §7: линейка из пяти этапов с их статусами — во всю ширину.
          Колонки тянутся по ширине карточки, поэтому трек обходится без
          горизонтальной прокрутки и обрезанных названий. */}
      <section className="card rise d2 p-5 sm:p-6 mb-5">
        <div className="flex items-center gap-2 mb-5">
          <Route size={16} className="text-green" />
          <h2 className="sec-title">Пять этапов упаковки</h2>
        </div>

        {/* Телефон: путь идёт сверху вниз, название этапа — справа от кружка.
            В строку пять названий на узком экране не встают. */}
        <div className="md:hidden flex flex-col">
          {p.path.map((s, i) => {
            const done = s.status === 'approved'
            const active = !done && p.currentStage?._id === s._id
            const last = i === p.path.length - 1
            return (
              <div key={s._id} className="flex gap-4">
                {/* Колонка тянется на всю высоту строки, поэтому линия идёт от
                    нижнего края кружка до самого низа — то есть ровно до
                    следующего кружка. Отступ снизу и есть длина линии. */}
                <div className={`relative w-14 shrink-0 ${last ? '' : 'pb-6'}`}>
                  <div
                    className={`relative w-14 h-14 rounded-full grid place-items-center text-2xl font-bold ${
                      done
                        ? 'bg-gradient-to-br from-green-2 to-green-d text-white shadow-[0_6px_16px_-8px_rgba(4,79,72,0.9)]'
                        : active
                          ? 'bg-[#e2f2ef] text-green-d ring-4 ring-green-light halo'
                          : 'bg-chip text-muted'
                    }`}
                  >
                    {done ? <CheckCircle2 size={30} /> : i + 1}
                  </div>
                  {!last && (
                    <span
                      className={`absolute left-1/2 -translate-x-1/2 top-14 bottom-0 w-1.5 ${
                        done ? 'bg-green' : 'bg-line'
                      }`}
                    />
                  )}
                </div>
                <div
                  className={`min-h-14 flex items-center text-[15px] leading-snug text-ink-2 ${
                    last ? '' : 'pb-6'
                  }`}
                >
                  {s.title}
                </div>
              </div>
            )
          })}
        </div>

        {/* Планшет и десктоп: горизонтальный трек, названия под кружками. */}
        <div className="hidden md:flex items-start">
          {p.path.map((s, i) => {
            const done = s.status === 'approved'
            const active = !done && p.currentStage?._id === s._id
            const prevDone = i > 0 && p.path[i - 1].status === 'approved'
            return (
              <div key={s._id} className="flex-1 min-w-0 flex flex-col items-center gap-3">
                {/* Перемычки рисуем половинками по бокам кружка: так трек
                    растягивается вместе с колонками. */}
                <div className="relative w-full h-16 flex items-center justify-center">
                  {i > 0 && (
                    <span
                      className={`absolute left-0 top-1/2 -translate-y-1/2 h-1.5 w-1/2 ${
                        prevDone ? 'bg-green' : 'bg-line'
                      }`}
                    />
                  )}
                  {i < p.path.length - 1 && (
                    <span
                      className={`absolute right-0 top-1/2 -translate-y-1/2 h-1.5 w-1/2 ${
                        done ? 'bg-green' : 'bg-line'
                      }`}
                    />
                  )}
                  <div
                    className={`relative w-16 h-16 rounded-full grid place-items-center text-2xl font-bold ${
                      done
                        ? 'bg-gradient-to-br from-green-2 to-green-d text-white shadow-[0_6px_16px_-8px_rgba(4,79,72,0.9)]'
                        : active
                          ? 'bg-[#e2f2ef] text-green-d ring-4 ring-green-light halo'
                          : 'bg-chip text-muted'
                    }`}
                  >
                    {done ? <CheckCircle2 size={30} /> : i + 1}
                  </div>
                </div>
                <div className="px-1 text-[13px] text-center leading-tight text-ink-2 line-clamp-3">
                  {s.title}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* §6.1: блок «Требуется ваше внимание» */}
      <section className="card rise d3 p-5 mb-5">
        <div className="flex items-center gap-2 mb-4">
          <Sparkles size={16} className="text-[#2563eb]" />
          <h2 className="sec-title">Требуется ваше внимание</h2>
          {todo && todo.awaitingStages.length > 0 && (
            <span className="chip bg-[#e8effd] text-[#2563eb]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#2563eb] dot-pulse" />
              {todo.awaitingStages.length}
            </span>
          )}
        </div>

        {todo === undefined ? (
          <div className="grid place-items-center py-6 text-muted">
            <Loader2 className="animate-spin" size={18} />
          </div>
        ) : !todo ? null : todo.awaitingStages.length === 0 ? (
          <p className="text-[15px] text-muted">
            Сейчас от вас ничего не требуется. Команда FRANCHONE работает над проектом — как только
            этап будет готов, он придёт вам на проверку.
          </p>
        ) : (
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
                className="block rounded-xl border border-[#cddcf9] bg-[#f7faff] p-3.5 lift transition-all"
              >
                <div className="text-[15px] font-semibold text-ink">{s.title}</div>
                {s.note && <div className="text-[13px] text-muted mt-0.5 line-clamp-2">{s.note}</div>}
                <div className="text-[13px] mt-1">
                  <Deadline at={s.dueAt} now={todo.now} />
                  {s.repeat && ' · повторная проверка'}
                </div>
              </Link>
            ))}
          </Block>
        )}

        {todo && todo.deadlines.length > 0 && (
          <div className="mt-4 pt-4 border-t border-line">
            <div className="text-[13px] font-semibold text-muted uppercase tracking-wide mb-2">
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

      {/* Мост в остальные разделы: с обзора должно быть видно, куда идти
          дальше, а не только что происходит сейчас. */}
      <section className="grid gap-4 sm:grid-cols-3 rise d4 mb-5">
        <NextCard
          to="/stages"
          icon={FolderOpen}
          title="Документы"
          text="Открыть, оценить и принять"
          tint="from-[#e8effd] to-white"
          color="#2563eb"
        />
        <NextCard
          to="/calendar"
          icon={CalendarClock}
          title="Сроки"
          text="Что и когда предстоит"
          tint="from-[#fff6e6] to-white"
          color="#b7791f"
        />
        <NextCard
          to="/learn"
          icon={BookOpen}
          title="Полезное"
          text="Видео, статьи и тесты"
          tint="from-[#f1ecfd] to-white"
          color="#7c5cd6"
        />
      </section>
    </>
  )
}

// Карточка-переход в соседний раздел: крупная иконка, короткая мысль и
// стрелка, которая подаётся вперёд при наведении.
function NextCard({
  to,
  icon: Icon,
  title,
  text,
  tint,
  color,
}: {
  to: string
  icon: LucideIcon
  title: string
  text: string
  tint: string
  color: string
}) {
  return (
    <Link
      to={to}
      className={`card lift group relative overflow-hidden p-5 bg-gradient-to-br ${tint} flex items-center gap-4`}
    >
      <span
        className="w-12 h-12 rounded-2xl grid place-items-center shrink-0 ring-1 ring-black/5"
        style={{ background: '#fff', color }}
      >
        <Icon size={22} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[16px] font-bold text-ink">{title}</span>
        <span className="block text-[13px] text-muted mt-0.5">{text}</span>
      </span>
      <ArrowRight
        size={18}
        className="shrink-0 text-muted-2 transition-transform group-hover:translate-x-1"
        style={{ color }}
      />
    </Link>
  )
}

// §7: пазл из пяти частей. Часть открывается за принятый в срок основной
// этап; нулевой этап части не открывает (§4.2). Факт начисления приходит с
// сервера, поэтому повторное открытие страницы ничего не начисляет (§7.1).
function Puzzle({
  puzzle,
  gift,
  packId,
}: {
  packId: string
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
  // Бенто из пяти плиток в квадрате 3×3: первая часть занимает четверть
  // побольше, четвёртая — широкую полосу. Раскладка рассчитана ровно на пять
  // частей (PUZZLE_PARTS); если их вдруг станет иначе, спокойно вырождается
  // в равный ряд.
  const bento = puzzle.parts.length === 5
  // Салют — на открытие новой части, а не на каждый заход в кабинет.
  const won = useCelebrate(`puzzle:${packId}`, puzzle.collected)

  return (
    <section className="hero-dark card border-transparent rise d1 p-5 sm:p-6 flex flex-col relative">
      <Confetti show={won} />
      <div className="flex items-center gap-2 flex-wrap mb-1">
        <Puzzle_ size={16} className="text-[#c4b1f5]" />
        <h2 className="sec-title text-white">Пазл</h2>
        <span
          className={`chip ${
            puzzle.collected === puzzle.total
              ? 'bg-[#7c5cd6] text-white'
              : 'bg-white/12 text-white/80 ring-1 ring-white/20'
          }`}
        >
          собрано {puzzle.collected} из {puzzle.total}
        </span>
      </div>
      <p className="text-[13px] text-white/60">
        Каждая часть открывается, когда вы принимаете этап в срок. Полный пазл — гарантированный
        персональный подарок от FRANCHONE.
      </p>

      <div className={FIGURE}>
        <div
          className={`w-full max-w-[264px] overflow-hidden rounded-2xl ${
            bento ? 'grid grid-cols-3 grid-rows-3 aspect-square' : 'grid grid-cols-5 gap-2'
          }`}
        >
          {puzzle.parts.map((p, i) => {
            const c = CELLS[i]
            const big = bento && i === 0
            return (
              <div
                key={p.index}
                title={p.title}
                className={`${bento ? `${c.span} ${c.corner}` : 'aspect-square rounded-xl'} relative overflow-hidden grid place-items-center font-bold transition-all duration-500 ${
                  big ? 'text-4xl' : 'text-2xl'
                } ${
                  p.open
                    ? ''
                    : p.missed
                      ? 'bg-[#4a1f28] text-[#ff9b9b] ring-1 ring-inset ring-white/10'
                      : p.active
                        ? 'bg-white/15 text-white ring-2 ring-inset ring-[#7fd4c4] animate-pulse'
                        : 'bg-white/[0.09] text-white/45 ring-1 ring-inset ring-white/15'
                }`}
              >
                {p.open && bento ? (
                  <>
                  // Кусок общей картинки: растягиваем её до размера всего
                  // квадрата и сдвигаем так, чтобы в окне плитки оказалась
                  // именно её доля.
                  <img
                    src={PUZZLE_IMAGE}
                    alt=""
                    aria-hidden
                    draggable={false}
                    className="absolute max-w-none select-none pointer-events-none"
                    style={{
                      width: `${(3 / c.cs) * 100}%`,
                      height: `${(3 / c.rs) * 100}%`,
                      left: `${-(c.col / c.cs) * 100}%`,
                      top: `${-(c.row / c.rs) * 100}%`,
                    }}
                  />
                  {/* Блик пробегает по только что открытой части. */}
                  {won && <span className="sheen absolute inset-0" />}
                  </>
                ) : p.open ? (
                  <span className="grid place-items-center w-full h-full bg-green text-white">
                    <Check size={22} />
                  </span>
                ) : (
                  p.index
                )}
              </div>
            )
          })}
        </div>
      </div>

      {gift.earned ? (
        <div className={`${CAPTION} text-white/60`}>
          <div className="font-semibold text-[#c4b1f5]">
            <Gift size={13} className="inline -mt-0.5 mr-1" />
            Пазл собран полностью
          </div>
          <div className="mt-0.5">
            За вами закреплён гарантированный персональный подарок от FRANCHONE — мы подберём его
            под ваш бизнес и свяжемся отдельно.
          </div>
        </div>
      ) : (
        <div className={`${CAPTION} text-white/60`}>
          <div className="font-semibold text-white/90">
            Осталось собрать частей: {puzzle.total - puzzle.collected}
          </div>
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
        <span className="text-[15px] font-semibold text-ink">{title}</span>
        {count > 0 && <span className="chip bg-[#e2f2ef] text-green-d">{count}</span>}
      </div>
      {count === 0 ? (
        <p className="text-[13px] text-muted">{empty}</p>
      ) : (
        <div className="flex flex-col gap-2">{children}</div>
      )}
    </div>
  )
}
