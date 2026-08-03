import { httpRouter } from 'convex/server'
import { httpAction } from './_generated/server'
import { internal } from './_generated/api'
import { auth } from './auth'

const http = httpRouter()

// Маршруты авторизации Convex Auth (обмен токенов и т.п.)
auth.addHttpRoutes(http)

// Webhook Telegram (ТЗ Telegram §9, §11).
//
// Telegram шлёт сюда каждое обновление. Секретный токен проверяется на входе:
// без него любой мог бы прислать боту поддельное событие. Обработка идёт в
// action и запускается асинхронно — Telegram должен получить 200 быстро,
// иначе он начнёт повторять доставку.
http.route({
  path: '/telegram/webhook',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET
    if (!secret || request.headers.get('x-telegram-bot-api-secret-token') !== secret) {
      return new Response('forbidden', { status: 403 })
    }
    let update: unknown
    try {
      update = await request.json()
    } catch {
      return new Response('bad request', { status: 400 })
    }
    await ctx.scheduler.runAfter(0, internal.telegramBot.handleUpdate, { update })
    return new Response('ok', { status: 200 })
  }),
})

export default http
