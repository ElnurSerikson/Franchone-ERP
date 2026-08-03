import { useState } from 'react'
import { useQuery } from 'convex/react'
import { Filter, Wallet, Building2, Handshake, Check } from 'lucide-react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import Select from '@/components/ui/Select'
import StatCard from '@/components/ui/StatCard'
import LineChart, { type ChartSeries } from '@/components/ui/LineChart'
import TargetReportsPanel from './TargetReportsPanel'
import DatePicker from '@/components/ui/DatePicker'
import { CAMPAIGN_ACCOUNTS, goalMeta } from '../../../convex/campaignGoals'
import { num, usd, usdCost } from '@/lib/format'
import { TODAY } from '@/lib/constants'
import { th, thRight, td, theadRow } from '@/lib/table'

// Дашборд рекламы (ТЗ таргетолога §11–§12 + дополнение §2.8, §2.9, §3).
//
// Иерархия: объекты продаж → рекламные цели → кампании. По умолчанию выбраны
// все активные объекты и все цели, и график показывает динамику по целям.
// Когда включённой остаётся одна цель, нижний список переключается с целей на
// кампании внутри неё, а график раскрывает их по ручным названиям.
//
// Единого показателя «всего результатов» наверху нет намеренно: сообщения,
// лиды, охваты и переходы — разные единицы, складывать их §11.2 запрещает.

const ALL = 'all'

function monthStart(date: string) {
  return `${date.slice(0, 7)}-01`
}

type GoalRow = {
  goal: string
  label: string
  metric: string
  costLabel: string
  hasData: boolean
  budgetCents: number
  result: number
  costCents: number | null
}

type CampaignRow = {
  campaignId: string
  name: string
  objectName: string | null
  status: string
  hasData: boolean
  budgetCents: number
  result: number
  costCents: number | null
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
  id: string
  label: string
  goal: string | null
  points: { date: string; budgetCents: number; result: number; costCents: number | null }[]
}

export default function TargetologDashboard() {
  const [from, setFrom] = useState(monthStart(TODAY))
  const [to, setTo] = useState(TODAY)
  // Пустой набор = «все» (§2.8). Так пользователь не может случайно остаться
  // с пустым экраном, сняв последнюю галочку.
  const [objectIds, setObjectIds] = useState<string[]>([])
  const [offGoals, setOffGoals] = useState<string[]>([])
  const [offCampaigns, setOffCampaigns] = useState<string[]>([])
  const [account, setAccount] = useState(ALL)
  const [moneySource, setMoneySource] = useState(ALL)
  const [status, setStatus] = useState(ALL)

  // Опорный запрос — без фильтра целей. Из него берётся полный справочник
  // целей (§2.9): нижний список обязан показывать и те цели, которые
  // пользователь только что отключил, иначе вернуть их было бы нечем.
  const base = from <= to ? {
    from,
    to,
    ...(objectIds.length ? { objectIds: objectIds as Id<'salesObjects'>[] } : {}),
    ...(account !== ALL ? { account } : {}),
    ...(moneySource !== ALL ? { moneySource } : {}),
    ...(status !== ALL ? { status } : {}),
  } : null
  const probe = useQuery(api.target.dashboard, base ?? 'skip')
  const allGoals = ((probe?.goalRows ?? []) as GoalRow[]).map((g) => g.goal)
  const onGoals = allGoals.filter((g) => !offGoals.includes(g))

  const data = useQuery(
    api.target.dashboard,
    base && allGoals.length > 0
      ? {
          ...base,
          ...(onGoals.length && onGoals.length < allGoals.length ? { goals: onGoals } : {}),
          ...(offCampaigns.length ? { excludeCampaignIds: offCampaigns as Id<'campaigns'>[] } : {}),
        }
      : 'skip',
  )

  const goalRows = (data?.goalRows ?? []) as GoalRow[]
  const campaignRows = (data?.campaignRows ?? []) as CampaignRow[]
  const objects = (data?.objects ?? []) as { _id: string; name: string }[]
  const detail = data?.mode === 'campaigns'
  // Список аккаунтов берём из справочника, а не из данных: раньше он строился
  // по уникальным значениям кампаний, и любое расхождение в написании
  // превращалось в лишний «аккаунт» в фильтре.

  const series: ChartSeries[] = ((data?.series ?? []) as SeriesRow[]).map((s) => ({
    id: s.id,
    label: detail ? s.label : `${s.label} · ${goalMeta(s.goal ?? undefined).metric}`,
    points: s.points.map((p) => ({
      x: p.date,
      y: p.costCents === null ? null : p.costCents / 100,
      hint: `${usd(p.budgetCents)} · ${num(p.result)} → ${usdCost(p.costCents)}`,
    })),
  }))

  const toggle = (list: string[], set: (v: string[]) => void, id: string) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id])

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
          <Field label="Аккаунт">
            <Select
              value={account}
              onChange={setAccount}
              options={[
                { value: ALL, label: 'Все аккаунты' },
                ...CAMPAIGN_ACCOUNTS.map((a) => ({ value: a, label: a })),
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

        {/* §2.8: верхний уровень иерархии. По умолчанию выбраны все активные
            объекты; пользователь оставляет один, несколько или снова все. */}
        <div className="mt-4">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className="text-[11px] font-semibold text-muted uppercase tracking-wide">
              Объекты продаж
            </span>
            <span className="text-[11px] text-muted-2">
              {objectIds.length === 0
                ? 'выбраны все активные'
                : `выбрано ${objectIds.length} из ${objects.length}`}
            </span>
            {objectIds.length > 0 && (
              <button onClick={() => setObjectIds([])} className="text-[11px] text-green-d underline">
                Все
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {objects.map((o) => {
              const on = objectIds.length === 0 || objectIds.includes(o._id)
              return (
                <Toggle
                  key={o._id}
                  on={on}
                  onClick={() => {
                    // Первый клик из состояния «все» оставляет один объект —
                    // иначе пришлось бы снимать галочки по одной.
                    if (objectIds.length === 0) setObjectIds([o._id])
                    else {
                      const next = objectIds.includes(o._id)
                        ? objectIds.filter((x) => x !== o._id)
                        : [...objectIds, o._id]
                      setObjectIds(next.length === objects.length ? [] : next)
                    }
                  }}
                >
                  {o.name}
                </Toggle>
              )
            })}
          </div>
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
          {detail
            ? 'Оставлена одна цель — на графике отдельные кампании внутри неё.'
            : 'Линия на рекламную цель. Разные цели сравниваем визуально: их результаты измеряются в разных единицах.'}
        </p>
        <LineChart
          series={series}
          formatY={(v) => '$' + v.toFixed(2)}
          emptyHint="За выбранный период отчётов нет"
        />

        {/* §2.9: нижний фильтр — весь справочник целей, включая те, по которым
            данных нет. Фильтра по ID и конкретным кампаниям здесь больше нет:
            кампании появляются только когда оставлена одна цель. */}
        <div className="mt-5 pt-4 border-t border-line">
          <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-2">
            {detail ? 'Кампании внутри цели' : 'Рекламные цели'}
          </div>
          {detail ? (
            <div className="flex flex-col gap-1.5">
              {campaignRows.length === 0 ? (
                <p className="text-sm text-muted">У этой цели нет кампаний по выбранным объектам.</p>
              ) : (
                campaignRows.map((c) => (
                  <LegendRow
                    key={c.campaignId}
                    on={!offCampaigns.includes(c.campaignId)}
                    disabled={!c.hasData}
                    locked={
                      campaignRows.filter((x) => !offCampaigns.includes(x.campaignId)).length === 1 &&
                      !offCampaigns.includes(c.campaignId)
                    }
                    onClick={() => {
                      const on = campaignRows.filter((x) => !offCampaigns.includes(x.campaignId))
                      if (on.length === 1 && !offCampaigns.includes(c.campaignId)) return
                      toggle(offCampaigns, setOffCampaigns, c.campaignId)
                    }}
                    title={c.name}
                    caption={c.objectName ?? 'объект не выбран'}
                    value={c.hasData ? usdCost(c.costCents) : 'Нет данных'}
                    extra={c.hasData ? `${usd(c.budgetCents)} · ${num(c.result)}` : ''}
                  />
                ))
              )}
              <button
                onClick={() => setOffGoals([])}
                className="text-[11px] text-green-d underline self-start mt-1"
              >
                ← вернуться ко всем целям
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {goalRows.map((g) => (
                <LegendRow
                  key={g.goal}
                  on={!offGoals.includes(g.goal)}
                  locked={onGoals.length === 1 && !offGoals.includes(g.goal)}
                  disabled={!g.hasData}
                  onClick={() => {
                    // Последнюю включённую цель снять нельзя: пустой график
                    // ничего не показывает, а галочки разошлись бы с данными.
                    if (onGoals.length === 1 && !offGoals.includes(g.goal)) return
                    toggle(offGoals, setOffGoals, g.goal)
                    setOffCampaigns([])
                  }}
                  title={g.label}
                  caption={g.metric}
                  value={g.hasData ? usdCost(g.costCents) : 'Нет данных'}
                  extra={g.hasData ? `${usd(g.budgetCents)} · ${num(g.result)}` : ''}
                />
              ))}
              <p className="text-[11px] text-muted-2 mt-1">
                Оставьте одну цель — график раскроет кампании внутри неё.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* Заголовка у сводки нет намеренно: строка колонок и так говорит, что
          это разрез «объект × цель × аккаунт × источник денег». */}
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

// Строка нижнего списка: включатель линии + собственный итог за период.
function LegendRow({
  on,
  disabled,
  locked = false,
  onClick,
  title,
  caption,
  value,
  extra,
}: {
  on: boolean
  disabled: boolean
  // Единственную включённую строку снять нельзя — иначе график опустеет.
  locked?: boolean
  onClick: () => void
  title: string
  caption: string
  value: string
  extra: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={locked ? 'Это единственная включённая строка' : undefined}
      className={`flex items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-colors ${
        on ? 'border-line bg-white hover:bg-chip/50' : 'border-line bg-chip/60'
      } ${locked ? 'cursor-default' : ''}`}
    >
      <span
        className={`w-4 h-4 rounded shrink-0 grid place-items-center border ${
          on ? 'bg-green border-green text-white' : 'bg-white border-line-2 text-transparent'
        }`}
      >
        <Check size={11} strokeWidth={3} />
      </span>
      <div className="min-w-0 flex-1">
        <div className={`text-sm truncate ${on ? 'text-ink font-medium' : 'text-muted'}`}>{title}</div>
        <div className="text-[11px] text-muted truncate">{caption}</div>
      </div>
      <div className="text-right shrink-0">
        <div
          className={`text-sm tabular-nums whitespace-nowrap ${
            disabled ? 'text-muted-2' : 'font-semibold text-ink'
          }`}
        >
          {value}
        </div>
        {extra && <div className="text-[11px] text-muted tabular-nums whitespace-nowrap">{extra}</div>}
      </div>
    </button>
  )
}

function Toggle({
  on,
  onClick,
  children,
}: {
  on: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`chip whitespace-nowrap transition-colors ${
        on ? 'bg-[#e2f2ef] text-green-d' : 'bg-chip text-muted hover:text-ink-2'
      }`}
    >
      {children}
    </button>
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
