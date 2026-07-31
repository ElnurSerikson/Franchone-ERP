import { useEffect, useMemo, useState } from 'react'

// Линейный XY-график динамики (ТЗ таргетолога §12). Своя реализация на SVG,
// без библиотеки: нужен ровно один тип графика, а любая библиотека добавила бы
// к бандлу больше, чем весит весь этот файл, и приехала бы со своим визуальным
// стилем, который пришлось бы перекрашивать.
//
// Рисуем в пикселях контейнера, а не через масштабируемый viewBox: иначе на
// широком экране SVG растягивается вместе с подписями, точками и толщиной
// линий, и аккуратный график превращается в грубый.

export interface ChartPoint {
  x: string // дата YYYY-MM-DD
  y: number | null // null — в этот день значения нет, линия разрывается
  hint?: string // что показать в подсказке помимо даты
}

export interface ChartSeries {
  id: string
  label: string
  points: ChartPoint[]
}

// Палитра серий: сначала фирменные зелёные, затем контрастные — чтобы
// соседние линии различались и в ч/б печати.
const COLORS = ['#057269', '#d69e2e', '#2563eb', '#c53030', '#7c3aed', '#0a857a', '#b7791f']

const PAD = { top: 18, right: 20, bottom: 30, left: 58 }
const HEIGHT = 260

// Округляем верх шкалы до «человеческого» шага, иначе подписи вида $4.13
// и $2.75 читаются как случайные числа.
function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0, 1]
  const raw = max / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const norm = raw / mag
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag
  const top = Math.ceil(max / step) * step
  const out: number[] = []
  for (let v = 0; v <= top + step / 1000; v += step) out.push(Number(v.toFixed(10)))
  return out
}

export default function LineChart({
  series,
  formatY,
  emptyHint = 'Нет данных за выбранный период',
}: {
  series: ChartSeries[]
  formatY: (v: number) => string
  emptyHint?: string
}) {
  const [box, setBox] = useState<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(0)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [hover, setHover] = useState<{
    left: number
    top: number
    title: string
    date: string
    hint?: string
    color: string
  } | null>(null)

  // Ширину меряем, а не задаём: график живёт и в узкой панели, и на всю
  // страницу, и в обоих местах должен выглядеть одинаково аккуратно.
  // Ref через состояние, а не useRef: контейнер появляется только когда
  // приехали данные, и наблюдатель должен подключиться именно тогда.
  useEffect(() => {
    if (!box) return
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    ro.observe(box)
    setWidth(box.getBoundingClientRect().width)
    return () => ro.disconnect()
  }, [box])

  const visible = series.filter((s) => !hidden.has(s.id))

  const { dates, maxY } = useMemo(() => {
    const all = new Set<string>()
    let max = 0
    for (const s of visible) {
      for (const p of s.points) {
        all.add(p.x)
        if (p.y !== null && p.y > max) max = p.y
      }
    }
    return { dates: [...all].sort(), maxY: max }
  }, [visible])

  if (series.length === 0) {
    return (
      <div className="rounded-xl border border-line p-8 text-center text-sm text-muted">
        {emptyHint}
      </div>
    )
  }

  const W = Math.max(width, 320)
  const plotW = W - PAD.left - PAD.right
  const plotH = HEIGHT - PAD.top - PAD.bottom
  const ticks = niceTicks(maxY)
  const top = ticks[ticks.length - 1] || 1
  // Одна дата — ставим точку по центру, иначе она прилипла бы к левому краю.
  const xAt = (i: number) =>
    PAD.left + (dates.length <= 1 ? plotW / 2 : (i / (dates.length - 1)) * plotW)
  const yAt = (v: number) => PAD.top + plotH - (v / top) * plotH

  // Подписей дат столько, сколько влезает без наложения: одна метка ≈ 46px.
  const maxLabels = Math.max(2, Math.floor(plotW / 56))
  const labelStep = Math.max(1, Math.ceil(dates.length / maxLabels))

  return (
    <div>
      <div ref={setBox} className="relative">
        {width > 0 && dates.length > 0 && (
          <svg width={W} height={HEIGHT} className="block" role="img">
            {/* Сетка и подписи оси Y */}
            {ticks.map((t) => (
              <g key={t}>
                <line
                  x1={PAD.left}
                  x2={W - PAD.right}
                  y1={yAt(t)}
                  y2={yAt(t)}
                  stroke={t === 0 ? '#e2e5e7' : '#f1f3f4'}
                  strokeWidth={1}
                  shapeRendering="crispEdges"
                />
                <text
                  x={PAD.left - 10}
                  y={yAt(t) + 4}
                  textAnchor="end"
                  fontSize={11}
                  fill="#9498a1"
                >
                  {formatY(t)}
                </text>
              </g>
            ))}

            {/* Подписи оси X */}
            {dates.map((d, i) =>
              i % labelStep === 0 || i === dates.length - 1 ? (
                <text
                  key={d}
                  x={xAt(i)}
                  y={HEIGHT - PAD.bottom + 18}
                  textAnchor={i === 0 ? 'start' : i === dates.length - 1 ? 'end' : 'middle'}
                  fontSize={11}
                  fill="#9498a1"
                >
                  {d.slice(8)}.{d.slice(5, 7)}
                </text>
              ) : null,
            )}

            {visible.map((s) => {
              const color = COLORS[series.findIndex((x) => x.id === s.id) % COLORS.length]
              const byDate = new Map(s.points.map((p) => [p.x, p]))
              // Разрываем линию там, где значения нет: соединять через пропуск
              // значило бы рисовать несуществующую динамику.
              const segments: string[] = []
              const solo: { i: number; y: number }[] = []
              let current: { i: number; y: number }[] = []
              const flush = () => {
                if (current.length > 1) {
                  segments.push(current.map((p, k) => `${k ? 'L' : 'M'}${xAt(p.i)},${yAt(p.y)}`).join(' '))
                } else if (current.length === 1) {
                  // Одинокая точка: линии из неё не выйдет, но данные есть.
                  solo.push(current[0])
                }
                current = []
              }
              dates.forEach((d, i) => {
                const p = byDate.get(d)
                if (!p || p.y === null) return flush()
                current.push({ i, y: p.y })
              })
              flush()

              return (
                <g key={s.id}>
                  {segments.map((d, i) => (
                    <path
                      key={i}
                      d={d}
                      fill="none"
                      stroke={color}
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ))}
                  {solo.map((p) => (
                    <circle key={`solo-${p.i}`} cx={xAt(p.i)} cy={yAt(p.y)} r={3} fill={color} />
                  ))}
                  {dates.map((d, i) => {
                    const p = byDate.get(d)
                    if (!p || p.y === null) return null
                    return (
                      <circle
                        key={d}
                        cx={xAt(i)}
                        cy={yAt(p.y)}
                        r={9}
                        fill="transparent"
                        className="cursor-pointer"
                        onMouseEnter={() =>
                          setHover({
                            left: xAt(i),
                            top: yAt(p.y as number),
                            title: s.label,
                            date: d,
                            hint: p.hint,
                            color,
                          })
                        }
                        onMouseLeave={() => setHover(null)}
                      />
                    )
                  })}
                  {dates.map((d, i) => {
                    const p = byDate.get(d)
                    if (!p || p.y === null) return null
                    const active = hover?.date === d && hover?.title === s.label
                    return (
                      <circle
                        key={`dot-${d}`}
                        cx={xAt(i)}
                        cy={yAt(p.y)}
                        r={active ? 5 : 3.5}
                        fill="#fff"
                        stroke={color}
                        strokeWidth={2}
                        pointerEvents="none"
                      />
                    )
                  })}
                </g>
              )
            })}
          </svg>
        )}

        {/* Подсказка — обычный DOM, а не текст в SVG: так шрифт остаётся
            системным и не «плывёт» вместе с графикой. */}
        {hover && (
          <div
            className="pointer-events-none absolute z-10 rounded-lg bg-ink px-3 py-2 shadow-soft"
            style={{
              left: Math.min(Math.max(hover.left, 80), Math.max(W - 80, 80)),
              top: hover.top - 12,
              transform: 'translate(-50%, -100%)',
            }}
          >
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-white whitespace-nowrap">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: hover.color }} />
              {hover.title}
            </div>
            <div className="text-[11px] text-white/70 whitespace-nowrap mt-0.5">
              {hover.date.slice(8)}.{hover.date.slice(5, 7)}
              {hover.hint ? ` · ${hover.hint}` : ''}
            </div>
          </div>
        )}
      </div>

      {/* Легенда: клик включает и выключает серию (§12). */}
      <div className="flex flex-wrap gap-1.5 mt-3">
        {series.map((s, i) => {
          const off = hidden.has(s.id)
          return (
            <button
              key={s.id}
              type="button"
              onClick={() =>
                setHidden((prev) => {
                  const next = new Set(prev)
                  if (next.has(s.id)) next.delete(s.id)
                  else next.add(s.id)
                  return next
                })
              }
              className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-[11px] font-semibold border transition-colors ${
                off
                  ? 'bg-white text-muted-2 border-line-2 line-through'
                  : 'bg-chip text-ink-2 border-transparent hover:bg-line'
              }`}
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ background: off ? '#d7dade' : COLORS[i % COLORS.length] }}
              />
              {s.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
