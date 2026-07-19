import { useState } from 'react'
import { Info } from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import Avatar from '@/components/ui/Avatar'
import { KpiChip } from '@/components/ui/StatusChip'
import { useData } from '@/lib/useData'
import { computeSmm, computeTargetolog, LEAD_WEIGHT, CPL_WEIGHT } from '@/lib/kpi'
import { employeeKpi } from '@/lib/selectors'
import { kzt, num, pct } from '@/lib/format'

type Tab = 'plans' | 'facts' | 'pay'
type Model = 'smm' | 'targetolog'

const tabs: { id: Tab; label: string }[] = [
  { id: 'plans', label: 'Планы' },
  { id: 'facts', label: 'Факт' },
  { id: 'pay', label: 'Выплаты' },
]

const th = 'text-left text-[11px] font-semibold text-muted uppercase tracking-wide px-3 py-2'
const td = 'px-3 py-2.5 text-sm text-ink-2 border-t border-line'

export default function Kpi() {
  const [tab, setTab] = useState<Tab>('facts')
  const [model, setModel] = useState<Model>('smm')

  const { smmMetrics, campaigns, reportMonth } = useData()
  const smm = computeSmm(smmMetrics)
  const tg = computeTargetolog(campaigns)

  return (
    <>
      <PageHeader
        title="KPI"
        subtitle={`Планы, факт и выплаты · ${reportMonth}`}
        actions={<button className="btn btn-green">{reportMonth}</button>}
      />

      {/* Tabs */}
      <div className="flex items-center gap-1 p-1 bg-chip rounded-xl w-fit mb-5">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`h-9 px-4 rounded-lg text-sm font-semibold transition-colors ${
              tab === t.id ? 'bg-white text-ink shadow-card' : 'text-muted hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Model switch (для Планов и Факта) */}
      {tab !== 'pay' && (
        <div className="flex items-center gap-2 mb-4">
          {(['smm', 'targetolog'] as Model[]).map((m) => (
            <button
              key={m}
              onClick={() => setModel(m)}
              className={`chip border ${
                model === m ? 'bg-dark text-white border-dark' : 'bg-white text-ink-2 border-line-2'
              }`}
            >
              {m === 'smm' ? 'SMM · Нурай' : 'Таргетолог · Дамир'}
            </button>
          ))}
        </div>
      )}

      {/* ——— ПЛАНЫ ——— */}
      {tab === 'plans' && model === 'smm' && (
        <div className="card p-5">
          <h3 className="sec-title mb-4">Планы SMM · веса и недельная разбивка</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr>
                  <th className={th}>Аккаунт · Формат</th>
                  <th className={th}>Вес</th>
                  <th className={th}>Нед.1</th>
                  <th className={th}>Нед.2</th>
                  <th className={th}>Нед.3</th>
                  <th className={th}>Нед.4</th>
                  <th className={th}>Нед.5</th>
                  <th className={th}>План/мес</th>
                </tr>
              </thead>
              <tbody>
                {smm.rows.map((r) => (
                  <tr key={r.metric.id}>
                    <td className={td}>
                      <span className="font-medium text-ink">{r.metric.account}</span> · {r.metric.format}
                    </td>
                    <td className={td}>{pct(r.metric.weight)}</td>
                    {r.metric.weekPlans.map((p, i) => (
                      <td key={i} className={td}>
                        {p}
                      </td>
                    ))}
                    <td className={`${td} font-semibold text-ink`}>{r.plan}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'plans' && model === 'targetolog' && (
        <div className="card p-5">
          <h3 className="sec-title mb-4">Реестр кампаний · планы</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead>
                <tr>
                  <th className={th}>ID</th>
                  <th className={th}>Кампания</th>
                  <th className={th}>Источник</th>
                  <th className={th}>Вес</th>
                  <th className={th}>План бюджет</th>
                  <th className={th}>План заявки</th>
                  <th className={th}>План CPL</th>
                </tr>
              </thead>
              <tbody>
                {tg.rows.map((r) => (
                  <tr key={r.campaign.id}>
                    <td className={`${td} font-mono text-xs`}>{r.campaign.id}</td>
                    <td className={td}>
                      <span className="font-medium text-ink">{r.campaign.brand}</span>
                    </td>
                    <td className={td}>
                      <span
                        className={`chip ${
                          r.campaign.moneySource === 'FRANCHONE'
                            ? 'bg-[#e3f6ee] text-green-d'
                            : 'bg-chip text-ink-2'
                        }`}
                      >
                        {r.campaign.moneySource}
                      </span>
                    </td>
                    <td className={td}>{pct(r.campaign.weight)}</td>
                    <td className={td}>{kzt(r.campaign.planBudget)}</td>
                    <td className={td}>{num(r.campaign.planLeads)}</td>
                    <td className={td}>{kzt(r.planCpl)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ——— ФАКТ ——— */}
      {tab === 'facts' && model === 'smm' && (
        <div className="flex flex-col gap-5">
          {/* weekly windows */}
          <div className="card p-5">
            <h3 className="sec-title mb-4">Недельные окна KPI</h3>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {smm.weekKpi.map((w, i) => (
                <div key={i} className="rounded-2xl border border-line p-3 text-center">
                  <div className="text-[11px] text-muted mb-1">Неделя {i + 1}</div>
                  <div className="text-xl font-bold text-ink">{pct(w)}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            <div className="card p-5 lg:col-span-2">
              <h3 className="sec-title mb-4">Факт по форматам</h3>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px]">
                  <thead>
                    <tr>
                      <th className={th}>Аккаунт · Формат</th>
                      <th className={th}>Вес</th>
                      <th className={th}>План</th>
                      <th className={th}>Факт</th>
                      <th className={th}>Коэф.</th>
                      <th className={th}>Вклад</th>
                    </tr>
                  </thead>
                  <tbody>
                    {smm.rows.map((r) => (
                      <tr key={r.metric.id}>
                        <td className={td}>
                          <span className="font-medium text-ink">{r.metric.account}</span> · {r.metric.format}
                        </td>
                        <td className={td}>{pct(r.metric.weight)}</td>
                        <td className={td}>{r.plan}</td>
                        <td className={`${td} font-semibold text-ink`}>{r.fact}</td>
                        <td className={td}>{pct(r.ratio)}</td>
                        <td className={td}>{pct(r.contribution)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="card p-5 flex flex-col gap-4">
              <h3 className="sec-title">Итог месяца</h3>
              <div className="rounded-2xl bg-green text-white p-4">
                <div className="text-sm text-white/85">Итоговый KPI</div>
                <div className="text-3xl font-bold">{pct(smm.totalKpi)}</div>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted">KPI FRANCHONE</span>
                <span className="font-semibold text-ink">{pct(smm.kpiFranchone)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted">KPI ANUAR</span>
                <span className="font-semibold text-ink">{pct(smm.kpiAnuar)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted">Факт / План</span>
                <span className="font-semibold text-ink">
                  {num(smm.totalFact)} / {num(smm.totalPlan)}
                </span>
              </div>
              <div className="mt-auto pt-4 border-t border-line flex items-center justify-between">
                <span className="text-sm text-muted">К выплате</span>
                <span className="text-lg font-bold text-green-d">{kzt(600000 * smm.totalKpi)}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'facts' && model === 'targetolog' && (
        <div className="grid gap-5 lg:grid-cols-3">
          <div className="card p-5 lg:col-span-2">
            <h3 className="sec-title mb-4">Факт по кампаниям</h3>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px]">
                <thead>
                  <tr>
                    <th className={th}>Кампания</th>
                    <th className={th}>Факт бюджет</th>
                    <th className={th}>Заявки</th>
                    <th className={th}>CPL</th>
                    <th className={th}>Заявки %</th>
                    <th className={th}>CPL-эфф.</th>
                    <th className={th}>KPI</th>
                  </tr>
                </thead>
                <tbody>
                  {tg.rows.map((r) => (
                    <tr key={r.campaign.id}>
                      <td className={td}>
                        <span className="font-medium text-ink">{r.campaign.brand}</span>
                        <span className="text-xs text-muted ml-1">{r.campaign.id}</span>
                      </td>
                      <td className={td}>{kzt(r.campaign.factBudget)}</td>
                      <td className={td}>{num(r.campaign.factLeads)}</td>
                      <td className={td}>{kzt(r.factCpl)}</td>
                      <td className={td}>{pct(r.leadsPct)}</td>
                      <td className={td}>{pct(r.cplEff)}</td>
                      <td className={`${td} font-semibold text-ink`}>{pct(r.kpi)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card p-5 flex flex-col gap-4">
            <h3 className="sec-title">Итог месяца</h3>
            <div className="rounded-2xl bg-green text-white p-4">
              <div className="text-sm text-white/85">Итоговый KPI</div>
              <div className="text-3xl font-bold">{pct(tg.totalKpi)}</div>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted">Общий расход</span>
              <span className="font-semibold text-ink">{kzt(tg.totalSpend)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted">Всего заявок</span>
              <span className="font-semibold text-ink">{num(tg.totalLeads)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted">Средний CPL</span>
              <span className="font-semibold text-ink">{kzt(tg.avgCpl)}</span>
            </div>
            <div className="text-[11px] text-muted-2">
              Веса: заявки {pct(LEAD_WEIGHT)} · CPL {pct(CPL_WEIGHT)}
            </div>
            <div className="mt-auto pt-4 border-t border-line flex items-center justify-between">
              <span className="text-sm text-muted">К выплате</span>
              <span className="text-lg font-bold text-green-d">{kzt(200000 * tg.totalKpi)}</span>
            </div>
          </div>
        </div>
      )}

      {/* ——— ВЫПЛАТЫ ——— */}
      {tab === 'pay' && <Payouts />}
    </>
  )
}

function Payouts() {
  const { employees, smmMetrics, campaigns, reportMonth } = useData()
  const rows = employees
    .map((e) => employeeKpi(e, smmMetrics, campaigns))
    .filter((r) => r.kpi !== null)
  const total = rows.reduce((s, r) => s + (r.payout ?? 0), 0)

  return (
    <div className="flex flex-col gap-5">
      <div className="card p-5 bg-[#e3f6ee] border-[#cdeed9]">
        <div className="flex gap-3">
          <Info size={18} className="text-green-d shrink-0 mt-0.5" />
          <div className="text-sm text-ink-2">
            <b className="text-green-d">Выплата = Оклад × Итоговый KPI</b> (KPI ограничен 100%). Формула
            воспроизводит расчёт из Excel-таблиц KPI_SMM и KPI_TARGETOLOG.
          </div>
        </div>
      </div>

      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="sec-title">К начислению · {reportMonth}</h3>
          <button className="mini-btn">Утвердить месяц</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr>
                <th className={th}>Сотрудник</th>
                <th className={th}>Должность</th>
                <th className={th}>Оклад</th>
                <th className={th}>KPI</th>
                <th className={th}>К начислению</th>
                <th className={th}>Статус</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ employee: e, kpi, payout }) => (
                <tr key={e.id}>
                  <td className={td}>
                    <div className="flex items-center gap-2.5">
                      <Avatar initials={e.initials} color={e.avatarColor} size={30} />
                      <span className="font-medium text-ink">{e.name}</span>
                    </div>
                  </td>
                  <td className={td}>{e.positionLabel}</td>
                  <td className={td}>{kzt(e.salary)}</td>
                  <td className={td}>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-ink">{pct(kpi ?? 0)}</span>
                      <KpiChip value={kpi ?? 0} />
                    </div>
                  </td>
                  <td className={`${td} font-bold text-ink`}>{kzt(payout ?? 0)}</td>
                  <td className={td}>
                    <span className="chip bg-chip text-muted">Черновик</span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className={`${td} font-semibold text-ink`} colSpan={4}>
                  Итого
                </td>
                <td className={`${td} font-bold text-green-d text-base`}>{kzt(total)}</td>
                <td className={td} />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  )
}
