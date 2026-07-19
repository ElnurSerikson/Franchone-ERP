interface AvatarProps {
  initials: string
  color: string
  size?: number
  ring?: boolean
}

export default function Avatar({ initials, color, size = 40, ring }: AvatarProps) {
  return (
    <div
      className={`inline-flex items-center justify-center rounded-full text-white font-semibold shrink-0 ${
        ring ? 'ring-2 ring-white' : ''
      }`}
      style={{ width: size, height: size, background: color, fontSize: size * 0.36 }}
    >
      {initials}
    </div>
  )
}
