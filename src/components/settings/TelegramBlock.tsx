import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { Check, Copy, Loader2, Send, ShieldCheck, X } from 'lucide-react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { errMessage } from '@/lib/errors'
import { reportTime } from '@/lib/reports'

// Блок «Telegram» в карточке сотрудника (ТЗ Telegram §8.1).
//
// Подключение двухэтапное (§3.1): администратор выдаёт одноразовую ссылку,
// сотрудник запускает бота, и только после подтверждения администратором
// связь активируется. Сам сотрудник привязаться не может.

const STATUS: Record<string, { label: string; chip: string; hint: string }> = {
  none: {
    label: 'Не подключён',
    chip: 'bg-chip text-muted',
    hint: 'Привязка отсутствует, уведомления не отправляются.',
  },
  invited: {
    label: 'Приглашение создано',
    chip: 'bg-[#fff6e6] text-[#b7791f]',
    hint: 'Ссылка выдана, сотрудник ещё не запустил бота.',
  },
  pending: {
    label: 'Ожидает подтверждения',
    chip: 'bg-[#fff6e6] text-[#b7791f]',
    hint: 'Telegram получен — требуется ваше решение.',
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
  // Имя бота для ссылки-приглашения. Приходит из настроек модуля.
  botUsername?: string | null
}) {
  const data = useQuery(api.telegram.linkFor, { employeeId })
  const createInvite = useMutation(api.telegram.createInvite)
  const confirmLink = useMutation(api.telegram.confirmLink)
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
  const code = 'inviteCode' in data ? data.inviteCode : null
  const inviteUrl =
    code && botUsername ? `https://t.me/${botUsername}?start=${code}` : code ? code : null

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
          {data.connectedBy && <span>кем: {data.connectedBy}</span>}
          {data.lastDeliveryAt && <span>последняя доставка {reportTime(data.lastDeliveryAt)}</span>}
        </div>
      )}
      {'lastError' in data && data.lastError && (
        <p className="text-[11px] text-[#c53030]">Ошибка доставки: {data.lastError}</p>
      )}

      {/* Ссылка-приглашение. Её админ передаёт сотруднику сам (§3.1 шаг 3). */}
      {inviteUrl && (
        <div className="rounded-lg bg-chip p-3 flex flex-col gap-2">
          <div className="text-[11px] text-muted">
            Одноразовая ссылка. Действует до{' '}
            {data.inviteExpiresAt ? reportTime(data.inviteExpiresAt) : '—'} и работает один раз.
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-[11px] text-ink-2 break-all">{inviteUrl}</code>
            <button
              onClick={() => {
                navigator.clipboard?.writeText(inviteUrl)
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              }}
              className="ico-btn w-8 h-8 shrink-0"
              title="Скопировать"
            >
              {copied ? <Check size={14} className="text-green-d" /> : <Copy size={14} />}
            </button>
          </div>
          {!botUsername && (
            <p className="text-[11px] text-[#b7791f]">
              Укажите имя бота в Настройках → Общие, чтобы ссылка собиралась целиком.
            </p>
          )}
        </div>
      )}

      {error && <p className="text-sm text-[#c53030]">{error}</p>}

      <div className="flex items-center gap-2 flex-wrap">
        {/* §3.1 шаг 6: финальное подтверждение администратором. */}
        {data.status === 'pending' && (
          <>
            <button
              onClick={() => run('yes', () => confirmLink({ employeeId, approve: true }))}
              disabled={!!busy}
              className="btn btn-green h-8 px-3 text-sm disabled:opacity-60"
            >
              {busy === 'yes' ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />}
              Подтвердить подключение
            </button>
            <button
              onClick={() => run('no', () => confirmLink({ employeeId, approve: false }))}
              disabled={!!busy}
              className="btn btn-ghost h-8 px-3 text-sm"
            >
              <X size={13} /> Отклонить
            </button>
          </>
        )}

        {(data.status === 'none' || data.status === 'disabled') && (
          <button
            onClick={() => run('inv', () => createInvite({ employeeId }))}
            disabled={!!busy}
            className="btn btn-green h-8 px-3 text-sm disabled:opacity-60"
          >
            {busy === 'inv' ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
            Подключить Telegram
          </button>
        )}

        {(data.status === 'invited' || data.status === 'connected' || data.status === 'failed') && (
          <button
            onClick={() => run('inv', () => createInvite({ employeeId }))}
            disabled={!!busy}
            className="btn btn-ghost h-8 px-3 text-sm"
          >
            {busy === 'inv' ? <Loader2 size={13} className="animate-spin" /> : null}
            {data.status === 'invited' ? 'Новая ссылка' : 'Переподключить'}
          </button>
        )}

        {/* §3.3: отключение. Данные ERP не удаляются. */}
        {data.status !== 'none' && data.status !== 'disabled' && (
          <button
            onClick={() => run('off', () => disableLink({ employeeId }))}
            disabled={!!busy}
            className="btn btn-ghost h-8 px-3 text-sm text-[#c53030]"
          >
            {busy === 'off' ? <Loader2 size={13} className="animate-spin" /> : null}
            Отключить
          </button>
        )}
      </div>

      {/* §6.1 и §8.1: категории уведомлений сотрудника. Права в ERP не меняются. */}
      {data.status === 'connected' && (
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
