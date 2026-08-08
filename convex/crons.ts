import { cronJobs } from 'convex/server'
import { internal } from './_generated/api'

const crons = cronJobs()

// Закрытие месяца 1-го числа (§5: начисления уходят в архив).
// 19:00 UTC 1-го числа — это 00:00 2-го по Алматы, то есть сутки запаса:
// дедлайн отчёта 20:00, и последний день месяца успевает досдаться.
crons.monthly(
  'close previous month',
  { day: 1, hourUTC: 19, minuteUTC: 0 },
  internal.payroll.autoClosePreviousMonth,
)

// Telegram-уведомления по времени (ТЗ Telegram §6, §7): напоминания за час,
// просрочки и пороги KPI. Каждые 10 минут — этого хватает для точности «за
// час», а реестр отправленного не даёт присылать одно и то же дважды.
crons.interval('telegram notifications', { minutes: 10 }, internal.telegramCron.tick)

// Проверка адреса доставки. Telegram снимает webhook без предупреждения — и
// тогда бот молчит, внешне неотличимо от поломки.
//
// Интервал в пять минут, а не в пятнадцать: на боевом боте адрес слетал
// несколько раз за день, и каждая такая пауза выглядела как сломанный бот.
// Проверка стоит одного запроса к Telegram, поэтому частить здесь дешевле,
// чем объяснять сотрудникам, почему бот замолчал.
crons.interval('telegram webhook watchdog', { minutes: 5 }, internal.telegramBot.ensureWebhook)

// Постпроектные сценарии упаковки (ТЗ Упаковка §13.2): «через N дней после
// завершения» и «при отсутствии активности клиента». Условия суточные, поэтому
// раз в день — 05:00 UTC, это 10:00 по Алматы.
crons.daily('pack post-project scenarios', { hourUTC: 5, minuteUTC: 0 }, internal.packExtras.tick)

// §14.1: «до срока осталось настраиваемое время» и «срок нарушен». Порог
// задаётся в часах, поэтому проверяем ежечасно; реестр отправленного не даёт
// прислать одно и то же дважды.
crons.interval('pack deadlines', { hours: 1 }, internal.packExtras.deadlineTick)

export default crons
