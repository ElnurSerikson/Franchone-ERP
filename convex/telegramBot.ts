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

const API = 'https://api.telegram.org'

// Явный тип: без него вывод уходит по кругу через internal.* и вся схема
// Convex вырождается в any.
type LinkInfo = {
  status: string
  employeeId: Id<'employees'>
  employeeName: string
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
    body: JSON.stringify({ audio_url: upload_url, language_code: 'ru' }),
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
  intent: 'task' | 'meeting' | 'unknown'
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
    '{"intent":"task|meeting|unknown","title":str,"description":str|null,',
    '"people":[str],"date":"YYYY-MM-DD"|null,"time":"HH:MM"|null,',
    '"priority":"low|medium|high|urgent"|null,"place":str|null,"url":str|null,',
    '"object":str|null,"note":str|null}',
    '',
    `Сегодня ${now.date} (${now.weekday}), сейчас ${now.time}. Часовой пояс ${tz}.`,
    'Относительные выражения («завтра», «в пятницу», «через два часа») переводи в конкретные дату и время.',
    '',
    'intent="task" — просят поставить задачу. intent="meeting" — назначить встречу.',
    'Если не понял намерение — "unknown".',
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

async function say(chatId: number, text: string, buttons?: Button[][]) {
  await tg('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...(buttons ? { reply_markup: keyboard(buttons) } : {}),
  })
}

const HELP =
  '<b>Бот FRANCHONE ERP</b>\n\n' +
  'Отправьте голосовое сообщение:\n' +
  '• «Поставь Арману задачу подготовить отчёт по KazNaves до завтра, 18:00, высокий приоритет»\n' +
  '• «Назначь встречу с Алиной и Данияром завтра в 15:00 в офисе, обсуждаем кампанию»\n\n' +
  'Бот покажет карточку — задача или встреча создаются только после вашего подтверждения.\n\n' +
  'Заполнять отчёты через бота нельзя: это делается в ERP.'


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
      await say(
        chatId,
        res.reason === 'busy'
          ? 'Этот Telegram уже подключён к другому сотруднику. Обратитесь к администратору.'
          : 'Не нахожу такой email среди сотрудников.\n\n' +
              'Укажите ту же почту, с которой вы входите в ERP. Если она верна, обратитесь к администратору.',
      )
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
      await say(
        chatId,
        `<b>${firstName(res.name)}, добро пожаловать в Telegram-бот FRANCHONE!</b>\n\n` +
          `${res.position} · доступ открыт.\n\n${HELP}`,
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
    await say(chatId, ASK_EMAIL)
    return
  }

  const link: LinkInfo = await ctx.runQuery(internal.telegram.linkByChat, { chatId })
  // Пока привязки нет, бот ведёт только диалог входа и ничего из ERP не
  // показывает.
  if (!link?.active) return await onAuth(ctx, chatId, msg, text)

  if (text === '/help' || text === '/start') return await say(chatId, HELP)

  const voice = msg.voice ?? msg.audio ?? msg.video_note
  if (!voice && !text) return
  if (!voice) {
    // Текст обрабатываем так же, как расшифровку голоса: это удобно и не
    // противоречит ТЗ, где голос — основной, но не единственный вход.
    return await runCommand(ctx, chatId, link, text, updateId)
  }

  await say(chatId, '🎧 Слушаю…')
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
    return await say(chatId, '⚠️ Не удалось распознать голосовое сообщение. Попробуйте ещё раз.')
  }
  if (!transcript) return await say(chatId, '⚠️ В сообщении не распозналась речь.')
  await runCommand(ctx, chatId, link, transcript, updateId)
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
    return await say(chatId, '⚠️ Не удалось разобрать команду. Сформулируйте иначе.')
  }

  // Если открыт черновик и человек уточняет поле — дополняем его, а не
  // заводим второй.
  const kind = pending && parsed.intent === 'unknown' ? pending.kind : parsed.intent
  if (kind === 'unknown') {
    await ctx.runMutation(internal.telegram.logAudit, {
      kind: 'command',
      employeeId: link.employeeId,
      chatId,
      updateId,
      text: transcript,
      result: 'намерение не распознано',
    })
    return await say(
      chatId,
      `Не понял, что нужно сделать.\n\nРаспознано: «${transcript}»\n\n` +
        `Скажите «поставь задачу …» или «назначь встречу …».`,
    )
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
    await say(
      chatId,
      `Кого именно вы имели в виду — «${view.ambiguous.query}»?`,
      view.ambiguous.options.map((o: { id: string; name: string }) => [
        { text: o.name, data: `pick:${draftId}:${o.id}` },
      ]),
    )
    return
  }
  if (view.missing.length > 0) {
    await say(
      chatId,
      `${view.card}\n\n<b>Не хватает:</b> ${view.missing.join(', ')}\n\n` +
        `Скажите или напишите недостающее — я дополню карточку.`,
    )
    return
  }

  await say(chatId, view.card, [
    [
      { text: view.kind === 'task' ? '✅ Создать' : '✅ Назначить', data: `ok:${draftId}` },
      { text: '✏️ Изменить', data: `edit:${draftId}` },
      { text: '✖️ Отменить', data: `no:${draftId}` },
    ],
  ])
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
