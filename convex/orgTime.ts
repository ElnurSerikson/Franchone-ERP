// Часовой пояс организации (ТЗ Telegram §4.3, §8.2).
//
// Относительные выражения из голосовых команд и время напоминаний считаются в
// поясе, заданном в настройках. По умолчанию Asia/Almaty — как и во всей
// остальной ERP; настройка нужна на случай, если компания переедет или
// появится второй офис.

export const DEFAULT_TZ = 'Asia/Almaty'

// Смещение пояса на конкретный момент, в формате «+05:00». Считается через
// Intl, поэтому переход на летнее время учитывается сам.
export function offsetAt(tz: string, at: Date = new Date()): string {
  try {
    const name = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
      .formatToParts(at)
      .find((p) => p.type === 'timeZoneName')?.value
    // «GMT+05:00» → «+05:00»; ровно «GMT» означает нулевое смещение.
    if (name?.startsWith('GMT')) {
      const rest = name.slice(3)
      return rest || '+00:00'
    }
  } catch {
    /* неизвестный пояс — падаём на значение по умолчанию ниже */
  }
  return '+05:00'
}

// Календарные дата и время в поясе организации.
export function nowIn(tz: string, at: Date = new Date()) {
  let stamp: string
  try {
    // Шведская локаль даёт ровно «YYYY-MM-DD HH:MM:SS» без лишнего.
    stamp = at.toLocaleString('sv-SE', { timeZone: tz })
  } catch {
    stamp = new Date(at.getTime() + 5 * 3600 * 1000).toISOString().replace('T', ' ')
  }
  const date = stamp.slice(0, 10)
  const time = stamp.slice(11, 16)
  const days = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота']
  return { date, time, weekday: days[new Date(`${date}T12:00:00Z`).getUTCDay()] }
}

// Момент «дата + время» в поясе организации, в миллисекундах.
export function momentIn(tz: string, date: string, time: string): number {
  return Date.parse(`${date}T${time}:00${offsetAt(tz, new Date(`${date}T12:00:00Z`))}`)
}
