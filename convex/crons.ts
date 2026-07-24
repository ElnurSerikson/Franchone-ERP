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

export default crons
