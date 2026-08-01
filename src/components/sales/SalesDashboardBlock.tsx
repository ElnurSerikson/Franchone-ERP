import { useState } from 'react'
import { useQuery } from 'convex/react'
import { CalendarRange, ChevronLeft, ChevronRight, CircleDollarSign, Filter, Inbox, Target } from 'lucide-react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import type { Employee, Role } from '@/types'
import Select from '@/components/ui/Select'
import DatePicker from '@/components/ui/DatePicker'
import { ProgressBar } from '@/components/ui/Progress'
import { CURRENT_MONTH, addMonth, formatMonth } from '@/lib/month'
import { kzt, num, pct, pctAuto } from '@/lib/format'
import { TODAY } from '@/lib/constants'
import {
  DEFAULT_PERIOD,
  PERIOD_OPTIONS,
  type PeriodState,
  periodLabel,
  periodRange,
} from '@/lib/period'
import { th, thRight, td, theadRow } from '@/lib/table'

// newPrepayments — этап «Подписанные договоры» (дополнение 1.4, п.4).
// Поле в базе не переименовывали: это переименование этапа, а не новый этап,
// и вся накопленная история должна остаться на месте.
type SalesTotals = {
  newLeads: number
  newConsultations: number
  repeatConsultations: number
  newMeetings: number
  repeatMeetings: number
  newPrepayments: number
  newDeals: number
  revenue: number
  planDeals: number
  planCompletion: number | null
  notReachedConsultation: number
  // Конверсии воронки — всегда число: при нулевом знаменателе 0% (п.3).
  conversions: {
    consultation: number
    meeting: number
    contract: number
    deal: number
    total: number
  }
  activity: {
    repeatConsultations: number
    repeatMeetings: number
    totalRepeatTouches: number
    totalInteractions: number
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
  month: monthProp,
}: {
  role: Role
  me: Employee
  employees?: Employee[]
  // Месяц можно задать снаружи — тогда блок берёт его у страницы и своего
  // переключателя не рисует. Два пикера периода на одном экране путают.
  month?: string
}) {
  const [ownMonth, setOwnMonth] = useState(CURRENT_MONTH)
  const month = monthProp ?? ownMonth
  const [objectId, setObjectId] = useState('all')
  const [employeeId, setEmployeeId] = useState('all')
  // §8: период выбирает сам пользователь; «Выбранный месяц» — прежнее поведение.
  const [period, setPeriod] = useState<PeriodState>(DEFAULT_PERIOD)
  const manager = role === 'owner' || role === 'head'
  const range = periodRange(period, month)

  const data = useQuery(api.sales.summary, {
    month,
    from: range.from,
    to: range.to,
    ...(objectId !== 'all' ? { objectId: objectId as Id<'salesObjects'> } : {}),
    ...(manager && employeeId !== 'all' ? { employeeId: employeeId as Id<'employees'> } : {}),
  })

  if (data === undefined) return <SalesSkeleton />
  if (!manager && me.position !== 'sales') return null

  const totals = data.totals as SalesTotals
  const objectRows = data.objectRows as SalesRow[]
  const managerRows = data.managerRows as SalesRow[]
  const objectOptions = data.objects as SalesObjectOption[]
  // План живёт в календарном месяце. За неделю или один день сравнивать факт
  // не с чем — колонки плана прячем, а не показываем прочерки.
  const planApplies = data.period.planApplies
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
          {monthProp === undefined && <MonthSwitch month={month} onChange={setOwnMonth} />}
        </div>

        <div className={`grid gap-3 ${manager ? 'lg:grid-cols-3' : 'lg:grid-cols-2'}`}>
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
                // Формулировка из §1 — режим считает только активные объекты.
                { value: 'all', label: 'Все активные объекты' },
                ...objectOptions.map((o) => ({ value: o._id, label: o.name })),
              ]}
              className="mt-1.5"
            />
          </div>
          {/* §8: фильтр периода стоит в общей панели фильтров — рядом с
              менеджером и объектом, а не в отдельном разделе. */}
          <div>
            <Label>Период</Label>
            <Select
              value={period.mode}
              onChange={(mode) => setPeriod((p) => ({ ...p, mode: mode as PeriodState['mode'] }))}
              options={PERIOD_OPTIONS}
              className="mt-1.5"
            />
          </div>
        </div>

        {period.mode === 'day' && (
          <div className="mt-3 max-w-xs">
            <Label>Дата</Label>
            <div className="mt-1.5">
              <DatePicker
                value={period.day}
                onChange={(day) => setPeriod((p) => ({ ...p, day }))}
                max={TODAY}
              />
            </div>
          </div>
        )}
        {period.mode === 'range' && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 max-w-xl">
            <div>
              <Label>Начало</Label>
              <div className="mt-1.5">
                <DatePicker
                  value={period.from}
                  onChange={(from) => setPeriod((p) => ({ ...p, from }))}
                  max={TODAY}
                />
              </div>
            </div>
            <div>
              <Label>Конец</Label>
              <div className="mt-1.5">
                <DatePicker
                  value={period.to}
                  onChange={(to) => setPeriod((p) => ({ ...p, to }))}
                  max={TODAY}
                />
              </div>
            </div>
          </div>
        )}

        <div className="mt-3 mb-5 flex items-center gap-2 text-sm text-muted">
          <CalendarRange size={15} className="text-green shrink-0" />
          <span>
            Период расчёта: <span className="text-ink font-medium">{periodLabel(range.from, range.to)}</span>
            {period.mode === 'range' && period.from > period.to && ' · даты переставлены местами'}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3 mb-6">
          {planApplies ? (
            <SalesStat
              icon={Target}
              label="План продаж"
              value={`${num(totals.newDeals)} из ${num(totals.planDeals)}`}
              foot={`Выполнено ${fmtPct(totals.planCompletion)}`}
              progress={progress}
            />
          ) : (
            <SalesStat
              icon={Target}
              label="Сделки за период"
              value={num(totals.newDeals)}
              foot="План задаётся на календарный месяц"
            />
          )}
          <SalesStat
            icon={CircleDollarSign}
            label="Сумма продаж"
            value={kzt(totals.revenue)}
            foot="Оплаты за выбранный период"
          />
          <SalesStat
            icon={Inbox}
            label="Не доведено до консультации"
            value={num(totals.notReachedConsultation)}
            foot={`Из ${num(totals.newLeads)} новых заявок`}
          />
        </div>

        <div>
          <div className="text-[15px] font-semibold text-ink">LIVE-воронка</div>
          {/* §2: воронка показывает переход между соседними этапами, а не долю
              от общего числа заявок. Поэтому конверсия живёт на карточке
              своего этапа, а «Заявки» — всегда 100%. */}
          <p className="text-xs text-muted mt-1 mb-3">
            Конверсия каждого этапа считается от предыдущего. Первый этап «Заявки» — 100%.
          </p>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <FunnelCard label="Заявки" value={totals.newLeads} conversion={1} hint="начало воронки" />
            <FunnelCard
              label="Консультации"
              value={totals.newConsultations}
              conversion={totals.conversions.consultation}
              hint="от заявок"
            />
            <FunnelCard
              label="Встречи / Zoom"
              value={totals.newMeetings}
              conversion={totals.conversions.meeting}
              hint="от консультаций"
            />
            <FunnelCard
              label="Подписанные договоры"
              value={totals.newPrepayments}
              conversion={totals.conversions.contract}
              hint="от встреч"
            />
            <FunnelCard
              label="Сделки"
              value={totals.newDeals}
              conversion={totals.conversions.deal}
              hint="от договоров"
              strong
            />
          </div>
          {/* §3: общая конверсия считается отдельно от воронки — и показана
              отдельно, чтобы её не путали с последним переходом. */}
          <div className="mt-4 rounded-2xl border border-line bg-chip p-4 flex items-center justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-ink">Общая конверсия в сделку</div>
              <div className="text-xs text-muted mt-0.5">
                Считается отдельно от воронки: сделки ÷ заявки — {num(totals.newDeals)} из{' '}
                {num(totals.newLeads)}
              </div>
            </div>
            <div className="text-[28px] leading-none font-bold text-green-d tabular-nums">
              {pctAuto(totals.conversions.total)}
            </div>
          </div>
        </div>
      </section>

      <section className="card p-5">
        <SalesObjectsTable rows={objectRows} planApplies={planApplies} />
      </section>

      <section className="card p-5">
        <ActivityPanel totals={totals} />
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

// Карточка этапа воронки: количество и конверсия ЭТОГО этапа от предыдущего
// (§2). Подпись «от заявок / от консультаций / …» снимает вопрос, от чего
// именно посчитан процент.
function FunnelCard({
  label,
  value,
  conversion,
  hint,
  strong = false,
}: {
  label: string
  value: number
  conversion: number
  hint: string
  strong?: boolean
}) {
  return (
    <div className={`min-h-[112px] rounded-2xl p-4 text-white flex flex-col ${strong ? 'bg-green' : 'bg-green-d'}`}>
      <div className="text-[34px] font-bold leading-none mb-2">{num(value)}</div>
      <div className="text-base leading-snug flex-1">{label}</div>
      {/* Процент и подпись — в столбик: на узкой карточке строка «50% от
          консультаций» рвалась посередине фразы. */}
      <div className="mt-3 pt-2.5 border-t border-white/25">
        <div className="text-lg font-semibold leading-none tabular-nums">{pctAuto(conversion)}</div>
        <div className="text-[11px] text-white/75 leading-tight mt-1">{hint}</div>
      </div>
    </div>
  )
}

function SalesObjectsTable({ rows, planApplies }: { rows: SalesRow[]; planApplies: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[15px] font-semibold text-ink mb-3">Результаты по объектам продаж</div>
      {rows.length === 0 ? (
        <div className="rounded-xl border border-line p-4 text-sm text-muted">
          Пока нет настроенных объектов или отчётов за выбранный период.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px]">
            <thead>
              <tr className={theadRow}>
                <th className={th}>Объект продаж</th>
                <th className={thRight}>Заявки</th>
                <th className={thRight}>Сделки</th>
                {/* §6: конверсия объекта — его собственные сделки ÷ заявки.
                    В общий итог она не усредняется. */}
                <th className={thRight}>Конверсия</th>
                {planApplies && <th className={thRight}>План</th>}
                {planApplies && <th className={thRight}>Выполнение</th>}
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
                  <td className={`${td} text-right tabular-nums`}>{pctAuto(r.conversions.total)}</td>
                  {planApplies && <td className={`${td} text-right tabular-nums`}>{num(r.planDeals)}</td>}
                  {planApplies && (
                    <td className={`${td} text-right tabular-nums font-semibold text-ink`}>
                      {fmtPct(r.planCompletion)}
                    </td>
                  )}
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

// Блок активности — ровно четыре цифры (дополнение 1.4, п.7). Он не должен
// повторять показатели и конверсии воронки, поэтому долей, средних и рейтинга
// менеджеров здесь больше нет.
function ActivityPanel({ totals }: { totals: SalesTotals }) {
  const a = totals.activity
  return (
    <div>
      <div className="text-lg font-semibold text-ink mb-4">Активность менеджера</div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Mini label="Повторные консультации" value={num(a.repeatConsultations)} />
        <Mini label="Повторные встречи / Zoom" value={num(a.repeatMeetings)} />
        <Mini label="Всего повторных касаний" value={num(a.totalRepeatTouches)} />
        <Mini label="Всего взаимодействий" value={num(a.totalInteractions)} />
      </div>
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

// Прочерк — там, где делить не на что (выполнение плана без плана).
const fmtPct = (value: number | null) => (value === null ? '—' : pct(value, 1))
