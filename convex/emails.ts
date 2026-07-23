// Брендовое письмо с кодом входа FRANCHONE.
// Табличная вёрстка + инлайн-стили — для совместимости с почтовыми клиентами
// (Gmail, Outlook, Apple Mail). Фирменные цвета: бирюзовый #026b62,
// золото #fe9c07, тёмный #19181d.

const SITE = (process.env.SITE_URL ?? 'https://erp.franchone.kz').replace(/\/+$/, '')
const LOGO = `${SITE}/logo-email.png`

const TEAL = '#026b62'
const TEAL_DARK = '#014f48'
const GOLD = '#fe9c07'
const DARK = '#19181d'
const INK = '#1c1d22'
const MUTED = '#8b9096'

export function otpEmail(code: string): { subject: string; html: string; text: string } {
  const subject = 'Код для входа в FRANCHONE'

  const text =
    `Ваш код для входа в FRANCHONE: ${code}\n\n` +
    `Код действует 10 минут. Никому его не сообщайте.\n` +
    `Если вы не запрашивали вход — просто проигнорируйте это письмо.\n\n` +
    `— FRANCHONE · стратегический партнёр по франчайзингу`

  const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="x-apple-disable-message-reformatting">
<title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#eef1f0;-webkit-font-smoothing:antialiased;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Ваш код действует 10 минут. Никому его не сообщайте.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f0;padding:32px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;margin:0 auto;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 8px 30px rgba(15,40,30,.08);">
          <!-- gold accent -->
          <tr><td style="height:4px;background:${GOLD};font-size:0;line-height:0;">&nbsp;</td></tr>
          <!-- dark header with logo -->
          <tr>
            <td align="center" style="background:${DARK};padding:30px 24px;">
              <img src="${LOGO}" width="212" alt="FRANCHONE" style="display:block;border:0;outline:none;text-decoration:none;width:212px;height:auto;">
            </td>
          </tr>
          <!-- body -->
          <tr>
            <td style="padding:40px 44px 8px 44px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
              <div style="font-size:12px;font-weight:700;letter-spacing:1.5px;color:${TEAL};text-transform:uppercase;">Вход в панель</div>
              <h1 style="margin:8px 0 12px;font-size:24px;line-height:1.25;font-weight:800;color:${INK};">Ваш код для входа</h1>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#4a4e55;">
                Используйте этот код, чтобы войти в панель управления FRANCHONE. Он действует <b style="color:${INK};">10 минут</b>.
              </p>
            </td>
          </tr>
          <!-- code panel -->
          <tr>
            <td style="padding:0 44px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef7f5;border:1px solid #cfe6e0;border-radius:14px;">
                <tr>
                  <td align="center" style="padding:24px 16px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                    <div style="font-size:40px;line-height:1;font-weight:800;letter-spacing:12px;color:${TEAL_DARK};padding-left:12px;">${code}</div>
                  </td>
                </tr>
              </table>
              <p style="margin:12px 0 0;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;color:${MUTED};text-align:center;">
                Никому не сообщайте этот код.
              </p>
            </td>
          </tr>
          <!-- security note -->
          <tr>
            <td style="padding:28px 44px 4px 44px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
              <div style="height:1px;background:#eceeed;font-size:0;line-height:0;">&nbsp;</div>
              <p style="margin:22px 0 0;font-size:13px;line-height:1.6;color:${MUTED};">
                Если вы не запрашивали вход — просто проигнорируйте это письмо. Без кода в аккаунт никто не войдёт.
              </p>
            </td>
          </tr>
          <!-- footer -->
          <tr>
            <td style="padding:26px 44px 34px 44px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
              <div style="font-size:13px;font-weight:700;color:${INK};">FRANCHONE</div>
              <div style="font-size:12px;color:${MUTED};margin-top:2px;">Стратегический партнёр по франчайзингу</div>
              <div style="font-size:12px;color:${MUTED};margin-top:10px;">
                +7 707 101 00 02 &nbsp;·&nbsp; г. Алматы, ул. Розыбакиева 247
              </div>
              <div style="font-size:11px;color:#b6bac1;margin-top:12px;">© 2026 FRANCHONE. Все права защищены.</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

  return { subject, html, text }
}

// Экранирование пользовательского имени для вставки в HTML письма.
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Письмо-приглашение сотруднику: «вас добавили в команду» + кнопка входа.
// Вход у нас по одноразовому коду (без пароля), поэтому в письме — ссылка на
// страницу входа, а код сотрудник получит, введя свой email.
export function inviteEmail(name: string): { subject: string; html: string; text: string } {
  const subject = 'Вас добавили в команду FRANCHONE'
  const greeting = name.trim() ? `Здравствуйте, ${name.trim()}!` : 'Здравствуйте!'

  const text =
    `${greeting}\n\n` +
    `Вас добавили в команду FRANCHONE ERP — внутреннюю панель управления.\n\n` +
    `Войдите в панель: ${SITE}\n\n` +
    `Вход по коду, без пароля: на странице входа введите этот email — мы пришлём ` +
    `одноразовый код на почту.\n\n` +
    `— FRANCHONE · стратегический партнёр по франчайзингу`

  const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="x-apple-disable-message-reformatting">
<title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#eef1f0;-webkit-font-smoothing:antialiased;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Вас добавили в команду FRANCHONE ERP. Войдите по своему email.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f0;padding:32px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;margin:0 auto;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 8px 30px rgba(15,40,30,.08);">
          <tr><td style="height:4px;background:${GOLD};font-size:0;line-height:0;">&nbsp;</td></tr>
          <tr>
            <td align="center" style="background:${DARK};padding:30px 24px;">
              <img src="${LOGO}" width="212" alt="FRANCHONE" style="display:block;border:0;outline:none;text-decoration:none;width:212px;height:auto;">
            </td>
          </tr>
          <tr>
            <td style="padding:40px 44px 8px 44px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
              <div style="font-size:12px;font-weight:700;letter-spacing:1.5px;color:${TEAL};text-transform:uppercase;">Добро пожаловать</div>
              <h1 style="margin:8px 0 12px;font-size:24px;line-height:1.25;font-weight:800;color:${INK};">${esc(greeting)}</h1>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#4a4e55;">
                Вас добавили в команду <b style="color:${INK};">FRANCHONE ERP</b> — внутреннюю панель управления командой, задачами и KPI.
              </p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:0 44px 8px 44px;">
              <a href="${SITE}" target="_blank" style="display:inline-block;background:${TEAL};color:#ffffff;text-decoration:none;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-weight:700;font-size:15px;padding:14px 30px;border-radius:12px;">Войти в панель</a>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 44px 4px 44px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef7f5;border:1px solid #cfe6e0;border-radius:14px;">
                <tr>
                  <td style="padding:16px 18px;font-size:13px;line-height:1.6;color:#3f5a54;">
                    <b style="color:${TEAL_DARK};">Вход по коду — без пароля.</b> На странице входа введите этот адрес почты, и мы пришлём одноразовый код для входа.
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:26px 44px 34px 44px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
              <div style="height:1px;background:#eceeed;font-size:0;line-height:0;">&nbsp;</div>
              <div style="font-size:13px;font-weight:700;color:${INK};margin-top:22px;">FRANCHONE</div>
              <div style="font-size:12px;color:${MUTED};margin-top:2px;">Стратегический партнёр по франчайзингу</div>
              <div style="font-size:11px;color:#b6bac1;margin-top:12px;">© 2026 FRANCHONE. Все права защищены.</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

  return { subject, html, text }
}
