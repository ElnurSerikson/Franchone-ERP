import { useState } from 'react'
import { useAction, useMutation, useQuery } from 'convex/react'
import { AlertTriangle, Check, CircleCheck, Loader2, RefreshCw, ScrollText, Send } from 'lucide-react'
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

// §4.3: пояса, в которых компания реально может работать. Список короткий
// намеренно — свободный ввод здесь только создаёт опечатки.
const TIMEZONES = [
  'Asia/Almaty',
  'Asia/Aqtobe',
  'Asia/Aqtau',
  'Asia/Tashkent',
  'Asia/Bishkek',
  'Europe/Moscow',
  'Asia/Dubai',
  'UTC',
]

// §7.2: значения по умолчанию. Администратор правит их без изменения кода.
const DEFAULT_KPI_TEXTS = [
  { threshold: 10, text: '{name}, вы уже выполнили 10% KPI. Отличное начало — продолжаем!' },
  { threshold: 20, text: '{name}, выполнено 20% KPI. Уже пятая часть пути позади — двигаемся дальше!' },
  { threshold: 30, text: '{name}, за плечами 30% KPI. Хороший темп — так держать!' },
  { threshold: 40, text: '{name}, выполнено 40% KPI. До половины совсем немного.' },
  { threshold: 50, text: 'Половина готова! Ваш KPI выполнен на 50%. Темп хороший — не сбавляем.' },
  { threshold: 60, text: '{name}, 60% KPI позади. Большая часть пути пройдена.' },
  { threshold: 70, text: '{name}, выполнено 70% KPI. Отличный результат, осталось немного.' },
  { threshold: 80, text: 'Уже 80% KPI! Финишная прямая — осталось совсем немного.' },
  { threshold: 90, text: '{name}, 90% KPI. План почти закрыт — последний рывок!' },
  { threshold: 100, text: '{name}, KPI выполнен на 100%! План закрыт — отличный результат.' },
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

        <WebhookHealth />

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
          {/* §4.3, §8.2: часовой пояс организации. В нём считаются «завтра»
              и «через два часа» из голосовых команд. */}
          <Field label="Часовой пояс организации">
            <select
              className={inputCls}
              value={val('tgTimezone', 'Asia/Almaty')}
              onChange={(e) => edit('tgTimezone', e.target.value)}
            >
              {TIMEZONES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
          {/* §8.2: правила напоминаний по задачам. У задачи срок — это дата
              без времени, поэтому задаётся час напоминания в день срока. */}
          <Field label="Напоминание о задаче в день срока">
            <input
              className={inputCls}
              type="time"
              value={val('tgTaskRemindAt', '10:00')}
              onChange={(e) => edit('tgTaskRemindAt', e.target.value || '10:00')}
            />
          </Field>
          <Field label="Хранить расшифровки, дней">
            <input
              className={inputCls}
              inputMode="numeric"
              value={String(val('tgTranscriptKeepDays', 90))}
              onChange={(e) =>
                edit('tgTranscriptKeepDays', Math.max(1, Number(e.target.value) || 90))
              }
            />
          </Field>
        </div>

        <label className="mt-3 flex items-center gap-2 text-sm text-ink-2 cursor-pointer">
          <input
            type="checkbox"
            checked={val('tgTaskEscalateAuthor', true)}
            onChange={(e) => edit('tgTaskEscalateAuthor', e.target.checked)}
          />
          Сообщать автору задачи о её просрочке
        </label>

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

      <KpiTextsEditor
        texts={val<{ threshold: number; text: string }[]>('tgKpiTexts', DEFAULT_KPI_TEXTS)}
        onChange={(next) => edit('tgKpiTexts', next)}
      />

      <TelegramAudit />
    </div>
  )
}

// §11: состояние связи с Telegram. Если webhook не зарегистрирован, бот
// молчит, и снаружи это выглядит как «ничего не происходит» — самая
// неприятная поломка модуля. Держим её на виду и даём починить кнопкой.
function WebhookHealth() {
  const check = useAction(api.telegramBot.health)
  const repair = useAction(api.telegramBot.repairWebhook)
  const [state, setState] = useState<Awaited<ReturnType<typeof check>> | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const run = async (name: string, fn: () => Promise<unknown>) => {
    setBusy(name)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError(errMessage(e, 'Не удалось выполнить проверку.'))
    } finally {
      setBusy('')
    }
  }

  const ok = state?.ok === true
  const broken = state !== null && state.ok === false

  return (
    <div
      className={`rounded-xl border p-3 mb-4 ${
        broken ? 'border-[#f0b4b4] bg-[#fdeaea]' : 'border-line bg-white'
      }`}
    >
      <div className="flex items-center gap-2 flex-wrap">
        {broken ? (
          <AlertTriangle size={15} className="text-[#c53030]" />
        ) : ok ? (
          <CircleCheck size={15} className="text-green-d" />
        ) : (
          <Send size={15} className="text-muted" />
        )}
        <span className="text-sm font-medium text-ink flex-1">Связь с Telegram</span>
        <button
          onClick={() => run('check', async () => setState(await check({})))}
          disabled={!!busy}
          className="mini-btn"
        >
          {busy === 'check' ? <Loader2 size={13} className="animate-spin" /> : null}
          Проверить
        </button>
        {broken && (
          <button
            onClick={() =>
              run('fix', async () => {
                await repair({})
                setState(await check({}))
              })
            }
            disabled={!!busy}
            className="btn btn-green h-8 px-3 text-sm disabled:opacity-60"
          >
            {busy === 'fix' ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <RefreshCw size={13} />
            )}
            Переподключить
          </button>
        )}
      </div>

      {state === null && !busy && (
        <p className="text-[11px] text-muted-2 mt-2">
          Нажмите «Проверить», чтобы убедиться, что Telegram знает, куда доставлять сообщения.
        </p>
      )}
      {ok && (
        <p className="text-[11px] text-muted mt-2">
          Бот @{state?.botUsername} на связи, адрес доставки зарегистрирован.
          {state && state.pending > 0 && ` В очереди: ${state.pending}.`}
          {state?.lastError && ` Последняя ошибка: ${state.lastError}`}
        </p>
      )}
      {broken && (
        <div className="text-[11px] text-[#7a1f1f] mt-2">
          <b>Адрес доставки не зарегистрирован — бот не получает сообщений.</b> Нажмите
          «Переподключить».
          <div className="mt-1 text-[#8a5a12]">
            Такое случается, если по токену бота вызвали getUpdates или токен перевыпустили в
            BotFather: Telegram снимает webhook сам.
          </div>
          {state?.url ? <div className="mt-1">Сейчас: {state.url}</div> : null}
          {state?.lastError ? <div className="mt-1">Ошибка: {state.lastError}</div> : null}
        </div>
      )}
      {error && <p className="text-[11px] text-[#c53030] mt-2">{error}</p>}

      <ResetLinks />
    </div>
  )
}

// Сброс всех подключений. Операция редкая и необратимая, поэтому спрятана за
// подтверждением и живёт рядом с проверкой связи — там же, где разбираются,
// почему бот молчит.
function ResetLinks() {
  const reset = useMutation(api.telegram.resetAll)
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState('')
  const [error, setError] = useState('')

  if (done) return <p className="text-[11px] text-green-d mt-2 pt-2 border-t border-line">{done}</p>

  return (
    <div className="mt-2 pt-2 border-t border-line">
      {!asking ? (
        <button onClick={() => setAsking(true)} className="text-[11px] text-muted hover:text-ink">
          Сбросить все подключения
        </button>
      ) : (
        <div className="text-[11px] text-[#7a1f1f]">
          Все сотрудники будут отключены от бота и подключатся заново — по почте и коду. История
          событий сохранится. Отменить нельзя.
          <div className="flex gap-2 mt-2">
            <button
              onClick={async () => {
                setBusy(true)
                setError('')
                try {
                  const r = await reset({})
                  setDone(
                    `Сброшено: связей ${r.links}, кодов ${r.codes}, черновиков ${r.drafts}.` +
                      (r.more ? ' Записей было много — нажмите ещё раз.' : ''),
                  )
                } catch (e) {
                  setError(errMessage(e, 'Не удалось сбросить подключения.'))
                } finally {
                  setBusy(false)
                }
              }}
              disabled={busy}
              className="btn h-7 px-3 text-[11px] bg-[#c53030] text-white disabled:opacity-60"
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : null}
              Да, сбросить
            </button>
            <button onClick={() => setAsking(false)} className="mini-btn">
              Отмена
            </button>
          </div>
          {error && <p className="text-[#c53030] mt-2">{error}</p>}
        </div>
      )}
    </div>
  )
}

// §7.2: редактор мотивационных сообщений. Тексты хранятся в настройках ERP,
// а не в коде, — менять их можно без выката.
function KpiTextsEditor({
  texts,
  onChange,
}: {
  texts: { threshold: number; text: string }[]
  onChange: (next: { threshold: number; text: string }[]) => void
}) {
  const byThreshold = new Map(texts.map((t) => [t.threshold, t.text]))
  return (
    <div className="card p-5">
      <h3 className="sec-title mb-1">Сообщения о достижении KPI</h3>
      <p className="text-xs text-muted mb-4">
        Отправляются при первом пересечении порога в периоде. <code>{'{name}'}</code> подставит
        имя сотрудника.
      </p>
      <div className="flex flex-col gap-2">
        {DEFAULT_KPI_TEXTS.map((d) => (
          <div key={d.threshold} className="flex items-center gap-3">
            <span className="w-12 shrink-0 text-sm font-semibold text-ink tabular-nums">
              {d.threshold}%
            </span>
            <input
              className="flex-1 h-9 rounded-lg border border-line-2 px-3 text-sm text-ink focus:outline-none focus:border-green-light bg-white"
              value={byThreshold.get(d.threshold) ?? d.text}
              onChange={(e) =>
                onChange(
                  DEFAULT_KPI_TEXTS.map((x) => ({
                    threshold: x.threshold,
                    text:
                      x.threshold === d.threshold
                        ? e.target.value
                        : (byThreshold.get(x.threshold) ?? x.text),
                  })),
                )
              }
            />
          </div>
        ))}
      </div>
      <p className="text-[11px] text-muted-2 mt-3">
        Изменения сохраняются кнопкой вверху блока «Telegram-модуль».
      </p>
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
