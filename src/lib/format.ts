// Форматирование чисел под русский/казахстанский формат

export const kzt = (n: number) =>
  new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Math.round(n)) + ' ₸'

export const num = (n: number, digits = 0) =>
  new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(n)

// Реклама считается в долларах (ТЗ таргетолога §15). Всегда два знака после
// точки и никогда не округляем до целого доллара: $3.30, а не $3. На вход —
// центы, потому что в базе деньги лежат целыми центами.
export const usd = (cents: number) =>
  '$' + (cents / 100).toFixed(2)

// Цена результата: у нулевого результата цены нет — показываем словами, а не
// $0.00, иначе бесплатный результат не отличить от отсутствующего.
// Формулировка из дополнения §2.2 — «Нет данных».
export const usdCost = (cents: number | null) => (cents === null ? 'Нет данных' : usd(cents))

export const pct = (x: number, digits = 0) =>
  new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(x * 100) + '%'

// Конверсии Live-воронки (ТЗ Live-воронки §7): знак после запятой ставим
// только у дробного результата. В примерах заказчика 100%, 50%, 40%, 20% и 5%
// написаны без знаков, а 3,3% — со знаком; «50,0%» читается как лишний шум.
export const pctAuto = (x: number) => {
  const value = x * 100
  const rounded = Math.round(value * 10) / 10
  return (
    new Intl.NumberFormat('ru-RU', {
      minimumFractionDigits: Number.isInteger(rounded) ? 0 : 1,
      maximumFractionDigits: 1,
    }).format(value) + '%'
  )
}

// Русское склонение по числу: plural(1, 'сотрудник', 'сотрудника', 'сотрудников').
export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

// Полная дата в формате ТЗ таргетолога §15: «28 июля 2026».
export const longDate = (iso: string) =>
  new Date(`${iso}T12:00:00+05:00`)
    .toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
    // Русская локаль добавляет «г.», а ТЗ просит ровно «28 июля 2026».
    .replace(/\s*г\.$/, '')

export const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
