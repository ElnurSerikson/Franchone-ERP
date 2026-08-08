// Telegram-модуль — отложенные уведомления (ТЗ Telegram §6, §7).
//
// Всё, что привязано ко времени, а не к действию пользователя: напоминание за
// час до встречи, за час до срока отчёта, просрочки задач и отчётов, пороги
// KPI. Проверка идёт по расписанию.
//
// §6.1: если условие уже неактуально, сообщение не отправляется — например,
// напоминание об отчёте отменяется, если отчёт заполнили до момента отправки.
// Ключ в реестре отправленного гарантирует, что повторный проход не пришлёт
// то же самое дважды.

import { internalMutation } from './_generated/server'
import type { MutationCtx } from './_generated/server'
import { notify, notifyMany, tgSettings } from './telegram'
import { digestFor } from './telegramTalk'
import { momentIn, nowIn } from './orgTime'
import { notifyKpi } from './telegramFlow'
import { submissionsFor, deadlineMs, REPORTING } from './reports'
import { computeMonth } from './payroll'

const TZ = '+05:00'

function businessNow() {
  const shifted = new Date(Date.now() + 5 * 3600 * 1000).toISOString()
  return { date: shifted.slice(0, 10), month: shifted.slice(0, 7) }
}

function addDays(date: string, delta: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + delta * 86400000).toISOString().slice(0, 10)
}

function fmtDate(iso: string): string {
  return new Date(`${iso}T12:00:00${TZ}`).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    timeZone: 'Asia/Almaty',
  })
}

// Единая точка: крон дёргает её, а она проходит по всем правилам.
export const tick = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now()
    const s = await tgSettings(ctx)
    await morningDigest(ctx, s.digestOn, s.digestAt, s.timezone)
    await meetingReminders(ctx, now, s.meetingRemindMin, s.timezone)
    await reportReminders(ctx, now, s.reportRemindMin)
    await taskReminders(ctx, now, s.taskRemindAt, s.taskEscalateAuthor, s.timezone)
    await kpiThresholds(ctx)
    // §9: расшифровки голосовых хранятся ограниченный срок.
    await pruneTranscripts(ctx, now, s.transcriptKeepDays)
  },
})

// Утренняя сводка: бот сам пишет первым в начале дня.
//
// Отправляется всем подключённым сотрудникам, по одному разу в день — ключ
// в реестре отправленного держит это правило. Текст собирает запрос к ERP, а
// не модель: сообщение приходит каждый день, и вёрстка должна быть та же.
//
// Молчим, когда сводка пустая: сообщение «сегодня ничего» каждое утро быстро
// превращается в шум, который перестают читать.
async function morningDigest(
  ctx: MutationCtx,
  on: boolean,
  at: string,
  tz: string,
) {
  if (!on) return
  const nowLocal = nowIn(tz)
  if (nowLocal.time < at) return
  // Окно в час: крон ходит каждые десять минут, и если деплоймент спал, сводка
  // всё равно уйдёт — но не в обед.
  if (nowLocal.time >= addHour(at)) return

  const links = await ctx.db
    .query('telegramLinks')
    .withIndex('by_status', (q) => q.eq('status', 'connected'))
    .collect()
  for (const link of links) {
    const d = await digestFor(ctx, link.employeeId)
    if (!d || d.quiet) continue
    await notify(ctx, {
      employeeId: link.employeeId,
      category: 'task',
      text: `<b>Доброе утро, ${d.first}!</b>\n\n${d.lines.join('\n')}`,
      key: `digest:${link.employeeId}:${nowLocal.date}`,
    })
  }
}

function addHour(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  return `${String(Math.min(23, (h ?? 9) + 1)).padStart(2, '0')}:${String(m ?? 0).padStart(2, '0')}`
}

// §6: напоминание за час до начала встречи — всем участникам.
async function meetingReminders(
  ctx: MutationCtx,
  now: number,
  remindMin: number,
  tz: string,
) {
  const { date } = businessNow()
  // Смотрим сегодня и завтра: окно напоминания может перейти через полночь.
  const rows = (await ctx.db.query('meetings').collect()).filter(
    (m) =>
      (m.date === date || m.date === addDays(date, 1)) &&
      // §8 дополнения по встречам: для отменённой встречи напоминание не
      // отправляется. Проведённой — тоже незачем.
      (m.status ?? 'planned') === 'planned',
  )
  for (const m of rows) {
    const startsAt = momentIn(tz, m.date, m.time)
    if (!Number.isFinite(startsAt)) continue
    const remindAt = startsAt - remindMin * 60 * 1000
    // Момент наступил, но встреча ещё не началась.
    if (now < remindAt || now >= startsAt) continue
    await notifyMany(ctx, m.participantIds, {
      category: 'meeting',
      text:
        `<b>Скоро встреча</b>\n\n${m.title}\n\n` +
        `Начало: ${fmtDate(m.date)}, ${m.time}` +
        (m.place ? `\nМесто: ${m.place}` : '') +
        (m.mapUrl ? `\n${m.mapUrl}` : ''),
      link: '/meetings',
      key: `meeting_remind:${m._id}`,
    })
  }
}

// §6: «Отчёт скоро» — за час до срока и только если отчёт ещё не заполнен.
// «Отчёт просрочен» — после срока, если не заполнен.
async function reportReminders(ctx: MutationCtx, now: number, remindMin: number) {
  const { date: today } = businessNow()
  const settings = await ctx.db
    .query('settings')
    .withIndex('by_key', (q) => q.eq('key', 'global'))
    .first()
  const time = settings?.reportDeadlineTime ?? '14:00'
  const tg = await tgSettings(ctx)

  const staff = (await ctx.db.query('employees').collect()).filter(
    (e) => e.status === 'active' && e.role !== 'owner' && REPORTING.has(e.position) && !e.hidden,
  )

  // Отчёт за вчера сдаётся до 14:00 сегодня — именно он сейчас «горит».
  const target = addDays(today, -1)

  for (const e of staff) {
    if (target < e.hiredAt) continue
    const submitted = (await submissionsFor(ctx, e, time)).some(
      (r) => r.date === target && !r.reopened,
    )
    // §6.1: условие проверяется в момент отправки — заполнил, значит молчим.
    if (submitted) continue

    const due = deadlineMs(target, time)
    if (now >= due - remindMin * 60 * 1000 && now < due) {
      await notify(ctx, {
        employeeId: e._id,
        category: 'report',
        text:
          `<b>Скоро срок отчёта</b>\n\n` +
          `Отчёт за ${fmtDate(target)} нужно заполнить до ${time}.`,
        link: '/reports',
        key: `report_due:${e._id}:${target}`,
        instant: false,
      })
      continue
    }

    if (now >= due) {
      await notify(ctx, {
        employeeId: e._id,
        category: 'report',
        text:
          `<b>Отчёт просрочен</b>\n\n` +
          `Отчёт за ${fmtDate(target)} не заполнен. Внести его теперь может только администратор.`,
        link: '/reports',
        key: `report_late:${e._id}:${target}`,
        instant: false,
      })
      // По настройке о просрочке узнаёт руководитель.
      const recipients = tg.reportRecipients.length
        ? tg.reportRecipients
        : (await ctx.db.query('employees').collect())
            .filter((x) => x.role === 'owner' && x.status === 'active')
            .map((x) => x._id)
      await notifyMany(ctx, recipients, {
        category: 'report',
        text: `<b>Отчёт не сдан</b>\n\n${e.name} · ${e.department}\nОтчётная дата: ${fmtDate(target)}`,
        link: '/reports',
        key: `report_late_admin:${e._id}:${target}`,
        instant: false,
      })
    }
  }
}

// §6: приближение срока задачи и просрочка.
async function taskReminders(
  ctx: MutationCtx,
  now: number,
  remindAt: string,
  escalateAuthor: boolean,
  tz: string,
) {
  const { date: today } = businessNow()
  const rows = (await ctx.db.query('tasks').collect()).filter(
    (t) => t.status !== 'done' && !!t.deadline,
  )
  for (const t of rows) {
    const deadline = t.deadline!
    if (deadline === today) {
      // Срок сегодня. Час напоминания задаётся в настройках (§8.2): у задачи
      // срок — это дата без времени, и «за час до дедлайна» означало бы
      // сообщение ночью. По умолчанию напоминаем утром.
      const at = momentIn(tz, today, remindAt)
      if (now >= at) {
        await notify(ctx, {
          employeeId: t.assigneeId,
          category: 'task',
          text: `<b>Срок задачи сегодня</b>\n\n${t.title}`,
          link: '/tasks',
          key: `task_due:${t._id}:${deadline}`,
          instant: false,
        })
      }
      continue
    }
    if (deadline < today) {
      await notify(ctx, {
        employeeId: t.assigneeId,
        category: 'task',
        text: `<b>Задача просрочена</b>\n\n${t.title}\n\nСрок был ${fmtDate(deadline)}.`,
        link: '/tasks',
        key: `task_overdue:${t._id}:${deadline}`,
        instant: false,
      })
      // §6: по настройке о просрочке узнаёт автор задачи.
      if (escalateAuthor && t.reporterId !== t.assigneeId) {
        const assignee = await ctx.db.get(t.assigneeId)
        await notify(ctx, {
          employeeId: t.reporterId,
          category: 'task',
          text:
            `<b>Задача просрочена</b>\n\n${t.title}\n\n` +
            `Ответственный: ${assignee?.name ?? '—'}\nСрок был ${fmtDate(deadline)}.`,
          link: '/tasks',
          key: `task_overdue_author:${t._id}:${deadline}`,
          instant: false,
        })
      }
    }
  }
}

// §9: голосовой файл не хранится вообще — он удаляется сразу после обработки.
// Распознанный текст остаётся в журнале ограниченный срок: он нужен для
// разбора спорных случаев, но вечно держать чужую речь незачем. Само событие
// в журнале сохраняется — стирается только текст команды и извлечённые поля.
async function pruneTranscripts(ctx: MutationCtx, now: number, keepDays: number) {
  if (keepDays <= 0) return
  const border = now - keepDays * 86400000
  const old = await ctx.db
    .query('telegramAudit')
    .withIndex('by_at', (q) => q.lt('at', border))
    .take(200)
  for (const row of old) {
    if (row.text === undefined && row.fields === undefined) continue
    await ctx.db.patch(row._id, { text: undefined, fields: undefined })
  }
  // Память разговора — такой же личный текст, как расшифровка, и живёт столько
  // же. Свежие реплики трогать нельзя: на них держится нить диалога.
  for (const m of await ctx.db
    .query('telegramMessages')
    .withIndex('by_at', (q) => q.lt('at', border))
    .take(200)) {
    await ctx.db.delete(m._id)
  }

  // Реестр обработанных update нужен только против повторной доставки —
  // Telegram повторяет считаные минуты, месяцами хранить незачем.
  for (const u of await ctx.db
    .query('telegramUpdates')
    .withIndex('by_update')
    .take(500)) {
    if (u.at < now - 7 * 86400000) await ctx.db.delete(u._id)
  }
}

// §7: мотивационные уведомления по KPI.
//
// Процент берётся из уже рассчитанного в ERP значения — Telegram-модуль KPI
// сам не считает и альтернативного значения не хранит.
async function kpiThresholds(ctx: MutationCtx) {
  const { month } = businessNow()
  const rows = await computeMonth(ctx, month)
  for (const r of rows) {
    if (!Number.isFinite(r.kpi)) continue
    await notifyKpi(ctx, r.employeeId, month, r.kpi)
  }
}
