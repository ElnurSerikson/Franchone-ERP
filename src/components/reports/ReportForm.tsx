import { useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import TargetLeadsForm from '@/components/campaigns/TargetLeadsForm'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import type { Doc, Id } from '../../../convex/_generated/dataModel'
import { Loader2, Save, Check, Clock, PencilLine, History, ChevronDown, Lock } from 'lucide-react'
import type { SmmRow } from '@/types'
import type { Submission } from '../../../convex/reports'
import { REPORTING_POSITIONS, REPORT_PAGES, CONTENT_TYPES } from '@/lib/constants'
import { REPORT_STATUS, reportTime } from '@/lib/reports'
import { goalMeta, dollarsToCents, resultCostCents } from '../../../convex/campaignGoals'
import { num, usd, usdCost } from '@/lib/format'
import { errMessage } from '@/lib/errors'
import { useMediaQuery } from '@/lib/useMediaQuery'
import DatePicker from '../ui/DatePicker'
import Select from '../ui/Select'

type Report = Doc<'dailyReports'>

const numCls =
  'w-full h-[38px] rounded-lg border border-line-2 px-2.5 text-sm text-ink text-right focus:outline-none focus:border-green-light bg-white'
const txtCls =
  'w-full h-[38px] rounded-lg border border-line-2 px-2.5 text-sm text-ink focus:outline-none focus:border-green-light bg-white'

// Числовое поле отчёта. Значение — строка, поэтому поле можно очистить
// полностью: у number-инпута со значением 0 бэкспейс возвращает ноль, и
// следующая цифра дописывается к нему («01», «10»). Клик выделяет содержимое,
// чтобы ввод сразу заменял старое число. Стрелки-счётчики скрыты в index.css.
function NumInput({
  value,
  onChange,
  className = numCls,
  placeholder = '0',
  disabled = false,
}: {
  value: string
  onChange: (v: string) => void
  className?: string
  placeholder?: string
  disabled?: boolean
}) {
  return (
    <input
      type="number"
      min={0}
      inputMode="numeric"
      placeholder={placeholder}
      value={value}
      disabled={disabled}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => onChange(e.target.value)}
      className={`${className} disabled:bg-chip disabled:text-muted disabled:cursor-not-allowed`}
    />
  )
}

function longDate(date: string): string {
  return new Date(`${date}T12:00:00+05:00`).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    weekday: 'long',
    timeZone: 'Asia/Almaty',
  })
}

export default function ReportForm() {
  // Дата отчёта: по умолчанию сегодня, но пропущенный день можно дозаполнить.
  // ?date= приходит из графика сдачи на дашборде (§2.5).
  const [params] = useSearchParams()
  const [date, setDate] = useState<string | undefined>(() => params.get('date') ?? undefined)
  const data = useQuery(api.reports.mine, date ? { date } : {})

  if (data === undefined)
    return (
      <div className="card p-10 grid place-items-center text-muted">
        <Loader2 className="animate-spin" size={20} />
      </div>
    )
  if (data === null) return null

  const reporting = (REPORTING_POSITIONS as readonly string[]).includes(data.position)

  // Форму показываем по фактическому содержимому отчёта, а не по текущей
  // должности сотрудника. Если человек сменил должность, его прошлые цифры
  // лежат под старым разделом (smm/sales) — рисуем ту форму, где данные
  // реально есть, иначе поля были бы пустыми, хотя отчёт сдан. Пустой
  // (переоткрытый) или новый день — по текущей должности.
  //
  // Таргетолог — исключение: его отчёты переехали в отдельные таблицы модуля
  // (targetReports), про которые легаси-строка dailyReports ничего не знает.
  // Не сделай мы этой оговорки — у бывшего продажника или SMM при переключении
  // даты открывалась бы чужая форма вместо его собственной.
  const r = data.report
  const formPos: string =
    data.position === 'targetolog'
      ? 'targetolog'
      : ((r?.smm ? 'smm' : r?.targetolog ? 'targetolog' : r?.sales ? 'sales' : null) ??
        data.position)

  if (!reporting)
    return (
      <div className="card p-10 text-center">
        <div className="text-ink font-semibold mb-1">Ежедневный отчёт не предусмотрен</div>
        <p className="text-sm text-muted max-w-md mx-auto">
          Для вашей должности форма ежедневной отчётности не настроена. Раздел «Дисциплина»
          доступен руководителям для контроля отчётности команды.
        </p>
      </div>
    )

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_300px] items-start">
      <div className="flex flex-col gap-5 min-w-0">
        <StatusBanner
          submission={data.submission}
          today={data.today}
          date={data.date}
          earliest={data.earliestDate}
          deadline={data.deadlineTime}
          editable={data.editable}
          reopened={data.reopened}
          onDate={(d) => setDate(d === data.today ? undefined : d)}
        />
        {/* key по дате: форму пересоздаём при переключении дня, иначе в полях
            останутся значения предыдущей даты — начальное состояние берётся
            из report один раз при монтировании. */}
        <div className="card p-5" key={`${data.date}:${formPos}`}>
          {formPos === 'smm' && <SmmForm report={data.report} date={data.date} readOnly={!data.editable} />}
          {formPos === 'targetolog' && <TargetologForm date={data.date} />}
          {formPos === 'sales' && <SalesForm report={data.report} date={data.date} readOnly={!data.editable} />}
        </div>
        {/* ТАРГЕТ 1.6 §6: второй обязательный ежедневный отчёт таргетолога —
            количество новых заявок по каждому объекту продаж. Отдельный блок,
            потому что это другой слой данных: рекламные кампании оцениваются
            своими техническими результатами, а заявки — общим числом по
            объекту, без привязки к кампаниям. */}
        {formPos === 'targetolog' && (
          <TargetLeadsForm key={`leads:${data.date}`} date={data.date} />
        )}
      </div>
      {/* §2.4: карточка истории открывает отчёт за свою дату. */}
      <HistoryPanel
        history={data.history}
        activeDate={data.date}
        onOpen={(d) => setDate(d === data.today ? undefined : d)}
      />
    </div>
  )
}

// ——— Баннер статуса + выбор даты отчёта ———
function StatusBanner({
  submission,
  today,
  date,
  earliest,
  deadline,
  editable,
  reopened,
  onDate,
}: {
  // Факт сдачи, а не документ отчёта: у таргетолога отчёт лежит в своих
  // таблицах, и общий для всех должностей признак — только он.
  submission: Submission | null
  today: string
  date: string
  earliest: string
  deadline: string
  editable: boolean
  reopened: boolean
  onDate: (d: string) => void
}) {
  const past = date < today
  const picker = (
    <div className="flex items-center gap-2 shrink-0">
      <div className="w-[172px]">
        <DatePicker value={date} onChange={onDate} min={earliest} max={today} />
      </div>
      {past && (
        <button onClick={() => onDate(today)} className="mini-btn whitespace-nowrap">
          Сегодня
        </button>
      )}
    </div>
  )

  // Владелец удалил отчёт и переоткрыл день — форма снова открыта, но сдача
  // пойдёт «с опозданием».
  if (reopened) {
    return (
      <div className="card p-4 flex items-center gap-3 flex-wrap border-l-4" style={{ borderLeftColor: '#d69e2e' }}>
        <span className="w-9 h-9 rounded-full grid place-items-center shrink-0" style={{ background: '#fff6e6', color: '#d69e2e' }}>
          <Clock size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-ink">Отчёт удалён владельцем — заполните заново</div>
          <div className="text-sm text-muted">{longDate(date)} · будет отмечен как сданный с опозданием</div>
        </div>
        {picker}
      </div>
    )
  }

  if (!submission) {
    // Пропущенный день сотруднику уже не отредактировать: после дедлайна его
    // вносит только администратор. Сегодняшний и вчерашний (до 14:00) — ещё
    // можно сдать вовремя.
    const color = editable ? '#d69e2e' : '#c53030'
    return (
      <div className="card p-4 flex items-center gap-3 flex-wrap border-l-4" style={{ borderLeftColor: color }}>
        <span
          className="w-9 h-9 rounded-full grid place-items-center shrink-0"
          style={{ background: editable ? '#fff6e6' : '#fdeaea', color }}
        >
          <Clock size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-ink">
            {editable ? 'Отчёт за сегодня ещё не заполнен' : 'Отчёт за этот день пропущен'}
          </div>
          <div className="text-sm text-muted">
            {longDate(date)} ·{' '}
            {editable
              ? `до ${deadline} следующего дня`
              : 'дедлайн прошёл — заполнить может только администратор'}
          </div>
        </div>
        {picker}
      </div>
    )
  }

  const st = REPORT_STATUS[submission.onTime ? 'onTime' : 'late']
  return (
    <div className="card p-4 flex items-center gap-3 flex-wrap border-l-4" style={{ borderLeftColor: st.dot }}>
      <span
        className="w-9 h-9 rounded-full grid place-items-center shrink-0"
        style={{ background: st.cell, color: st.dot }}
      >
        <Check size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-ink">
          Отчёт отправлен · <span style={{ color: st.dot }}>{st.label.toLowerCase()}</span>
        </div>
        <div className="text-sm text-muted">
          {longDate(date)} · {reportTime(submission.submittedAt)}
        </div>
      </div>
      {submission.editCount > 0 && submission.editedAt && (
        <span className="chip bg-chip text-muted-2 shrink-0">
          <PencilLine size={12} /> изм. {submission.editCount}×
        </span>
      )}
      {picker}
    </div>
  )
}

// ——— Обёртка формы: заголовок + кнопка сохранения ———
function FormShell({
  title,
  hint,
  edited,
  saving,
  saved,
  readOnly = false,
  readOnlyHint,
  onSave,
  extraAction,
  children,
}: {
  title: string
  hint?: string
  edited: boolean
  saving: boolean
  saved: boolean
  readOnly?: boolean
  // Почему форма закрыта. По умолчанию — прошедший дедлайн. null означает, что
  // причину объясняет сама форма: у таргетолога это «отчёт отправлен», и
  // говорить про дедлайн было бы прямой неправдой — он ещё не наступил.
  readOnlyHint?: string | null
  onSave: () => void
  // Дополнительная кнопка справа от «Сохранить» — нужна отчёту таргетолога,
  // где черновик и отправка это разные действия.
  extraAction?: ReactNode
  children: ReactNode
}) {
  return (
    <>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="sec-title">{title}</h3>
          {hint && <p className="text-[11px] text-muted-2 mt-0.5">{hint}</p>}
        </div>
        {readOnly ? (
          <span className="chip bg-chip text-muted-2 shrink-0">
            <Lock size={12} /> Только просмотр
          </span>
        ) : (
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={onSave}
              disabled={saving}
              className={`btn disabled:opacity-60 ${extraAction ? 'btn-ghost' : 'btn-green'}`}
            >
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              {extraAction ? 'Сохранить черновик' : edited ? 'Сохранить' : 'Отправить'}
            </button>
            {extraAction}
          </div>
        )}
      </div>
      {children}
      {readOnly && readOnlyHint !== null && (
        <div className="text-[11px] text-muted-2 mt-3">
          {readOnlyHint ?? 'Дедлайн этого дня прошёл — правки вносит только владелец.'}
        </div>
      )}
      {saved && !readOnly && (
        <div className="text-xs text-green-d mt-3 flex items-center gap-1">
          <Check size={13} /> Сохранено
        </div>
      )}
    </>
  )
}

// ——— §3.1 SMM ———
// Шесть фиксированных полей «аккаунт × формат» — ровно колонки листа
// «Отчет SMM» в KPI_SMM.xlsx. Строки не добавляются: набор форматов задан
// моделью KPI, у произвольной пары не было бы ни веса, ни плана, и её факт
// не дошёл бы до KPI. Не публиковали — оставляем 0, как в файле.
const SMM_CELLS = REPORT_PAGES.flatMap((page) => CONTENT_TYPES.map((type) => ({ page, type })))
const cellKey = (page: string, type: string) => `${page}|${type}`

function SmmForm({ report, date, readOnly }: { report: Report | null; date: string; readOnly: boolean }) {
  const submit = useMutation(api.reports.submit)
  // Значения держим строками: number-поле со значением 0 нельзя очистить —
  // бэкспейс возвращает 0, и следующая цифра дописывается к нему («01», «10»).
  const [counts, setCounts] = useState<Record<string, string>>(() => {
    const from: Record<string, string> = {}
    for (const r of report?.smm ?? []) from[cellKey(r.page, r.type)] = String(r.count)
    return from
  })
  const [note, setNote] = useState(report?.note ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const get = (page: string, type: string) => counts[cellKey(page, type)] ?? ''
  const setCount = (page: string, type: string, v: string) =>
    setCounts((c) => ({ ...c, [cellKey(page, type)]: v }))
  const numOf = (page: string, type: string) => Number(get(page, type)) || 0

  const total = SMM_CELLS.reduce((s, c) => s + numOf(c.page, c.type), 0)

  const save = async () => {
    if (readOnly) return
    setSaving(true)
    try {
      const rows: SmmRow[] = SMM_CELLS.map((c) => ({
        page: c.page,
        type: c.type,
        count: numOf(c.page, c.type),
      }))
      await submit({ date, smm: rows, note: note.trim() || undefined })
      setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormShell
      title="Отчёт SMM-специалиста"
      hint="Опубликованный контент за сегодня. Не публиковали — оставьте 0"
      edited={!!report}
      saving={saving}
      saved={saved}
      readOnly={readOnly}
      onSave={save}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {REPORT_PAGES.map((page) => (
          <div key={page} className="rounded-2xl border border-line p-4">
            <div className="text-[11px] font-semibold text-green-d uppercase tracking-wide mb-3">
              {page}
            </div>
            <div className="flex flex-col gap-2.5">
              {CONTENT_TYPES.map((type) => (
                <div key={type} className="flex items-center justify-between gap-3">
                  <span className="text-sm text-ink-2">{type}</span>
                  <NumInput
                    className={`${numCls} w-24`}
                    value={get(page, type)}
                    onChange={(v) => setCount(page, type, v)}
                    disabled={readOnly}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4">
        <Lbl>Комментарий / ссылка</Lbl>
        <input
          className={`${txtCls} mt-1.5 disabled:bg-chip disabled:text-muted`}
          placeholder="Ссылка на опубликованное или короткое пояснение"
          value={note}
          disabled={readOnly}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      <div className="flex items-center justify-between mt-4 pt-3 border-t border-line text-sm">
        <span className="text-muted">Итого публикаций</span>
        <span className="text-lg font-bold text-green-d">{total}</span>
      </div>
    </FormShell>
  )
}

// ——— §3.2 Таргетолог ———
// Строки не набираются руками: это все активные кампании из реестра, как в
// KPI_TARGETOLOG.xlsx, где кампания выбирается по ID, а не пишется текстом.
// Свободный текст невозможно сматчить с планом, и факт не дошёл бы до KPI.
// ——— Таргетолог: ежедневный отчёт по новому ТЗ (§9) ———
// Таргетолог вводит только бюджет и результат — цена всегда производная.
// Внизу суммируется ТОЛЬКО бюджет: результаты разных целей (сообщения, лиды,
// охваты, переходы) — разные единицы, складывать их нельзя (§8, §9.1).
function TargetologForm({ date }: { date: string }) {
  const data = useQuery(api.target.day, { date })
  const save = useMutation(api.target.save)
  const [vals, setVals] = useState<Record<string, { budget: string; result: string }>>({})
  const [comment, setComment] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  if (data === undefined) {
    return (
      <div className="py-8 grid place-items-center text-muted">
        <Loader2 className="animate-spin" size={18} />
      </div>
    )
  }

  if (data.rows.length === 0) {
    return (
      <div className="card p-10 text-center">
        <div className="sec-title mb-1.5">Нет кампаний за эту дату</div>
        <p className="text-sm text-muted max-w-md mx-auto">
          В форме показываются кампании, которые были активны в выбранный день. Заведите
          кампанию в реестре — она появится здесь строкой.
        </p>
      </div>
    )
  }

  const readOnly = !data.editable
  // Значения держим строками: у числового поля со значением 0 бэкспейс
  // возвращает ноль и следующая цифра дописывается к нему.
  const get = (id: string, row: { budgetCents: number; result: number; filled: boolean }) =>
    vals[id] ?? {
      budget: row.filled ? (row.budgetCents / 100).toFixed(2) : '',
      result: row.filled ? String(row.result) : '',
    }
  const setVal = (id: string, patch: Partial<{ budget: string; result: string }>) =>
    setVals((v) => ({ ...v, [id]: { ...(v[id] ?? { budget: '', result: '' }), ...patch } }))

  const parsed = data.rows.map((r) => {
    const raw = get(r.campaignId as string, r)
    return {
      row: r,
      raw,
      budgetCents: dollarsToCents(Number(raw.budget) || 0),
      result: Math.max(0, Math.floor(Number(raw.result) || 0)),
    }
  })
  const totalBudgetCents = parsed.reduce((s, p) => s + p.budgetCents, 0)
  const currentComment = comment ?? data.comment

  const send = async (submit: boolean) => {
    if (readOnly) return
    setBusy(true)
    setError('')
    try {
      await save({
        date,
        comment: currentComment || undefined,
        submit,
        rows: parsed.map((p) => ({
          campaignId: p.row.campaignId,
          budgetCents: p.budgetCents,
          result: p.result,
        })),
      })
      setSaved(true)
    } catch (e) {
      setError(errMessage(e, 'Не удалось сохранить отчёт.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormShell
      title="Отчёт таргетолога"
      hint="Бюджет в долларах и результат по цели каждой кампании. Цена считается сама; кампания не крутилась — оставьте 0"
      edited={data.submittedAt !== null}
      saving={busy}
      saved={saved}
      readOnly={readOnly}
      readOnlyHint={data.submittedAt !== null ? null : undefined}
      onSave={() => send(false)}
      extraAction={
        readOnly ? null : (
          <button onClick={() => send(true)} disabled={busy} className="btn btn-green h-9 px-4 text-sm disabled:opacity-60">
            Отправить отчёт
          </button>
        )
      }
    >
      {data.submittedAt !== null && (
        <div className="rounded-xl bg-[#e2f2ef] px-4 py-3 mb-4 text-sm text-green-d">
          Отчёт отправлен — изменить его может только администратор, с указанием причины.
        </div>
      )}

      <div className="overflow-x-auto">
        <div className="min-w-[600px]">
          {/* §2.7: колонка ID убрана — строку опознают по названию кампании. */}
          <div className="grid grid-cols-[1fr_96px_84px_136px] gap-2 px-1 mb-1.5">
            <Lbl>Кампания · объект · цель</Lbl>
            <Lbl right>Бюджет, $</Lbl>
            <Lbl right>Результат</Lbl>
            <Lbl right>Цена</Lbl>
          </div>
          <div className="flex flex-col gap-2">
            {parsed.map(({ row, raw, budgetCents, result }) => {
              const gm = goalMeta(row.goal ?? undefined)
              const id = row.campaignId as string
              return (
                <div key={id} className="grid grid-cols-[1fr_96px_84px_136px] gap-2 items-center">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-ink truncate">{row.name}</div>
                    <div className="text-[11px] text-muted truncate">
                      {row.objectName ? `${row.objectName} · ` : ''}
                      <span className="text-green-d font-medium">{gm.metric}</span> · {row.account} ·{' '}
                      {row.moneySource}
                    </div>
                  </div>
                  <NumInput
                    value={raw.budget}
                    onChange={(v) => setVal(id, { budget: v })}
                    disabled={readOnly}
                  />
                  <NumInput
                    value={raw.result}
                    onChange={(v) => setVal(id, { result: v })}
                    disabled={readOnly}
                  />
                  <div className="h-[38px] flex items-center justify-end px-2.5 text-sm font-semibold text-ink-2 rounded-lg bg-chip whitespace-nowrap">
                    {usdCost(resultCostCents(budgetCents, result, row.goal ?? undefined))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* §9.1: общий результат и средняя цена по всем строкам не выводятся. */}
      <div className="mt-4 pt-3 border-t border-line flex items-center justify-between gap-3 flex-wrap">
        <span className="text-sm text-muted">Общий бюджет за день</span>
        <span className="text-lg font-bold text-ink tabular-nums">{usd(totalBudgetCents)}</span>
      </div>

      <div className="mt-3">
        <Lbl>Комментарий</Lbl>
        <textarea
          rows={2}
          className={`${txtCls} h-auto py-2 resize-y mt-1 disabled:bg-chip disabled:text-muted`}
          placeholder="Необязательно"
          value={currentComment}
          disabled={readOnly}
          onChange={(e) => setComment(e.target.value)}
        />
      </div>
      {error && <div className="text-sm text-[#c53030] mt-3">{error}</div>}
    </FormShell>
  )
}

// ——— §3.3 Отдел продаж: объектный отчёт по новому ТЗ ———
function SalesForm({ report, date, readOnly }: { report: Report | null; date: string; readOnly: boolean }) {
  const objects = useQuery(api.sales.assignedObjects, { date })
  const [objectId, setObjectId] = useState('')
  const selected = objectId || objects?.[0]?._id || ''
  const daily = useQuery(
    api.sales.daily,
    selected ? { date, objectId: selected as Id<'salesObjects'> } : 'skip',
  )

  if (objects === undefined) {
    return (
      <div className="py-8 grid place-items-center text-muted">
        <Loader2 className="animate-spin" size={18} />
      </div>
    )
  }

  if (objects.length === 0) {
    return (
      <div className="rounded-2xl border border-line p-6 text-center">
        <div className="sec-title mb-1">Нет активных объектов продаж</div>
        <p className="text-sm text-muted max-w-md mx-auto">
          Для выбранного месяца вам не назначены объекты продаж. Объект появится здесь после
          настройки месяца владельцем.
        </p>
      </div>
    )
  }

  if (daily === undefined) {
    return (
      <div className="py-8 grid place-items-center text-muted">
        <Loader2 className="animate-spin" size={18} />
      </div>
    )
  }

  const object = objects.find((o) => o._id === selected) ?? objects[0]

  return (
    <SalesObjectEditor
      key={`${date}:${object._id}:${daily?._id ?? 'new'}`}
      report={report}
      daily={daily}
      date={date}
      object={object}
      objects={objects}
      selected={object._id}
      onSelect={setObjectId}
      readOnly={readOnly}
    />
  )
}

type SalesAssignedObject = Doc<'salesObjects'> & { planDeals: number; submitted: boolean }
type SalesDaily = Doc<'salesObjectReports'> | null

function SalesObjectEditor({
  report,
  daily,
  date,
  object,
  objects,
  selected,
  onSelect,
  readOnly,
}: {
  report: Report | null
  daily: SalesDaily
  date: string
  object: SalesAssignedObject
  objects: SalesAssignedObject[]
  selected: string
  onSelect: (id: string) => void
  readOnly: boolean
}) {
  const submit = useMutation(api.sales.submitDaily)
  const [f, setF] = useState({
    newLeads: daily ? String(daily.newLeads) : '',
    newConsultations: daily ? String(daily.newConsultations) : '',
    repeatConsultations: daily ? String(daily.repeatConsultations) : '',
    newMeetings: daily ? String(daily.newMeetings) : '',
    repeatMeetings: daily ? String(daily.repeatMeetings) : '',
    newPrepayments: daily ? String(daily.newPrepayments) : '',
    newDeals: daily ? String(daily.newDeals) : '',
    revenue: daily ? String(daily.revenue) : '',
    comment: daily?.comment ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  // Только что сохранённый объект считаем сданным, не дожидаясь ответа сервера:
  // иначе галочка появлялась бы с задержкой на круг перезапроса.
  const doneCount = objects.filter((o) => o.submitted || (saved && o._id === object._id)).length

  const setNum = (k: Exclude<keyof typeof f, 'comment'>, v: string) =>
    setF((p) => ({ ...p, [k]: v }))
  const toInt = (v: string) => Math.max(0, Math.floor(Number(v) || 0))

  const save = async () => {
    if (readOnly) return
    if (f.newLeads.trim() === '') {
      setError('Поле «Новые заявки» обязательно для заполнения.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await submit({
        date,
        objectId: object._id as Id<'salesObjects'>,
        newLeads: toInt(f.newLeads),
        newConsultations: toInt(f.newConsultations),
        repeatConsultations: toInt(f.repeatConsultations),
        newMeetings: toInt(f.newMeetings),
        repeatMeetings: toInt(f.repeatMeetings),
        newPrepayments: toInt(f.newPrepayments),
        newDeals: toInt(f.newDeals),
        revenue: Number(f.revenue) || 0,
        comment: f.comment.trim() || undefined,
      })
      setSaved(true)
    } catch (e) {
      setError(errMessage(e, 'Не удалось сохранить отчёт.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormShell
      title="Отчёт отдела продаж"
      hint="Заполняется отдельно по каждому объекту продаж за выбранную дату"
      edited={!!daily || !!report}
      saving={saving}
      saved={saved}
      readOnly={readOnly}
      onSave={save}
    >
      {/* Сдача видна сразу: галочка и светло-зелёный фон у заполненных объектов
          плюс общий счётчик (дополнение 1.4, п.8). */}
      <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
        <Lbl>Объект продаж</Lbl>
        <span
          className={`chip ${
            doneCount === objects.length ? 'bg-[#e2f2ef] text-green-d' : 'bg-chip text-ink-2'
          }`}
        >
          Сдано отчётов: {doneCount} из {objects.length}
        </span>
      </div>
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px] mb-4">
        <Select
          value={selected}
          onChange={onSelect}
          options={objects.map((o) => ({ value: o._id, label: o.name, done: o.submitted }))}
        />
        <div className="h-[38px] rounded-lg bg-chip px-3 flex items-center justify-between gap-3">
          <div className="text-[11px] text-muted uppercase tracking-wide">План сделок</div>
          <div className="text-base font-bold text-green-d tabular-nums">{num(object.planDeals)}</div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-line p-4">
          <div className="text-[11px] font-semibold text-green-d uppercase tracking-wide mb-3">
            Уникальные этапы
          </div>
          <div className="grid grid-cols-2 gap-3">
            <NumField label="Новые заявки *" value={f.newLeads} onChange={(v) => setNum('newLeads', v)} disabled={readOnly} />
            <NumField label="Новые консультации" value={f.newConsultations} onChange={(v) => setNum('newConsultations', v)} disabled={readOnly} />
            <NumField label="Новые встречи / Zoom" value={f.newMeetings} onChange={(v) => setNum('newMeetings', v)} disabled={readOnly} />
            <NumField label="Новые подписанные договоры" value={f.newPrepayments} onChange={(v) => setNum('newPrepayments', v)} disabled={readOnly} />
            <NumField label="Новые сделки" value={f.newDeals} onChange={(v) => setNum('newDeals', v)} disabled={readOnly} />
          </div>
        </div>

        <div className="rounded-2xl border border-line p-4">
          <div className="text-[11px] font-semibold text-green-d uppercase tracking-wide mb-3">
            Повторная активность и деньги
          </div>
          <div className="grid grid-cols-2 gap-3">
            <NumField label="Повторные консультации" value={f.repeatConsultations} onChange={(v) => setNum('repeatConsultations', v)} disabled={readOnly} />
            <NumField label="Повторные встречи / Zoom" value={f.repeatMeetings} onChange={(v) => setNum('repeatMeetings', v)} disabled={readOnly} />
            <div className="col-span-2">
              <NumField label="Фактически полученная сумма, ₸" value={f.revenue} onChange={(v) => setNum('revenue', v)} disabled={readOnly} />
            </div>
          </div>
        </div>
      </div>

      <div className="mt-3">
        <Lbl>Комментарий</Lbl>
        <textarea
          rows={2}
          className={`${txtCls} h-auto py-2 resize-y mt-1 disabled:bg-chip disabled:text-muted`}
          placeholder="Необязательно"
          value={f.comment ?? ''}
          disabled={readOnly}
          onChange={(e) => setF((p) => ({ ...p, comment: e.target.value }))}
        />
      </div>
      {error && <div className="text-sm text-[#c53030] mt-3">{error}</div>}
    </FormShell>
  )
}

// ——— История (правая колонка; на телефоне/планшете — сворачивается) ———
function HistoryPanel({
  history,
  activeDate,
  onOpen,
}: {
  history: Submission[]
  activeDate: string
  onOpen: (date: string) => void
}) {
  const collapsible = useMediaQuery('(max-width: 1023px)') // < lg: колонка стекается вниз
  const [open, setOpen] = useState(false)
  const show = !collapsible || open
  return (
    <div className="card p-5">
      <button
        type="button"
        onClick={() => collapsible && setOpen((o) => !o)}
        className={`flex items-center gap-2 w-full mb-3 ${collapsible ? '' : 'cursor-default'}`}
      >
        <History size={16} className="text-green" />
        <h3 className="sec-title flex-1 text-left">История отчётов</h3>
        {collapsible && (
          <ChevronDown
            size={16}
            className={`text-muted transition-transform ${open ? 'rotate-180' : ''}`}
          />
        )}
      </button>
      {show &&
        (history.length === 0 ? (
          <p className="text-sm text-muted-2">Пока нет отправленных отчётов.</p>
        ) : (
          <div className="flex flex-col">
          {history.map((h) => {
            const st = REPORT_STATUS[h.onTime ? 'onTime' : 'late']
            const active = h.date === activeDate
            return (
              <button
                type="button"
                key={h.date}
                onClick={() => onOpen(h.date)}
                title="Открыть отчёт за этот день"
                className={`flex items-center justify-between gap-2 py-2.5 px-2 -mx-2 rounded-lg text-left border-b border-line last:border-0 transition-colors ${
                  active ? 'bg-[#e2f2ef]' : 'hover:bg-chip'
                }`}
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink capitalize">
                    {new Date(`${h.date}T12:00:00+05:00`).toLocaleDateString('ru-RU', {
                      day: 'numeric',
                      month: 'long',
                      timeZone: 'Asia/Almaty',
                    })}
                  </div>
                  <div className="text-[11px] text-muted">
                    {reportTime(h.submittedAt)}
                    {h.editCount > 0 ? ` · изм. ${h.editCount}×` : ''}
                  </div>
                </div>
                <span className={`chip shrink-0 ${st.chip}`}>{st.label}</span>
              </button>
            )
          })}
          </div>
        ))}
    </div>
  )
}

// ——— мелкие переиспользуемые кусочки ———
function Lbl({ children, right }: { children: ReactNode; right?: boolean }) {
  return (
    <span
      className={`text-[11px] font-semibold text-muted uppercase tracking-wide ${right ? 'text-right' : ''}`}
    >
      {children}
    </span>
  )
}

function NumField({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  disabled?: boolean
}) {
  return (
    <div>
      <Lbl>{label}</Lbl>
      <div className="mt-1">
        <NumInput value={value} onChange={onChange} className={`${numCls} text-left`} disabled={disabled} />
      </div>
    </div>
  )
}
