import { useState } from 'react'
import { useQuery } from 'convex/react'
import { Plus, ChevronLeft, ChevronRight, Loader2, Megaphone } from 'lucide-react'
import { api } from '../../../convex/_generated/api'
import type { Doc } from '../../../convex/_generated/dataModel'
import CampaignDrawer from './CampaignDrawer'
import { kzt, num, pct } from '@/lib/format'
import { CURRENT_MONTH, addMonth, formatMonth } from '@/lib/month'
import { th, thRight, td, theadRow } from '@/lib/table'

type Campaign = Doc<'campaigns'>

const STATUS_CHIP: Record<string, string> = {
  Активна: 'bg-[#e2f2ef] text-green-d',
  Пауза: 'bg-[#fff6e6] text-[#b7791f]',
  Завершена: 'bg-chip text-muted',
}

// Реестр рекламных кампаний: карточка живёт месяцами, план задаётся на месяц.
// Правки идут через drawer справа — там же и план, чтобы не разводить по экранам.
export default function CampaignsTab() {
  const [month, setMonth] = useState(CURRENT_MONTH)
  const [open, setOpen] = useState<{ campaign: Campaign | null } | null>(null)
  const registry = useQuery(api.campaigns.registry, {})
  const plans = useQuery(api.campaigns.plans, { month })
  const atCurrent = month >= CURRENT_MONTH

  const planOf = (c: Campaign) => plans?.find((p) => p.campaignId === c._id)
  const loading = registry === undefined || plans === undefined

  return (
    <>
      {/* Тулбар вне карточки: шапка таблицы должна быть первой строкой,
          как в «Команде», а не второй после заголовка. */}
      <div className="flex items-center gap-1.5 flex-wrap mb-5">
        <button
          onClick={() => setMonth(addMonth(month, -1))}
          className="ico-btn w-10 h-10"
          title="Предыдущий месяц"
          aria-label="Предыдущий месяц"
        >
          <ChevronLeft size={16} />
        </button>
        <div className="btn btn-ghost min-w-[132px] justify-center cursor-default select-none">
          {formatMonth(month)}
        </div>
        <button
          onClick={() => setMonth(addMonth(month, 1))}
          disabled={atCurrent}
          className="ico-btn w-10 h-10 disabled:opacity-40 disabled:cursor-default disabled:hover:bg-white"
          title={atCurrent ? 'Текущий месяц' : 'Следующий месяц'}
          aria-label="Следующий месяц"
        >
          <ChevronRight size={16} />
        </button>
        <div className="flex-1" />
        <button onClick={() => setOpen({ campaign: null })} className="btn btn-green">
          <Plus size={16} /> Добавить кампанию
        </button>
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-10 grid place-items-center text-muted">
            <Loader2 className="animate-spin" size={20} />
          </div>
        ) : registry.length === 0 ? (
          <div className="p-10 text-center">
            <span className="w-12 h-12 rounded-full bg-chip text-muted grid place-items-center mx-auto mb-3">
              <Megaphone size={20} />
            </span>
            <div className="sec-title mb-1">В реестре пока нет кампаний</div>
            <p className="text-sm text-muted max-w-md mx-auto">
              Заведите кампанию — она сразу появится строкой в ежедневном отчёте таргетолога,
              а её план ляжет в расчёт KPI.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px]">
              <thead>
                <tr className={theadRow}>
                  <th className={th}>ID</th>
                  <th className={th}>Кампания</th>
                  <th className={th}>Аккаунт</th>
                  <th className={th}>Деньги</th>
                  <th className={thRight}>План бюджета</th>
                  <th className={thRight}>План заявок</th>
                  <th className={thRight}>Вес</th>
                  <th className={th}>Статус</th>
                </tr>
              </thead>
              <tbody>
                {registry.map((c) => {
                  const p = planOf(c)
                  return (
                    <tr
                      key={c._id}
                      onClick={() => setOpen({ campaign: c })}
                      className="hover:bg-chip/40 transition-colors cursor-pointer"
                    >
                      <td className={td}>
                        <span className="chip bg-[#e2f2ef] text-green-d">{c.code}</span>
                      </td>
                      <td className={td}>
                        <div className="font-medium text-ink whitespace-nowrap">{c.campaign}</div>
                        <div className="text-[11px] text-muted whitespace-nowrap">{c.brand}</div>
                      </td>
                      <td className={td}>{c.account}</td>
                      <td className={td}>
                        <span
                          className={`chip ${
                            c.moneySource === 'FRANCHONE'
                              ? 'bg-[#e2f2ef] text-green-d'
                              : 'bg-chip text-ink-2'
                          }`}
                        >
                          {c.moneySource}
                        </span>
                      </td>
                      <td className={`${td} text-right tabular-nums`}>
                        {p?.planBudget ? kzt(p.planBudget) : <span className="text-muted-2">—</span>}
                      </td>
                      <td className={`${td} text-right tabular-nums`}>
                        {p?.planLeads ? num(p.planLeads) : <span className="text-muted-2">—</span>}
                      </td>
                      <td className={`${td} text-right tabular-nums`}>
                        {p?.weight ? pct(p.weight) : <span className="text-muted-2">—</span>}
                      </td>
                      <td className={td}>
                        <span className={`chip ${STATUS_CHIP[c.status] ?? 'bg-chip text-ink-2'}`}>
                          {c.status}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

      </div>

      {open && (
        <CampaignDrawer campaign={open.campaign} month={month} onClose={() => setOpen(null)} />
      )}
    </>
  )
}
