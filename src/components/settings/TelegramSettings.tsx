import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { Check, Loader2, ScrollText, Send } from 'lucide-react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { errMessage, errDetail } from '@/lib/errors'
import { useData } from '@/lib/useData'
import { reportTime } from '@/lib/reports'
import { th, td, theadRow } from '@/lib/table'

// Общие настройки Telegram-модуля (ТЗ Telegram §8.2) и журнал (§10).
//
// Токена бота здесь нет и быть не может: §8.2 требует хранить его в защищённых
// настройках сервера, а не в интерфейсе или клиентском коде. В Convex он лежит
// переменной окружения TELEGRAM_BOT_TOKEN.

const CATEGORIES = [
  { key: 'task', label: 'Задачи' },
  { key: 'meeting', label: 'Встречи' },
  { key: 'report', label: 'Отчёты' },
  { key: 'plan', label: 'Планы и показатели' },
  { key: 'kpi', label: 'Достижения KPI' },
]

const inputCls =
  'w-full h-9 rounded-lg border border-line-2 px-3 text-sm text-ink focus:outline-none focus:border-green-light bg-white'

export default function TelegramSettings() {
  const settings = useQuery(api.settings.get, {})
  const update = useMutation(api.settings.update)
  const { activeEmployees } = useData()

  const [draft, setDraft] = useState<Record<string, unknown>>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  if (settings === undefined) {
    return (
      <div className="card p-10 grid place-items-center text-muted">
        <Loader2 className="animate-spin" size={18} />
      </div>
    )
  }

  const val = <T,>(key: string, fallback: T): T =>
    (draft[key] as T) ?? ((settings as Record<string, unknown>)[key] as T) ?? fallback

  const edit = (key: string, value: unknown) => {
    setDraft((d) => ({ ...d, [key]: value }))
    setSaved(false)
  }

  const disabled = val<string[]>('tgDisabledCategories', [])
  const recipients = val<string[]>('tgReportRecipients', [])
  const dirty = Object.keys(draft).length > 0

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      await update(draft as never)
      setDraft({})
      setSaved(true)
    } catch (e) {
      const detail = errDetail(e)
      setError(errMessage(e, 'Не удалось сохранить.') + (detail ? ` (${detail})` : ''))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <Send size={18} className="text-green" />
          <h3 className="sec-title flex-1">Telegram-модуль</h3>
          {dirty && (
            <button
              onClick={save}
              disabled={saving}
              className="btn btn-green h-9 px-4 text-sm disabled:opacity-60"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              Сохранить
            </button>
          )}
          {saved && !dirty && <span className="text-sm text-green-d">Сохранено</span>}
        </div>

        <div className="rounded-xl bg-chip p-3 text-xs text-ink-2 mb-4">
          Токен бота и ключи распознавания хранятся в защищённых настройках сервера, а не здесь.
          Подключение сотрудников — в карточке каждого: Команда → сотрудник → Telegram.
        </div>

        {error && <p className="text-sm text-[#c53030] mb-3">{error}</p>}

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Имя бота (без @)">
            <input
              className={inputCls}
              placeholder="franchone_erp_bot"
              value={val('tgBotUsername', '')}
              onChange={(e) => edit('tgBotUsername', e.target.value.replace('@', '').trim())}
            />
          </Field>
          <Field label="Срок ссылки, часов">
            <input
              className={inputCls}
              inputMode="numeric"
              value={String(val('tgInviteTtlHours', 24))}
              onChange={(e) => edit('tgInviteTtlHours', Math.max(1, Number(e.target.value) || 24))}
            />
          </Field>
          <Field label="Напоминание до встречи, минут">
            <input
              className={inputCls}
              inputMode="numeric"
              value={String(val('tgMeetingRemindMin', 60))}
              onChange={(e) => edit('tgMeetingRemindMin', Math.max(5, Number(e.target.value) || 60))}
            />
          </Field>
          <Field label="Напоминание до срока отчёта, минут">
            <input
              className={inputCls}
              inputMode="numeric"
              value={String(val('tgReportRemindMin', 60))}
              onChange={(e) => edit('tgReportRemindMin', Math.max(5, Number(e.target.value) || 60))}
            />
          </Field>
        </div>

        {/* §6.1: глобальные переключатели категорий. Права в ERP не меняются. */}
        <div className="mt-4">
          <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-2">
            Категории уведомлений
          </div>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((c) => {
              const on = !disabled.includes(c.key)
              return (
                <button
                  key={c.key}
                  onClick={() =>
                    edit(
                      'tgDisabledCategories',
                      on ? [...disabled, c.key] : disabled.filter((x) => x !== c.key),
                    )
                  }
                  className={`chip whitespace-nowrap transition-colors ${
                    on ? 'bg-[#e2f2ef] text-green-d' : 'bg-chip text-muted'
                  }`}
                >
                  {on && <Check size={11} />} {c.label}
                </button>
              )
            })}
          </div>
          <p className="text-[11px] text-muted-2 mt-2">
            Выключенная категория не отправляется никому. Точечно по сотруднику — в его карточке.
          </p>
        </div>

        {/* §6: получатели уведомлений о заполненных и просроченных отчётах. */}
        <div className="mt-4">
          <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-2">
            Кто получает сводки по отчётам
          </div>
          <div className="flex flex-wrap gap-2">
            {activeEmployees
              .filter((e) => e.role === 'owner' || e.role === 'head')
              .map((e) => {
                const on = recipients.includes(e.id)
                return (
                  <button
                    key={e.id}
                    onClick={() =>
                      edit(
                        'tgReportRecipients',
                        on ? recipients.filter((x) => x !== e.id) : [...recipients, e.id],
                      )
                    }
                    className={`chip whitespace-nowrap transition-colors ${
                      on ? 'bg-[#e2f2ef] text-green-d' : 'bg-chip text-muted'
                    }`}
                  >
                    {on && <Check size={11} />} {e.name}
                  </button>
                )
              })}
          </div>
          <p className="text-[11px] text-muted-2 mt-2">
            Если никто не выбран, сводки уходят администратору.
          </p>
        </div>

        {/* §7.1: режим перевыполнения. */}
        <label className="mt-4 flex items-center gap-2 text-sm text-ink-2 cursor-pointer">
          <input
            type="checkbox"
            checked={val('tgKpiOverachieve', false)}
            onChange={(e) => edit('tgKpiOverachieve', e.target.checked)}
          />
          Присылать пороги KPI выше 100%
        </label>
      </div>

      <TelegramAudit />
    </div>
  )
}

// §10: журнал доступен администратору, с фильтром по сотруднику и событию.
function TelegramAudit() {
  const { activeEmployees } = useData()
  const [employeeId, setEmployeeId] = useState('')
  const rows = useQuery(api.telegram.auditLog, {
    ...(employeeId ? { employeeId: employeeId as Id<'employees'> } : {}),
    limit: 60,
  })

  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <ScrollText size={18} className="text-green" />
        <h3 className="sec-title flex-1">Журнал Telegram</h3>
        <select
          value={employeeId}
          onChange={(e) => setEmployeeId(e.target.value)}
          className="h-9 rounded-lg border border-line-2 px-2 text-sm bg-white"
        >
          <option value="">Все сотрудники</option>
          {activeEmployees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </div>

      {rows === undefined ? (
        <div className="py-6 grid place-items-center text-muted">
          <Loader2 className="animate-spin" size={16} />
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted">Пока пусто.</p>
      ) : (
        <div className="rounded-xl border border-line overflow-hidden overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead>
              <tr className={theadRow}>
                <th className={th}>Когда</th>
                <th className={th}>Событие</th>
                <th className={th}>Сотрудник</th>
                <th className={th}>Детали</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r._id}>
                  <td className={`${td} whitespace-nowrap`}>{reportTime(r.at)}</td>
                  <td className={td}>{r.kind}</td>
                  <td className={td}>{r.employee ?? '—'}</td>
                  <td className={td}>
                    {r.text && <div className="text-ink-2">«{r.text}»</div>}
                    {r.result && <div className="text-[11px] text-muted">{r.result}</div>}
                    {r.error && <div className="text-[11px] text-[#c53030]">{r.error}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted mt-2">
        Секреты и токены в журнал не попадают. Обычный сотрудник журнала не видит.
      </p>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-1.5">
        {label}
      </div>
      {children}
    </div>
  )
}
