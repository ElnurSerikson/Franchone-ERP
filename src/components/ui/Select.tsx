import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Check } from 'lucide-react'

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
}: {
  value: string
  onChange: (v: string) => void
  options: SelectOption[]
  placeholder?: string
  className?: string
  variant?: 'input' | 'ghost'
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const selected = options.find((o) => o.value === value)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const trigger =
    variant === 'ghost'
      ? `inline-flex items-center gap-1 text-sm font-semibold cursor-pointer transition-colors ${
          selected ? 'text-ink' : 'text-muted'
        } hover:text-green-d`
      : `w-full h-[38px] flex items-center gap-2 rounded-lg border px-2.5 text-sm bg-white transition-colors ${
          open ? 'border-green-light' : 'border-line-2 hover:border-muted-2'
        } ${selected ? 'text-ink' : 'text-muted'}`

  return (
    <div ref={ref} className={`relative ${variant === 'ghost' ? 'inline-block' : ''} ${className}`}>
      <button type="button" onClick={() => setOpen((o) => !o)} className={trigger}>
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

      {open && (
        <div
          className={`absolute z-[60] mt-1.5 bg-white rounded-xl border border-line shadow-soft p-1.5 max-h-64 overflow-y-auto ${
            align === 'right' ? 'right-0' : 'left-0'
          } ${variant === 'ghost' ? 'min-w-[170px]' : 'w-full min-w-max'}`}
        >
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                onChange(o.value)
                setOpen(false)
              }}
              className={`w-full flex items-center gap-2 px-2.5 h-9 rounded-lg text-sm text-left transition-colors ${
                o.value === value ? 'bg-green/10 text-green-d font-semibold' : 'text-ink-2 hover:bg-chip'
              }`}
            >
              {o.dot && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: o.dot }} />}
              <span className="flex-1 truncate">{o.label}</span>
              {o.value === value && <Check size={15} className="text-green shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
