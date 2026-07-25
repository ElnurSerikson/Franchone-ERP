import { useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { Sliders, Users2, Building2, Timer, Check, Plus, Trash2 } from 'lucide-react'
import { api } from '../../convex/_generated/api'
import PageHeader from '@/components/PageHeader'
import Select from '@/components/ui/Select'
import { useData } from '@/lib/useData'
import { DEFAULT_WEIGHTS } from '@/lib/kpi'
import type { Id } from '../../convex/_generated/dataModel'
import { pct } from '@/lib/format'
import { CURRENT_MONTH } from '@/lib/month'
import { errMessage } from '@/lib/errors'
import { th, td, theadRow } from '@/lib/table'

const cellCls =
  'w-16 h-8 px-2 rounded-lg border border-line-2 text-sm text-right tabular-nums focus:outline-none focus:border-green-light'

// §5 ТЗ: «формулы расчёта и набор KPI настраиваются отдельно для каждой
// должности». Поэтому настройки сгруппированы по должности, а не по типу
// параметра: у каждой своя формула, свой оклад и свой набор показателей.
type Position = 'smm' | 'targetolog' | 'sales'
const POSITIONS: { id: Position; label: string }[] = [
  { id: 'smm', label: 'SMM' },
  { id: 'targetolog', label: 'Таргетолог' },
  { id: 'sales', label: 'Отдел продаж' },
]

export default function Settings() {
  const registry = useQuery(api.campaigns.registry, {})
  const [pos, setPos] = useState<Position>('smm')

  return (
    <>
      <PageHeader title="Настройки" subtitle="KPI по должностям, отчётность и справочники" />

      <div className="flex items-center gap-1 p-1 bg-chip rounded-xl w-full sm:w-fit mb-5">
        {POSITIONS.map((p) => (
          <button
            key={p.id}
            onClick={() => setPos(p.id)}
            className={`h-9 px-4 rounded-lg text-sm font-semibold transition-colors flex-1 sm:flex-none ${
              pos === p.id
                ? 'bg-white text-ink shadow-card'
                : 'bg-line text-ink-2/70 hover:bg-line-2 hover:text-ink'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {pos === 'smm' && <SmmKpiSetup />}
      {pos === 'targetolog' && <TargetologKpiSetup />}
      {pos === 'sales' && <SalesKpiSetup />}

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

// ——— Общее для всех должностей ———

// Формула должности словами: что именно настраивают поля ниже.
function FormulaNote({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl bg-chip px-4 py-3 mb-4">
      <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-1">
        Формула расчёта
      </div>
      <div className="text-sm text-ink-2">{children}</div>
    </div>
  )
}

// Оклад должности — база выплаты: выплата = оклад × итоговый KPI.
function SalaryField({
  label = 'Оклад, ₸',
  value,
  onChange,
  hint,
}: {
  label?: string
  value: number
  onChange: (v: number) => void
  hint?: string
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <span className="text-sm text-ink-2">{label}</span>
        {hint && <p className="text-[11px] text-muted-2 mt-0.5">{hint}</p>}
      </div>
      <input
        type="number"
        min={0}
        step={10000}
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="w-36 h-9 px-2 rounded-lg border border-line-2 text-sm font-semibold text-right focus:outline-none focus:border-green-light shrink-0"
      />
    </div>
  )
}

function SaveBar({
  dirty,
  saving,
  saved,
  onSave,
}: {
  dirty: boolean
  saving: boolean
  saved: boolean
  onSave: () => void
}) {
  if (saved && !dirty)
    return (
      <span className="chip bg-[#e2f2ef] text-green-d">
        <Check size={12} /> Сохранено
      </span>
    )
  if (!dirty) return null
  return (
    <button onClick={onSave} disabled={saving} className="btn btn-green h-8 px-3 text-xs disabled:opacity-60">
      Сохранить
    </button>
  )
}

// ——— SMM: набор «аккаунт × формат», веса и недельные планы ———
const SMM_ACCOUNTS = ['FRANCHONE', 'ANUAR'] as const
const SMM_FORMATS = ['Рилсы', 'Сторис', 'Карусели'] as const

function SmmKpiSetup() {
  const { smmMetrics } = useData()
  const settings = useQuery(api.settings.get, {})
  const updateSettings = useMutation(api.settings.update)
  const setPlan = useMutation(api.smm.setPlan)
  const addMetric = useMutation(api.smm.addMetric)
  const removeMetric = useMutation(api.smm.removeMetric)

  const [draft, setDraft] = useState<Record<string, { weight: number; weekPlans: number[] }>>({})
  const [salary, setSalary] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [newPair, setNewPair] = useState<{ account: string; format: string } | null>(null)

  const rowOf = (m: (typeof smmMetrics)[number]) =>
    draft[m.id] ?? { weight: m.weight, weekPlans: m.weekPlans }
  const edit = (id: string, patch: Partial<{ weight: number; weekPlans: number[] }>) => {
    const base = smmMetrics.find((m) => m.id === id)!
    setDraft((d) => ({
      ...d,
      [id]: { ...(d[id] ?? { weight: base.weight, weekPlans: base.weekPlans }), ...patch },
    }))
    setSaved(false)
  }

  const curSalary = salary ?? settings?.salarySmm ?? 0
  const weightSum = smmMetrics.reduce((s, m) => s + rowOf(m).weight, 0)
  const dirty = Object.keys(draft).length > 0 || salary !== null

  // Пары, которых ещё нет в наборе — их и предлагаем добавить.
  const freePairs = SMM_ACCOUNTS.flatMap((a) =>
    SMM_FORMATS.filter((f) => !smmMetrics.some((m) => m.account === a && m.format === f)).map(
      (f) => ({ account: a, format: f }),
    ),
  )

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      for (const [id, val] of Object.entries(draft)) {
        await setPlan({ id: id as Id<'smmMetrics'>, weight: val.weight, weekPlans: val.weekPlans })
      }
      if (salary !== null) await updateSettings({ salarySmm: salary })
      setDraft({})
      setSalary(null)
      setSaved(true)
    } catch (e) {
      setError(errMessage(e, 'Не удалось сохранить настройки.'))
    } finally {
      setSaving(false)
    }
  }

  const run = async (fn: () => Promise<unknown>) => {
    setError('')
    try {
      await fn()
    } catch (e) {
      setError(errMessage(e, 'Не удалось изменить набор метрик.'))
    }
  }

  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <Sliders size={18} className="text-green" />
        <h3 className="sec-title flex-1">KPI · SMM-специалист</h3>
        <SaveBar dirty={dirty} saving={saving} saved={saved} onSave={save} />
      </div>

      <FormulaNote>
        По каждой паре «аккаунт × формат»: <b>МИН(факт ÷ план; 1) × вес</b>. Итоговый KPI —
        сумма вкладов, выплата — <b>оклад × KPI</b>. Перевыполнение сверх плана не начисляется.
      </FormulaNote>

      {error && <p className="text-sm text-[#c53030] mb-3">{error}</p>}

      <div className="mb-4">
        <SalaryField
          value={curSalary}
          onChange={(v) => {
            setSalary(v)
            setSaved(false)
          }}
          hint="база выплаты для должности"
        />
      </div>

      <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-2">
        Набор показателей
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px]">
          <thead>
            <tr className={theadRow}>
              <th className={th}>Аккаунт · Формат</th>
              <th className={th}>Вес</th>
              {[1, 2, 3, 4, 5].map((w) => (
                <th key={w} className={th}>
                  Н{w}
                </th>
              ))}
              <th className={th}>Мес.</th>
              <th className={th} />
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
                  <td className={td}>
                    <button
                      onClick={() => run(() => removeMetric({ id: m.id as Id<'smmMetrics'> }))}
                      className="w-8 h-8 grid place-items-center rounded-lg text-muted hover:text-[#c53030] hover:bg-chip transition-colors"
                      title="Убрать показатель из расчёта"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {freePairs.length > 0 &&
        (newPair ? (
          <div className="flex items-end gap-2 flex-wrap mt-3">
            <div className="w-40">
              <Select
                value={`${newPair.account}|${newPair.format}`}
                onChange={(v) => {
                  const [account, format] = v.split('|')
                  setNewPair({ account, format })
                }}
                options={freePairs.map((p) => ({
                  value: `${p.account}|${p.format}`,
                  label: `${p.account} · ${p.format}`,
                }))}
              />
            </div>
            <button
              onClick={() =>
                run(async () => {
                  await addMetric({
                    month: CURRENT_MONTH,
                    account: newPair.account as 'FRANCHONE' | 'ANUAR',
                    format: newPair.format as 'Рилсы' | 'Сторис' | 'Карусели',
                    weight: 0,
                  })
                  setNewPair(null)
                })
              }
              className="btn btn-green h-9 px-3 text-sm"
            >
              Добавить
            </button>
            <button onClick={() => setNewPair(null)} className="btn btn-ghost h-9 px-3 text-sm">
              Отмена
            </button>
          </div>
        ) : (
          <button
            onClick={() => setNewPair(freePairs[0])}
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-green-d hover:text-green transition-colors"
          >
            <Plus size={15} /> Добавить показатель
          </button>
        ))}

      <p className={`text-[11px] mt-3 ${Math.abs(weightSum - 1) < 0.001 ? 'text-muted-2' : 'text-[#c53030]'}`}>
        Сумма весов = {pct(weightSum)}. В модели KPI она должна быть 100%.
      </p>
    </div>
  )
}

// ——— Таргетолог: веса заявок и CPL ———
function TargetologKpiSetup() {
  const settings = useQuery(api.settings.get, {})
  const update = useMutation(api.settings.update)
  const [draft, setDraft] = useState<{
    leadWeight: number
    cplWeight: number
    salaryTargetolog: number
  } | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const cur = draft ?? {
    leadWeight: settings?.leadWeight ?? DEFAULT_WEIGHTS.leadWeight,
    cplWeight: settings?.cplWeight ?? DEFAULT_WEIGHTS.cplWeight,
    salaryTargetolog: settings?.salaryTargetolog ?? 0,
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

  const set = (patch: Partial<typeof cur>) => {
    setDraft({ ...cur, ...patch })
    setSaved(false)
  }

  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <Sliders size={18} className="text-green" />
        <h3 className="sec-title flex-1">KPI · Таргетолог</h3>
        <SaveBar dirty={!!draft} saving={saving} saved={saved} onSave={save} />
      </div>

      <FormulaNote>
        По каждой кампании: <b>МИН(факт заявок ÷ план; 1) × вес заявок + МИН(план CPL ÷ факт
        CPL; 1) × вес CPL</b>. Итог — среднее по кампаниям с учётом их весов, выплата —{' '}
        <b>оклад × KPI</b>.
      </FormulaNote>

      <div className="mb-4">
        <SalaryField
          value={cur.salaryTargetolog}
          onChange={(v) => set({ salaryTargetolog: v })}
          hint="база выплаты для должности"
        />
      </div>

      <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-2">
        Набор показателей
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
              onChange={(e) => set({ [key]: Number(e.target.value) || 0 })}
              className="w-full h-9 px-2 rounded-lg border border-line-2 text-lg font-bold focus:outline-none focus:border-green-light"
            />
          </div>
        ))}
      </div>
      <p className={`text-[11px] mt-3 ${Math.abs(sum - 1) < 0.001 ? 'text-muted-2' : 'text-[#c53030]'}`}>
        Сумма весов = {pct(sum)}. Планы бюджета и заявок задаются по каждой кампании —
        в «Отчётности → Кампании».
      </p>
    </div>
  )
}

// ——— Отдел продаж: план выручки ———
function SalesKpiSetup() {
  const settings = useQuery(api.settings.get, {})
  const update = useMutation(api.settings.update)
  const [draft, setDraft] = useState<{ salarySales: number; planRevenueSales: number } | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const cur = draft ?? {
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

  const set = (patch: Partial<typeof cur>) => {
    setDraft({ ...cur, ...patch })
    setSaved(false)
  }

  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <Sliders size={18} className="text-green" />
        <h3 className="sec-title flex-1">KPI · Отдел продаж</h3>
        <SaveBar dirty={!!draft} saving={saving} saved={saved} onSave={save} />
      </div>

      <FormulaNote>
        <b>МИН(выручка за месяц ÷ план выручки; 1)</b>, выплата — <b>оклад × KPI</b>. Выручка
        собирается из ежедневных отчётов отдела продаж.
      </FormulaNote>

      <div className="flex flex-col gap-4">
        <SalaryField
          value={cur.salarySales}
          onChange={(v) => set({ salarySales: v })}
          hint="база выплаты для должности"
        />
        <div className="pt-4 border-t border-line">
          <SalaryField
            label="План выручки, ₸"
            value={cur.planRevenueSales}
            onChange={(v) => set({ planRevenueSales: v })}
            hint="цель месяца, с которой сравнивается факт"
          />
        </div>
      </div>

      {cur.salarySales > 0 && cur.planRevenueSales === 0 && (
        <p className="text-[11px] text-[#c53030] mt-3">
          Без плана выручки KPI продаж не считается, и выплата останется нулевой.
        </p>
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

  const current = picked ?? settings?.reportDeadlineTime ?? '23:50'
  const options = useMemo(() => {
    const o: { value: string; label: string }[] = []
    for (let h = 12; h <= 23; h++)
      for (const m of ['00', '30']) {
        const t = `${String(h).padStart(2, '0')}:${m}`
        o.push({ value: t, label: t })
      }
    // Конец рабочего дня — стандартный дедлайн отчётности.
    o.push({ value: '23:50', label: '23:50 (конец дня)' })
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
