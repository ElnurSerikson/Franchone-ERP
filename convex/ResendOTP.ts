import { Email } from '@convex-dev/auth/providers/Email'
import { Resend as ResendAPI } from 'resend'
import { ConvexError } from 'convex/values'
import type { AnyDataModel, GenericActionCtx } from 'convex/server'
import { internal } from './_generated/api'
import { otpEmail } from './emails'

// OTP-провайдер: отправляет 6-значный код на почту через Resend.
// Ключ Resend — в переменной окружения AUTH_RESEND_KEY (задаётся в Convex).
// Пока ключ не задан — dev-режим: код печатается в логи (npx convex logs),
// чтобы можно было тестировать вход без реальной отправки письма.
export const ResendOTP = Email({
  id: 'resend-otp',
  apiKey: process.env.AUTH_RESEND_KEY ?? process.env.RESEND_API_KEY,
  maxAge: 60 * 10, // код действует 10 минут

  async generateVerificationToken() {
    // Криптостойкий 6-значный код (100000–999999)
    const bytes = new Uint8Array(4)
    crypto.getRandomValues(bytes)
    const num = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0
    return String(100000 + (num % 900000))
  },

  async sendVerificationRequest(
    {
      identifier: email,
      provider,
      token,
    }: { identifier: string; provider: { apiKey?: string }; token: string },
    ctx?: GenericActionCtx<AnyDataModel>,
  ) {
    // Инвайт-гейт ДО отправки: не шлём код чужим адресам.
    if (ctx) {
      const invited = await ctx.runQuery(internal.users.isInvited, { email })
      if (!invited) {
        throw new ConvexError(
          'Нет доступа. Обратитесь к владельцу, чтобы вас добавили в команду.',
        )
      }
    }

    const apiKey = provider.apiKey
    const { subject, html, text } = otpEmail(token)
    if (!apiKey) {
      // dev-режим без Resend
      console.log(`[DEV OTP] Код входа для ${email}: ${token}`)
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
    if (error) {
      throw new Error('Не удалось отправить код: ' + JSON.stringify(error))
    }
  },
})
