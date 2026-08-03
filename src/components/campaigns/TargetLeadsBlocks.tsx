import { useState } from 'react'
import { useQuery } from 'convex/react'
import { Link } from 'react-router-dom'
import { CalendarRange, ChevronRight, Target } from 'lucide-react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import Select from '@/components/ui/Select'
import DatePicker from '@/components/ui/DatePicker'
import { num, pctAuto, usd } from '@/lib/format'
import { TODAY } from '@/lib/constants'
import { CURRENT_MONTH, formatMonth } from '@/lib/month'
import { th, thRight, td, theadRow } from '@/lib/table'

// Дашбордные блоки модуля заявок (ТАРГЕТ 1.6 §12 и §13).

type Row = {
  objectId: Id<'salesObjects'>
  name: string
  planLeads: number | null
  factLeads: number
  completion: number | null
  planBudgetCents: number | null
  factBudgetCents: number
  planCostCents: number | null
  factCostCents: number | null
  status: 'done' | 'risk' | 'fail' | 'noplan'
}

const STATUS: Record<Row['status'], { label: string; chip: string }> = {
  done: { label: 'Выполнено', chip: 'bg-[#e2f2ef] text-green-d' },
  risk: { label: 'Риск невыполнения', chip: 'bg-[#fff6e6] text-[#b7791f]' },
  fail: { label: 'Не выполнено', chip: 'bg-[#fdeaea] text-[#c53030]' },
  noplan: { label: 'Без плана', chip: 'bg-chip text-muted' },
}

const planNum = (v: number | null) =>
  v === null ? '—' : Number.isInteger(v) ? num(v) : num(v, 1)

function shift(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
function monthEnd(ym: string) {
  const [y, m] = ym.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}

// §12: компактный KPI-блок на личном дашборде таргетолога. Всегда за текущий
// календарный месяц — именно он идёт в мотивацию.
export function MyTargetLeadsBlock() {
  const data = useQuery(api.targetLeads.myMonth, {})
  if (!data) return null

  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <Target size={17} className="text-green" />
        <h3 className="sec-title flex-1">Мой KPI · заявки по объектам</h3>
        <Link to="/kpi" className="mini-btn whitespace-nowrap">
          Подробно <ChevronRight size={13} />
        </Link>
      </div>
      <p className="text-xs text-muted mb-4">за {formatMonth(data.month)}</p>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Mini
          label="Заявки план / факт"
          value={`${num(data.factLeads)} из ${planNum(data.planLeads || null)}`}
        />
        <Mini
          label="Выполнение плана"
          value={data.completion === null ? '—' : pctAuto(data.completion)}
        />
        <Mini
          label="Расход"
          value={usd(data.factBudgetCents)}
          foot={data.planBudgetCents === null ? 'плана нет' : `план ${usd(data.planBudgetCents)}`}
        />
        <Mini
          label="Цена заявки"
          value={data.factLeads > 0 ? usd(data.factCostCents ?? 0) : 'Нет заявок'}
        />
      </div>

      <div className="mt-4 pt-3 border-t border-line flex items-center justify-between gap-3 flex-wrap">
        <span className="text-sm text-muted">
          Итоговый KPI · вес показателя {pctAuto(data.weight)}
        </span>
        <span className="text-2xl font-bold text-green-d tabular-nums">
          {data.kpi === null ? '—' : pctAuto(data.kpi)}
        </span>
      </div>
      {data.completion === null && (
        <p className="text-[11px] text-muted-2 mt-2">
          План на этот месяц не установлен — оклад выплачивается полностью.
        </p>
      )}
    </div>
  )
}

// §13: управленческий блок «KPI таргетолога» на дашборде администратора.
type Mode = 'month' | 'd7' | 'd14' | 'day' | 'range'
const MODES: { value: Mode; label: string }[] = [
  { value: 'month', label: 'Текущий месяц' },
  { value: 'd7', label: 'Последние 7 дней' },
  { value: 'd14', label: 'Последние 14 дней' },
  { value: 'day', label: 'Конкретный день' },
  { value: 'range', label: 'Произвольный период' },
]
const ALL = 'all'

export function AdminTargetLeadsBlock() {
  const [mode, setMode] = useState<Mode>('month')
  const [day, setDay] = useState(TODAY)
  const [from, setFrom] = useState(shift(TODAY, -6))
  const [to, setTo] = useState(TODAY)
  const [employeeId, setEmployeeId] = useState(ALL)
  const [objectId, setObjectId] = useState(ALL)

  const range =
    mode === 'd7'
      ? { from: shift(TODAY, -6), to: TODAY }
      : mode === 'd14'
        ? { from: shift(TODAY, -13), to: TODAY }
        : mode === 'day'
          ? { from: day, to: day }
          : mode === 'range'
            ? from <= to
              ? { from, to }
              : { from: to, to: from }
            : { from: `${CURRENT_MONTH}-01`, to: monthEnd(CURRENT_MONTH) }

  const data = useQuery(api.targetLeads.overview, {
    from: range.from,
    to: range.to,
    ...(employeeId !== ALL ? { employeeId: employeeId as Id<'employees'> } : {}),
    ...(objectId !== ALL ? { objectId: objectId as Id<'salesObjects'> } : {}),
  })

  const rows = (data?.rows ?? []) as Row[]
  const t = data?.totals
  // Блок пустой, пока в компании нет ни одного таргетолога с данными.
  if (data && rows.length === 0 && data.targetologs.length === 0) return null

  return (
    <div className="card p-5 mb-5">
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <Target size={17} className="text-green" />
        <h3 className="sec-title flex-1">KPI таргетолога · заявки по объектам</h3>
        <Link to="/kpi" className="mini-btn whitespace-nowrap">
          В раздел KPI <ChevronRight size={13} />
        </Link>
      </div>

      {/* §13.2: период плюс фильтры по таргетологу и объекту продаж. */}
      <div className="grid gap-3 md:grid-cols-3 mb-3">
        <Field label="Период">
          <Select value={mode} onChange={(v) => setMode(v as Mode)} options={MODES} />
        </Field>
        <Field label="Таргетолог">
          <Select
            value={employeeId}
            onChange={setEmployeeId}
            options={[
              { value: ALL, label: 'Все таргетологи' },
              ...(data?.targetologs ?? []).map((e) => ({ value: e._id, label: e.name })),
            ]}
          />
        </Field>
        <Field label="Объект продаж">
          <Select
            value={objectId}
            onChange={setObjectId}
            options={[
              { value: ALL, label: 'Все активные объекты' },
              ...(data?.objects ?? []).map((o) => ({ value: o._id, label: o.name })),
            ]}
          />
        </Field>
      </div>

      {mode === 'day' && (
        <div className="max-w-xs mb-3">
          <Field label="Дата">
            <DatePicker value={day} onChange={setDay} max={TODAY} />
          </Field>
        </div>
      )}
      {mode === 'range' && (
        <div className="grid gap-3 sm:grid-cols-2 max-w-xl mb-3">
          <Field label="С даты">
            <DatePicker value={from} onChange={setFrom} max={TODAY} />
          </Field>
          <Field label="По дату">
            <DatePicker value={to} onChange={setTo} max={TODAY} />
          </Field>
        </div>
      )}

      {/* §13.5: сводный результат по компании над таблицей объектов. */}
      {t && (
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4 mb-4">
          <Mini
            label="Заявки план / факт"
            value={`${num(t.factLeads)} из ${planNum(t.planLeads || null)}`}
          />
          <Mini
            label="Выполнение"
            value={t.completion === null ? '—' : pctAuto(t.completion)}
          />
          <Mini
            label="Расход"
            value={usd(t.factBudgetCents)}
            foot={t.planBudgetCents === null ? 'плана нет' : `план ${usd(t.planBudgetCents)}`}
          />
          <Mini
            label="Цена заявки"
            value={t.factLeads > 0 ? usd(t.factCostCents ?? 0) : 'Нет заявок'}
          />
        </div>
      )}

      {data && !data.period.wholeMonth && (
        <div className="flex items-start gap-2 text-xs text-muted mb-3">
          <CalendarRange size={14} className="text-green shrink-0 mt-0.5" />
          <span>
            План периода пересчитан пропорционально календарным дням. Официальный месячный
            KPI от этого не меняется.
          </span>
        </div>
      )}

      <div className="rounded-xl border border-line overflow-hidden overflow-x-auto">
        {rows.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted">
            На выбранный период планы по объектам не выставлены.
          </div>
        ) : (
          <table className="w-full min-w-[820px]">
            <thead>
              <tr className={theadRow}>
                <th className={th}>Объект продаж</th>
                <th className={thRight}>План</th>
                <th className={thRight}>Факт</th>
                <th className={thRight}>Выполнение</th>
                <th className={thRight}>Плановый бюджет</th>
                <th className={thRight}>Расход</th>
                <th className={thRight}>Цена заявки</th>
                <th className={th}>Статус</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.objectId}>
                  <td className={td}>
                    <span className="font-medium text-ink whitespace-nowrap">{r.name}</span>
                  </td>
                  <td className={`${td} text-right tabular-nums`}>{planNum(r.planLeads)}</td>
                  <td className={`${td} text-right tabular-nums`}>{num(r.factLeads)}</td>
                  <td className={`${td} text-right tabular-nums font-semibold text-ink`}>
                    {r.completion === null ? '—' : pctAuto(r.completion)}
                  </td>
                  <td className={`${td} text-right tabular-nums`}>
                    {r.planBudgetCents === null ? '—' : usd(r.planBudgetCents)}
                  </td>
                  <td className={`${td} text-right tabular-nums`}>{usd(r.factBudgetCents)}</td>
                  <td className={`${td} text-right tabular-nums whitespace-nowrap`}>
                    {r.factLeads > 0 ? usd(r.factCostCents ?? 0) : 'Нет заявок'}
                  </td>
                  <td className={td}>
                    <span className={`chip whitespace-nowrap ${STATUS[r.status].chip}`}>
                      {STATUS[r.status].label}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function Mini({ label, value, foot }: { label: string; value: string; foot?: string }) {
  return (
    <div className="rounded-xl bg-chip p-3">
      <div className="text-[11px] text-muted mb-1">{label}</div>
      <div className="text-lg font-bold leading-none text-ink tabular-nums">{value}</div>
      {foot && <div className="text-[11px] text-muted-2 mt-1">{foot}</div>}
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
