import { useState } from 'react'
import { useQuery, useMutation } from 'convex/react'
import type { Doc, Id } from '../../../convex/_generated/dataModel'
import { api } from '../../../convex/_generated/api'
import { Clock, PencilLine, History, Loader2, Check } from 'lucide-react'
import { kzt, num } from '@/lib/format'
import { REPORT_STATUS, reportTime, cpl } from '@/lib/reports'
import { errMessage } from '@/lib/errors'

type Report = Doc<'dailyReports'>
type NamedEvent = {
  at: number
  action: 'submitted' | 'edited'
  byName: string
  byInitials: string
  byColor: string
}

const th = 'text-left text-[11px] font-semibold text-green-d uppercase tracking-wide px-3 py-2'
const td = 'px-3 py-2 text-sm text-ink-2 border-t border-line'
const numCls =
  'w-24 h-8 px-2 rounded-lg border border-line-2 text-sm text-right text-ink tabular-nums focus:outline-none focus:border-green-light'

// Числовое поле правки: строка, чтобы можно было очистить (см. форму отчёта).
function EditNum({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="number"
      min={0}
      inputMode="numeric"
      value={value}
      placeholder="0"
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => onChange(e.target.value)}
      className={numCls}
    />
  )
}

// Отчёт: просмотр, правка (для автора и руководства) и история изменений.
export default function ReportView({
  report,
  history,
  canEdit,
}: {
  report: Report
  history: NamedEvent[]
  canEdit: boolean
}) {
  const [editing, setEditing] = useState(false)
  const st = REPORT_STATUS[report.onTime ? 'onTime' : 'late']
  const registry = useQuery(api.campaigns.registry, report.targetolog ? {} : 'skip')
  const byCode = new Map((registry ?? []).map((c) => [c.code, c]))

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`chip ${st.chip}`}>
          <Clock size={12} /> {st.label}
        </span>
        <span className="text-sm text-muted">Отправлен: {reportTime(report.submittedAt)}</span>
        {report.editCount > 0 && report.editedAt && (
          <span className="chip bg-chip text-muted-2">
            <PencilLine size={12} /> Изменён {report.editCount}×
          </span>
        )}
        <div className="flex-1" />
        {canEdit && !editing && (
          <button onClick={() => setEditing(true)} className="mini-btn">
            <PencilLine size={13} /> Редактировать
          </button>
        )}
      </div>

      {editing ? (
        <EditForm report={report} onDone={() => setEditing(false)} byCode={byCode} />
      ) : (
        <ReadContent report={report} byCode={byCode} />
      )}

      {history.length > 0 && <HistoryBlock history={history} />}
    </div>
  )
}

// ——— Просмотр ———
function ReadContent({
  report,
  byCode,
}: {
  report: Report
  byCode: Map<string, { campaign: string; brand: string }>
}) {
  return (
    <>
      {report.smm && (
        <table className="w-full">
          <thead>
            <tr className="bg-[#e2f2ef]">
              <th className={th}>Страница</th>
              <th className={th}>Формат</th>
              <th className={th}>Кол-во</th>
            </tr>
          </thead>
          <tbody>
            {report.smm.map((r, i) => (
              <tr key={i}>
                <td className={td}>{r.page}</td>
                <td className={td}>{r.type}</td>
                <td className={`${td} font-semibold text-ink`}>{r.count}</td>
              </tr>
            ))}
            <tr>
              <td className={`${td} font-semibold text-ink`} colSpan={2}>
                Итого публикаций
              </td>
              <td className={`${td} font-bold text-green-d`}>
                {report.smm.reduce((s, r) => s + r.count, 0)}
              </td>
            </tr>
          </tbody>
        </table>
      )}

      {report.targetolog && (
        <div className="overflow-x-auto -mx-1 px-1">
          <table className="w-full min-w-[420px]">
            <thead>
              <tr className="bg-[#e2f2ef]">
                <th className={th}>Кампания</th>
                <th className={th}>Бюджет</th>
                <th className={th}>Заявки</th>
                <th className={th}>CPL</th>
              </tr>
            </thead>
            <tbody>
              {report.targetolog.map((r, i) => (
                <tr key={i}>
                  <td className={td}>
                    <div className="font-medium text-ink">{byCode.get(r.code)?.campaign ?? r.code}</div>
                    <div className="text-[11px] text-muted">
                      {r.code}
                      {byCode.get(r.code) ? ` · ${byCode.get(r.code)!.brand}` : ''}
                    </div>
                  </td>
                  <td className={td}>{kzt(r.budget)}</td>
                  <td className={`${td} font-semibold text-ink`}>{r.leads}</td>
                  <td className={td}>{kzt(cpl(r.budget, r.leads))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {report.sales && (
        <div className="grid grid-cols-2 gap-3">
          <Metric label="Обработано заявок" value={num(report.sales.leads)} />
          <Metric label="Звонки / встречи" value={num(report.sales.meetings)} />
          <Metric label="Продаж, шт" value={num(report.sales.sales)} />
          <Metric label="Сумма продаж" value={kzt(report.sales.revenue)} />
        </div>
      )}

      {report.note ? (
        <div className="rounded-xl border border-line p-3">
          <div className="text-[11px] text-muted uppercase tracking-wide mb-1">Комментарий / ссылка</div>
          <div className="text-sm text-ink-2 break-words">{report.note}</div>
        </div>
      ) : null}
    </>
  )
}

// ——— Правка ———
// Правим ровно тот набор строк, что был сдан: состав не меняем, только цифры.
function EditForm({
  report,
  onDone,
  byCode,
}: {
  report: Report
  onDone: () => void
  byCode: Map<string, { campaign: string; brand: string }>
}) {
  const edit = useMutation(api.reports.edit)
  const [smm, setSmm] = useState(() => (report.smm ?? []).map((r) => ({ ...r, count: String(r.count) })))
  const [tg, setTg] = useState(() =>
    (report.targetolog ?? []).map((r) => ({ ...r, budget: String(r.budget), leads: String(r.leads) })),
  )
  const [sales, setSales] = useState(() =>
    report.sales
      ? {
          leads: String(report.sales.leads),
          meetings: String(report.sales.meetings),
          sales: String(report.sales.sales),
          revenue: String(report.sales.revenue),
        }
      : null,
  )
  const [note, setNote] = useState(report.note ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      await edit({
        reportId: report._id as Id<'dailyReports'>,
        note: note.trim() || undefined,
        smm: report.smm ? smm.map((r) => ({ page: r.page, type: r.type, count: Number(r.count) || 0 })) : undefined,
        targetolog: report.targetolog
          ? tg.map((r) => ({ code: r.code, budget: Number(r.budget) || 0, leads: Number(r.leads) || 0 }))
          : undefined,
        sales:
          report.sales && sales
            ? {
                leads: Number(sales.leads) || 0,
                meetings: Number(sales.meetings) || 0,
                sales: Number(sales.sales) || 0,
                revenue: Number(sales.revenue) || 0,
                note: undefined,
              }
            : undefined,
      })
      onDone()
    } catch (e) {
      setError(errMessage(e, 'Не удалось сохранить правку.'))
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {report.smm && (
        <table className="w-full">
          <thead>
            <tr className="bg-[#e2f2ef]">
              <th className={th}>Страница</th>
              <th className={th}>Формат</th>
              <th className={`${th} text-right`}>Кол-во</th>
            </tr>
          </thead>
          <tbody>
            {smm.map((r, i) => (
              <tr key={i}>
                <td className={td}>{r.page}</td>
                <td className={td}>{r.type}</td>
                <td className={`${td} text-right`}>
                  <EditNum value={r.count} onChange={(v) => setSmm((s) => s.map((x, j) => (j === i ? { ...x, count: v } : x)))} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {report.targetolog && (
        <div className="flex flex-col gap-2">
          {tg.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_104px_74px] gap-2 items-center">
              <div className="min-w-0">
                <div className="text-sm font-medium text-ink truncate">{byCode.get(r.code)?.campaign ?? r.code}</div>
                <div className="text-[11px] text-muted">{r.code}</div>
              </div>
              <EditNum value={r.budget} onChange={(v) => setTg((s) => s.map((x, j) => (j === i ? { ...x, budget: v } : x)))} />
              <EditNum value={r.leads} onChange={(v) => setTg((s) => s.map((x, j) => (j === i ? { ...x, leads: v } : x)))} />
            </div>
          ))}
        </div>
      )}

      {report.sales && sales && (
        <div className="grid grid-cols-2 gap-3">
          {(
            [
              ['leads', 'Обработано заявок'],
              ['meetings', 'Звонки / встречи'],
              ['sales', 'Продаж, шт'],
              ['revenue', 'Сумма продаж'],
            ] as const
          ).map(([k, label]) => (
            <div key={k}>
              <div className="text-xs text-muted mb-1">{label}</div>
              <input
                type="number"
                min={0}
                inputMode="numeric"
                value={sales[k]}
                placeholder="0"
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => setSales((s) => (s ? { ...s, [k]: e.target.value } : s))}
                className="w-full h-9 px-2 rounded-lg border border-line-2 text-sm text-ink focus:outline-none focus:border-green-light"
              />
            </div>
          ))}
        </div>
      )}

      <div>
        <div className="text-[11px] text-muted uppercase tracking-wide mb-1">Комментарий / ссылка</div>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Ссылка или пояснение"
          className="w-full h-9 px-2 rounded-lg border border-line-2 text-sm text-ink focus:outline-none focus:border-green-light"
        />
      </div>

      {error && <p className="text-sm text-[#c53030]">{error}</p>}

      <div className="flex items-center gap-2">
        <button onClick={save} disabled={saving} className="btn btn-green h-9 px-4 text-sm disabled:opacity-60">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          Сохранить
        </button>
        <button onClick={onDone} disabled={saving} className="btn btn-ghost h-9 px-4 text-sm">
          Отмена
        </button>
      </div>
    </div>
  )
}

// ——— История правок ———
function HistoryBlock({ history }: { history: NamedEvent[] }) {
  // Свежие сверху.
  const items = [...history].reverse()
  return (
    <div className="rounded-xl border border-line p-3">
      <div className="flex items-center gap-1.5 text-[11px] text-muted uppercase tracking-wide mb-2">
        <History size={12} /> История изменений
      </div>
      <div className="flex flex-col gap-2">
        {items.map((h, i) => (
          <div key={i} className="flex items-center gap-2.5">
            <span
              className="w-6 h-6 rounded-full grid place-items-center text-white text-[10px] font-bold shrink-0"
              style={{ background: h.byColor }}
            >
              {h.byInitials}
            </span>
            <span className="text-sm text-ink-2 flex-1 min-w-0 truncate">
              <b className="font-medium text-ink">{h.byName}</b>{' '}
              {h.action === 'submitted' ? 'отправил(а) отчёт' : 'внёс(ла) правку'}
            </span>
            <span className="text-xs text-muted whitespace-nowrap">{reportTime(h.at)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line p-3">
      <div className="text-xs text-muted mb-1">{label}</div>
      <div className="text-lg font-bold text-ink">{value}</div>
    </div>
  )
}
