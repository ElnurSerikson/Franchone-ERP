import { useState } from 'react'
import { useQuery } from 'convex/react'
import { CalendarRange, ChevronRight, Loader2, Target, TrendingUp, Wallet, X } from 'lucide-react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import Select from '@/components/ui/Select'
import DatePicker from '@/components/ui/DatePicker'
import LineChart, { type ChartSeries } from '@/components/ui/LineChart'
import { goalMeta } from '../../../convex/campaignGoals'
import { num, pctAuto, usd, usdCost, longDate } from '@/lib/format'
import { TODAY } from '@/lib/constants'
import { CURRENT_MONTH, formatMonth } from '@/lib/month'
import { th, thRight, td, theadRow } from '@/lib/table'

// План-факт таргетолога по объектам продаж (ТАРГЕТ 1.6 §9, §13, §14).
//
// §13.4: официальный KPI считается только по полному календарному месяцу.
// Показатель за день, 7/14 дней или произвольный диапазон — оперативная
// управленческая аналитика, месячный KPI она не меняет.

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

// §13.2: пять вариантов периода.
type Mode = 'month' | 'd7' | 'd14' | 'day' | 'range'
const MODES: { value: Mode; label: string }[] = [
  { value: 'month', label: 'Текущий месяц' },
  { value: 'd7', label: 'Последние 7 дней' },
  { value: 'd14', label: 'Последние 14 дней' },
  { value: 'day', label: 'Конкретный день' },
  { value: 'range', label: 'Произвольный период' },
]

const ALL = 'all'

function shift(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
function monthEnd(ym: string) {
  const [y, m] = ym.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}

// §13.3: план периода может быть дробным — показываем один знак после запятой.
// Факт всегда целый.
const planNum = (v: number | null) =>
  v === null ? '—' : Number.isInteger(v) ? num(v) : num(v, 1)

export default function TargetLeadsPanel({ manager }: { manager: boolean }) {
  const [mode, setMode] = useState<Mode>('month')
  const [day, setDay] = useState(TODAY)
  const [from, setFrom] = useState(shift(TODAY, -6))
  const [to, setTo] = useState(TODAY)
  const [employeeId, setEmployeeId] = useState(ALL)
  const [objectId, setObjectId] = useState(ALL)
  const [detail, setDetail] = useState<Id<'salesObjects'> | null>(null)

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

  if (data === undefined) {
    return (
      <div className="card p-10 grid place-items-center text-muted">
        <Loader2 className="animate-spin" size={20} />
      </div>
    )
  }

  const rows = data.rows as Row[]
  const t = data.totals
  const whole = data.period.wholeMonth

  return (
    <div className="flex flex-col gap-5">
      <section className="card p-5">
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <Target size={17} className="text-green" />
          <h3 className="sec-title flex-1">KPI таргетолога · план-факт по заявкам</h3>
        </div>

        <div className={`grid gap-3 ${manager ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
          <Field label="Период">
            <Select value={mode} onChange={(v) => setMode(v as Mode)} options={MODES} />
          </Field>
          {manager && (
            <Field label="Таргетолог">
              <Select
                value={employeeId}
                onChange={setEmployeeId}
                options={[
                  { value: ALL, label: 'Все таргетологи' },
                  ...data.targetologs.map((e) => ({ value: e._id, label: e.name })),
                ]}
              />
            </Field>
          )}
          <Field label="Объект продаж">
            <Select
              value={objectId}
              onChange={setObjectId}
              options={[
                { value: ALL, label: 'Все активные объекты' },
                ...data.objects.map((o) => ({ value: o._id, label: o.name })),
              ]}
            />
          </Field>
        </div>

        {mode === 'day' && (
          <div className="mt-3 max-w-xs">
            <Field label="Дата">
              <DatePicker value={day} onChange={setDay} max={TODAY} />
            </Field>
          </div>
        )}
        {mode === 'range' && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 max-w-xl">
            <Field label="С даты">
              <DatePicker value={from} onChange={setFrom} max={TODAY} />
            </Field>
            <Field label="По дату">
              <DatePicker value={to} onChange={setTo} max={TODAY} />
            </Field>
          </div>
        )}

        <div className="mt-3 flex items-start gap-2 text-sm text-muted">
          <CalendarRange size={15} className="text-green shrink-0 mt-0.5" />
          <span>
            {range.from === range.to ? (
              <>Период: <b className="text-ink font-medium">{longDate(range.from)}</b></>
            ) : (
              <>
                Период:{' '}
                <b className="text-ink font-medium">
                  {longDate(range.from)} — {longDate(range.to)}
                </b>
              </>
            )}
            {!whole && (
              // §13.3 и §13.4: за неполный период план пересчитан пропорционально
              // календарным дням, а официальный месячный KPI не меняется.
              <span className="block text-xs text-muted-2 mt-0.5">
                План периода пересчитан пропорционально дням. Это оперативная аналитика —
                официальный KPI считается по полному календарному месяцу.
              </span>
            )}
          </span>
        </div>
      </section>

      {/* §13.5: сводный результат по компании над таблицей объектов. */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Stat
          highlight
          icon={Target}
          label="Заявки план / факт"
          value={`${num(t.factLeads)} из ${planNum(t.planLeads)}`}
          foot={
            t.completion === null
              ? 'план не установлен'
              : `выполнение ${pctAuto(t.completion)}`
          }
        />
        <Stat
          icon={Wallet}
          label="Рекламный расход"
          value={usd(t.factBudgetCents)}
          foot={
            t.planBudgetCents === null
              ? 'плановый бюджет не задан'
              : `план ${usd(t.planBudgetCents)}`
          }
        />
        <Stat
          icon={TrendingUp}
          label="Средняя цена заявки"
          value={t.factLeads > 0 ? usd(t.factCostCents ?? 0) : 'Нет заявок'}
          foot={t.planCostCents === null ? 'плановой цены нет' : `план ${usd(t.planCostCents)}`}
        />
        <Stat
          icon={Target}
          label={whole ? 'KPI за месяц' : 'KPI (только за месяц)'}
          value={data.kpi === null ? '—' : pctAuto(data.kpi)}
          foot={
            whole
              ? `вес показателя ${pctAuto(data.weight)}`
              : `официальный KPI — за ${formatMonth(CURRENT_MONTH)}`
          }
        />
      </div>

      <section>
        <h3 className="sec-title mb-3">Объекты продаж</h3>
        <div className="card overflow-hidden overflow-x-auto">
          {rows.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted">
              За выбранный период ни планов, ни заявок, ни расхода нет.
            </div>
          ) : (
            <table className="w-full min-w-[900px]">
              <thead>
                <tr className={theadRow}>
                  <th className={th}>Объект</th>
                  <th className={thRight}>План</th>
                  <th className={thRight}>Факт</th>
                  <th className={thRight}>Выполнение</th>
                  <th className={thRight}>Бюджет план / факт</th>
                  <th className={thRight}>Цена заявки план / факт</th>
                  <th className={th}>Статус</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.objectId} className="hover:bg-chip/40 transition-colors">
                    <td className={td}>
                      <span className="font-medium text-ink whitespace-nowrap">{r.name}</span>
                    </td>
                    <td className={`${td} text-right tabular-nums`}>{planNum(r.planLeads)}</td>
                    <td className={`${td} text-right tabular-nums`}>{num(r.factLeads)}</td>
                    <td className={`${td} text-right tabular-nums font-semibold text-ink`}>
                      {/* §9: в строке объекта выполнение может быть выше 100%. */}
                      {r.completion === null ? '—' : pctAuto(r.completion)}
                    </td>
                    <td className={`${td} text-right tabular-nums whitespace-nowrap`}>
                      {r.planBudgetCents === null ? '—' : usd(r.planBudgetCents)} /{' '}
                      {usd(r.factBudgetCents)}
                    </td>
                    <td className={`${td} text-right tabular-nums whitespace-nowrap`}>
                      {r.planCostCents === null ? '—' : usd(r.planCostCents)} /{' '}
                      {/* §16: расход есть, заявок нет — «Нет заявок». */}
                      {r.factLeads > 0 ? usd(r.factCostCents ?? 0) : 'Нет заявок'}
                    </td>
                    <td className={td}>
                      <span className={`chip whitespace-nowrap ${STATUS[r.status].chip}`}>
                        {STATUS[r.status].label}
                      </span>
                    </td>
                    <td className={`${td} text-right`}>
                      <button
                        onClick={() => setDetail(r.objectId)}
                        className="mini-btn whitespace-nowrap"
                        title="Аналитика по объекту"
                      >
                        Детали <ChevronRight size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <p className="text-xs text-muted mt-2">
          Объекты без установленного плана показаны в аналитике, но в расчёт KPI не входят.
          Перевыполнение одного объекта не компенсирует невыполнение другого: вклад каждого
          ограничен его планом.
        </p>
      </section>

      {detail && (
        <ObjectDetailDrawer
          objectId={detail}
          from={range.from}
          to={range.to}
          employeeId={employeeId !== ALL ? (employeeId as Id<'employees'>) : undefined}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  )
}

// §14: расширенная аналитика по объекту — динамика заявок, расхода и средней
// цены заявки плюс связанные кампании с их собственными результатами.
function ObjectDetailDrawer({
  objectId,
  from,
  to,
  employeeId,
  onClose,
}: {
  objectId: Id<'salesObjects'>
  from: string
  to: string
  employeeId?: Id<'employees'>
  onClose: () => void
}) {
  const data = useQuery(api.targetLeads.objectDetail, {
    objectId,
    from,
    to,
    ...(employeeId ? { employeeId } : {}),
  })

  const daily = data?.daily ?? []
  const series: ChartSeries[] = [
    {
      id: 'leads',
      label: 'Заявки за день',
      points: daily.map((d) => ({ x: d.date, y: d.leads, hint: `${num(d.leads)} заявок` })),
    },
  ]
  const money: ChartSeries[] = [
    {
      id: 'budget',
      label: 'Расход за день, $',
      points: daily.map((d) => ({ x: d.date, y: d.budgetCents / 100, hint: usd(d.budgetCents) })),
    },
    {
      id: 'cost',
      label: 'Цена заявки, $',
      points: daily.map((d) => ({
        x: d.date,
        y: d.costCents === null ? null : d.costCents / 100,
        hint: d.costCents === null ? 'Нет заявок' : usd(d.costCents),
      })),
    },
  ]

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-4xl h-full bg-bg flex flex-col">
        <div className="shrink-0 bg-white border-b border-line px-5 sm:px-6 py-4 flex items-center gap-3">
          <span className="w-9 h-9 rounded-xl bg-[#e2f2ef] text-green-d grid place-items-center shrink-0">
            <Target size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold text-ink truncate">
              {data?.objectName ?? 'Объект продаж'}
            </h2>
            <p className="text-[11px] text-muted">
              {longDate(from)} — {longDate(to)}
            </p>
          </div>
          <button onClick={onClose} className="ico-btn w-9 h-9" aria-label="Закрыть">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-5 flex flex-col gap-5">
          {data === undefined ? (
            <div className="py-10 grid place-items-center text-muted">
              <Loader2 className="animate-spin" size={18} />
            </div>
          ) : data === null ? (
            <p className="text-sm text-muted">Нет доступа к этому объекту.</p>
          ) : (
            <>
              {data.summary && (
                <div className="grid gap-3 sm:grid-cols-3">
                  <Mini
                    label="Заявки план / факт"
                    value={`${num(data.summary.factLeads)} из ${planNum(data.summary.planLeads)}`}
                  />
                  <Mini label="Расход" value={usd(data.summary.factBudgetCents)} />
                  <Mini
                    label="Средняя цена заявки"
                    value={
                      data.summary.factLeads > 0
                        ? usd(data.summary.factCostCents ?? 0)
                        : 'Нет заявок'
                    }
                  />
                </div>
              )}

              <section className="card p-5">
                <h3 className="sec-title mb-1">Динамика заявок по дням</h3>
                <p className="text-xs text-muted mb-4">
                  Заявки учитываются на уровне объекта продаж целиком, без разбивки по
                  кампаниям и целям.
                </p>
                <LineChart
                  series={series}
                  formatY={(v) => num(v)}
                  emptyHint="За период заявок не вносили"
                />
              </section>

              <section className="card p-5">
                <h3 className="sec-title mb-1">Расход и цена заявки по дням</h3>
                <p className="text-xs text-muted mb-4">
                  Цена заявки — расход по объекту за день ÷ заявки за тот же день.
                </p>
                <LineChart
                  series={money}
                  formatY={(v) => '$' + v.toFixed(2)}
                  emptyHint="За период расхода не было"
                />
              </section>

              <section>
                <h3 className="sec-title mb-3">Связанные рекламные кампании</h3>
                <div className="card overflow-hidden overflow-x-auto">
                  {data.campaigns.length === 0 ? (
                    <div className="p-6 text-center text-sm text-muted">
                      На этот объект реклама не запускалась.
                    </div>
                  ) : (
                    <table className="w-full min-w-[620px]">
                      <thead>
                        <tr className={theadRow}>
                          <th className={th}>Кампания</th>
                          <th className={th}>Цель</th>
                          <th className={thRight}>Расход</th>
                          <th className={thRight}>Результат</th>
                          <th className={thRight}>Цена результата</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.campaigns.map((c) => (
                          <tr key={c.campaignId}>
                            <td className={td}>
                              <div className="font-medium text-ink">{c.name}</div>
                              <div className="text-[11px] text-muted">{c.status}</div>
                            </td>
                            <td className={td}>
                              <div className="text-ink-2 whitespace-nowrap">
                                {goalMeta(c.goal ?? undefined).label}
                              </div>
                              <div className="text-[11px] text-muted whitespace-nowrap">
                                {goalMeta(c.goal ?? undefined).metric}
                              </div>
                            </td>
                            <td className={`${td} text-right tabular-nums`}>{usd(c.budgetCents)}</td>
                            <td className={`${td} text-right tabular-nums`}>{num(c.result)}</td>
                            <td
                              className={`${td} text-right tabular-nums font-semibold text-ink whitespace-nowrap`}
                            >
                              {usdCost(c.costCents)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
                <p className="text-xs text-muted mt-2">
                  На уровне кампании показаны только расход и её собственный технический
                  результат. Стоимость бизнес-заявки здесь не считается — общее число заявок
                  объекта между кампаниями не распределяется.
                </p>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Stat({
  icon: Icon,
  label,
  value,
  foot,
  highlight = false,
}: {
  icon: typeof Target
  label: string
  value: string
  foot: string
  highlight?: boolean
}) {
  return (
    <div className={`rounded-2xl border p-4 ${highlight ? 'border-green bg-[#e2f2ef]' : 'border-line bg-white'}`}>
      <div className="flex items-center gap-2 text-muted mb-3">
        <Icon size={16} />
        <span className="text-sm font-medium">{label}</span>
      </div>
      <div className="text-2xl leading-none font-bold text-ink mb-2">{value}</div>
      <div className="text-xs text-muted">{foot}</div>
    </div>
  )
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white border border-line p-4">
      <div className="text-xs text-muted mb-1.5">{label}</div>
      <div className="text-xl font-bold text-ink tabular-nums">{value}</div>
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
