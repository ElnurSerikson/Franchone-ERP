import { useState, type ReactNode } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import type { Doc } from '../../../convex/_generated/dataModel'
import { Loader2, Save, Check, Clock, PencilLine, History, ChevronDown } from 'lucide-react'
import type { SmmRow, TargetologRow, SalesPayload } from '@/types'
import { REPORTING_POSITIONS, REPORT_PAGES, CONTENT_TYPES } from '@/lib/constants'
import { REPORT_STATUS, reportTime, cpl } from '@/lib/reports'
import { kzt, num } from '@/lib/format'
import { useMediaQuery } from '@/lib/useMediaQuery'
import DatePicker from '../ui/DatePicker'

type Report = Doc<'dailyReports'>

const numCls =
  'w-full h-[38px] rounded-lg border border-line-2 px-2.5 text-sm text-ink text-right focus:outline-none focus:border-green-light bg-white'
const txtCls =
  'w-full h-[38px] rounded-lg border border-line-2 px-2.5 text-sm text-ink focus:outline-none focus:border-green-light bg-white'

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
          onDate={(d) => setDate(d === data.today ? undefined : d)}
        />
        {/* key по дате: форму пересоздаём при переключении дня, иначе в полях
            останутся значения предыдущей даты — начальное состояние берётся
            из report один раз при монтировании. */}
        <div className="card p-5" key={data.date}>
          {data.position === 'smm' && <SmmForm report={data.report} date={data.date} />}
          {data.position === 'targetolog' && <TargetologForm report={data.report} date={data.date} />}
          {data.position === 'sales' && <SalesForm report={data.report} date={data.date} />}
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
  onDate,
}: {
  report: Report | null
  today: string
  date: string
  earliest: string
  deadline: string
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

  if (!report) {
    // За прошлый день отчёт уже не может быть «в срок» — предупреждаем заранее,
    // чтобы отметка «с опозданием» в сетке дисциплины не была сюрпризом.
    const color = past ? '#c53030' : '#d69e2e'
    return (
      <div className="card p-4 flex items-center gap-3 flex-wrap border-l-4" style={{ borderLeftColor: color }}>
        <span
          className="w-9 h-9 rounded-full grid place-items-center shrink-0"
          style={{ background: past ? '#fdeaea' : '#fff6e6', color }}
        >
          <Clock size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-ink">
            {past ? 'Отчёт за этот день пропущен' : 'Отчёт за сегодня ещё не заполнен'}
          </div>
          <div className="text-sm text-muted">
            {longDate(date)} · {past ? 'будет отмечен как сданный с опозданием' : `дедлайн ${deadline}`}
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
  onSave,
  children,
}: {
  title: string
  hint?: string
  edited: boolean
  saving: boolean
  saved: boolean
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
        <button onClick={onSave} disabled={saving} className="btn btn-green disabled:opacity-60 shrink-0">
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
          {edited ? 'Сохранить' : 'Отправить'}
        </button>
      </div>
      {children}
      {saved && (
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

function SmmForm({ report, date }: { report: Report | null; date: string }) {
  const submit = useMutation(api.reports.submit)
  const [counts, setCounts] = useState<Record<string, number>>(() => {
    const from: Record<string, number> = {}
    for (const r of report?.smm ?? []) from[cellKey(r.page, r.type)] = r.count
    return from
  })
  const [note, setNote] = useState(report?.note ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const get = (page: string, type: string) => counts[cellKey(page, type)] ?? 0
  const setCount = (page: string, type: string, n: number) =>
    setCounts((c) => ({ ...c, [cellKey(page, type)]: n }))

  const total = SMM_CELLS.reduce((s, c) => s + get(c.page, c.type), 0)

  const save = async () => {
    setSaving(true)
    try {
      const rows: SmmRow[] = SMM_CELLS.map((c) => ({
        page: c.page,
        type: c.type,
        count: get(c.page, c.type),
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
                  <input
                    type="number"
                    min={0}
                    className={`${numCls} w-24`}
                    value={get(page, type)}
                    onChange={(e) =>
                      setCount(page, type, e.target.value === '' ? 0 : Number(e.target.value))
                    }
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
          className={`${txtCls} mt-1.5`}
          placeholder="Ссылка на опубликованное или короткое пояснение"
          value={note}
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
function TargetologForm({ report, date }: { report: Report | null; date: string }) {
  const submit = useMutation(api.reports.submit)
  const campaigns = useQuery(api.campaigns.registry, { activeOnly: true })
  const [vals, setVals] = useState<Record<string, { budget: number; leads: number }>>(() => {
    const from: Record<string, { budget: number; leads: number }> = {}
    for (const r of report?.targetolog ?? []) from[r.code] = { budget: r.budget, leads: r.leads }
    return from
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const list = campaigns ?? []
  const get = (code: string) => vals[code] ?? { budget: 0, leads: 0 }
  const setVal = (code: string, patch: Partial<{ budget: number; leads: number }>) =>
    setVals((v) => ({ ...v, [code]: { ...get(code), ...patch } }))

  const sumB = list.reduce((s, c) => s + get(c.code).budget, 0)
  const sumL = list.reduce((s, c) => s + get(c.code).leads, 0)

  const save = async () => {
    setSaving(true)
    try {
      const rows: TargetologRow[] = list.map((c) => ({
        code: c.code,
        budget: get(c.code).budget,
        leads: get(c.code).leads,
      }))
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
      hint="Бюджет и заявки по каждой активной кампании за сегодня. CPL считается сам; кампания не крутилась — оставьте 0"
      edited={!!report}
      saving={saving}
      saved={saved}
      onSave={save}
    >
      <div className="overflow-x-auto">
        <div className="min-w-[560px]">
          <div className="grid grid-cols-[92px_1fr_104px_74px_96px] gap-2 px-1 mb-1.5">
            <Lbl>ID</Lbl>
            <Lbl>Кампания</Lbl>
            <Lbl right>Бюджет ₸</Lbl>
            <Lbl right>Заявки</Lbl>
            <Lbl right>CPL</Lbl>
          </div>
          <div className="flex flex-col gap-2">
            {list.map((c) => {
              const val = get(c.code)
              return (
                <div key={c.code} className="grid grid-cols-[92px_1fr_104px_74px_96px] gap-2 items-center">
                  <span className="chip bg-[#e2f2ef] text-green-d justify-center">{c.code}</span>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-ink truncate">{c.campaign}</div>
                    <div className="text-[11px] text-muted truncate">
                      {c.brand} · деньги: {c.moneySource}
                    </div>
                  </div>
                  <input
                    type="number"
                    min={0}
                    className={numCls}
                    value={val.budget}
                    onChange={(e) =>
                      setVal(c.code, { budget: e.target.value === '' ? 0 : Number(e.target.value) })
                    }
                  />
                  <input
                    type="number"
                    min={0}
                    className={numCls}
                    value={val.leads}
                    onChange={(e) =>
                      setVal(c.code, { leads: e.target.value === '' ? 0 : Number(e.target.value) })
                    }
                  />
                  <div className="h-[38px] flex items-center justify-end px-2 text-sm font-semibold text-ink-2 rounded-lg bg-chip">
                    {val.leads > 0 ? kzt(cpl(val.budget, val.leads)) : '—'}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3 mt-4 pt-3 border-t border-line">
        <Summary label="Бюджет" value={kzt(sumB)} />
        <Summary label="Заявки" value={num(sumL)} />
        <Summary label="Средний CPL" value={sumL > 0 ? kzt(sumB / sumL) : '—'} accent />
      </div>
    </FormShell>
  )
}

// ——— §3.3 Отдел продаж ———
function SalesForm({ report, date }: { report: Report | null; date: string }) {
  const submit = useMutation(api.reports.submit)
  const init: SalesPayload = report?.sales ?? { leads: 0, meetings: 0, sales: 0, revenue: 0, note: '' }
  const [f, setF] = useState<SalesPayload>(init)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const setNum = (k: keyof SalesPayload, v: string) =>
    setF((p) => ({ ...p, [k]: v === '' ? 0 : Number(v) }))

  const save = async () => {
    setSaving(true)
    try {
      await submit({
        date,
        sales: {
          leads: Number(f.leads) || 0,
          meetings: Number(f.meetings) || 0,
          sales: Number(f.sales) || 0,
          revenue: Number(f.revenue) || 0,
          note: f.note || undefined,
        },
      })
      setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormShell
      title="Отчёт отдела продаж"
      hint="Базовый набор метрик — состав уточняется заказчиком (§3.3)"
      edited={!!report}
      saving={saving}
      saved={saved}
      onSave={save}
    >
      <div className="grid grid-cols-2 gap-3">
        <NumField label="Обработано заявок" value={f.leads} onChange={(v) => setNum('leads', v)} />
        <NumField label="Звонки / встречи" value={f.meetings} onChange={(v) => setNum('meetings', v)} />
        <NumField label="Продаж, шт" value={f.sales} onChange={(v) => setNum('sales', v)} />
        <NumField label="Сумма продаж, ₸" value={f.revenue} onChange={(v) => setNum('revenue', v)} />
      </div>
      <div className="mt-3">
        <Lbl>Комментарий</Lbl>
        <textarea
          rows={2}
          className={`${txtCls} h-auto py-2 resize-y mt-1`}
          placeholder="Необязательно"
          value={f.note ?? ''}
          onChange={(e) => setF((p) => ({ ...p, note: e.target.value }))}
        />
      </div>
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
}: {
  label: string
  value: number
  onChange: (v: string) => void
}) {
  return (
    <div>
      <Lbl>{label}</Lbl>
      <input
        type="number"
        min={0}
        className={`${numCls} text-left mt-1`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}
