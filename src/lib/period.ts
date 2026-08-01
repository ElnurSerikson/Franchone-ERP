// Период Live-воронки (дополнение «Live-воронка», §8). Пять вариантов выбора
// сводятся к паре дат включительно — бэкенду уходит уже готовый отрезок, и
// расчёт для всех вариантов один и тот же.

import { TODAY } from './constants'
import { longDate } from './format'

export type PeriodMode = 'month' | 'd7' | 'd14' | 'day' | 'range'

export type PeriodState = {
  mode: PeriodMode
  day: string // «Конкретный день»
  from: string // «Произвольный период»
  to: string
}

export const PERIOD_OPTIONS: { value: PeriodMode; label: string }[] = [
  { value: 'month', label: 'Выбранный месяц' },
  { value: 'd7', label: 'Последние 7 дней' },
  { value: 'd14', label: 'Последние 14 дней' },
  { value: 'day', label: 'Конкретный день' },
  { value: 'range', label: 'Произвольный период' },
]

export function shiftDate(iso: string, days: number): string {
  // Полдень по UTC — чтобы перевод часов не сдвинул дату на сутки.
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function monthEnd(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  // Нулевой день следующего месяца — последний день текущего.
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}

export const DEFAULT_PERIOD: PeriodState = {
  mode: 'month',
  day: TODAY,
  from: shiftDate(TODAY, -6),
  to: TODAY,
}

// «Последние 7 дней» — текущий день и 6 предшествующих; 14 — и 13
// предшествующих. Обе границы включаются в расчёт (§8).
export function periodRange(p: PeriodState, month: string): { from: string; to: string } {
  switch (p.mode) {
    case 'd7':
      return { from: shiftDate(TODAY, -6), to: TODAY }
    case 'd14':
      return { from: shiftDate(TODAY, -13), to: TODAY }
    case 'day':
      return { from: p.day, to: p.day }
    case 'range':
      return p.from <= p.to ? { from: p.from, to: p.to } : { from: p.to, to: p.from }
    default:
      return { from: `${month}-01`, to: monthEnd(month) }
  }
}

// §8 требует, чтобы выбранный период был виден без открытия доп. раздела.
export function periodLabel(from: string, to: string): string {
  return from === to ? longDate(from) : `${longDate(from)} — ${longDate(to)}`
}
