import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react'
import { useIsSmDown } from '@/lib/useMediaQuery'
import AnchoredPopover from './AnchoredPopover'

const MONTHS = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
]
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

function parse(value?: string): Date | null {
  if (!value) return null
  const [y, m, d] = value.split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d)
}
function toValue(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`
}
const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

export default function DatePicker({
  value,
  onChange,
  placeholder = 'Выберите дату',
}: {
  value?: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  const selected = parse(value)
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<Date>(() => selected ?? new Date())
  const btnRef = useRef<HTMLButtonElement>(null)
  const isSheet = useIsSmDown() // на телефоне — bottom-sheet
  // Клик вне: на десктопе им занимается AnchoredPopover, у листа свой backdrop.

  const today = new Date()
  const y = view.getFullYear()
  const m = view.getMonth()
  const lead = (new Date(y, m, 1).getDay() + 6) % 7 // старт с понедельника
  const daysInMonth = new Date(y, m + 1, 0).getDate()
  const cells: (Date | null)[] = []
  for (let i = 0; i < lead; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(y, m, d))

  const display = selected
    ? `${selected.getDate()} ${MONTHS_SHORT[selected.getMonth()]} ${selected.getFullYear()}`
    : ''

  const calendar = (
    <>
      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          onClick={() => setView(new Date(y, m - 1, 1))}
          className="w-9 h-9 rounded-lg hover:bg-chip flex items-center justify-center text-muted hover:text-ink"
        >
          <ChevronLeft size={16} />
        </button>
        <div className="text-sm font-semibold text-ink">
          {MONTHS[m]} {y}
        </div>
        <button
          type="button"
          onClick={() => setView(new Date(y, m + 1, 1))}
          className="w-9 h-9 rounded-lg hover:bg-chip flex items-center justify-center text-muted hover:text-ink"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-0.5 mb-1">
        {WEEKDAYS.map((w) => (
          <div key={w} className="text-[11px] text-muted-2 text-center py-1">
            {w}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((d, i) =>
          d === null ? (
            <div key={i} />
          ) : (
            <button
              key={i}
              type="button"
              onClick={() => {
                onChange(toValue(d))
                setOpen(false)
              }}
              className={`h-10 sm:h-8 rounded-lg text-sm flex items-center justify-center transition-colors ${
                selected && sameDay(d, selected)
                  ? 'bg-green text-white font-semibold'
                  : sameDay(d, today)
                    ? 'text-green-d font-semibold hover:bg-chip'
                    : 'text-ink-2 hover:bg-chip'
              }`}
            >
              {d.getDate()}
            </button>
          ),
        )}
      </div>

      <div className="mt-2 pt-2 border-t border-line">
        <button
          type="button"
          onClick={() => {
            onChange(toValue(today))
            setOpen(false)
          }}
          className="text-xs text-green-d font-semibold hover:underline"
        >
          Сегодня
        </button>
      </div>
    </>
  )

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        onClick={() => {
          if (!open && selected) setView(selected)
          setOpen((o) => !o)
        }}
        className={`w-full h-[38px] flex items-center gap-2 rounded-lg border px-2.5 text-sm bg-white transition-colors ${
          open ? 'border-green-light' : 'border-line-2 hover:border-muted-2'
        } ${selected ? 'text-ink' : 'text-muted'}`}
      >
        <CalendarIcon size={15} className="text-muted shrink-0" />
        <span className="flex-1 text-left">{display || placeholder}</span>
      </button>

      {open &&
        (isSheet ? (
          createPortal(
            <>
              <div className="sheet-backdrop" onClick={() => setOpen(false)} />
              <div className="sheet-panel p-4">{calendar}</div>
            </>,
            document.body,
          )
        ) : (
          <AnchoredPopover anchorRef={btnRef} onClose={() => setOpen(false)}>
            <div className="w-64 max-w-[calc(100vw-1.5rem)] bg-white rounded-xl border border-line shadow-soft p-3">
              {calendar}
            </div>
          </AnchoredPopover>
        ))}
    </div>
  )
}
