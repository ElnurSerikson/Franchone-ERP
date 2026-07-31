import { useState } from 'react'
import { useQuery } from 'convex/react'
import { Filter, Wallet, Building2, Handshake } from 'lucide-react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import Select from '@/components/ui/Select'
import StatCard from '@/components/ui/StatCard'
import LineChart, { type ChartSeries } from '@/components/ui/LineChart'
import TargetReportsPanel from './TargetReportsPanel'
import DatePicker from '@/components/ui/DatePicker'
import { CAMPAIGN_GOALS, goalMeta } from '../../../convex/campaignGoals'
import { num, usd, usdCost } from '@/lib/format'
import { TODAY } from '@/lib/constants'
import { th, thRight, td, theadRow } from '@/lib/table'

// Дашборд рекламы (ТЗ таргетолога §11–§12). Единого показателя «всего
// результатов» наверху нет намеренно: сообщения, лиды, охваты и переходы —
// разные единицы, и складывать их §11.2 прямо запрещает.

const ALL = 'all'

function monthStart(date: string) {
  return `${date.slice(0, 7)}-01`
}

export default function TargetologDashboard() {
  const [from, setFrom] = useState(monthStart(TODAY))
  const [to, setTo] = useState(TODAY)
  const [objectId, setObjectId] = useState(ALL)
  const [campaignId, setCampaignId] = useState(ALL)
  const [goal, setGoal] = useState(ALL)
  const [account, setAccount] = useState(ALL)
  const [moneySource, setMoneySource] = useState(ALL)
  const [status, setStatus] = useState(ALL)

  const registry = useQuery(api.target.registry, {})
  const objects = useQuery(api.target.objectOptions, {})
  const data = useQuery(
    api.target.dashboard,
    from <= to
      ? {
          from,
          to,
          ...(objectId !== ALL ? { objectId: objectId as Id<'salesObjects'> } : {}),
          ...(campaignId !== ALL ? { campaignId: campaignId as Id<'campaigns'> } : {}),
          ...(goal !== ALL ? { goal } : {}),
          ...(account !== ALL ? { account } : {}),
          ...(moneySource !== ALL ? { moneySource } : {}),
          ...(status !== ALL ? { status } : {}),
        }
      : 'skip',
  )

  const accounts = [...new Set((registry ?? []).map((c) => c.account))].sort()

  const series: ChartSeries[] = ((data?.series ?? []) as SeriesRow[]).map((s) => ({
    id: s.campaignId,
    label: `${s.code} · ${goalMeta(s.goal ?? undefined).metric}`,
    points: s.points.map((p) => ({
      x: p.date,
      y: p.costCents === null ? null : p.costCents / 100,
      hint: `${usd(p.budgetCents)} · ${num(p.result)} → ${usdCost(p.costCents)}`,
    })),
  }))

  return (
    <div className="flex flex-col gap-5">
      <section className="card p-5">
        <div className="flex items-center gap-2 mb-4">
          <Filter size={17} className="text-green" />
          <h3 className="sec-title flex-1">Реклама · период и разрезы</h3>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Field label="С даты">
            <DatePicker value={from} onChange={setFrom} max={to} />
          </Field>
          <Field label="По дату">
            <DatePicker value={to} onChange={setTo} min={from} max={TODAY} />
          </Field>
          <Field label="Объект продаж">
            <Select
              value={objectId}
              onChange={(v) => {
                setObjectId(v)
                setCampaignId(ALL)
              }}
              options={[
                { value: ALL, label: 'Все объекты' },
                ...(objects ?? []).map((o) => ({ value: o._id, label: o.name })),
              ]}
            />
          </Field>
          <Field label="Кампания">
            <Select
              value={campaignId}
              onChange={setCampaignId}
              options={[
                { value: ALL, label: 'Все кампании' },
                ...(registry ?? [])
                  .filter((c) => objectId === ALL || c.objectId === objectId)
                  .map((c) => ({ value: c._id, label: `${c.code} · ${c.objectName ?? c.campaign}` })),
              ]}
            />
          </Field>
          <Field label="Цель">
            <Select
              value={goal}
              onChange={setGoal}
              options={[
                { value: ALL, label: 'Все цели' },
                ...CAMPAIGN_GOALS.map((g) => ({ value: g.slug, label: g.label })),
              ]}
            />
          </Field>
          <Field label="Аккаунт">
            <Select
              value={account}
              onChange={setAccount}
              options={[
                { value: ALL, label: 'Все аккаунты' },
                ...accounts.map((a) => ({ value: a, label: a })),
              ]}
            />
          </Field>
          <Field label="Источник денег">
            <Select
              value={moneySource}
              onChange={setMoneySource}
              options={[
                { value: ALL, label: 'Любой' },
                { value: 'FRANCHONE', label: 'Деньги FRANCHONE' },
                { value: 'Партнёр', label: 'Деньги партнёра' },
              ]}
            />
          </Field>
          <Field label="Статус кампании">
            <Select
              value={status}
              onChange={setStatus}
              options={[
                { value: ALL, label: 'Любой' },
                { value: 'Активна', label: 'Активна' },
                { value: 'Пауза', label: 'Пауза' },
                { value: 'Завершена', label: 'Завершена' },
              ]}
            />
          </Field>
        </div>
      </section>

      {/* §11.2: наверху только деньги — общий расход и его разделение по
          источнику. Общего числа результатов здесь нет и быть не может. */}
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          highlight
          label="Потрачено всего"
          value={usd(data?.totalBudgetCents ?? 0)}
          foot="за выбранный период"
          icon={Wallet}
        />
        <StatCard
          label="Деньги FRANCHONE"
          value={usd(data?.franchoneBudgetCents ?? 0)}
          foot="собственный бюджет"
          icon={Building2}
        />
        <StatCard
          label="Деньги партнёров"
          value={usd(data?.partnerBudgetCents ?? 0)}
          foot="партнёрский бюджет"
          icon={Handshake}
        />
      </div>

      <section className="card p-5">
        <h3 className="sec-title mb-1">Динамика стоимости результата</h3>
        <p className="text-xs text-muted mb-4">
          Линия на кампанию. Разные цели сравниваем визуально — складывать их результаты нельзя.
        </p>
        <LineChart
          series={series}
          formatY={(v) => '$' + v.toFixed(2)}
          emptyHint="За выбранный период отчётов нет"
        />
      </section>

      {/* Заголовка у сводки нет намеренно: строка колонок и так говорит, что
          это разрез «объект × цель × аккаунт × источник денег». Лишняя белая
          полоса над зелёной шапкой только утяжеляла бы экран. */}
      <section className="card overflow-hidden">
        {(data?.rows ?? []).length === 0 ? (
          <div className="p-8 text-center text-sm text-muted">
            За выбранный период данных нет. Измените период или снимите фильтры.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px]">
              <thead>
                <tr className={theadRow}>
                  <th className={th}>Объект продаж</th>
                  <th className={th}>Цель</th>
                  <th className={th}>Аккаунт</th>
                  <th className={th}>Деньги</th>
                  <th className={thRight}>Расход</th>
                  <th className={thRight}>Результат</th>
                  <th className={thRight}>Цена</th>
                </tr>
              </thead>
              <tbody>
                {((data?.rows ?? []) as SummaryRow[]).map((r, i) => {
                  const gm = goalMeta(r.goal ?? undefined)
                  return (
                    <tr key={i} className="hover:bg-chip/40 transition-colors">
                      <td className={td}>
                        <span className="font-medium text-ink whitespace-nowrap">{r.objectName}</span>
                      </td>
                      <td className={td}>
                        <div className="text-ink-2 whitespace-nowrap">{gm.label}</div>
                        <div className="text-[11px] text-muted whitespace-nowrap">{gm.metric}</div>
                      </td>
                      <td className={td}>{r.account}</td>
                      <td className={td}>
                        <span
                          className={`chip ${
                            r.moneySource === 'FRANCHONE'
                              ? 'bg-[#e2f2ef] text-green-d'
                              : 'bg-chip text-ink-2'
                          }`}
                        >
                          {r.moneySource}
                        </span>
                      </td>
                      <td className={`${td} text-right tabular-nums`}>{usd(r.budgetCents)}</td>
                      <td className={`${td} text-right tabular-nums`}>{num(r.result)}</td>
                      <td className={`${td} text-right tabular-nums font-semibold text-ink`}>
                        {usdCost(r.costCents)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <TargetReportsPanel />
    </div>
  )
}

type SummaryRow = {
  objectName: string
  goal: string | null
  account: string
  moneySource: string
  budgetCents: number
  result: number
  costCents: number | null
}

type SeriesRow = {
  campaignId: string
  code: string
  campaign: string
  goal: string | null
  points: { date: string; budgetCents: number; result: number; costCents: number | null }[]
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
