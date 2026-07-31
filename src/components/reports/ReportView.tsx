import { useState } from 'react'
import { useQuery, useMutation } from 'convex/react'
import type { Doc, Id } from '../../../convex/_generated/dataModel'
import { api } from '../../../convex/_generated/api'
import { Clock, PencilLine, History, Loader2, Check, Trash2, FilePlus2, AlertTriangle } from 'lucide-react'
import { kzt, num } from '@/lib/format'
import { REPORT_PAGES, CONTENT_TYPES } from '@/lib/constants'
import { REPORT_STATUS, reportTime, cpl } from '@/lib/reports'
import { errMessage } from '@/lib/errors'

type Report = Doc<'dailyReports'>
type ReportAction = 'submitted' | 'edited' | 'created' | 'deleted'
type NamedEvent = {
  at: number
  action: ReportAction
  byName: string
  byInitials: string
  byColor: string
}
type Position = 'smm' | 'targetolog' | 'sales'

// Полный ответ reports.reportFor: сам отчёт может отсутствовать (пропущенный
// день) или быть переоткрытым (владелец удалил — цифры очищены).
export interface ReportData {
  report: Report | null
  history: NamedEvent[]
  reopened: boolean
  position: string | null // должность сотрудника (может быть не «отчётной»)
  canEdit: boolean
  canDelete: boolean
  canCreate: boolean
}

const th = 'text-left text-[11px] font-semibold text-green-d uppercase tracking-wide px-3 py-2'
const td = 'px-3 py-2 text-sm text-ink-2 border-t border-line'
const numCls =
  'w-full h-8 px-2 rounded-lg border border-line-2 text-sm text-right text-ink tabular-nums focus:outline-none focus:border-green-light'

// Все шесть ячеек «страница × формат» — как в форме сотрудника и в KPI_SMM.
const SMM_CELLS = REPORT_PAGES.flatMap((page) => CONTENT_TYPES.map((type) => ({ page, type })))
const cellKey = (page: string, type: string) => `${page}|${type}`

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

// Отчёт в модалке дисциплины. Просмотр — для руководства; правка, внесение за
// пропущенный день и удаление — только для владельца (флаги приходят с сервера).
export default function ReportView({
  data,
  employeeId,
  date,
  onClose,
}: {
  data: ReportData
  employeeId: Id<'employees'>
  date: string
  onClose: () => void
}) {
  const { report, history, reopened, position, canEdit, canDelete, canCreate } = data
  const isSales = position === 'sales' || report?.position === 'sales'
  const [mode, setMode] = useState<'view' | 'edit'>('view')
  const [confirmDel, setConfirmDel] = useState(false)
  const [delBusy, setDelBusy] = useState(false)
  const [delError, setDelError] = useState('')
  const remove = useMutation(api.reports.remove)

  const registry = useQuery(api.campaigns.registry, {})
  const byCode = new Map((registry ?? []).map((c) => [c.code, c]))

  // Отчёт с содержимым: не пропуск и не переоткрытая пустышка.
  const hasContent = !!report && !reopened

  const del = async () => {
    if (!report) return
    setDelBusy(true)
    setDelError('')
    try {
      await remove({ reportId: report._id as Id<'dailyReports'> })
      onClose()
    } catch (e) {
      setDelError(errMessage(e, 'Не удалось удалить отчёт.'))
      setDelBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Шапка статуса + действия владельца */}
      {hasContent && report ? (
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip report={report} />
          <span className="text-sm text-muted">Отправлен: {reportTime(report.submittedAt)}</span>
          {report.editCount > 0 && report.editedAt && (
            <span className="chip bg-chip text-muted-2">
              <PencilLine size={12} /> Изменён {report.editCount}×
            </span>
          )}
          <div className="flex-1" />
          {canEdit && !isSales && mode === 'view' && (
            <button onClick={() => setMode('edit')} className="mini-btn">
              <PencilLine size={13} /> Редактировать
            </button>
          )}
          {canDelete && !isSales && mode === 'view' && !confirmDel && (
            <button
              onClick={() => setConfirmDel(true)}
              className="mini-btn text-[#c53030] hover:bg-[#fdeaea]"
            >
              <Trash2 size={13} /> Удалить
            </button>
          )}
        </div>
      ) : null}

      {/* Подтверждение удаления */}
      {confirmDel && (
        <div className="rounded-xl border border-[#f0b4b4] bg-[#fdeaea] p-3 flex flex-col gap-2">
          <div className="text-sm text-[#7a1f1f]">
            Удалить отчёт? Цифры будут стёрты, день снова откроется сотруднику для повторной сдачи —
            она пойдёт «с опозданием». В истории останется, что отчёт удалили вы.
          </div>
          {delError && <div className="text-xs text-[#c53030]">{delError}</div>}
          <div className="flex items-center gap-2">
            <button onClick={del} disabled={delBusy} className="btn h-8 px-3 text-sm bg-[#c53030] text-white disabled:opacity-60">
              {delBusy ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
              Удалить
            </button>
            <button onClick={() => setConfirmDel(false)} disabled={delBusy} className="btn btn-ghost h-8 px-3 text-sm">
              Отмена
            </button>
          </div>
        </div>
      )}

      {/* Тело: просмотр / правка / внесение за пропущенный день */}
      {isSales ? (
        <SalesObjectReports employeeId={employeeId} date={date} canCreate={canCreate} />
      ) : hasContent && report ? (
        mode === 'edit' ? (
          <OwnerEditor
            employeeId={employeeId}
            date={date}
            position={report.position}
            report={report}
            onDone={() => setMode('view')}
          />
        ) : (
          <ReadContent report={report} byCode={byCode} />
        )
      ) : canCreate && position ? (
        <CreateBlock
          employeeId={employeeId}
          date={date}
          position={position as Position}
          reopened={reopened}
        />
      ) : (
        <div className="rounded-xl border border-line p-4 text-sm text-muted">
          Отчёт за эту дату не сдан.
        </div>
      )}

      {history.length > 0 && <HistoryBlock history={history} />}
    </div>
  )
}

function StatusChip({ report }: { report: Report }) {
  const st = REPORT_STATUS[report.onTime ? 'onTime' : 'late']
  return (
    <span className={`chip ${st.chip}`}>
      <Clock size={12} /> {st.label}
    </span>
  )
}

// ——— Блок «внести за пропущенный/переоткрытый день» ———
function CreateBlock({
  employeeId,
  date,
  position,
  reopened,
}: {
  employeeId: Id<'employees'>
  date: string
  position: Position
  reopened: boolean
}) {
  const [open, setOpen] = useState(false)
  if (open) {
    return <OwnerEditor employeeId={employeeId} date={date} position={position} report={null} onDone={() => setOpen(false)} />
  }
  return (
    <div className="rounded-xl border border-[#f3d9a4] bg-[#fff6e6] p-4 flex flex-col gap-3">
      <div className="flex items-start gap-2.5">
        <AlertTriangle size={18} className="text-[#b7791f] shrink-0 mt-0.5" />
        <div className="text-sm text-[#8a5a12]">
          {reopened
            ? 'День переоткрыт: отчёт был удалён. Сотрудник может сдать заново, либо внесите цифры сами — отчёт будет отмечен «с опозданием».'
            : 'Отчёт за этот день не сдан. Вы можете внести цифры за сотрудника — отчёт будет отмечен «с опозданием».'}
        </div>
      </div>
      <button onClick={() => setOpen(true)} className="btn btn-green h-9 px-4 text-sm self-start">
        <FilePlus2 size={14} /> Внести отчёт
      </button>
    </div>
  )
}

// ——— Просмотр ———
function ReadContent({
  report,
  byCode,
}: {
  report: Report
  byCode: Map<string, { campaign: string; brand?: string }>
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
          <Metric label="Новые заявки" value={num(report.sales.leads)} />
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

function SalesObjectReports({
  employeeId,
  date,
  canCreate,
}: {
  employeeId: Id<'employees'>
  date: string
  canCreate: boolean
}) {
  const data = useQuery(api.sales.dayForEmployee, { employeeId, date })

  if (data === undefined) {
    return (
      <div className="grid place-items-center py-6 text-muted">
        <Loader2 className="animate-spin" size={18} />
      </div>
    )
  }
  if (data === null) {
    return <div className="rounded-xl border border-line p-4 text-sm text-muted">Нет доступа к объектным отчётам продаж.</div>
  }
  if (data.rows.length === 0) {
    return (
      <div className="rounded-xl border border-line p-4 text-sm text-muted">
        На эту дату нет назначенных объектов продаж.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {data.rows.map((row) => (
        <SalesObjectReportRow
          key={row.object._id}
          employeeId={employeeId}
          date={date}
          object={row.object}
          planDeals={row.planDeals}
          report={row.report}
          canEdit={data.canEdit || canCreate}
        />
      ))}
      {data.closed && (
        <div className="text-[11px] text-muted-2">
          Месяц закрыт — объектные отчёты доступны только для просмотра.
        </div>
      )}
    </div>
  )
}

type SalesObjectDoc = Doc<'salesObjects'>
type SalesObjectReportDoc = Doc<'salesObjectReports'> | null

function SalesObjectReportRow({
  employeeId,
  date,
  object,
  planDeals,
  report,
  canEdit,
}: {
  employeeId: Id<'employees'>
  date: string
  object: SalesObjectDoc
  planDeals: number
  report: SalesObjectReportDoc
  canEdit: boolean
}) {
  const save = useMutation(api.sales.ownerSetDaily)
  const [editing, setEditing] = useState(false)
  const [f, setF] = useState(() => ({
    newLeads: report ? String(report.newLeads) : '',
    newConsultations: report ? String(report.newConsultations) : '',
    repeatConsultations: report ? String(report.repeatConsultations) : '',
    newMeetings: report ? String(report.newMeetings) : '',
    repeatMeetings: report ? String(report.repeatMeetings) : '',
    newPrepayments: report ? String(report.newPrepayments) : '',
    newDeals: report ? String(report.newDeals) : '',
    revenue: report ? String(report.revenue) : '',
    comment: report?.comment ?? '',
  }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const setNum = (key: Exclude<keyof typeof f, 'comment'>, value: string) =>
    setF((prev) => ({ ...prev, [key]: value }))
  const toInt = (value: string) => Math.max(0, Math.floor(Number(value) || 0))
  const doSave = async () => {
    if (f.newLeads.trim() === '') {
      setError('Поле «Новые заявки» обязательно.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await save({
        employeeId,
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
      setEditing(false)
    } catch (e) {
      setError(errMessage(e, 'Не удалось сохранить объектный отчёт.'))
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return (
      <div className="rounded-2xl border border-line p-4">
        <div className="flex items-start gap-3 mb-3">
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-ink truncate">{object.name}</div>
            <div className="text-[11px] text-muted">План сделок: {num(planDeals)}</div>
          </div>
          {canEdit && (
            <button onClick={() => setEditing(true)} className="mini-btn">
              <PencilLine size={13} /> {report ? 'Править' : 'Внести'}
            </button>
          )}
        </div>
        {report ? (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Metric label="Заявки" value={num(report.newLeads)} />
              <Metric label="Консультации" value={num(report.newConsultations)} />
              <Metric label="Встречи" value={num(report.newMeetings)} />
              <Metric label="Сделки" value={num(report.newDeals)} />
              <Metric label="Повт. консультации" value={num(report.repeatConsultations)} />
              <Metric label="Повт. встречи" value={num(report.repeatMeetings)} />
              <Metric label="Подписанные договоры" value={num(report.newPrepayments)} />
              <Metric label="Сумма" value={kzt(report.revenue)} />
            </div>
            {report.comment && (
              <div className="text-sm text-muted mt-3 break-words">{report.comment}</div>
            )}
          </>
        ) : (
          <div className="text-sm text-muted">По этому объекту отчёт за день ещё не внесён.</div>
        )}
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-green-light/50 p-4 bg-[#f8fcfb]">
      <div className="font-semibold text-ink mb-3">{object.name}</div>
      <div className="grid grid-cols-2 gap-3">
        <EditField label="Новые заявки *" value={f.newLeads} onChange={(v) => setNum('newLeads', v)} />
        <EditField label="Новые консультации" value={f.newConsultations} onChange={(v) => setNum('newConsultations', v)} />
        <EditField label="Повторные консультации" value={f.repeatConsultations} onChange={(v) => setNum('repeatConsultations', v)} />
        <EditField label="Новые встречи / Zoom" value={f.newMeetings} onChange={(v) => setNum('newMeetings', v)} />
        <EditField label="Повторные встречи" value={f.repeatMeetings} onChange={(v) => setNum('repeatMeetings', v)} />
        <EditField label="Подписанные договоры" value={f.newPrepayments} onChange={(v) => setNum('newPrepayments', v)} />
        <EditField label="Сделки" value={f.newDeals} onChange={(v) => setNum('newDeals', v)} />
        <div className="col-span-2">
          <EditField label="Фактически полученная сумма, ₸" value={f.revenue} onChange={(v) => setNum('revenue', v)} />
        </div>
      </div>
      <div className="mt-3">
        <div className="text-[11px] text-muted uppercase tracking-wide mb-1">Комментарий</div>
        <input
          value={f.comment}
          onChange={(e) => setF((prev) => ({ ...prev, comment: e.target.value }))}
          className="w-full h-9 px-2 rounded-lg border border-line-2 text-sm text-ink focus:outline-none focus:border-green-light"
        />
      </div>
      {error && <p className="text-sm text-[#c53030] mt-3">{error}</p>}
      <div className="flex items-center gap-2 mt-3">
        <button onClick={doSave} disabled={saving} className="btn btn-green h-9 px-4 text-sm disabled:opacity-60">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          Сохранить
        </button>
        <button onClick={() => setEditing(false)} disabled={saving} className="btn btn-ghost h-9 px-4 text-sm">
          Отмена
        </button>
      </div>
    </div>
  )
}

function EditField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div>
      <div className="text-xs text-muted mb-1">{label}</div>
      <EditNum value={value} onChange={onChange} />
    </div>
  )
}

// ——— Правка / внесение (владелец) ———
// Один редактор на оба случая: правим существующий отчёт или вносим новый за
// пропущенный день. Состав строк фиксирован моделью: SMM — шесть ячеек,
// таргет — активные кампании реестра (при правке — те, что были в отчёте).
function OwnerEditor({
  employeeId,
  date,
  position,
  report,
  onDone,
}: {
  employeeId: Id<'employees'>
  date: string
  position: Position
  report: Report | null
  onDone: () => void
}) {
  const save = useMutation(api.reports.ownerSet)
  // Активные кампании нужны только когда вносим таргет с нуля.
  const activeCampaigns = useQuery(
    api.campaigns.registry,
    position === 'targetolog' && !report?.targetolog ? { activeOnly: true } : 'skip',
  )
  const registry = useQuery(api.campaigns.registry, position === 'targetolog' ? {} : 'skip')
  const byCode = new Map((registry ?? []).map((c) => [c.code, c]))

  const [smm, setSmm] = useState<Record<string, string>>(() => {
    const from: Record<string, string> = {}
    for (const r of report?.smm ?? []) from[cellKey(r.page, r.type)] = String(r.count)
    return from
  })
  const [tg, setTg] = useState<Record<string, { budget: string; leads: string }>>(() => {
    const from: Record<string, { budget: string; leads: string }> = {}
    for (const r of report?.targetolog ?? []) from[r.code] = { budget: String(r.budget), leads: String(r.leads) }
    return from
  })
  const [sales, setSales] = useState(() => ({
    leads: report?.sales ? String(report.sales.leads) : '',
    meetings: report?.sales ? String(report.sales.meetings) : '',
    sales: report?.sales ? String(report.sales.sales) : '',
    revenue: report?.sales ? String(report.sales.revenue) : '',
  }))
  const [note, setNote] = useState(report?.note ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Строки таргета: из отчёта (правка) либо активные кампании (внесение).
  const tgCodes: string[] = report?.targetolog
    ? report.targetolog.map((r) => r.code)
    : (activeCampaigns ?? []).map((c) => c.code)

  const doSave = async () => {
    setSaving(true)
    setError('')
    try {
      await save({
        employeeId,
        date,
        note: note.trim() || undefined,
        smm:
          position === 'smm'
            ? SMM_CELLS.map((c) => ({ page: c.page, type: c.type, count: Number(smm[cellKey(c.page, c.type)]) || 0 }))
            : undefined,
        targetolog:
          position === 'targetolog'
            ? tgCodes.map((code) => ({
                code,
                budget: Number(tg[code]?.budget) || 0,
                leads: Number(tg[code]?.leads) || 0,
              }))
            : undefined,
        sales:
          position === 'sales'
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
      setError(errMessage(e, 'Не удалось сохранить.'))
      setSaving(false)
    }
  }

  const canSaveTargetolog = position !== 'targetolog' || tgCodes.length > 0

  return (
    <div className="flex flex-col gap-4">
      {position === 'smm' && (
        <table className="w-full">
          <thead>
            <tr className="bg-[#e2f2ef]">
              <th className={th}>Страница</th>
              <th className={th}>Формат</th>
              <th className={`${th} text-right`}>Кол-во</th>
            </tr>
          </thead>
          <tbody>
            {SMM_CELLS.map((c) => {
              const k = cellKey(c.page, c.type)
              return (
                <tr key={k}>
                  <td className={td}>{c.page}</td>
                  <td className={td}>{c.type}</td>
                  <td className={`${td} text-right`}>
                    <EditNum
                      value={smm[k] ?? ''}
                      onChange={(v) => setSmm((s) => ({ ...s, [k]: v }))}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {position === 'targetolog' &&
        (tgCodes.length === 0 ? (
          <div className="rounded-xl border border-line p-4 text-sm text-muted">
            В реестре нет активных кампаний — вносить нечего.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {tgCodes.map((code) => (
              <div key={code} className="grid grid-cols-[1fr_104px_74px] gap-2 items-center">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink truncate">{byCode.get(code)?.campaign ?? code}</div>
                  <div className="text-[11px] text-muted">{code}</div>
                </div>
                <EditNum
                  value={tg[code]?.budget ?? ''}
                  onChange={(v) => setTg((s) => ({ ...s, [code]: { ...(s[code] ?? { budget: '', leads: '' }), budget: v } }))}
                />
                <EditNum
                  value={tg[code]?.leads ?? ''}
                  onChange={(v) => setTg((s) => ({ ...s, [code]: { ...(s[code] ?? { budget: '', leads: '' }), leads: v } }))}
                />
              </div>
            ))}
          </div>
        ))}

      {position === 'sales' && (
        <div className="grid grid-cols-2 gap-3">
          {(
            [
              ['leads', 'Новые заявки'],
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
                onChange={(e) => setSales((s) => ({ ...s, [k]: e.target.value }))}
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
        <button onClick={doSave} disabled={saving || !canSaveTargetolog} className="btn btn-green h-9 px-4 text-sm disabled:opacity-60">
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
const ACTION_LABEL: Record<ReportAction, string> = {
  submitted: 'отправил(а) отчёт',
  edited: 'внёс(ла) правку',
  created: 'внёс(ла) отчёт',
  deleted: 'удалил(а) отчёт',
}

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
              <b className="font-medium text-ink">{h.byName}</b> {ACTION_LABEL[h.action]}
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
