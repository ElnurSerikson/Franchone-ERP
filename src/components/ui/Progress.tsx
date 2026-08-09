// Круговой индикатор (как «gauge» в demo) и линейный прогресс-бар.

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
}: RingProps) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const clamped = Math.max(0, Math.min(1, value))
  const dash = c * clamped
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c - dash}`}
        />
      </svg>
      <div className="absolute text-center">
        <div className={`${labelClass} font-bold text-ink leading-none`}>
          {label ?? Math.round(clamped * 100) + '%'}
        </div>
        {caption && <div className={`${captionClass} text-muted mt-1`}>{caption}</div>}
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
