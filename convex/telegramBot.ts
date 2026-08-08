// Telegram-модуль — сетевая часть (ТЗ Telegram §4, §5, §9, §11).
//
// Здесь всё, что ходит наружу: отправка сообщений, скачивание голосового,
// распознавание речи и разбор фразы в поля. Мутации Convex в сеть не умеют,
// поэтому любой такой шаг — action.
//
// Порядок обработки голосовой команды (§4.1):
//   голосовое → скачали файл → распознали текст → определили намерение и
//   поля → сопоставили людей с доступными по правам ERP → карточка
//   предпросмотра → и только после «Создать» запись появляется в ERP.

import { action, internalAction } from './_generated/server'
import type { ActionCtx } from './_generated/server'
import { v } from 'convex/values'
import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { nowIn } from './orgTime'
import { Resend as ResendAPI } from 'resend'
import { otpEmail, BOT_CODE_COPY } from './emails'
import { humanDate } from './telegramTalk'

const API = 'https://api.telegram.org'

// Явный тип: без него вывод уходит по кругу через internal.* и вся схема
// Convex вырождается в any.
type LinkInfo = {
  status: string
  employeeId: Id<'employees'>
  employeeName: string
  isOwner: boolean
  active: boolean
} | null

function token(): string {
  const t = process.env.TELEGRAM_BOT_TOKEN
  if (!t) throw new Error('TELEGRAM_BOT_TOKEN не задан в окружении Convex')
  return t
}

function siteUrl(): string {
  return (process.env.SITE_URL ?? '').replace(/\/$/, '')
}

// §4.3: относительные выражения считаются в часовом поясе организации.
// Пояс задаётся в настройках, а не зашит в код.

// ——— Telegram API ———

async function tg(method: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${API}/bot${token()}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = (await res.json()) as { ok: boolean; description?: string; result?: unknown }
  if (!json.ok) throw new Error(json.description ?? `Telegram ${method} вернул ошибку`)
  return (json.result ?? {}) as Record<string, unknown>
}

type Button = { text: string; data: string }

function keyboard(rows: Button[][]) {
  return {
    inline_keyboard: rows.map((r) => r.map((b) => ({ text: b.text, callback_data: b.data }))),
  }
}

// Отправка уведомления. Ошибку не глотаем: она нужна администратору (§3.4).
export const deliver = internalAction({
  args: {
    chatId: v.number(),
    text: v.string(),
    link: v.optional(v.string()),
    employeeId: v.optional(v.id('employees')),
    buttons: v.optional(v.array(v.array(v.object({ text: v.string(), data: v.string() })))),
    attempt: v.optional(v.number()),
  },
  handler: async (ctx, { chatId, text, link, employeeId, buttons, attempt }) => {
    const base = siteUrl()
    // §6.1: ссылка ведёт на страницу ERP, авторизация и права сохраняются.
    const full = link && base ? `${text}\n\n<a href="${base}${link}">Открыть в ERP</a>` : text
    try {
      await tg('sendMessage', {
        chat_id: chatId,
        text: full,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        ...(buttons ? { reply_markup: keyboard(buttons) } : {}),
      })
      await ctx.runMutation(internal.telegram.markDelivery, { chatId, ok: true, employeeId })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      const tries = attempt ?? 0
      // §6.1: при ВРЕМЕННОЙ ошибке допускаются повторы с ограничением числа и
      // интервала. Постоянные отказы (бот заблокирован, чата нет) повторять
      // бессмысленно — они не пройдут и через час.
      const permanent = /blocked|chat not found|deactivated|kicked|user is deactivated/i.test(
        message,
      )
      if (!permanent && tries < 3) {
        // 1, 5 и 25 минут: короткий сбой сети переживём, а очередь не забьём.
        const delayMin = [1, 5, 25][tries]
        await ctx.scheduler.runAfter(delayMin * 60 * 1000, internal.telegramBot.deliver, {
          chatId,
          text,
          link,
          employeeId,
          buttons,
          attempt: tries + 1,
        })
        return
      }
      await ctx.runMutation(internal.telegram.markDelivery, {
        chatId,
        ok: false,
        error: message,
        employeeId,
      })
    }
  },
})

// ——— Распознавание речи (AssemblyAI) ———

async function transcribe(fileId: string): Promise<string> {
  const key = process.env.ASSEMBLYAI_API_KEY
  if (!key) throw new Error('ASSEMBLYAI_API_KEY не задан в окружении Convex')

  const file = (await tg('getFile', { file_id: fileId })) as { file_path?: string }
  if (!file.file_path) throw new Error('Не удалось получить голосовой файл')
  const audio = await fetch(`${API}/file/bot${token()}/${file.file_path}`)
  if (!audio.ok) throw new Error('Голосовой файл недоступен')
  const bytes = await audio.arrayBuffer()

  const up = await fetch('https://api.assemblyai.com/v2/upload', {
    method: 'POST',
    headers: { authorization: key, 'content-type': 'application/octet-stream' },
    body: bytes,
  })
  if (!up.ok) throw new Error(`Загрузка аудио не удалась: ${up.status}`)
  const { upload_url } = (await up.json()) as { upload_url: string }

  const start = await fetch('https://api.assemblyai.com/v2/transcript', {
    method: 'POST',
    headers: { authorization: key, 'content-type': 'application/json' },
    // Язык не навязываем: в компании говорят и по-русски, и по-казахски, а
    // жёсткий русский ломал казахскую речь в бессмысленную транскрипцию.
    body: JSON.stringify({ audio_url: upload_url, language_detection: true }),
  })
  if (!start.ok) {
    const body = await start.text().catch(() => '')
    throw new Error(`Распознавание не запустилось: ${start.status} ${body.slice(0, 200)}`)
  }
  const started = (await start.json()) as { id: string }

  // §11: карточка должна появляться за разумное время — целевые 15 секунд.
  // Ждём ограниченно, чтобы не висеть бесконечно на чужом сервисе.
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 1500))
    const poll = await fetch(`https://api.assemblyai.com/v2/transcript/${started.id}`, {
      headers: { authorization: key },
    })
    const t = (await poll.json()) as { status: string; text?: string; error?: string }
    if (t.status === 'completed') return (t.text ?? '').trim()
    if (t.status === 'error') throw new Error(t.error ?? 'Ошибка распознавания')
  }
  throw new Error('Распознавание заняло слишком много времени')
}

// ——— Разбор фразы в поля (Anthropic) ———

type Parsed = {
  intent:
    | 'task'
    | 'meeting'
    | 'task_done'
    | 'task_reopen'
    | 'task_deadline'
    | 'meeting_move'
    | 'meeting_cancel'
    | 'unknown'
  title?: string
  description?: string
  people?: string[]
  date?: string
  time?: string
  priority?: 'low' | 'medium' | 'high' | 'urgent'
  place?: string
  url?: string
  object?: string
  note?: string
}

async function parseCommand(text: string, people: string[], tz: string): Promise<Parsed> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('ANTHROPIC_API_KEY не задан в окружении Convex')
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5'
  const now = nowIn(tz)

  const system = [
    'Ты разбираешь голосовые команды сотрудников ERP на русском языке.',
    'Верни ТОЛЬКО JSON без пояснений и без markdown-ограждений.',
    '',
    'Поля результата:',
    '{"intent":"task|meeting|task_done|task_reopen|task_deadline|meeting_move|meeting_cancel|unknown",',
    '"title":str,"description":str|null,',
    '"people":[str],"date":"YYYY-MM-DD"|null,"time":"HH:MM"|null,',
    '"priority":"low|medium|high|urgent"|null,"place":str|null,"url":str|null,',
    '"object":str|null,"note":str|null}',
    '',
    `Сегодня ${now.date} (${now.weekday}), сейчас ${now.time}. Часовой пояс ${tz}.`,
    'Относительные выражения («завтра», «в пятницу», «через два часа») переводи в конкретные дату и время.',
    '',
    'Намерения:',
    'task — поставить новую задачу. meeting — назначить новую встречу.',
    'task_done — закрыть, завершить, отметить выполненной существующую задачу.',
    'task_reopen — вернуть в работу, переоткрыть уже закрытую задачу.',
    'task_deadline — сдвинуть, продлить срок существующей задачи.',
    'meeting_move — перенести существующую встречу на другое время.',
    'meeting_cancel — отменить существующую встречу.',
    'Не понял намерение — "unknown".',
    '',
    'Для действий над существующей записью (task_done, task_reopen, task_deadline,',
    'meeting_move, meeting_cancel) в title клади то, как человек назвал запись,',
    'своими словами:',
    '«смета», «встреча с Алиной». Не придумывай точный заголовок и не дополняй его.',
    'В date и time для этих намерений клади НОВЫЕ дату и время, если они названы.',
    '',
    'people — имена людей из команды так, как их назвали. Список сотрудников:',
    people.join(', ') || '(список пуст)',
    'Сопоставляй с этим списком; если человека в нём нет — верни как услышал.',
    '',
    'НЕ ДОГАДЫВАЙСЯ. Если поле не названо — null. Пустую строку не возвращай.',
    'title формулируй кратко и по-деловому, без слов «поставь задачу» и «назначь встречу».',
  ].join('\n')

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      // temperature не задаём: у актуальных моделей параметр объявлен
      // устаревшим и запрос с ним отклоняется.
      system,
      messages: [{ role: 'user', content: text }],
    }),
  })
  if (!res.ok) {
    // §11: ошибка интеграции должна быть видна администратору без доступа к
    // серверным логам — поэтому тащим текст ответа, а не голый код.
    const body = await res.text().catch(() => '')
    throw new Error(`Разбор команды не удался: ${res.status} ${body.slice(0, 300)}`)
  }
  const data = (await res.json()) as { content?: { type: string; text?: string }[] }
  const raw = (data.content ?? []).find((c) => c.type === 'text')?.text ?? ''
  const json = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)
  try {
    return JSON.parse(json) as Parsed
  } catch {
    throw new Error('Не удалось разобрать ответ модели')
  }
}

// ——— Обработка входящего update ———

export const handleUpdate = internalAction({
  args: { update: v.any() },
  handler: async (ctx, { update }): Promise<void> => {
    const u = update as Record<string, any>
    const updateId = u.update_id as number

    // §11: повторная доставка одного update не создаёт дубль.
    const fresh = await ctx.runMutation(internal.telegram.claimUpdate, { updateId })
    if (!fresh) return

    if (u.callback_query) return await onCallback(ctx, u.callback_query, updateId)
    if (u.message) return await onMessage(ctx, u.message, updateId)
  },
})

// Чужой текст внутри HTML-сообщения: речь человека может содержать «<» и «&».
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

async function say(chatId: number, text: string, buttons?: Button[][]) {
  const body = {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
    ...(buttons ? { reply_markup: keyboard(buttons) } : {}),
  }
  try {
    await tg('sendMessage', { ...body, parse_mode: 'HTML' })
  } catch (e) {
    // Разговорные ответы собирает модель, и она может выдать разметку, которую
    // Telegram не принимает. Молчание вместо ответа — худший исход, поэтому
    // повторяем тем же текстом без разметки.
    if (!/parse entities|unsupported start tag|can't find end/i.test(String(e))) throw e
    await tg('sendMessage', body)
  }
}

// «Печатает…» наверху чата.
//
// Бот думает секунды: распознаёт голос, разбирает фразу, собирает ответ. Всё
// это время экран был пустым, и человек не понимал, дошло сообщение или нет.
// Telegram держит статус пять секунд, поэтому его приходится повторять, пока
// работа идёт.
async function withTyping<T>(chatId: number, work: () => Promise<T>): Promise<T> {
  let working = true
  const pulse = (async () => {
    while (working) {
      // Статус — дело второстепенное: если он не отправился, работа всё равно
      // должна дойти до конца.
      try {
        await tg('sendChatAction', { chat_id: chatId, action: 'typing' })
      } catch {
        return
      }
      // Спим короткими шагами, чтобы закончить почти сразу, как ответ готов, а
      // не висеть лишние секунды после него.
      for (let i = 0; i < 16 && working; i++) await new Promise((r) => setTimeout(r, 250))
    }
  })()
  try {
    return await work()
  } finally {
    working = false
    await pulse
  }
}

// ——— Сводка дня, команды и быстрые кнопки ———
//
// Сводку собирает запрос к ERP, а не модель: она приходит каждый день, и
// вёрстка в ней должна быть одна и та же.

type Digest = { name: string; isOwner: boolean; lines: string[]; quiet: boolean } | null

function renderDigest(d: Digest, head: string): string {
  if (!d) return head
  if (d.quiet) {
    return `${head}\n\nНа сегодня ничего срочного: задач со сроком нет, встреч тоже.`
  }
  return `${head}\n\n${d.lines.join('\n')}`
}

// Быстрые кнопки под ответом: одно нажатие вместо набора фразы.
function quickButtons(isOwner: boolean): Button[][] {
  const row: Button[] = [
    { text: '📋 Мои задачи', data: 'q:tasks' },
    { text: '📅 Встречи', data: 'q:meetings' },
  ]
  const second: Button[] = [{ text: '📊 KPI', data: 'q:kpi' }]
  if (isOwner) second.push({ text: '👥 Команда', data: 'q:team' })
  return [row, second]
}

// Меню команд у поля ввода. Ставится на конкретный чат, поэтому у владельца
// и у сотрудника наборы разные и никто не видит того, что ему не положено.
async function syncCommands(chatId: number, isOwner: boolean): Promise<void> {
  const commands = [
    { command: 'today', description: 'Что у меня сегодня' },
    { command: 'tasks', description: 'Мои задачи' },
    { command: 'meetings', description: 'Ближайшие встречи' },
    { command: 'kpi', description: 'Мой KPI за месяц' },
  ]
  if (isOwner) {
    commands.push({ command: 'team', description: 'Команда по отделам' })
    commands.push({ command: 'reports', description: 'Кто не сдал отчёт' })
  }
  commands.push({ command: 'help', description: 'Что я умею' })
  try {
    await tg('setMyCommands', { commands, scope: { type: 'chat', chat_id: chatId } })
  } catch {
    // Меню — удобство, а не условие работы: молча переживём отказ.
  }
}

const HELP =
  'Голосом или текстом — как удобнее.\n\n' +
  '• «Поставь Арману задачу подготовить отчёт по KazNaves до завтра, 18:00, высокий приоритет»\n' +
  '• «Назначь встречу с Алиной и Данияром завтра в 15:00 в офисе, обсуждаем кампанию»\n\n' +
  'Задача или встреча появятся в ERP только после вашего подтверждения — сначала покажу карточку.\n\n' +
  'А ещё можно просто спросить: «что у меня сегодня», «какие задачи горят», «как мой KPI». ' +
  'Отчёты заполняются в самой ERP, через бота нельзя.'


// ——— Вход в бота ———
//
// Диалог короткий: почта → код из письма → доступ. Личность подтверждает
// доступ к рабочему ящику — тот же самый, через который сотрудник входит в
// ERP.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const ASK_EMAIL =
  'Здравствуйте! Это бот <b>FRANCHONE ERP</b>.\n\n' +
  'Отправьте рабочий email, с которым вы входите в ERP, — я пришлю на него код подтверждения.'

function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] || full
}

async function mailCode(email: string, code: string): Promise<void> {
  const apiKey = process.env.AUTH_RESEND_KEY ?? process.env.RESEND_API_KEY
  const { subject, html, text } = otpEmail(code, BOT_CODE_COPY)
  if (!apiKey) {
    // dev-среда без Resend: код виден в npx convex logs.
    console.log(`[DEV TG CODE] ${email}: ${code}`)
    return
  }
  const resend = new ResendAPI(apiKey)
  const { error } = await resend.emails.send({
    from: process.env.AUTH_EMAIL_FROM ?? 'FRANCHONE <onboarding@resend.dev>',
    to: [email],
    subject,
    html,
    text,
  })
  if (error) throw new Error(JSON.stringify(error))
}

async function onAuth(
  ctx: ActionCtx,
  chatId: number,
  msg: Record<string, any>,
  raw: string,
): Promise<void> {
  const text = raw.trim()

  if (EMAIL_RE.test(text)) {
    const res = await ctx.runMutation(internal.telegram.requestCode, { chatId, email: text })
    if (!res.ok) {
      const why: Record<string, string> = {
        busy: 'Этот Telegram уже подключён к другому сотруднику. Обратитесь к администратору.',
        client:
          'Бот пока работает только для сотрудников компании.\n\n' +
          'Ход работ по вашему проекту смотрите в личном кабинете ERP.',
        unknown:
          'Не нахожу такой email среди сотрудников.\n\n' +
          'Укажите ту же почту, с которой вы входите в ERP. Если она верна, обратитесь к администратору.',
      }
      await say(chatId, why[res.reason] ?? why.unknown)
      return
    }
    try {
      await mailCode(res.email, res.code)
    } catch (e) {
      await ctx.runMutation(internal.telegram.logAudit, {
        kind: 'login',
        chatId,
        status: 'error',
        error: `письмо с кодом не ушло: ${String(e)}`,
      })
      await say(chatId, 'Не получилось отправить письмо. Попробуйте ещё раз через минуту.')
      return
    }
    await say(
      chatId,
      `${firstName(res.name)}, код отправлен на <b>${res.email}</b>.\n\n` +
        `Введите шесть цифр из письма. Код действует ${res.ttlMin} минут.`,
    )
    return
  }

  if (/^\d{6}$/.test(text)) {
    const res = await ctx.runMutation(internal.telegram.verifyCode, {
      chatId,
      code: text,
      username: msg.from?.username,
      tgName: [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' '),
    })
    if (res.ok) {
      // Первый экран — не мануал, а его день. Что бот умеет, лежит в /help и
      // в меню команд, которое ставится тут же.
      const d: Digest = await ctx.runQuery(internal.telegramTalk.digest, {
        employeeId: res.employeeId,
      })
      await syncCommands(chatId, res.isOwner)
      await say(
        chatId,
        renderDigest(d, `<b>${firstName(res.name)}, добро пожаловать!</b>\n\n${res.position}`) +
          '\n\nЧто я умею — /help',
        quickButtons(!!res.isOwner),
      )
      return
    }
    const why: Record<string, string> = {
      none: 'Сначала отправьте свой рабочий email — я пришлю код.',
      expired: 'Срок действия кода истёк. Отправьте email ещё раз, пришлю новый.',
      wrong: `Код неверный. Осталось попыток: ${'left' in res ? res.left : 0}.`,
      blocked: 'Слишком много неверных попыток. Отправьте email заново, чтобы получить новый код.',
      unknown: 'Учётная запись недоступна. Обратитесь к администратору.',
    }
    await say(chatId, why[res.reason] ?? why.none)
    return
  }

  // Голосовое и любой другой ввод до входа — возвращаем к первому шагу.
  await say(chatId, ASK_EMAIL)
}

// Ответы на команды меню и быстрые кнопки. Всё берётся из ERP напрямую и
// верстается кодом — одинаково от раза к разу.
async function runSlash(
  ctx: ActionCtx,
  chatId: number,
  link: { employeeId: Id<'employees'>; employeeName: string; isOwner: boolean },
  raw: string,
): Promise<void> {
  const cmd = raw.split(/[\s@]/)[0].replace('/', '')
  const b: Brief = await ctx.runQuery(internal.telegramTalk.brief, {
    employeeId: link.employeeId,
  })

  if (cmd === 'help') {
    await syncCommands(chatId, link.isOwner)
    return await say(chatId, HELP, quickButtons(link.isOwner))
  }

  if (cmd === 'start' || cmd === 'today') {
    const d: Digest = await ctx.runQuery(internal.telegramTalk.digest, {
      employeeId: link.employeeId,
    })
    return await say(
      chatId,
      renderDigest(d, `<b>${firstName(link.employeeName)}, ваш день</b>`),
      quickButtons(link.isOwner),
    )
  }

  if (cmd === 'tasks') {
    if (!b || !b.tasks.length) return await say(chatId, 'Открытых задач нет. 📋')
    const lines = b.tasks.map(
      (t) =>
        `${t.overdue ? '⚠️' : '📌'} <b>${t.title}</b>\n` +
        `${t.status} · ${t.priority}` +
        (t.deadline ? ` · срок ${humanDate(t.deadline)}${t.overdue ? ', просрочена' : ''}` : ' · без срока'),
    )
    return await say(chatId, `<b>Ваши задачи — ${b.tasks.length}</b>\n\n${lines.join('\n\n')}`)
  }

  if (cmd === 'meetings') {
    if (!b || !b.meetings.length) return await say(chatId, 'Ближайших встреч нет. 📅')
    const lines = b.meetings.map(
      (m) =>
        `📅 <b>${m.title}</b>\n${humanDate(m.date)}, ${m.time}` +
        (m.place ? ` · ${m.place}` : '') +
        (m.moved ? ' · переносилась' : ''),
    )
    return await say(chatId, `<b>Ближайшие встречи — ${b.meetings.length}</b>\n\n${lines.join('\n\n')}`)
  }

  if (cmd === 'kpi') {
    if (!b) return await say(chatId, 'Не вижу ваших данных по KPI.')
    const own =
      b.kpi === null
        ? 'KPI за этот месяц пока не считается.'
        : `📊 <b>Ваш KPI за месяц — ${Math.round(b.kpi * 100)}%</b>`
    if (!b.isOwner) return await say(chatId, own)
    const rows = b.team
      .filter((t) => t.kpi !== null)
      .sort((a, b2) => (a.kpi ?? 0) - (b2.kpi ?? 0))
      .map((t) => `<b>${t.name}</b> · ${t.position}\n📊 ${Math.round((t.kpi ?? 0) * 100)}%`)
    return await say(
      chatId,
      rows.length ? `${own}\n\n<b>По команде</b>\n\n${rows.join('\n\n')}` : own,
    )
  }

  if (cmd === 'team') {
    if (!b) return await say(chatId, 'Не вижу данных по команде.')
    if (!b.isOwner) {
      // Сотруднику — только состав и загрузка, без цифр.
      const list = b.team.map((t) => `<b>${t.name}</b> · ${t.position}\nзадач в работе: ${t.openTasks}`)
      return await say(
        chatId,
        list.length ? `<b>Коллеги — ${b.team.length}</b>\n\n${list.join('\n\n')}` : 'Коллег в базе нет.',
      )
    }
    return await say(chatId, teamByDepartment(b))
  }

  if (cmd === 'reports') {
    if (!b?.isOwner) return await say(chatId, 'Эта команда доступна администратору.')
    const late = b.team.filter((t) => t.reportMissing === true)
    return await say(
      chatId,
      late.length
        ? `<b>Не сдали вчерашний отчёт — ${late.length}</b>\n\n` +
            late.map((t) => `📝 <b>${t.name}</b> · ${t.position}`).join('\n')
        : 'Вчерашний отчёт сдали все. 📝',
    )
  }

  // Незнакомая команда — не повод молчать.
  return await say(chatId, 'Такой команды у меня нет. Что умею — /help', quickButtons(link.isOwner))
}

// Владельцу — по отделам: он смотрит на компанию подразделениями.
function teamByDepartment(b: NonNullable<Brief>): string {
  if (!b.team.length) return 'В команде пока никого нет.'
  const byDept = new Map<string, typeof b.team>()
  for (const t of b.team) {
    const list = byDept.get(t.department) ?? []
    list.push(t)
    byDept.set(t.department, list)
  }
  const blocks: string[] = [`<b>Команда — ${b.team.length}</b>`]
  for (const [dept, people] of byDept) {
    const rows = people.map((t) => {
      const marks: string[] = []
      if (t.overdueTasks) marks.push(`⚠️ просрочено ${t.overdueTasks}`)
      if (t.reportMissing === true) marks.push('📝 отчёт не сдан')
      return (
        `<b>${t.name}</b> · ${t.position}\n` +
        `📊 ${t.kpi === null ? 'KPI пока не считается' : `KPI ${Math.round(t.kpi * 100)}%`}` +
        ` · задач ${t.openTasks || 'нет'}` +
        (marks.length ? `\n${marks.join(' · ')}` : '')
      )
    })
    blocks.push(`<b>${dept}</b>\n\n${rows.join('\n\n')}`)
  }
  return blocks.join('\n\n')
}

async function onMessage(
  ctx: ActionCtx,
  msg: Record<string, any>,
  updateId: number,
): Promise<void> {
  const chatId = msg.chat?.id as number
  if (!chatId) return
  const text: string = msg.text ?? ''

  // Вход в бота: сотрудник подтверждает себя рабочей почтой из ERP.
  if (text.startsWith('/start')) {
    const known: LinkInfo = await ctx.runQuery(internal.telegram.linkByChat, { chatId })
    if (known?.active) {
      await say(chatId, `${firstName(known.employeeName)}, вы уже подключены.\n\n${HELP}`)
      return
    }
    // Связь могла оборваться не по вине человека — тогда вход проходить заново
    // не нужно.
    const back: { ok: boolean; name?: string; reason?: string } = await ctx.runMutation(
      internal.telegram.resume,
      { chatId },
    )
    if (back.ok) {
      await say(chatId, `С возвращением, ${firstName(back.name ?? '')}!\n\n${HELP}`)
      return
    }
    if (back.reason === 'disabled') {
      await say(chatId, 'Доступ к боту закрыт администратором. Обратитесь к нему.')
      return
    }
    await say(chatId, ASK_EMAIL)
    return
  }

  const link: LinkInfo = await ctx.runQuery(internal.telegram.linkByChat, { chatId })
  // Пока привязки нет, бот ведёт только диалог входа и ничего из ERP не
  // показывает.
  // Отправка письма с кодом и проверка тоже занимают секунду-две.
  if (!link?.active) return await withTyping(chatId, () => onAuth(ctx, chatId, msg, text))

  // Команды из меню. Отвечает на них не модель, а прямой запрос к ERP:
  // человек нажал кнопку и ждёт цифры, а не рассуждения.
  if (text.startsWith('/')) return await runSlash(ctx, chatId, link, text)

  const voice = msg.voice ?? msg.audio ?? msg.video_note
  if (!voice && !text) return
  if (!voice) {
    // Текст обрабатываем так же, как расшифровку голоса: это удобно и не
    // противоречит ТЗ, где голос — основной, но не единственный вход.
    return await withTyping(chatId, () => runCommand(ctx, chatId, link, text, updateId))
  }

  // Голосовое идёт дольше всего: скачать, распознать, разобрать. Статус висит
  // все эти секунды, поэтому отдельная реплика «слушаю» больше не нужна.
  await withTyping(chatId, async () => {
    let transcript = ''
    try {
      transcript = await transcribe(voice.file_id)
    } catch (e) {
      await ctx.runMutation(internal.telegram.logAudit, {
        kind: 'command',
        employeeId: link.employeeId,
        chatId,
        updateId,
        status: 'error',
        error: e instanceof Error ? e.message : String(e),
      })
      return await say(chatId, 'Не разобрал голосовое — попробуйте записать ещё раз.')
    }
    if (!transcript) return await say(chatId, 'В сообщении не слышно речи. Попробуйте ещё раз.')
    // Показываем, что именно услышали. Без этой строки ошибка распознавания
    // неотличима от глупости бота: человек видит странный ответ и не понимает,
    // что виновата не логика, а расслышанное слово.
    await say(chatId, `<i>услышал: ${esc(transcript)}</i>`)
    await runCommand(ctx, chatId, link, transcript, updateId)
  })
}

// ——— Разговор ———
//
// Команда — частный случай речи, а не единственный допустимый её вид. Человек
// здоровается, спрашивает «что у меня сегодня», уточняет, благодарит. Бот,
// который на всё это отвечает «не понял, скажите поставь задачу», выглядит
// сломанным, и им перестают пользоваться.
//
// Отвечает модель, но факты берёт не из головы: сводка по человеку собрана
// запросами к ERP и передана готовой. Чего в ней нет — того бот не знает.

type Brief = {
  name: string
  position: string
  department: string
  isOwner: boolean
  tasks: {
    title: string
    status: string
    priority: string
    deadline: string | null
    overdue: boolean
    assignee: string | null
  }[]
  doneRecent: { title: string; onTime: boolean; assignee: string | null }[]
  meetings: { title: string; date: string; time: string; place: string | null; moved: boolean }[]
  report: { date: string; due: string; submitted: boolean } | null
  kpi: number | null
  month: string
  team: {
    name: string
    position: string
    department: string
    openTasks: number
    overdueTasks: number
    kpi: number | null
    reportMissing: boolean | null
  }[]
} | null

function pct(v: number | null): string {
  return v === null ? 'нет данных' : `${Math.round(v * 100)}%`
}

function factSheet(b: Brief, tz: string): string {
  const now = nowIn(tz)
  const lines: string[] = [
    `Сегодня ${now.date} (${now.weekday}), время ${now.time}.`,
  ]
  if (!b) return lines.join('\n')

  lines.push(`Собеседник: ${b.name}, ${b.position}, отдел «${b.department}».`)

  lines.push('')
  if (b.tasks.length === 0) lines.push('Открытых задач нет.')
  else {
    lines.push(`Открытые задачи собеседника — свои и поставленные им (${b.tasks.length}):`)
    for (const t of b.tasks) {
      lines.push(
        `— «${t.title}»: ${t.status}, приоритет ${t.priority}` +
          (t.deadline ? `, срок ${t.deadline}${t.overdue ? ' — ПРОСРОЧЕНА' : ''}` : ', без срока') +
          (t.assignee ? `, исполнитель ${t.assignee}` : ', исполнитель — собеседник'),
      )
    }
  }

  if (b.doneRecent.length) {
    lines.push('')
    lines.push(`Недавно закрытые задачи (${b.doneRecent.length}) — их можно вернуть в работу:`)
    for (const t of b.doneRecent) {
      lines.push(
        `— «${t.title}»: выполнена${t.onTime ? ' в срок' : ' с опозданием'}` +
          (t.assignee ? `, исполнитель ${t.assignee}` : ''),
      )
    }
  }

  lines.push('')
  if (b.meetings.length === 0) lines.push('Ближайших встреч нет.')
  else {
    lines.push(`Ближайшие встречи (${b.meetings.length}):`)
    for (const m of b.meetings) {
      lines.push(
        `— «${m.title}»: ${m.date} в ${m.time}` +
          (m.place ? `, место ${m.place}` : '') +
          (m.moved ? ' (переносилась)' : ''),
      )
    }
  }

  if (b.report) {
    lines.push('')
    lines.push(
      b.report.submitted
        ? `Отчёт за ${b.report.date} сдан.`
        : `Отчёт за ${b.report.date} НЕ сдан, срок сегодня до ${b.report.due}.`,
    )
  }

  lines.push('')
  lines.push(`KPI за ${b.month}: ${pct(b.kpi)}.`)

  if (b.team.length) {
    lines.push('')
    lines.push(
      b.isOwner
        ? 'Команда (собеседник — владелец, видит всё). Перечислять по отделам:'
        : 'Коллеги (собеседнику видны имена, должности и загрузка — цифры KPI и отчёты чужие ему НЕ видны, о них говорить нечего):',
    )
    // Владельцу — по отделам: он смотрит на компанию по подразделениям.
    const byDept = new Map<string, typeof b.team>()
    for (const t of b.team) {
      const list = byDept.get(t.department) ?? []
      list.push(t)
      byDept.set(t.department, list)
    }
    for (const [dept, people] of byDept) {
      lines.push(`Отдел «${dept}»:`)
      for (const t of people) {
        lines.push(
          `— ${t.name}, ${t.position}: открытых задач ${t.openTasks}` +
            (b.isOwner
              ? (t.overdueTasks ? `, просрочено ${t.overdueTasks}` : '') +
                `, KPI ${pct(t.kpi)}` +
                (t.reportMissing === true ? ', вчерашний отчёт не сдан' : '')
              : ''),
        )
      }
    }
  }

  return lines.join('\n')
}

// Anthropic ждёт чередование ролей и первую реплику от пользователя.
function normalize(
  history: { role: string; text: string }[],
  text: string,
): { role: 'user' | 'assistant'; content: string }[] {
  const out: { role: 'user' | 'assistant'; content: string }[] = []
  for (const h of [...history, { role: 'user', text }]) {
    const role = h.role === 'bot' ? 'assistant' : 'user'
    const last = out[out.length - 1]
    if (last && last.role === role) last.content += `\n${h.text}`
    else out.push({ role, content: h.text })
  }
  while (out.length && out[0].role === 'assistant') out.shift()
  return out
}

async function converse(
  ctx: ActionCtx,
  chatId: number,
  employeeId: Id<'employees'>,
  text: string,
  tz: string,
): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('ANTHROPIC_API_KEY не задан в окружении Convex')
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5'

  const brief: Brief = await ctx.runQuery(internal.telegramTalk.brief, { employeeId })
  const history: { role: string; text: string }[] = await ctx.runQuery(
    internal.telegramTalk.recent,
    { chatId },
  )

  const system = [
    'Ты — Telegram-бот ERP компании FRANCHONE. Не автоответчик, а толковый помощник:',
    'доброжелательный, коротко и по делу, без канцелярита и без панибратства.',
    'Можешь по-доброму подтолкнуть: «отчёт горит, успеете до 14:00?»',
    '',
    'ОБРАЩЕНИЕ. Всегда на «вы», ко всем без исключения, даже если написали на «ты».',
    'По имени — к месту, а не в каждой реплике.',
    '',
    'ЯЗЫК. Отвечай на том языке, на котором к тебе обратились: написали по-казахски —',
    'отвечай по-казахски, по-английски — по-английски. Разметка и правила те же.',
    '',
    'ДЛИНА. По умолчанию не больше пяти строк. Развёрнуто — только если прямо попросили',
    'подробностей. Не пересказывай факты, которых не спрашивали.',
    '',
    'ОФОРМЛЕНИЕ. Разметка только Telegram HTML: <b>жирный</b>, <i>курсив</i>.',
    'Markdown и звёздочки не использовать — они покажутся как есть.',
    'Любое перечисление — списком, а не фразой:',
    '  • жирный заголовок с итогом, дальше пустая строка;',
    '  • каждый пункт с новой строки, имя или название жирным;',
    '  • внутри пункта части разделяй « · »;',
    '  • между смысловыми блоками — пустая строка.',
    'Эмодзи — по месту, как маркеры: 📌 задача, 📅 встреча, 📊 KPI, 📝 отчёт, ⚠️ просрочка.',
    'Не лепи их в каждую строку и не используй вместо слов.',
    '',
    'ЦИФРЫ И ДАТЫ. Числа бери из фактов дословно, проценты — как дано.',
    'Даты произноси по-человечески: «4 августа», «завтра», «в пятницу», не «2026-08-04».',
    'Пустоту говори по-русски: «задач нет», а не «задач 0»; «KPI пока не считается»,',
    'а не «KPI нет данных». Следи за согласованием: «два человека», не «двое человек».',
    '',
    'ЧТО ТЫ ЗНАЕШЬ — только факты ниже. Они уже отобраны по правам собеседника: если',
    'чего-то в них нет, значит ему это не положено видеть либо этого нет в ERP. Не',
    'додумывай, не обобщай, не придумывай задачи, встречи, суммы и имена. На вопрос вне',
    'фактов ответь, что не видишь этого, и назови раздел ERP, где это есть.',
    '',
    'ДЕЙСТВИЯ. Голосом или текстом ты умеешь: поставить задачу, назначить встречу,',
    'закрыть задачу, вернуть закрытую в работу, сдвинуть срок, перенести и отменить',
    'встречу. Каждое проходит',
    'отдельным шагом — карточкой с подтверждением, — поэтому в разговоре НИКОГДА не',
    'сообщай, что уже создал, закрыл, перенёс или удалил запись. Хочет действие —',
    'попроси сказать его одной фразой, с примером на именах реальных коллег из фактов.',
    '',
    'ГРАНИЦЫ. Отчёты заполняются только в ERP. Про оклады и выплаты коротко отправь',
    'в раздел «Зарплата» — без объяснений и без цифр.',
    '',
    '——— ФАКТЫ ———',
    factSheet(brief, tz),
  ].join('\n')

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 700,
      system,
      messages: normalize(history, text),
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Ответ не собрался: ${res.status} ${body.slice(0, 300)}`)
  }
  const data = (await res.json()) as { content?: { type: string; text?: string }[] }
  const reply = ((data.content ?? []).find((c) => c.type === 'text')?.text ?? '').trim()
  if (!reply) throw new Error('Пустой ответ модели')

  await ctx.runMutation(internal.telegramTalk.remember, {
    chatId,
    employeeId,
    role: 'user',
    text,
  })
  await ctx.runMutation(internal.telegramTalk.remember, {
    chatId,
    employeeId,
    role: 'bot',
    text: reply,
  })
  return reply
}

async function runCommand(
  ctx: ActionCtx,
  chatId: number,
  link: { employeeId: Id<'employees'>; employeeName: string },
  transcript: string,
  updateId: number,
): Promise<void> {
  // Уточняем незаполненное поле по открытому черновику (§4.3).
  const pending = await ctx.runQuery(internal.telegramFlow.openDraft, { chatId })

  const people = await ctx.runQuery(internal.telegram.visiblePeople, {
    employeeId: link.employeeId,
  })
  const names = people.map((p: { name: string }) => p.name)
  const tz: string = await ctx.runQuery(internal.telegram.timezone, {})

  let parsed: Parsed
  try {
    parsed = await parseCommand(transcript, names, tz)
  } catch (e) {
    await ctx.runMutation(internal.telegram.logAudit, {
      kind: 'command',
      employeeId: link.employeeId,
      chatId,
      updateId,
      text: transcript,
      status: 'error',
      error: e instanceof Error ? e.message : String(e),
    })
    return await say(chatId, 'Что-то я подвис на этой фразе. Повторите, пожалуйста?')
  }

  // Если открыт черновик и человек уточняет поле — дополняем его, а не
  // заводим второй.
  const kind = pending && parsed.intent === 'unknown' ? pending.kind : parsed.intent
  // Не команда — значит обычный разговор, а не ошибка пользователя.
  if (kind === 'unknown') {
    let reply: string
    try {
      reply = await converse(ctx, chatId, link.employeeId, transcript, tz)
    } catch (e) {
      await ctx.runMutation(internal.telegram.logAudit, {
        kind: 'command',
        employeeId: link.employeeId,
        chatId,
        updateId,
        text: transcript,
        status: 'error',
        error: e instanceof Error ? e.message : String(e),
      })
      return await say(
        chatId,
        'Не могу сейчас ответить — связь с помощником пропала. Попробуйте через минуту. ' +
          'Задачу или встречу поставить смогу и так.',
      )
    }
    await ctx.runMutation(internal.telegram.logAudit, {
      kind: 'command',
      employeeId: link.employeeId,
      chatId,
      updateId,
      text: transcript,
      result: 'разговор',
    })
    return await say(chatId, reply)
  }

  // Дополняем открытый черновик, только когда человек действительно уточняет:
  // после нажатия «Изменить» или когда во фразе нет названия — значит это
  // ответ на вопрос бота, а не новая команда. Полная команда с названием
  // всегда начинает новую карточку, иначе в неё протекали бы поля прошлой.
  const merge = pending && (pending.state === 'editing' || !parsed.title) ? pending._id : undefined

  const draft = await ctx.runMutation(internal.telegramFlow.upsertDraft, {
    chatId,
    employeeId: link.employeeId,
    kind,
    transcript,
    parsed: JSON.stringify(parsed),
    mergeWith: merge,
  })

  await ctx.runMutation(internal.telegram.logAudit, {
    kind: 'command',
    employeeId: link.employeeId,
    chatId,
    updateId,
    text: transcript,
    fields: JSON.stringify(parsed).slice(0, 900),
    result: `черновик ${kind}`,
  })

  await showDraft(ctx, chatId, draft._id)
}

// Карточка предпросмотра (§4.1 шаг 6, §5.1 шаг 5).
async function showDraft(
  ctx: ActionCtx,
  chatId: number,
  draftId: Id<'telegramDrafts'>,
): Promise<void> {
  const view = await ctx.runQuery(internal.telegramFlow.draftView, { draftId })
  if (!view) return

  // §4.3: при неоднозначности бот показывает только разрешённых кандидатов
  // и просит выбрать, а не угадывает.
  if (view.ambiguous) {
    const target = view.ambiguous.what === 'target'
    await say(
      chatId,
      target
        ? `Подходит несколько — какую именно?`
        : `Кого именно вы имели в виду — «${view.ambiguous.query}»?`,
      view.ambiguous.options.map((o: { id: string; name: string }) => [
        { text: o.name.slice(0, 60), data: `${target ? 'tgt' : 'pick'}:${draftId}:${o.id}` },
      ]),
    )
    return
  }
  if (view.missing.length > 0) {
    await say(
      chatId,
      (view.card ? `${view.card}\n\n` : '') +
        `<b>Не хватает:</b> ${view.missing.join(', ')}\n\n` +
        `Скажите или напишите недостающее — я дополню карточку.`,
    )
    return
  }

  await say(chatId, view.card, [
    [
      { text: CONFIRM_LABEL[view.kind] ?? '✅ Сделать', data: `ok:${draftId}` },
      { text: '✏️ Изменить', data: `edit:${draftId}` },
      { text: '✖️ Отменить', data: `no:${draftId}` },
    ],
  ])
}

// Подпись на кнопке подтверждения. Она должна называть само действие: «создать»
// на отмене встречи читается как согласие создать встречу.
const CONFIRM_LABEL: Record<string, string> = {
  task: '✅ Создать',
  meeting: '✅ Назначить',
  task_done: '✅ Закрыть задачу',
  task_reopen: '✅ Вернуть в работу',
  task_deadline: '✅ Сдвинуть срок',
  meeting_move: '✅ Перенести',
  meeting_cancel: '✅ Отменить встречу',
}

async function onCallback(
  ctx: ActionCtx,
  cb: Record<string, any>,
  updateId: number,
): Promise<void> {
  const chatId = cb.message?.chat?.id as number
  const data: string = cb.data ?? ''
  // Гасим «часики» на кнопке. Если не вышло (устаревший запрос) — не беда:
  // из-за этого нельзя терять само нажатие «Создать».
  try {
    await tg('answerCallbackQuery', { callback_query_id: cb.id })
  } catch {
    /* пусто: ответ на callback не влияет на результат действия */
  }
  if (!chatId) return

  const link: LinkInfo = await ctx.runQuery(internal.telegram.linkByChat, { chatId })
  if (!link?.active) return await say(chatId, 'Ваш Telegram не подключён к ERP.')

  // Быстрые кнопки — те же ответы, что и команды меню.
  if (data.startsWith('q:')) return await runSlash(ctx, chatId, link, `/${data.slice(2)}`)

  const [action, rawDraftId, extra] = data.split(':')
  const draftId = rawDraftId as Id<'telegramDrafts'>

  if (action === 'no') {
    await ctx.runMutation(internal.telegramFlow.cancelDraft, { draftId })
    await ctx.runMutation(internal.telegram.logAudit, {
      kind: 'command',
      employeeId: link.employeeId,
      chatId,
      updateId,
      result: 'отменено пользователем',
    })
    return await say(chatId, 'Отменено. Ничего не создано.')
  }

  if (action === 'edit') {
    await ctx.runMutation(internal.telegramFlow.setEditing, { draftId })
    return await say(
      chatId,
      'Скажите или напишите, что поправить — например «срок послезавтра в 12:00» или ' +
        '«приоритет обычный». Я обновлю карточку.',
    )
  }

  if (action === 'pick') {
    await ctx.runMutation(internal.telegramFlow.resolvePerson, {
      draftId,
      employeeId: extra as Id<'employees'>,
    })
    return await showDraft(ctx, chatId, draftId)
  }

  // Выбрана запись из нескольких похожих — задача или встреча.
  if (action === 'tgt') {
    await ctx.runMutation(internal.telegramFlow.pickTarget, { draftId, targetId: extra })
    return await showDraft(ctx, chatId, draftId)
  }

  if (action === 'ok') {
    // §4.3: подтверждение успеха только после фактической записи в ERP.
    let res: { ok: boolean; message: string; ref?: string; link?: string }
    try {
      res = await ctx.runMutation(internal.telegramFlow.commitDraft, { draftId })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      await ctx.runMutation(internal.telegram.logAudit, {
        kind: 'command',
        employeeId: link.employeeId,
        chatId,
        updateId,
        status: 'error',
        error: message,
      })
      return await say(chatId, `⚠️ Запись не создана: ${message}\n\nПопробуйте ещё раз.`)
    }
    await ctx.runMutation(internal.telegram.logAudit, {
      kind: 'command',
      employeeId: link.employeeId,
      chatId,
      updateId,
      objectRef: res.ref,
      result: res.message,
      status: 'ok',
    })
    const base = siteUrl()
    await say(
      chatId,
      `${res.message}` + (base && res.link ? `\n\n<a href="${base}${res.link}">Открыть в ERP</a>` : ''),
    )
  }
}

// ——— Настройка webhook ———
//
// Telegram шлёт обновления на один адрес. Секрет проверяется на входе (§9).
export const setWebhook = internalAction({
  args: { url: v.string() },
  handler: async (_ctx, { url }) => {
    // Секрет берём из окружения — наружу он не передаётся и в логи не попадает.
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET
    if (!secret) throw new Error('TELEGRAM_WEBHOOK_SECRET не задан в окружении Convex')
    const res = await tg('setWebhook', {
      url,
      secret_token: secret,
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: true,
    })
    return res
  },
})

// Кто мы для Telegram: имя бота нужно, чтобы собирать ссылки-приглашения.
export const getMe = internalAction({
  args: {},
  handler: async () => {
    const res = await fetch(`${API}/bot${token()}/getMe`)
    return (await res.json()) as unknown
  },
})

// §11: наблюдаемость. Состояние webhook — главная точка отказа всего модуля:
// если Telegram некуда доставлять, бот молчит и внешне это неотличимо от
// «ничего не происходит». Показываем администратору прямо в настройках.
//
// Webhook может слететь и без нашего участия: Telegram снимает его, если по
// тому же токену кто-то вызвал getUpdates, и при отзыве токена в BotFather.
export const health = action({
  args: {},
  handler: async (ctx): Promise<{
    ok: boolean
    url: string
    expected: string
    lastError: string | null
    lastErrorAt: number | null
    pending: number
    botUsername: string | null
  } | null> => {
    const isOwner: boolean = await ctx.runQuery(internal.telegram.callerIsOwner, {})
    if (!isOwner) return null

    const expected = `${(process.env.CONVEX_SITE_URL ?? '').replace(/\/$/, '')}/telegram/webhook`
    const info = (await (await fetch(`${API}/bot${token()}/getWebhookInfo`)).json()) as {
      result?: {
        url?: string
        last_error_message?: string
        last_error_date?: number
        pending_update_count?: number
      }
    }
    const me = (await (await fetch(`${API}/bot${token()}/getMe`)).json()) as {
      result?: { username?: string }
    }
    const url = info.result?.url ?? ''
    return {
      ok: url === expected,
      url,
      expected,
      lastError: info.result?.last_error_message ?? null,
      lastErrorAt: info.result?.last_error_date ? info.result.last_error_date * 1000 : null,
      pending: info.result?.pending_update_count ?? 0,
      botUsername: me.result?.username ?? null,
    }
  },
})

// Самовосстановление. За один день webhook боевого бота обнулялся дважды, и
// оба раза это выглядело как «бот сломался»: сообщения уходили в пустоту, а
// понять причину без терминала было нельзя.
//
// Поэтому адрес проверяется по расписанию и восстанавливается сам. Каждый
// деплоймент ставит свой собственный адрес и знает его из окружения, так что
// подменить прод на dev эта проверка не может.
export const ensureWebhook = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    const site = (process.env.CONVEX_SITE_URL ?? '').replace(/\/$/, '')
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET
    if (!site || !secret || !process.env.TELEGRAM_BOT_TOKEN) return
    const url = `${site}/telegram/webhook`

    let current: string
    try {
      const info = (await (await fetch(`${API}/bot${token()}/getWebhookInfo`)).json()) as {
        result?: { url?: string }
      }
      current = info.result?.url ?? ''
    } catch {
      // Telegram недоступен — не повод шуметь, вернёмся через четверть часа.
      return
    }
    if (current === url) return

    await tg('setWebhook', {
      url,
      secret_token: secret,
      allowed_updates: ['message', 'callback_query'],
    })
    // Запись в журнал: если адрес слетает регулярно, это должно быть видно
    // администратору, а не тонуть в молчаливой починке.
    await ctx.runMutation(internal.telegram.logAudit, {
      kind: 'reconnect',
      result: current ? `адрес был чужим: ${current.slice(0, 120)}` : 'адрес был пуст',
      status: 'ok',
    })
  },
})

// Починка одной кнопкой: адрес деплоймента система знает сама.
export const repairWebhook = action({
  args: {},
  handler: async (ctx): Promise<{ url: string }> => {
    const isOwner: boolean = await ctx.runQuery(internal.telegram.callerIsOwner, {})
    if (!isOwner) throw new Error('Переподключить webhook может только администратор')
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET
    if (!secret) throw new Error('TELEGRAM_WEBHOOK_SECRET не задан в окружении Convex')
    const url = `${(process.env.CONVEX_SITE_URL ?? '').replace(/\/$/, '')}/telegram/webhook`
    await tg('setWebhook', {
      url,
      secret_token: secret,
      allowed_updates: ['message', 'callback_query'],
    })
    return { url }
  },
})

export const webhookInfo = internalAction({
  args: {},
  handler: async () => {
    const res = await fetch(`${API}/bot${token()}/getWebhookInfo`)
    return (await res.json()) as unknown
  },
})
