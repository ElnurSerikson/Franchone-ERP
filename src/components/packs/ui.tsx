// Мелкие общие детали модуля упаковки (ТЗ Упаковка).
// Классы статусов и цвета берём из convex/packModel — так клиент, упаковщик и
// владелец видят один и тот же оттенок для одного и того же состояния.

import type { ReactNode } from 'react'
import { FileText, Link2, Paperclip, type LucideIcon } from 'lucide-react'
import {
  HEALTH,
  MATERIAL_STATUS,
  PACK_STATUS,
  REWARD_STATUS,
  SIDE_LABEL,
  STAGE_STATUS,
  humanDuration,
  type Health,
  type MaterialStatus,
  type PackStatus,
  type RewardStatus,
  type Side,
  type StageStatus,
} from '../../../convex/packModel'

export const inputCls =
  'w-full h-9 rounded-lg border border-line-2 px-3 text-sm text-ink placeholder:text-muted focus:outline-none focus:border-green-light bg-white'
export const areaCls = `${inputCls} h-auto min-h-[76px] py-2 resize-y`

// Лента вкладок. На телефоне не переносится, а скроллится от края до края —
// как канбан в «Задачах»: перенос съедал бы пол-экрана под шесть чипов.
export const tabStrip =
  'flex items-center gap-2 flex-nowrap overflow-x-auto no-scrollbar -mx-4 px-4 sm:mx-0 sm:px-0'

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div>
      <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-1.5">
        {label}
      </div>
      {children}
      {hint && <div className="text-[11px] text-muted-2 mt-1">{hint}</div>}
    </div>
  )
}

// §6.3: цвет + текстовая причина. Цвет без причины бесполезен — по нему не
// понять, кого ждут и сколько осталось.
export function HealthChip({ health, reason }: { health: Health; reason?: string }) {
  const h = HEALTH[health] ?? HEALTH.grey
  return (
    <span className={`chip whitespace-nowrap ${h.chip}`} title={reason}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: h.color }} />
      {h.label}
    </span>
  )
}

export function StageChip({ status }: { status: StageStatus }) {
  const s = STAGE_STATUS[status] ?? STAGE_STATUS.planned
  return (
    <span className={`chip whitespace-nowrap ${s.chip}`} title={s.hint}>
      {s.label}
    </span>
  )
}

export function MaterialChip({ status }: { status: MaterialStatus }) {
  const s = MATERIAL_STATUS[status] ?? MATERIAL_STATUS.planned
  return (
    <span className={`chip whitespace-nowrap ${s.chip}`} title={s.hint}>
      {s.label}
    </span>
  )
}

export function PackStatusChip({ status }: { status: PackStatus }) {
  const s = PACK_STATUS[status] ?? PACK_STATUS.draft
  return <span className={`chip whitespace-nowrap ${s.chip}`}>{s.label}</span>
}

export function RewardChip({ status }: { status: RewardStatus }) {
  const s = REWARD_STATUS[status] ?? REWARD_STATUS.locked
  return <span className={`chip whitespace-nowrap ${s.chip}`}>{s.label}</span>
}

export function SideChip({ side }: { side: Side }) {
  const map: Record<Side, string> = {
    client: 'bg-[#e8effd] text-[#2563eb]',
    franchone: 'bg-[#eef0ff] text-[#5a4bd6]',
    none: 'bg-chip text-muted',
  }
  return <span className={`chip whitespace-nowrap ${map[side]}`}>{SIDE_LABEL[side]}</span>
}

// «осталось 1 день 8 часов» либо «просрочено на 2 дня» — формулировка §6.3.
export function Deadline({ at, now }: { at: number | null; now: number }) {
  if (!at) return <span className="text-muted">—</span>
  const left = at - now
  if (left < 0) {
    return (
      <span className="text-[#c53030] font-semibold whitespace-nowrap">
        просрочено на {humanDuration(-left)}
      </span>
    )
  }
  return (
    <span className="text-ink-2 whitespace-nowrap">осталось {humanDuration(left)}</span>
  )
}

export function dateTime(ms: number): string {
  return new Date(ms).toLocaleString('ru-RU', {
    timeZone: 'Asia/Almaty',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function dateOnly(ms: number): string {
  return new Date(ms).toLocaleDateString('ru-RU', {
    timeZone: 'Asia/Almaty',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

// Вложение комментария или версия материала: ссылка либо файл.
export function AttachmentLink({
  kind,
  name,
  url,
}: {
  kind: 'file' | 'link'
  name: string
  url: string | null
}) {
  const Icon = kind === 'link' ? Link2 : FileText
  // Имена файлов бывают длиннее строки — обрезаем многоточием, полное видно
  // по наведению. Иначе одна ссылка растягивает всю карточку.
  if (!url) {
    return (
      <span className="inline-flex items-center gap-1.5 chip bg-chip text-muted max-w-full">
        <Paperclip size={12} className="shrink-0" />
        <span className="truncate">{name}</span>
      </span>
    )
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      title={name}
      className="inline-flex items-center gap-1.5 chip bg-chip text-ink-2 hover:bg-line-2 transition-colors max-w-full"
    >
      <Icon size={12} className="shrink-0" />
      <span className="truncate">{name}</span>
    </a>
  )
}

// Пустое состояние в стиле остальных разделов.
export function Empty({
  icon: Icon,
  title,
  text,
}: {
  icon: LucideIcon
  title: string
  text?: string
}) {
  return (
    <div className="card p-10 text-center">
      <span className="w-12 h-12 rounded-full bg-chip text-muted grid place-items-center mx-auto mb-3">
        <Icon size={20} />
      </span>
      <div className="sec-title mb-1">{title}</div>
      {text && <p className="text-sm text-muted max-w-md mx-auto">{text}</p>}
    </div>
  )
}
