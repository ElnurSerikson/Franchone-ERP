import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Check } from 'lucide-react'
import { useIsSmDown } from '@/lib/useMediaQuery'
import AnchoredPopover from './AnchoredPopover'

export interface SelectOption {
  value: string
  label: string
  dot?: string // необязательный цветной кружок слева
}

export default function Select({
  value,
  onChange,
  options,
  placeholder = 'Выберите…',
  className = '',
  variant = 'input',
  align = 'left',
  disabled = false,
}: {
  value: string
  onChange: (v: string) => void
  options: SelectOption[]
  placeholder?: string
  className?: string
  variant?: 'input' | 'ghost'
  align?: 'left' | 'right'
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const selected = options.find((o) => o.value === value)
  const isSheet = useIsSmDown() // на телефоне открываем bottom-sheet
  // Клик вне: на десктопе им занимается AnchoredPopover, у листа свой backdrop.

  const trigger =
    variant === 'ghost'
      ? `inline-flex items-center gap-1 text-sm font-semibold cursor-pointer transition-colors ${
          selected ? 'text-ink' : 'text-muted'
        } hover:text-green-d disabled:cursor-not-allowed disabled:text-muted`
      : `w-full h-[38px] flex items-center gap-2 rounded-lg border px-2.5 text-sm bg-white transition-colors ${
          open ? 'border-green-light' : 'border-line-2 hover:border-muted-2'
        } ${selected ? 'text-ink' : 'text-muted'} disabled:bg-chip disabled:text-muted disabled:cursor-not-allowed disabled:hover:border-line-2`

  const optionBtn = (o: SelectOption, big = false) => (
    <button
      key={o.value}
      type="button"
      onClick={() => {
        onChange(o.value)
        setOpen(false)
      }}
      className={`w-full flex items-center gap-2 px-2.5 rounded-lg text-sm text-left transition-colors ${
        big ? 'h-12' : 'h-9'
      } ${o.value === value ? 'bg-green/10 text-green-d font-semibold' : 'text-ink-2 hover:bg-chip'}`}
    >
      {o.dot && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: o.dot }} />}
      <span className="flex-1 truncate">{o.label}</span>
      {o.value === value && <Check size={15} className="text-green shrink-0" />}
    </button>
  )

  return (
    <div className={`relative ${variant === 'ghost' ? 'inline-block' : ''} ${className}`}>
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        className={trigger}
      >
        {selected?.dot && (
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: selected.dot }} />
        )}
        <span className={`${variant === 'ghost' ? '' : 'flex-1'} text-left truncate`}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown
          size={15}
          className={`text-muted shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open &&
        (isSheet ? (
          // Портал в body: bottom-sheet не должен зависеть от transform-предков (drawer).
          createPortal(
            <>
              <div className="sheet-backdrop" onClick={() => setOpen(false)} />
              <div className="sheet-panel p-2">
                <div className="px-2.5 py-1.5 text-[11px] font-semibold text-muted-2 uppercase tracking-wide">
                  {placeholder}
                </div>
                {options.map((o) => optionBtn(o, true))}
              </div>
            </>,
            document.body,
          )
        ) : (
          <AnchoredPopover
            anchorRef={btnRef}
            onClose={() => setOpen(false)}
            align={align}
            minWidth={variant === 'ghost' ? 170 : btnRef.current?.offsetWidth}
          >
            <div className="bg-white rounded-xl border border-line shadow-soft p-1.5 max-h-64 overflow-y-auto max-w-[calc(100vw-1.5rem)]">
              {options.map((o) => optionBtn(o))}
            </div>
          </AnchoredPopover>
        ))}
    </div>
  )
}
