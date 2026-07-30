import { useState, type ReactNode } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import type { Doc, Id } from '../../../convex/_generated/dataModel'
import { Loader2, Save, Check, Clock, PencilLine, History, ChevronDown, Lock } from 'lucide-react'
import type { SmmRow, TargetologRow } from '@/types'
import { REPORTING_POSITIONS, REPORT_PAGES, CONTENT_TYPES } from '@/lib/constants'
import { REPORT_STATUS, reportTime, cpl } from '@/lib/reports'
import { goalMeta } from '../../../convex/campaignGoals'
import { kzt, num } from '@/lib/format'
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
  const [date, setDate] = useState<string | undefined>(undefined)
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
  // лежат под старым разделом (smm/targetolog/sales) — рисуем ту форму, где
  // данные реально есть, иначе поля были бы пустыми, хотя отчёт сдан. Пустой
  // (переоткрытый) или новый день — по текущей должности.
  const r = data.report
  const formPos: string =
    (r?.smm ? 'smm' : r?.targetolog ? 'targetolog' : r?.sales ? 'sales' : null) ?? data.position

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
          report={data.report}
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
          {formPos === 'targetolog' && <TargetologForm report={data.report} date={data.date} readOnly={!data.editable} />}
          {formPos === 'sales' && <SalesForm report={data.report} date={data.date} readOnly={!data.editable} />}
        </div>
      </div>
      <HistoryPanel history={data.history} />
    </div>
  )
}

// ——— Баннер статуса + выбор даты отчёта ———
function StatusBanner({
  report,
  today,
  date,
  earliest,
  deadline,
  editable,
  reopened,
  onDate,
}: {
  report: Report | null
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

  if (!report) {
    // Пропущенный прошлый день сотруднику уже не отредактировать: после дедлайна
    // его вносит только владелец. Сегодня до 23:50 — ещё можно сдать вовремя.
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
            {longDate(date)} · {editable ? `дедлайн ${deadline}` : 'дедлайн прошёл — заполнить может только владелец'}
          </div>
        </div>
        {picker}
      </div>
    )
  }

  const st = REPORT_STATUS[report.onTime ? 'onTime' : 'late']
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
          {longDate(date)} · {reportTime(report.submittedAt)}
        </div>
      </div>
      {report.editCount > 0 && report.editedAt && (
        <span className="chip bg-chip text-muted-2 shrink-0">
          <PencilLine size={12} /> изм. {report.editCount}×
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
  onSave,
  children,
}: {
  title: string
  hint?: string
  edited: boolean
  saving: boolean
  saved: boolean
  readOnly?: boolean
  onSave: () => void
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
          <button onClick={onSave} disabled={saving} className="btn btn-green disabled:opacity-60 shrink-0">
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            {edited ? 'Сохранить' : 'Отправить'}
          </button>
        )}
      </div>
      {children}
      {readOnly && (
        <div className="text-[11px] text-muted-2 mt-3">
          Дедлайн этого дня прошёл — правки вносит только владелец.
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
function TargetologForm({ report, date, readOnly }: { report: Report | null; date: string; readOnly: boolean }) {
  const submit = useMutation(api.reports.submit)
  const campaigns = useQuery(api.campaigns.registry, { activeOnly: true })
  // Строки, а не числа: иначе поле нельзя очистить, см. NumInput.
  const [vals, setVals] = useState<Record<string, { budget: string; leads: string }>>(() => {
    const from: Record<string, { budget: string; leads: string }> = {}
    for (const r of report?.targetolog ?? [])
      from[r.code] = { budget: String(r.budget), leads: String(r.leads) }
    return from
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const list = campaigns ?? []
  const get = (code: string) => vals[code] ?? { budget: '', leads: '' }
  const setVal = (code: string, patch: Partial<{ budget: string; leads: string }>) =>
    setVals((v) => ({ ...v, [code]: { ...get(code), ...patch } }))
  const numOf = (code: string) => ({
    budget: Number(get(code).budget) || 0,
    leads: Number(get(code).leads) || 0,
  })

  const sumB = list.reduce((s, c) => s + numOf(c.code).budget, 0)
  const sumL = list.reduce((s, c) => s + numOf(c.code).leads, 0)

  const save = async () => {
    if (readOnly) return
    setSaving(true)
    try {
      const rows: TargetologRow[] = list.map((c) => ({ code: c.code, ...numOf(c.code) }))
      await submit({ date, targetolog: rows })
      setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  if (campaigns !== undefined && list.length === 0) {
    return (
      <div className="card p-10 text-center">
        <div className="sec-title mb-1.5">В реестре нет активных кампаний</div>
        <p className="text-sm text-muted max-w-md mx-auto">
          Отчёт заполняется по кампаниям из реестра. Заведите кампанию — она сразу появится
          здесь строкой.
        </p>
      </div>
    )
  }

  return (
    <FormShell
      title="Отчёт таргетолога"
      hint="Бюджет и результат по метрике каждой кампании за сегодня. Метрика зависит от цели кампании; цена считается сама; кампания не крутилась — оставьте 0"
      edited={!!report}
      saving={saving}
      saved={saved}
      readOnly={readOnly}
      onSave={save}
    >
      <div className="overflow-x-auto">
        <div className="min-w-[560px]">
          <div className="grid grid-cols-[92px_1fr_104px_74px_96px] gap-2 px-1 mb-1.5">
            <Lbl>ID</Lbl>
            <Lbl>Кампания · метрика</Lbl>
            <Lbl right>Бюджет ₸</Lbl>
            <Lbl right>Результат</Lbl>
            <Lbl right>Цена</Lbl>
          </div>
          <div className="flex flex-col gap-2">
            {list.map((c) => {
              const val = get(c.code)
              const n = numOf(c.code)
              const gm = goalMeta(c.goal)
              return (
                <div key={c.code} className="grid grid-cols-[92px_1fr_104px_74px_96px] gap-2 items-center">
                  <span className="chip bg-[#e2f2ef] text-green-d justify-center">{c.code}</span>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-ink truncate">{c.campaign}</div>
                    <div className="text-[11px] text-muted truncate">
                      <span className="text-green-d font-medium">{gm.metric}</span> · {c.brand}
                    </div>
                  </div>
                  <NumInput value={val.budget} onChange={(v) => setVal(c.code, { budget: v })} disabled={readOnly} />
                  <NumInput value={val.leads} onChange={(v) => setVal(c.code, { leads: v })} disabled={readOnly} />
                  <div className="h-[38px] flex items-center justify-end px-2 text-sm font-semibold text-ink-2 rounded-lg bg-chip">
                    {n.leads > 0 ? kzt(cpl(n.budget, n.leads)) : '—'}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3 mt-4 pt-3 border-t border-line">
        <Summary label="Бюджет" value={kzt(sumB)} />
        <Summary label="Результат" value={num(sumL)} />
        <Summary label="Средняя цена" value={sumL > 0 ? kzt(sumB / sumL) : '—'} accent />
      </div>
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

type SalesAssignedObject = Doc<'salesObjects'> & { planDeals: number }
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
    processedLeads: daily ? String(daily.processedLeads) : '',
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
        processedLeads: toInt(f.processedLeads),
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
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px] mb-4">
        <div>
          <Lbl>Объект продаж</Lbl>
          <Select
            value={selected}
            onChange={onSelect}
            options={objects.map((o) => ({ value: o._id, label: o.name }))}
            className="mt-1.5"
          />
        </div>
        <div className="h-[38px] self-end rounded-lg bg-chip px-3 flex items-center justify-between gap-3">
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
            <NumField label="Обработано новых заявок" value={f.processedLeads} onChange={(v) => setNum('processedLeads', v)} disabled={readOnly} />
            <NumField label="Новые консультации" value={f.newConsultations} onChange={(v) => setNum('newConsultations', v)} disabled={readOnly} />
            <NumField label="Новые встречи / Zoom" value={f.newMeetings} onChange={(v) => setNum('newMeetings', v)} disabled={readOnly} />
            <NumField label="Новые предоплаты" value={f.newPrepayments} onChange={(v) => setNum('newPrepayments', v)} disabled={readOnly} />
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
function HistoryPanel({ history }: { history: Report[] }) {
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
            return (
              <div
                key={h._id}
                className="flex items-center justify-between gap-2 py-2.5 border-b border-line last:border-0"
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
              </div>
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

function Summary({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div className="text-[11px] text-muted uppercase tracking-wide mb-0.5">{label}</div>
      <div className={`text-base font-bold ${accent ? 'text-green-d' : 'text-ink'}`}>{value}</div>
    </div>
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
