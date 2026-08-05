import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { Check, Copy, Loader2, Send } from 'lucide-react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { errMessage } from '@/lib/errors'
import { reportTime } from '@/lib/reports'

// Блок «Telegram» в карточке сотрудника (ТЗ Telegram §8.1).
//
// Подключается сотрудник сам: запускает бота, вводит свой рабочий email из ERP
// и код, пришедший на почту. Администратору здесь остаётся то, что и должно
// быть за ним, — видеть состояние привязки, отключать её и настраивать
// категории уведомлений.

const STATUS: Record<string, { label: string; chip: string; hint: string }> = {
  none: {
    label: 'Не подключён',
    chip: 'bg-chip text-muted',
    hint: 'Привязка отсутствует, уведомления не отправляются.',
  },
  invited: {
    label: 'Не подключён',
    chip: 'bg-chip text-muted',
    hint: 'Сотрудник ещё не подтвердил почту в боте.',
  },
  pending: {
    label: 'Не подключён',
    chip: 'bg-chip text-muted',
    hint: 'Сотрудник ещё не подтвердил почту в боте.',
  },
  connected: {
    label: 'Подключён',
    chip: 'bg-[#e2f2ef] text-green-d',
    hint: 'Команды и уведомления работают в пределах прав ERP.',
  },
  disabled: {
    label: 'Отключён администратором',
    chip: 'bg-chip text-muted',
    hint: 'Связь заблокирована, история сохранена.',
  },
  failed: {
    label: 'Ошибка доставки',
    chip: 'bg-[#fdeaea] text-[#c53030]',
    hint: 'Telegram недоступен или бот заблокирован пользователем.',
  },
}

export default function TelegramBlock({
  employeeId,
  botUsername,
}: {
  employeeId: Id<'employees'>
  // Имя бота — чтобы дать сотруднику готовую ссылку. Приходит из настроек модуля.
  botUsername?: string | null
}) {
  const data = useQuery(api.telegram.linkFor, { employeeId })
  const disableLink = useMutation(api.telegram.disableLink)
  const setCategories = useMutation(api.telegram.setCategories)

  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  if (data === undefined) {
    return (
      <div className="rounded-xl border border-line p-4 grid place-items-center text-muted">
        <Loader2 className="animate-spin" size={16} />
      </div>
    )
  }
  if (data === null) return null

  const st = STATUS[data.status] ?? STATUS.none
  const connected = data.status === 'connected'
  const botUrl = botUsername ? `https://t.me/${botUsername.replace(/^@/, '')}` : null

  const run = async (name: string, fn: () => Promise<unknown>) => {
    setBusy(name)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError(errMessage(e, 'Не удалось выполнить действие.'))
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="rounded-xl border border-line p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Send size={15} className="text-green" />
        <span className="text-sm font-semibold text-ink flex-1">Telegram</span>
        <span className={`chip whitespace-nowrap ${st.chip}`}>{st.label}</span>
      </div>
      <p className="text-[11px] text-muted-2 -mt-1">{st.hint}</p>

      {/* §8.1: справочные сведения о привязке. */}
      {'username' in data && (data.username || data.chatIdMasked) && (
        <div className="text-[11px] text-muted flex flex-wrap gap-x-4 gap-y-1">
          {data.username && <span>@{data.username}</span>}
          {data.tgName && <span>{data.tgName}</span>}
          {data.chatIdMasked && <span>ID {data.chatIdMasked}</span>}
          {data.connectedAt && <span>подключён {reportTime(data.connectedAt)}</span>}
          {data.lastDeliveryAt && <span>последняя доставка {reportTime(data.lastDeliveryAt)}</span>}
        </div>
      )}
      {'lastError' in data && data.lastError && (
        <p className="text-[11px] text-[#c53030]">Ошибка доставки: {data.lastError}</p>
      )}

      {/* Пока сотрудник не подключился — показываем, что ему для этого сделать. */}
      {!connected && (
        <div className="rounded-lg bg-chip p-3 flex flex-col gap-2">
          <div className="text-[11px] text-muted leading-relaxed">
            Сотрудник подключается сам: открывает бота, нажимает «Старт», вводит свой рабочий email
            из ERP и шестизначный код, который придёт на почту.
          </div>
          {botUrl ? (
            <div className="flex items-center gap-2">
              <code className="flex-1 text-[11px] text-ink-2 break-all">{botUrl}</code>
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(botUrl)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1500)
                }}
                className="ico-btn w-8 h-8 shrink-0"
                title="Скопировать ссылку на бота"
              >
                {copied ? <Check size={14} className="text-green-d" /> : <Copy size={14} />}
              </button>
            </div>
          ) : (
            <p className="text-[11px] text-[#b7791f]">
              Укажите имя бота в Настройках → Telegram, чтобы здесь появилась готовая ссылка.
            </p>
          )}
        </div>
      )}

      {error && <p className="text-sm text-[#c53030]">{error}</p>}

      {/* §3.3: отключение. Данные ERP не удаляются. */}
      {data.status !== 'none' && data.status !== 'disabled' && (
        <div>
          <button
            onClick={() => run('off', () => disableLink({ employeeId }))}
            disabled={!!busy}
            className="btn btn-ghost h-8 px-3 text-sm text-[#c53030]"
          >
            {busy === 'off' ? <Loader2 size={13} className="animate-spin" /> : null}
            Отключить
          </button>
        </div>
      )}

      {/* §6.1 и §8.1: категории уведомлений сотрудника. Права в ERP не меняются. */}
      {connected && (
        <div>
          <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-2">
            Уведомления
          </div>
          <div className="flex flex-wrap gap-2">
            {data.categories.map((c) => (
              <button
                key={c.key}
                onClick={() =>
                  run('cat', () =>
                    setCategories({
                      employeeId,
                      muted: data.categories
                        .filter((x) => (x.key === c.key ? c.on : !x.on))
                        .map((x) => x.key),
                    }),
                  )
                }
                className={`chip whitespace-nowrap transition-colors ${
                  c.on ? 'bg-[#e2f2ef] text-green-d' : 'bg-chip text-muted'
                }`}
              >
                {c.on && <Check size={11} />} {c.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
