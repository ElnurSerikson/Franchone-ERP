// Круговой индикатор (как «gauge» в demo) и линейный прогресс-бар.

interface RingProps {
  value: number // 0..1
  size?: number
  stroke?: number
  color?: string
  track?: string
  label?: string
  caption?: string
}

export function ProgressRing({
  value,
  size = 160,
  stroke = 16,
  color = '#057269',
  track = '#eef0f1',
  label,
  caption,
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
        <div className="text-2xl font-bold text-ink">{label ?? Math.round(clamped * 100) + '%'}</div>
        {caption && <div className="text-xs text-muted mt-0.5">{caption}</div>}
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
