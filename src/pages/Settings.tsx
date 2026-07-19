import { Sliders, Users2, Building2, Wallet } from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import { useData } from '@/lib/useData'
import { LEAD_WEIGHT, CPL_WEIGHT } from '@/lib/kpi'
import { kzt, pct } from '@/lib/format'

const th = 'text-left text-[11px] font-semibold text-muted uppercase tracking-wide px-3 py-2'
const td = 'px-3 py-2.5 text-sm text-ink-2 border-t border-line'

export default function Settings() {
  const { smmMetrics, campaigns, employees } = useData()
  return (
    <>
      <PageHeader title="Настройки" subtitle="Веса KPI, оклады и справочники системы" />

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Веса SMM */}
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Sliders size={18} className="text-green" />
            <h3 className="sec-title">Веса KPI · SMM</h3>
          </div>
          <table className="w-full">
            <thead>
              <tr>
                <th className={th}>Аккаунт · Формат</th>
                <th className={th}>Вес</th>
              </tr>
            </thead>
            <tbody>
              {smmMetrics.map((m) => (
                <tr key={m.id}>
                  <td className={td}>
                    <span className="font-medium text-ink">{m.account}</span> · {m.format}
                  </td>
                  <td className={td}>
                    <input
                      defaultValue={m.weight}
                      className="w-20 h-8 px-2 rounded-lg border border-line-2 text-sm focus:outline-none focus:border-green-light"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Веса таргетолога + оклады */}
        <div className="flex flex-col gap-5">
          <div className="card p-5">
            <div className="flex items-center gap-2 mb-4">
              <Sliders size={18} className="text-green" />
              <h3 className="sec-title">Веса KPI · Таргетолог</h3>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-line p-4">
                <div className="text-sm text-muted mb-1">Вес заявок</div>
                <input
                  defaultValue={LEAD_WEIGHT}
                  className="w-full h-9 px-2 rounded-lg border border-line-2 text-lg font-bold focus:outline-none focus:border-green-light"
                />
              </div>
              <div className="rounded-2xl border border-line p-4">
                <div className="text-sm text-muted mb-1">Вес CPL</div>
                <input
                  defaultValue={CPL_WEIGHT}
                  className="w-full h-9 px-2 rounded-lg border border-line-2 text-lg font-bold focus:outline-none focus:border-green-light"
                />
              </div>
            </div>
            <p className="text-[11px] text-muted-2 mt-3">
              Сумма весов = {pct(LEAD_WEIGHT + CPL_WEIGHT)}. Применяется во всех расчётах KPI таргетолога.
            </p>
          </div>

          <div className="card p-5">
            <div className="flex items-center gap-2 mb-4">
              <Wallet size={18} className="text-green" />
              <h3 className="sec-title">Оклады</h3>
            </div>
            <div className="flex flex-col divide-y divide-line">
              {employees
                .filter((e) => e.salary > 0)
                .map((e) => (
                  <div key={e.id} className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0">
                    <span className="text-sm text-ink-2">{e.name}</span>
                    <span className="text-sm font-semibold text-ink">{kzt(e.salary)}</span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      </div>

      {/* Справочники */}
      <div className="grid gap-5 lg:grid-cols-2 mt-5">
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Building2 size={18} className="text-green" />
            <h3 className="sec-title">Справочники</h3>
          </div>
          <div className="flex flex-col gap-3 text-sm">
            <Row label="Аккаунты" value="FRANCHONE · ANUAR" />
            <Row label="Источники денег" value="FRANCHONE · Партнёр" />
            <Row label="Отделы" value="Руководство · Маркетинг · Продажи · Производство" />
            <Row label="Кампаний в реестре" value={`${campaigns.length}`} />
            <Row label="Правило недель" value="ROUNDUP(день/7), максимум 5" />
          </div>
        </div>

        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Users2 size={18} className="text-green" />
            <h3 className="sec-title">Роли и доступ</h3>
          </div>
          <div className="flex flex-col gap-3 text-sm">
            <Row label="Владелец" value="Полный доступ ко всему" />
            <Row label="Руководитель отдела" value="Свой отдел: планы, задачи, KPI" />
            <Row label="Сотрудник" value="Только своё: факт, задачи, свой KPI" />
          </div>
        </div>
      </div>
    </>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 border-b border-line last:border-0">
      <span className="text-muted">{label}</span>
      <span className="font-medium text-ink text-right">{value}</span>
    </div>
  )
}
