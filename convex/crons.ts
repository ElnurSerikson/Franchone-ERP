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
// тогда бот молчит, внешне неотличимо от поломки. Раз в 15 минут убеждаемся,
// что адрес наш, и возвращаем его, если нет.
crons.interval('telegram webhook watchdog', { minutes: 15 }, internal.telegramBot.ensureWebhook)

export default crons
