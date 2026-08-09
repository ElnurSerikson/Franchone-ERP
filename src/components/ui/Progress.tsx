// Круговой индикатор (как «gauge» в demo) и линейный прогресс-бар.

import { useEffect, useId, useRef, useState } from 'react'

interface RingProps {
  value: number // 0..1
  size?: number
  stroke?: number
  color?: string
  track?: string
  label?: string
  caption?: string
  // Крупному кольцу нужна и крупная цифра внутри — иначе на 200 px она
  // теряется в середине. Классы, а не пиксели: масштаб остаётся в системе.
  labelClass?: string
  captionClass?: string
  // Дуга-градиент вместо плоского цвета: [начало, конец].
  gradient?: [string, string]
  // Отрисовать дугу от нуля и досчитать проценты при появлении. Кабинет
  // заказчика открывают редко — движение здесь работает, в рабочей админке
  // оно бы только мешало, поэтому по умолчанию выключено.
  animate?: boolean
  glow?: boolean
}

export function ProgressRing({
  value,
  size = 160,
  stroke = 16,
  color = '#057269',
  track = '#eef0f1',
  label,
  caption,
  labelClass = 'text-2xl',
  captionClass = 'text-xs',
  gradient,
  animate = false,
  glow = false,
}: RingProps) {
  const gid = useId().replace(/:/g, '')
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const clamped = Math.max(0, Math.min(1, value))

  // Значение, которое реально нарисовано: при animate оно доезжает до цели.
  const [shown, setShown] = useState(animate ? 0 : clamped)
  const raf = useRef(0)
  useEffect(() => {
    if (!animate) {
      setShown(clamped)
      return
    }
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduce) {
      setShown(clamped)
      return
    }
    const start = performance.now()
    const from = 0
    const dur = 1100
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / dur)
      // Замедление к концу — дуга «доводится», а не втыкается.
      const eased = 1 - Math.pow(1 - k, 3)
      setShown(from + (clamped - from) * eased)
      if (k < 1) raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [clamped, animate])

  const dash = c * shown
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90 overflow-visible">
        {gradient && (
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={gradient[0]} />
              <stop offset="100%" stopColor={gradient[1]} />
            </linearGradient>
          </defs>
        )}
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={gradient ? `url(#${gid})` : color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c - dash}`}
          style={glow ? { filter: `drop-shadow(0 0 10px ${gradient?.[1] ?? color}88)` } : undefined}
        />
      </svg>
      <div className="absolute text-center">
        <div className={`${labelClass} font-bold leading-none tabular-nums`}>
          {label ?? Math.round(shown * 100) + '%'}
        </div>
        {caption && <div className={`${captionClass} mt-1 opacity-70`}>{caption}</div>}
      </div>
    </div>
  )
}

export function ProgressBar({
  value,
  color = '#057269',
  height = 8,
}: {
  value: number
  color?: string
  height?: number
}) {
  const clamped = Math.max(0, Math.min(1, value))
  return (
    <div className="w-full rounded-full bg-line overflow-hidden" style={{ height }}>
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${clamped * 100}%`, background: color }}
      />
    </div>
  )
}
