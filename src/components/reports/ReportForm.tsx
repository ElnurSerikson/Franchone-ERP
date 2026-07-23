import { useState, type ReactNode } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import type { Doc } from '../../../convex/_generated/dataModel'
import { Plus, Trash2, Loader2, Save, Check, Clock, PencilLine, History, ChevronDown } from 'lucide-react'
import type { SmmRow, TargetologRow, SalesPayload } from '@/types'
import { REPORTING_POSITIONS, REPORT_PAGES, CONTENT_TYPES } from '@/lib/constants'
import { REPORT_STATUS, reportTime, cpl } from '@/lib/reports'
import { kzt, num } from '@/lib/format'
import { useMediaQuery } from '@/lib/useMediaQuery'
import Select from '../ui/Select'

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
  const data = useQuery(api.reports.mine, {})

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
        <StatusBanner report={data.report} today={data.today} deadline={data.deadlineTime} />
        <div className="card p-5">
          {data.position === 'smm' && <SmmForm report={data.report} />}
          {data.position === 'targetolog' && <TargetologForm report={data.report} />}
          {data.position === 'sales' && <SalesForm report={data.report} />}
        </div>
      </div>
      <HistoryPanel history={data.history} />
    </div>
  )
}

// ——— Баннер статуса за сегодня ———
function StatusBanner({
  report,
  today,
  deadline,
}: {
  report: Report | null
  today: string
  deadline: string
}) {
  if (!report)
    return (
      <div className="card p-4 flex items-center gap-3 border-l-4" style={{ borderLeftColor: '#d69e2e' }}>
        <span className="w-9 h-9 rounded-full bg-[#fff6e6] text-[#b7791f] grid place-items-center shrink-0">
          <Clock size={18} />
        </span>
        <div className="min-w-0">
          <div className="font-semibold text-ink">Отчёт за сегодня ещё не заполнен</div>
          <div className="text-sm text-muted">
            {longDate(today)} · дедлайн {deadline}
          </div>
        </div>
      </div>
    )

  const st = REPORT_STATUS[report.onTime ? 'onTime' : 'late']
  return (
    <div className="card p-4 flex items-center gap-3 border-l-4" style={{ borderLeftColor: st.dot }}>
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
          {longDate(today)} · {reportTime(report.submittedAt)}
        </div>
      </div>
      {report.editCount > 0 && report.editedAt && (
        <span className="chip bg-chip text-muted-2 shrink-0">
          <PencilLine size={12} /> изм. {report.editCount}×
        </span>
      )}
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
function SmmForm({ report }: { report: Report | null }) {
  const submit = useMutation(api.reports.submit)
  const [rows, setRows] = useState<SmmRow[]>(() =>
    report?.smm?.length ? report.smm : [{ page: 'FRANCHONE', type: 'Reels', count: 1 }],
  )
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const setRow = (i: number, patch: Partial<SmmRow>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  const total = rows.reduce((s, r) => s + (Number(r.count) || 0), 0)

  const save = async () => {
    setSaving(true)
    try {
      await submit({ smm: rows.map((r) => ({ page: r.page, type: r.type, count: Number(r.count) || 0 })) })
      setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormShell
      title="Отчёт SMM-специалиста"
      hint="Опубликованный контент по страницам за сегодня"
      edited={!!report}
      saving={saving}
      saved={saved}
      onSave={save}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_84px_36px] gap-2 px-1 mb-1.5">
        <Lbl>Страница</Lbl>
        <Lbl>Формат</Lbl>
        <Lbl right>Кол-во</Lbl>
        <span />
      </div>
      <div className="flex flex-col gap-2">
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_84px_36px] gap-2 items-center">
            <Select
              value={r.page}
              onChange={(v) => setRow(i, { page: v })}
              options={REPORT_PAGES.map((p) => ({ value: p, label: p }))}
            />
            <Select
              value={r.type}
              onChange={(v) => setRow(i, { type: v })}
              options={CONTENT_TYPES.map((t) => ({ value: t, label: t }))}
            />
            <input
              type="number"
              min={0}
              className={numCls}
              value={r.count}
              onChange={(e) => setRow(i, { count: e.target.value === '' ? 0 : Number(e.target.value) })}
            />
            <RemoveBtn disabled={rows.length === 1} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} />
          </div>
        ))}
      </div>
      <AddBtn onClick={() => setRows((rs) => [...rs, { page: 'FRANCHONE', type: 'Reels', count: 1 }])}>
        Добавить строку
      </AddBtn>
      <div className="flex items-center justify-between mt-4 pt-3 border-t border-line text-sm">
        <span className="text-muted">Итого публикаций</span>
        <span className="text-lg font-bold text-green-d">{total}</span>
      </div>
    </FormShell>
  )
}

// ——— §3.2 Таргетолог ———
function TargetologForm({ report }: { report: Report | null }) {
  const submit = useMutation(api.reports.submit)
  const [rows, setRows] = useState<TargetologRow[]>(() =>
    report?.targetolog?.length
      ? report.targetolog
      : [{ project: '', campaign: '', budget: 0, leads: 0 }],
  )
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const setRow = (i: number, patch: Partial<TargetologRow>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  const sumB = rows.reduce((s, r) => s + (Number(r.budget) || 0), 0)
  const sumL = rows.reduce((s, r) => s + (Number(r.leads) || 0), 0)

  const save = async () => {
    setSaving(true)
    try {
      await submit({
        targetolog: rows.map((r) => ({
          project: r.project,
          campaign: r.campaign,
          budget: Number(r.budget) || 0,
          leads: Number(r.leads) || 0,
        })),
      })
      setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormShell
      title="Отчёт таргетолога"
      hint="Показатели по каждой активной рекламной кампании за сегодня"
      edited={!!report}
      saving={saving}
      saved={saved}
      onSave={save}
    >
      <div className="overflow-x-auto">
        <div className="min-w-[560px]">
          <div className="grid grid-cols-[1.2fr_1.2fr_104px_74px_96px_36px] gap-2 px-1 mb-1.5">
            <Lbl>Проект</Lbl>
            <Lbl>Кампания</Lbl>
            <Lbl right>Бюджет ₸</Lbl>
            <Lbl right>Заявки</Lbl>
            <Lbl right>CPL</Lbl>
            <span />
          </div>
          <div className="flex flex-col gap-2">
            {rows.map((r, i) => (
              <div key={i} className="grid grid-cols-[1.2fr_1.2fr_104px_74px_96px_36px] gap-2 items-center">
                <input
                  className={txtCls}
                  placeholder="Франшиза"
                  value={r.project}
                  onChange={(e) => setRow(i, { project: e.target.value })}
                />
                <input
                  className={txtCls}
                  placeholder="Название кампании"
                  value={r.campaign}
                  onChange={(e) => setRow(i, { campaign: e.target.value })}
                />
                <input
                  type="number"
                  min={0}
                  className={numCls}
                  value={r.budget}
                  onChange={(e) => setRow(i, { budget: e.target.value === '' ? 0 : Number(e.target.value) })}
                />
                <input
                  type="number"
                  min={0}
                  className={numCls}
                  value={r.leads}
                  onChange={(e) => setRow(i, { leads: e.target.value === '' ? 0 : Number(e.target.value) })}
                />
                <div className="h-[38px] flex items-center justify-end px-2 text-sm font-semibold text-ink-2 rounded-lg bg-chip">
                  {r.leads > 0 ? kzt(cpl(Number(r.budget) || 0, Number(r.leads) || 0)) : '—'}
                </div>
                <RemoveBtn disabled={rows.length === 1} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} />
              </div>
            ))}
          </div>
        </div>
      </div>
      <AddBtn onClick={() => setRows((rs) => [...rs, { project: '', campaign: '', budget: 0, leads: 0 }])}>
        Добавить кампанию
      </AddBtn>
      <div className="grid grid-cols-3 gap-3 mt-4 pt-3 border-t border-line">
        <Summary label="Бюджет" value={kzt(sumB)} />
        <Summary label="Заявки" value={num(sumL)} />
        <Summary label="Средний CPL" value={sumL > 0 ? kzt(sumB / sumL) : '—'} accent />
      </div>
    </FormShell>
  )
}

// ——— §3.3 Отдел продаж ———
function SalesForm({ report }: { report: Report | null }) {
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

function RemoveBtn({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-9 h-9 grid place-items-center rounded-lg text-muted hover:text-[#c53030] hover:bg-chip disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
      title="Удалить строку"
    >
      <Trash2 size={15} />
    </button>
  )
}

function AddBtn({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="mt-2.5 inline-flex items-center gap-1.5 text-sm font-medium text-green-d hover:text-green transition-colors"
    >
      <Plus size={15} /> {children}
    </button>
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
