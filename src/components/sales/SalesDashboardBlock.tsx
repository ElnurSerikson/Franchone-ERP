import { useState } from 'react'
import { useQuery } from 'convex/react'
import { ChevronLeft, ChevronRight, CircleDollarSign, Filter, Inbox, Target } from 'lucide-react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import type { Employee, Role } from '@/types'
import Select from '@/components/ui/Select'
import { ProgressBar } from '@/components/ui/Progress'
import { CURRENT_MONTH, addMonth, formatMonth } from '@/lib/month'
import { kzt, num, pct } from '@/lib/format'
import { th, thRight, td, theadRow } from '@/lib/table'

type SalesTotals = {
  newLeads: number
  processedLeads: number
  newConsultations: number
  repeatConsultations: number
  newMeetings: number
  repeatMeetings: number
  newPrepayments: number
  newDeals: number
  revenue: number
  planDeals: number
  planCompletion: number | null
  unprocessedLeads: number
  conversions: {
    consultation: number | null
    meeting: number | null
    prepayment: number | null
    deal: number | null
    total: number | null
  }
  activity: {
    totalConsultations: number
    avgConsultationsPerClient: number | null
    repeatConsultationShare: number | null
    totalMeetings: number
    avgMeetingsPerClient: number | null
    repeatMeetingShare: number | null
    totalInteractions: number
    interactionsPerDeal: number | null
  }
}

type SalesRow = SalesTotals & {
  objectId?: string
  employeeId?: string
  name: string
  initials?: string
  avatarColor?: string
}

type SalesObjectOption = {
  _id: string
  name: string
  type: string
  status: string
  selling: boolean
}

export default function SalesDashboardBlock({
  role,
  me,
  employees = [],
}: {
  role: Role
  me: Employee
  employees?: Employee[]
}) {
  const [month, setMonth] = useState(CURRENT_MONTH)
  const [objectId, setObjectId] = useState('all')
  const [employeeId, setEmployeeId] = useState('all')
  const manager = role === 'owner' || role === 'head'

  const data = useQuery(api.sales.summary, {
    month,
    ...(objectId !== 'all' ? { objectId: objectId as Id<'salesObjects'> } : {}),
    ...(manager && employeeId !== 'all' ? { employeeId: employeeId as Id<'employees'> } : {}),
  })

  if (data === undefined) return <SalesSkeleton />
  if (!manager && me.position !== 'sales') return null

  const totals = data.totals as SalesTotals
  const objectRows = data.objectRows as SalesRow[]
  const managerRows = data.managerRows as SalesRow[]
  const objectOptions = data.objects as SalesObjectOption[]
  const salesPeople = employees.filter((e) => e.position === 'sales' && e.role !== 'owner' && e.status === 'active')
  const managerOptions = salesPeople.map((e) => ({ value: e.id, label: e.name }))
  const seenManagerIds = new Set(managerOptions.map((option) => option.value))
  for (const row of managerRows) {
    if (!row.employeeId || seenManagerIds.has(row.employeeId)) continue
    managerOptions.push({ value: row.employeeId, label: row.name })
    seenManagerIds.add(row.employeeId)
  }
  const progress = totals.planCompletion ?? 0

  return (
    <div className="flex flex-col gap-5 mb-5">
      <section className="card p-5">
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <Filter size={17} className="text-green" />
          <h3 className="sec-title flex-1">Продажи · LIVE-воронка</h3>
          <MonthSwitch month={month} onChange={setMonth} />
        </div>

        <div className={`grid gap-3 mb-5 ${manager ? 'lg:grid-cols-3' : 'lg:grid-cols-2'}`}>
          {manager && (
            <div>
              <Label>Менеджер</Label>
              <Select
                value={employeeId}
                onChange={setEmployeeId}
                options={[
                  { value: 'all', label: 'Все менеджеры' },
                  ...managerOptions,
                ]}
                className="mt-1.5"
              />
            </div>
          )}
          <div>
            <Label>Объект продаж</Label>
            <Select
              value={objectId}
              onChange={setObjectId}
              options={[
                { value: 'all', label: 'Все активные' },
                ...objectOptions.map((o) => ({ value: o._id, label: o.name })),
              ]}
              className="mt-1.5"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3 mb-6">
          <SalesStat
            icon={Target}
            label="План продаж"
            value={`${num(totals.newDeals)} из ${num(totals.planDeals)}`}
            foot={`Выполнено ${fmtPct(totals.planCompletion)}`}
            progress={progress}
          />
          <SalesStat
            icon={CircleDollarSign}
            label="Сумма продаж"
            value={kzt(totals.revenue)}
            foot="Оплаты текущего месяца"
          />
          <SalesStat
            icon={Inbox}
            label="Не обработано"
            value={num(totals.unprocessedLeads)}
            foot={`Из ${num(totals.newLeads)} новых заявок`}
          />
        </div>

        <div>
          <div className="text-[15px] font-semibold text-ink mb-3">LIVE-воронка</div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <FunnelCard label="Заявки" value={totals.newLeads} />
            <FunnelCard label="Консультации" value={totals.newConsultations} />
            <FunnelCard label="Встречи / Zoom" value={totals.newMeetings} />
            <FunnelCard label="Предоплаты" value={totals.newPrepayments} />
            <FunnelCard label="Сделки" value={totals.newDeals} strong />
          </div>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4 mt-3 text-sm text-muted">
            <span>→ {fmtPct(totals.conversions.consultation)}</span>
            <span>→ {fmtPct(totals.conversions.meeting)}</span>
            <span>→ {fmtPct(totals.conversions.prepayment)}</span>
            <span>→ {fmtPct(totals.conversions.deal)}</span>
          </div>
          <div className="flex items-center gap-3 justify-between flex-wrap mt-4 text-sm text-muted">
            <span>Обработано заявок: {num(totals.processedLeads)} из {num(totals.newLeads)}</span>
            <span>Общая конверсия в сделку: {fmtPct(totals.conversions.total)}</span>
          </div>
        </div>
      </section>

      <section className="card p-5">
        <SalesObjectsTable rows={objectRows} />
      </section>

      <section className="card p-5">
        <ActivityPanel totals={totals} managerRows={manager ? managerRows : []} />
      </section>
    </div>
  )
}

function MonthSwitch({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  return (
    <div className="flex items-center gap-1 rounded-xl bg-chip p-1">
      <button onClick={() => onChange(addMonth(month, -1))} className="ico-btn w-8 h-8 border-0 bg-transparent" title="Предыдущий месяц">
        <ChevronLeft size={16} />
      </button>
      <span className="px-2 text-sm font-semibold text-ink min-w-[116px] text-center">{formatMonth(month)}</span>
      <button onClick={() => onChange(addMonth(month, 1))} className="ico-btn w-8 h-8 border-0 bg-transparent" title="Следующий месяц">
        <ChevronRight size={16} />
      </button>
    </div>
  )
}

function SalesStat({
  icon: Icon,
  label,
  value,
  foot,
  progress,
}: {
  icon: typeof Target
  label: string
  value: string
  foot: string
  progress?: number
}) {
  return (
    <div className="rounded-2xl border border-line bg-white p-4">
      <div className="flex items-center gap-2 text-muted mb-3">
        <Icon size={17} />
        <span className="text-sm font-medium">{label}</span>
      </div>
      <div className="text-[28px] leading-none font-bold text-ink mb-2">{value}</div>
      <div className="text-sm text-muted">{foot}</div>
      {progress !== undefined && <div className="mt-4"><ProgressBar value={Math.min(progress, 1)} /></div>}
    </div>
  )
}

function FunnelCard({ label, value, strong = false }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={`min-h-[112px] rounded-2xl p-4 text-white flex flex-col justify-center ${strong ? 'bg-green' : 'bg-green-d'}`}>
      <div className="text-[34px] font-bold leading-none mb-2">{num(value)}</div>
      <div className="text-base leading-snug">{label}</div>
    </div>
  )
}

function SalesObjectsTable({ rows }: { rows: SalesRow[] }) {
  return (
    <div className="min-w-0">
      <div className="text-[15px] font-semibold text-ink mb-3">Результаты по объектам продаж</div>
      {rows.length === 0 ? (
        <div className="rounded-xl border border-line p-4 text-sm text-muted">
          Пока нет настроенных объектов или отчётов за выбранный месяц.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px]">
            <thead>
              <tr className={theadRow}>
                <th className={th}>Объект продаж</th>
                <th className={thRight}>Заявки</th>
                <th className={thRight}>Сделки</th>
                <th className={thRight}>План</th>
                <th className={thRight}>Выполнение</th>
                <th className={thRight}>Сумма продаж</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.objectId ?? r.name}>
                  <td className={td}>
                    <span className="inline-block w-2 h-2 rounded-full bg-green mr-2" />
                    <span className="font-medium text-ink">{r.name}</span>
                  </td>
                  <td className={`${td} text-right tabular-nums`}>{num(r.newLeads)}</td>
                  <td className={`${td} text-right tabular-nums`}>{num(r.newDeals)}</td>
                  <td className={`${td} text-right tabular-nums`}>{num(r.planDeals)}</td>
                  <td className={`${td} text-right tabular-nums font-semibold text-ink`}>{fmtPct(r.planCompletion)}</td>
                  <td className={`${td} text-right tabular-nums font-semibold text-ink`}>{kzt(r.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function ActivityPanel({ totals, managerRows }: { totals: SalesTotals; managerRows: SalesRow[] }) {
  return (
    <div>
      <div className="text-lg font-semibold text-ink mb-4">Повторная активность</div>
      <div className="grid grid-cols-2 gap-2 mb-4 md:grid-cols-3 xl:grid-cols-6">
        <Mini label="Всего консультаций" value={num(totals.activity.totalConsultations)} />
        <Mini label="Доля повторных" value={fmtPct(totals.activity.repeatConsultationShare)} />
        <Mini label="Всего встреч" value={num(totals.activity.totalMeetings)} />
        <Mini label="Повторных встреч" value={fmtPct(totals.activity.repeatMeetingShare)} />
        <Mini label="Взаимодействий" value={num(totals.activity.totalInteractions)} />
        <Mini label="На сделку" value={fmtNum(totals.activity.interactionsPerDeal)} />
      </div>
      {managerRows.length > 0 && (
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {managerRows.slice(0, 5).map((r) => (
            <div key={r.employeeId} className="rounded-xl border border-line p-3 flex items-center gap-2">
              <span
                className="w-7 h-7 rounded-full grid place-items-center text-white text-[11px] font-bold shrink-0"
                style={{ background: r.avatarColor ?? '#057269' }}
              >
                {r.initials ?? '—'}
              </span>
              <span className="text-sm text-ink flex-1 truncate">{r.name}</span>
              <span className="text-sm font-semibold text-ink">{num(r.activity.totalInteractions)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-chip p-4">
      <div className="text-sm text-muted mb-2">{label}</div>
      <div className="text-2xl font-bold leading-none text-ink">{value}</div>
    </div>
  )
}

function Label({ children }: { children: string }) {
  return <div className="text-[11px] font-semibold text-muted uppercase tracking-wide">{children}</div>
}

function SalesSkeleton() {
  return (
    <div className="card p-5 mb-5">
      <div className="h-5 w-48 rounded bg-line animate-pulse mb-4" />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="h-32 rounded-2xl bg-line animate-pulse" />
        <div className="h-32 rounded-2xl bg-line animate-pulse" />
        <div className="h-32 rounded-2xl bg-line animate-pulse" />
      </div>
    </div>
  )
}

const fmtPct = (value: number | null) => (value === null ? '—' : pct(value, 1))
const fmtNum = (value: number | null) => (value === null ? '—' : num(value, 1))
