import { useMemo, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { Sliders, Users2, Building2, Wallet, Timer, Check } from 'lucide-react'
import { api } from '../../convex/_generated/api'
import PageHeader from '@/components/PageHeader'
import Select from '@/components/ui/Select'
import { useData } from '@/lib/useData'
import { DEFAULT_WEIGHTS } from '@/lib/kpi'
import type { Id } from '../../convex/_generated/dataModel'
import { kzt, pct } from '@/lib/format'

const th = 'text-left text-[11px] font-semibold text-green-d uppercase tracking-wide px-3 py-2'
const td = 'px-3 py-2.5 text-sm text-ink-2 border-t border-line'
const cellCls =
  'w-16 h-8 px-2 rounded-lg border border-line-2 text-sm text-right tabular-nums focus:outline-none focus:border-green-light'

export default function Settings() {
  const registry = useQuery(api.campaigns.registry, {})
  return (
    <>
      <PageHeader title="Настройки" subtitle="Веса KPI, оклады и справочники системы" />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <SmmPlanCard />
        <div className="flex flex-col gap-5">
          <TargetologWeightsCard />
          <SalaryCard />
        </div>
      </div>

      {/* Ежедневная отчётность */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 mt-5">
        <ReportDeadlineCard />
      </div>

      {/* Справочники */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 mt-5">
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Building2 size={18} className="text-green" />
            <h3 className="sec-title">Справочники</h3>
          </div>
          <div className="flex flex-col gap-3 text-sm">
            <Row label="Аккаунты" value="FRANCHONE · ANUAR" />
            <Row label="Источники денег" value="FRANCHONE · Партнёр" />
            <Row label="Отделы" value="Руководство · Маркетинг · Продажи · Производство" />
            <Row label="Кампаний в реестре" value={`${registry?.length ?? 0}`} />
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

// ——— Недельные планы и веса SMM (лист «Недельные планы» в KPI_SMM.xlsx) ———
function SmmPlanCard() {
  const { smmMetrics } = useData()
  const setPlan = useMutation(api.smm.setPlan)
  const [draft, setDraft] = useState<Record<string, { weight: number; weekPlans: number[] }>>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const rowOf = (m: (typeof smmMetrics)[number]) =>
    draft[m.id] ?? { weight: m.weight, weekPlans: m.weekPlans }
  const edit = (id: string, patch: Partial<{ weight: number; weekPlans: number[] }>) => {
    const base = smmMetrics.find((m) => m.id === id)!
    setDraft((d) => ({ ...d, [id]: { ...(d[id] ?? { weight: base.weight, weekPlans: base.weekPlans }), ...patch } }))
    setSaved(false)
  }

  const weightSum = smmMetrics.reduce((s, m) => s + rowOf(m).weight, 0)

  const save = async () => {
    setSaving(true)
    try {
      for (const [id, val] of Object.entries(draft)) {
        await setPlan({ id: id as Id<'smmMetrics'>, weight: val.weight, weekPlans: val.weekPlans })
      }
      setDraft({})
      setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-4">
        <Sliders size={18} className="text-green" />
        <h3 className="sec-title flex-1">Планы и веса KPI · SMM</h3>
        {Object.keys(draft).length > 0 && (
          <button onClick={save} disabled={saving} className="btn btn-green h-8 px-3 text-xs disabled:opacity-60">
            Сохранить
          </button>
        )}
        {saved && (
          <span className="chip bg-[#e2f2ef] text-green-d">
            <Check size={12} /> Сохранено
          </span>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px]">
          <thead>
            <tr className="bg-[#e2f2ef]">
              <th className={th}>Аккаунт · Формат</th>
              <th className={th}>Вес</th>
              {[1, 2, 3, 4, 5].map((w) => (
                <th key={w} className={th}>
                  Н{w}
                </th>
              ))}
              <th className={th}>Мес.</th>
            </tr>
          </thead>
          <tbody>
            {smmMetrics.map((m) => {
              const r = rowOf(m)
              return (
                <tr key={m.id}>
                  <td className={td}>
                    <span className="font-medium text-ink">{m.account}</span> · {m.format}
                  </td>
                  <td className={td}>
                    <input
                      type="number"
                      step="0.05"
                      min={0}
                      value={r.weight}
                      onChange={(e) => edit(m.id, { weight: Number(e.target.value) || 0 })}
                      className={cellCls}
                    />
                  </td>
                  {r.weekPlans.map((p, i) => (
                    <td key={i} className={td}>
                      <input
                        type="number"
                        min={0}
                        value={p}
                        onChange={(e) => {
                          const next = [...r.weekPlans]
                          next[i] = Number(e.target.value) || 0
                          edit(m.id, { weekPlans: next })
                        }}
                        className={cellCls}
                      />
                    </td>
                  ))}
                  <td className={`${td} font-semibold text-ink tabular-nums`}>
                    {r.weekPlans.reduce((s, x) => s + x, 0)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className={`text-[11px] mt-3 ${Math.abs(weightSum - 1) < 0.001 ? 'text-muted-2' : 'text-[#c53030]'}`}>
        Сумма весов = {pct(weightSum)}. В модели KPI она должна быть 100%.
      </p>
    </div>
  )
}

// ——— Веса KPI таргетолога (B6/B7 дашборда KPI_TARGETOLOG.xlsx) ———
function TargetologWeightsCard() {
  const settings = useQuery(api.settings.get, {})
  const update = useMutation(api.settings.update)
  const [draft, setDraft] = useState<{ leadWeight: number; cplWeight: number } | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const cur = draft ?? {
    leadWeight: settings?.leadWeight ?? DEFAULT_WEIGHTS.leadWeight,
    cplWeight: settings?.cplWeight ?? DEFAULT_WEIGHTS.cplWeight,
  }
  const sum = cur.leadWeight + cur.cplWeight

  const save = async () => {
    setSaving(true)
    try {
      await update(cur)
      setDraft(null)
      setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-4">
        <Sliders size={18} className="text-green" />
        <h3 className="sec-title flex-1">Веса KPI · Таргетолог</h3>
        {draft && (
          <button onClick={save} disabled={saving} className="btn btn-green h-8 px-3 text-xs disabled:opacity-60">
            Сохранить
          </button>
        )}
        {saved && (
          <span className="chip bg-[#e2f2ef] text-green-d">
            <Check size={12} /> Сохранено
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {(
          [
            ['leadWeight', 'Вес заявок'],
            ['cplWeight', 'Вес CPL'],
          ] as const
        ).map(([key, label]) => (
          <div key={key} className="rounded-2xl border border-line p-4">
            <div className="text-sm text-muted mb-1">{label}</div>
            <input
              type="number"
              step="0.05"
              min={0}
              max={1}
              value={cur[key]}
              onChange={(e) => {
                setDraft({ ...cur, [key]: Number(e.target.value) || 0 })
                setSaved(false)
              }}
              className="w-full h-9 px-2 rounded-lg border border-line-2 text-lg font-bold focus:outline-none focus:border-green-light"
            />
          </div>
        ))}
      </div>
      <p className={`text-[11px] mt-3 ${Math.abs(sum - 1) < 0.001 ? 'text-muted-2' : 'text-[#c53030]'}`}>
        Сумма весов = {pct(sum)}. Применяется во всех расчётах KPI таргетолога.
      </p>
    </div>
  )
}

// ——— Оклады: база выплаты по должности («Оклад» на дашбордах) ———
function SalaryCard() {
  const { employees } = useData()
  const settings = useQuery(api.settings.get, {})
  const update = useMutation(api.settings.update)
  const [draft, setDraft] = useState<{
    salarySmm: number
    salaryTargetolog: number
    salarySales: number
    planRevenueSales: number
  } | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const cur = draft ?? {
    salarySmm: settings?.salarySmm ?? 0,
    salaryTargetolog: settings?.salaryTargetolog ?? 0,
    salarySales: settings?.salarySales ?? 0,
    planRevenueSales: settings?.planRevenueSales ?? 0,
  }

  const save = async () => {
    setSaving(true)
    try {
      await update(cur)
      setDraft(null)
      setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  const paid = employees.filter((e) => e.salary > 0)

  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-4">
        <Wallet size={18} className="text-green" />
        <h3 className="sec-title flex-1">Оклады</h3>
        {draft && (
          <button onClick={save} disabled={saving} className="btn btn-green h-8 px-3 text-xs disabled:opacity-60">
            Сохранить
          </button>
        )}
        {saved && (
          <span className="chip bg-[#e2f2ef] text-green-d">
            <Check size={12} /> Сохранено
          </span>
        )}
      </div>
      <div className="flex flex-col gap-3">
        {(
          [
            ['salarySmm', 'SMM-специалист'],
            ['salaryTargetolog', 'Таргетолог'],
            ['salarySales', 'Отдел продаж'],
          ] as const
        ).map(([key, label]) => (
          <div key={key} className="flex items-center justify-between gap-3">
            <span className="text-sm text-ink-2">{label}</span>
            <input
              type="number"
              min={0}
              step={10000}
              value={cur[key]}
              onChange={(e) => {
                setDraft({ ...cur, [key]: Number(e.target.value) || 0 })
                setSaved(false)
              }}
              className="w-36 h-9 px-2 rounded-lg border border-line-2 text-sm font-semibold text-right focus:outline-none focus:border-green-light"
            />
          </div>
        ))}
      </div>
      <p className="text-[11px] text-muted-2 mt-3">
        База выплаты по должности: выплата = оклад × итоговый KPI.
      </p>

      {/* План продаж — не оклад, поэтому отдельным блоком. */}
      <div className="mt-4 pt-4 border-t border-line">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <span className="text-sm text-ink-2">План выручки, ₸</span>
            <p className="text-[11px] text-muted-2 mt-0.5">
              KPI продаж = МИН(факт / план; 1)
            </p>
          </div>
          <input
            type="number"
            min={0}
            step={100000}
            value={cur.planRevenueSales}
            onChange={(e) => {
              setDraft({ ...cur, planRevenueSales: Number(e.target.value) || 0 })
              setSaved(false)
            }}
            className="w-36 h-9 px-2 rounded-lg border border-line-2 text-sm font-semibold text-right focus:outline-none focus:border-green-light shrink-0"
          />
        </div>
        {cur.salarySales > 0 && cur.planRevenueSales === 0 && (
          <p className="text-[11px] text-[#c53030] mt-2">
            Без плана выручки KPI продаж не считается, и выплата останется нулевой.
          </p>
        )}
      </div>
      {paid.length > 0 && (
        <div className="flex flex-col divide-y divide-line mt-3 pt-3 border-t border-line">
          {paid.map((e) => (
            <div key={e.id} className="flex items-center justify-between py-2 first:pt-0 last:pb-0">
              <span className="text-sm text-muted">{e.name}</span>
              <span className="text-sm text-ink-2">{kzt(e.salary)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ReportDeadlineCard() {
  const settings = useQuery(api.settings.get, {})
  const update = useMutation(api.settings.update)
  const [picked, setPicked] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const current = picked ?? settings?.reportDeadlineTime ?? '20:00'
  const options = useMemo(() => {
    const o: { value: string; label: string }[] = []
    for (let h = 12; h <= 23; h++)
      for (const m of ['00', '30']) {
        const t = `${String(h).padStart(2, '0')}:${m}`
        o.push({ value: t, label: t })
      }
    return o
  }, [])

  const save = async () => {
    setSaving(true)
    try {
      // Мутация патчит только переданные поля — соседние настройки не трогаем.
      await update({ reportDeadlineTime: current })
      setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-4">
        <Timer size={18} className="text-green" />
        <h3 className="sec-title">Ежедневная отчётность</h3>
      </div>
      <div className="flex items-end gap-3 flex-wrap gap-y-2">
        <div>
          <div className="text-sm text-muted mb-1.5">Дедлайн отправки (Алматы)</div>
          <Select
            value={current}
            onChange={(v) => {
              setPicked(v)
              setSaved(false)
            }}
            options={options}
            className="w-32"
          />
        </div>
        <button onClick={save} disabled={saving} className="btn btn-green disabled:opacity-60">
          Сохранить
        </button>
        {saved && (
          <span className="text-xs text-green-d flex items-center gap-1 pb-2.5">
            <Check size={13} /> Сохранено
          </span>
        )}
      </div>
      <p className="text-[11px] text-muted-2 mt-3">
        Отчёт, отправленный после этого времени, помечается «с опозданием». Незаполненный за
        календарный день — «пропущен».
      </p>
    </div>
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
