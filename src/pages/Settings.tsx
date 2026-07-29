import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { Sliders, Users2, Building2, Timer, Check, Plus, Trash2, Pencil, Lock, X, Briefcase, ChevronLeft, ChevronRight } from 'lucide-react'
import { api } from '../../convex/_generated/api'
import PageHeader from '@/components/PageHeader'
import Select from '@/components/ui/Select'
import { useData } from '@/lib/useData'
import { DEFAULT_WEIGHTS } from '@/lib/kpi'
import type { Id } from '../../convex/_generated/dataModel'
import { num, pct } from '@/lib/format'
import { CURRENT_MONTH, addMonth, formatMonth } from '@/lib/month'
import { errMessage } from '@/lib/errors'
import { th, td, theadRow } from '@/lib/table'
import { PERM_SECTIONS, ACTION_LABEL, permKey } from '../../convex/permModel'

const cellCls =
  'w-16 h-8 px-2 rounded-lg border border-line-2 text-sm text-right tabular-nums focus:outline-none focus:border-green-light'

// §5 ТЗ: «формулы расчёта и набор KPI настраиваются отдельно для каждой
// должности». Поэтому настройки сгруппированы по должности, а не по типу
// параметра: у каждой своя формула, свой оклад и свой набор показателей.
type SettingsTab = 'general' | 'smm' | 'targetolog' | 'sales'
const SETTINGS_TABS: { id: SettingsTab; label: string }[] = [
  { id: 'general', label: 'Общие' },
  { id: 'smm', label: 'SMM' },
  { id: 'targetolog', label: 'Таргетолог' },
  { id: 'sales', label: 'Отдел продаж' },
]

export default function Settings() {
  const [tab, setTab] = useState<SettingsTab>('general')

  return (
    <>
      <PageHeader title="Настройки" subtitle="KPI по должностям, отчётность и справочники" />

      <div className="flex items-center gap-1 p-1 bg-chip rounded-xl w-full sm:w-fit mb-5">
        {SETTINGS_TABS.map((p) => (
          <button
            key={p.id}
            onClick={() => setTab(p.id)}
            className={`h-9 px-4 rounded-lg text-sm font-semibold transition-colors flex-1 sm:flex-none ${
              tab === p.id
                ? 'bg-white text-ink shadow-card'
                : 'bg-line text-ink-2/70 hover:bg-line-2 hover:text-ink'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {tab === 'general' && <GeneralSettings />}
      {tab === 'smm' && <SmmKpiSetup />}
      {tab === 'targetolog' && <TargetologKpiSetup />}
      {tab === 'sales' && <SalesKpiSetup />}
    </>
  )
}

function GeneralSettings() {
  return (
    <div className="flex flex-col gap-5">
      <ReportDeadlineCard />
      <PermissionsCard />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <CatalogCard kind="departments" />
        <CatalogCard kind="positions" />
      </div>
    </div>
  )
}

// ——— Матрица прав (§9) ———
// Владелец включает/выключает действия для ролей «Руководитель» и «Сотрудник».
// Владелец всегда имеет всё; роли/оклады/сама матрица — только владелец.
function PermissionsCard() {
  const data = useQuery(api.permissions.matrix)
  const setMatrix = useMutation(api.permissions.setMatrix)
  const [tab, setTab] = useState<'head' | 'employee'>('head')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (data === undefined) return null
  if (data === null) return null

  const allowed = new Set(tab === 'head' ? data.head : data.employee)
  const toggle = async (key: string) => {
    const next = new Set(allowed)
    if (next.has(key)) {
      next.delete(key)
    } else {
      next.add(key)
      const [section, action] = key.split(':')
      if (action === 'view') next.delete(permKey(section, 'viewAll'))
      if (action === 'viewAll') next.delete(permKey(section, 'view'))
    }
    setBusy(true)
    setError('')
    try {
      await setMatrix({ role: tab, allowed: [...next] })
    } catch (e) {
      setError(errMessage(e, 'Не удалось сохранить.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <Users2 size={18} className="text-green" />
        <h3 className="sec-title flex-1">Матрица доступов</h3>
        <div className="flex items-center gap-1 p-1 bg-chip rounded-xl">
          {(['head', 'employee'] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setTab(r)}
              className={`h-8 px-3 rounded-lg text-sm font-semibold transition-colors ${
                tab === r ? 'bg-white text-ink shadow-card' : 'text-ink-2/70 hover:text-ink'
              }`}
            >
              {r === 'head' ? 'Руководитель' : 'Сотрудник'}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="text-sm text-[#c53030] mb-3">{error}</p>}

      <div className="flex flex-col divide-y divide-line">
        {PERM_SECTIONS.map((section) => (
          <div key={section.key} className="flex items-center gap-3 py-3 first:pt-0 flex-wrap">
            <div className="w-28 shrink-0 text-sm font-medium text-ink">{section.label}</div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] text-muted mr-0.5">Просмотр:</span>
              {(['view', 'viewAll'] as const)
                .filter((action) => (section.actions as string[]).includes(action))
                .map((action) => (
                  <PermBtn
                    key={action}
                    label={ACTION_LABEL[action]}
                    on={allowed.has(permKey(section.key, action))}
                    busy={busy}
                    onClick={() => toggle(permKey(section.key, action))}
                  />
                ))}
              {section.actions.some((action) => action !== 'view' && action !== 'viewAll') && (
                <span className="w-px h-5 bg-line-2 mx-1" />
              )}
              {section.actions
                .filter((action) => action !== 'view' && action !== 'viewAll')
                .map((action) => (
                  <PermBtn
                    key={action}
                    label={ACTION_LABEL[action]}
                    on={allowed.has(permKey(section.key, action))}
                    busy={busy}
                    onClick={() => toggle(permKey(section.key, action))}
                  />
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function PermBtn({
  label,
  on,
  busy,
  onClick,
}: {
  label: string
  on: boolean
  busy: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={`h-8 px-3 rounded-lg text-xs font-semibold border transition-colors disabled:opacity-60 ${
        on
          ? 'bg-[#e2f2ef] text-green-d border-green-light'
          : 'bg-white text-muted border-line-2 hover:bg-chip'
      }`}
    >
      {label}
    </button>
  )
}

// ——— Справочники: CRUD отделов и должностей (§11) ———
// Один компонент на оба справочника: у отделов — name, у должностей — label +
// slug + защита встроенных (с KPI). Владелец добавляет/переименовывает/удаляет.
function CatalogCard({ kind }: { kind: 'departments' | 'positions' }) {
  const isDep = kind === 'departments'
  const items = useQuery(isDep ? api.departments.list : api.positions.list) ?? []
  const createDep = useMutation(api.departments.create)
  const renameDep = useMutation(api.departments.rename)
  const removeDep = useMutation(api.departments.remove)
  const createPos = useMutation(api.positions.create)
  const renamePos = useMutation(api.positions.rename)
  const removePos = useMutation(api.positions.remove)

  const [draft, setDraft] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [editVal, setEditVal] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const run = async (fn: () => Promise<unknown>) => {
    setError('')
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      setError(errMessage(e, 'Не удалось сохранить.'))
    } finally {
      setBusy(false)
    }
  }

  const add = () => {
    const v = draft.trim()
    if (!v) return
    run(async () => {
      if (isDep) await createDep({ name: v })
      else await createPos({ label: v })
      setDraft('')
    })
  }
  const saveEdit = (id: string) => {
    const v = editVal.trim()
    if (!v) return
    run(async () => {
      if (isDep) await renameDep({ id: id as Id<'departments'>, name: v })
      else await renamePos({ id: id as Id<'positions'>, label: v })
      setEditId(null)
    })
  }
  const del = (id: string) =>
    run(() => (isDep ? removeDep({ id: id as Id<'departments'> }) : removePos({ id: id as Id<'positions'> })))

  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-4">
        <Building2 size={18} className="text-green" />
        <h3 className="sec-title flex-1">{isDep ? 'Отделы' : 'Должности'}</h3>
        <span className="text-xs text-muted">{items.length}</span>
      </div>

      {error && <p className="text-sm text-[#c53030] mb-3">{error}</p>}

      <div className="flex flex-col divide-y divide-line mb-3">
        {items.map((it) => {
          const id = it._id as string
          const label = isDep ? (it as { name: string }).name : (it as { label: string }).label
          const builtin = !isDep && (it as { builtin?: boolean }).builtin === true
          const editing = editId === id
          return (
            <div key={id} className="flex items-center gap-2 py-2.5 first:pt-0">
              {editing ? (
                <>
                  <input
                    autoFocus
                    value={editVal}
                    onChange={(e) => setEditVal(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && saveEdit(id)}
                    className="flex-1 h-9 px-2.5 rounded-lg border border-line-2 text-sm focus:outline-none focus:border-green-light"
                  />
                  <button onClick={() => saveEdit(id)} disabled={busy} className="ico-btn w-8 h-8 text-green-d" title="Сохранить">
                    <Check size={15} />
                  </button>
                  <button onClick={() => setEditId(null)} className="ico-btn w-8 h-8" title="Отмена">
                    <X size={15} />
                  </button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm text-ink truncate">{label}</span>
                  {builtin ? (
                    <span className="chip bg-chip text-muted-2" title="Встроенная должность с моделью KPI">
                      <Lock size={11} /> KPI
                    </span>
                  ) : null}
                  <button
                    onClick={() => {
                      setEditId(id)
                      setEditVal(label)
                    }}
                    className="ico-btn w-8 h-8 text-muted hover:text-ink"
                    title="Переименовать"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => del(id)}
                    disabled={busy || builtin}
                    className="ico-btn w-8 h-8 text-muted hover:text-[#c53030] disabled:opacity-30 disabled:hover:text-muted"
                    title={builtin ? 'Встроенную нельзя удалить' : 'Удалить'}
                  >
                    <Trash2 size={14} />
                  </button>
                </>
              )}
            </div>
          )
        })}
        {items.length === 0 && <p className="text-sm text-muted py-2">Пока пусто.</p>}
      </div>

      <div className="flex items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder={isDep ? 'Новый отдел' : 'Новая должность'}
          className="flex-1 h-9 px-2.5 rounded-lg border border-line-2 text-sm focus:outline-none focus:border-green-light"
        />
        <button onClick={add} disabled={busy || !draft.trim()} className="btn btn-green h-9 px-3 text-sm disabled:opacity-60">
          <Plus size={15} /> Добавить
        </button>
      </div>
      {!isDep && (
        <p className="text-[11px] text-muted-2 mt-3">
          У новой должности нет модели KPI — её добавляют кодом. Должности с KPI (SMM, таргетолог,
          продажи) удалять нельзя.
        </p>
      )}
    </div>
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

// Выбор сотрудника, чей персональный план/оклад настраиваем. Один в команде —
// показываем имя; несколько — выпадающий список.
function EmployeePicker({
  staff,
  value,
  onChange,
}: {
  staff: { id: string; name: string }[]
  value: string
  onChange: (v: string) => void
}) {
  if (staff.length <= 1) {
    return (
      <div className="text-sm text-muted">
        Сотрудник: <span className="font-medium text-ink">{staff[0]?.name ?? '—'}</span>
      </div>
    )
  }
  return (
    <div className="w-64">
      <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-1">Сотрудник</div>
      <Select value={value} onChange={onChange} options={staff.map((e) => ({ value: e.id, label: e.name }))} />
    </div>
  )
}

function EmployeeTabs({
  staff,
  value,
  onChange,
}: {
  staff: { id: string; name: string }[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div>
      <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-2">Сотрудник</div>
      <div className="flex flex-wrap gap-1.5">
        {staff.map((e) => {
          const active = e.id === value
          return (
            <button
              key={e.id}
              type="button"
              onClick={() => onChange(e.id)}
              className={`h-8 px-3 rounded-lg text-xs font-semibold border transition-colors ${
                active
                  ? 'bg-[#e2f2ef] text-green-d border-green-light'
                  : 'bg-white text-muted border-line-2 hover:bg-chip'
              }`}
            >
              {e.name}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function SmmKpiSetup() {
  const { activeEmployees } = useData()
  const staff = activeEmployees.filter((e) => e.position === 'smm' && e.role !== 'owner')
  const [empId, setEmpId] = useState('')
  const selected = empId || staff[0]?.id || ''
  const selectedEmp = staff.find((e) => e.id === selected)
  const metricsRaw = useQuery(
    api.smm.list,
    selected ? { month: CURRENT_MONTH, employeeId: selected as Id<'employees'> } : 'skip',
  )
  const smmMetrics = (metricsRaw ?? []).map((m) => ({
    id: m._id as string,
    account: m.account,
    format: m.format,
    weight: m.weight,
    weekPlans: m.weekPlans,
  }))
  const updateEmployee = useMutation(api.employees.update)
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

  const curSalary = salary ?? selectedEmp?.salary ?? 0
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
      if (salary !== null && selected) {
        await updateEmployee({ id: selected as Id<'employees'>, patch: { salary } })
      }
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

      {staff.length === 0 ? (
        <p className="text-sm text-muted">Нет действующих SMM-специалистов.</p>
      ) : (
        <>
      <div className="mb-4">
        <EmployeePicker
          staff={staff}
          value={selected}
          onChange={(v) => {
            setEmpId(v)
            setDraft({})
            setSalary(null)
            setSaved(false)
          }}
        />
      </div>

      <div className="mb-4">
        <SalaryField
          value={curSalary}
          onChange={(v) => {
            setSalary(v)
            setSaved(false)
          }}
          hint="персональный оклад сотрудника"
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
                    employeeId: selected as Id<'employees'>,
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
        </>
      )}
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
  const { activeEmployees } = useData()
  const salesManagers = useQuery(api.sales.managers, {})
  const staff =
    salesManagers ??
    activeEmployees
      .filter((e) => e.position === 'sales' && e.role !== 'owner')
      .map((e) => ({ id: e.id, name: e.name, salary: e.salary }))
  const [empId, setEmpId] = useState('')
  const selected = empId || staff[0]?.id || ''
  const emp = staff.find((e) => e.id === selected)
  const summary = useQuery(
    api.sales.summary,
    selected ? { month: CURRENT_MONTH, employeeId: selected as Id<'employees'> } : 'skip',
  )
  const updateEmployee = useMutation(api.employees.update)
  const setSalesPlan = useMutation(api.sales.setPlan)

  const [salary, setSalary] = useState<number | null>(null)
  const [plan, setPlan] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const curSalary = salary ?? emp?.salary ?? 0
  const curPlan = plan ?? summary?.planRevenue ?? 0
  const dirty = salary !== null || plan !== null

  const save = async () => {
    if (!selected) return
    setSaving(true)
    setError('')
    try {
      if (salary !== null) await updateEmployee({ id: selected as Id<'employees'>, patch: { salary } })
      if (plan !== null) {
        await setSalesPlan({ employeeId: selected as Id<'employees'>, month: CURRENT_MONTH, planRevenue: plan })
      }
      setSalary(null)
      setPlan(null)
      setSaved(true)
    } catch (e) {
      setError(errMessage(e, 'Не удалось сохранить.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <Sliders size={18} className="text-green" />
          <h3 className="sec-title flex-1">KPI · Отдел продаж</h3>
          <SaveBar dirty={dirty} saving={saving} saved={saved} onSave={save} />
        </div>

        <FormulaNote>
          <b>МИН(выручка за месяц ÷ план выручки; 1)</b>, выплата — <b>оклад × KPI</b>. Выручка
          собирается из ежедневных объектных отчётов отдела продаж.
        </FormulaNote>

        {error && <p className="text-sm text-[#c53030] mb-3">{error}</p>}

        {staff.length === 0 ? (
          <p className="text-sm text-muted">Нет действующих менеджеров по продажам.</p>
        ) : (
          <div className="flex flex-col gap-4">
            <EmployeeTabs
              staff={staff}
              value={selected}
              onChange={(v) => {
                setEmpId(v)
                setSalary(null)
                setPlan(null)
                setSaved(false)
              }}
            />
            <div className="grid gap-4 lg:grid-cols-2">
              <SalaryField
                value={curSalary}
                onChange={(v) => {
                  setSalary(v)
                  setSaved(false)
                }}
                hint="персональный оклад сотрудника"
              />
              <div className="lg:border-l lg:border-line lg:pl-4">
                <SalaryField
                  label="План выручки, ₸"
                  value={curPlan}
                  onChange={(v) => {
                    setPlan(v)
                    setSaved(false)
                  }}
                  hint="персональная цель месяца для начислений KPI"
                />
              </div>
            </div>
            {curSalary > 0 && curPlan === 0 && (
              <p className="text-[11px] text-[#c53030]">
                Без плана выручки KPI продаж не считается, и выплата останется нулевой.
              </p>
            )}
          </div>
        )}
      </div>

      <SalesObjectsSetup />
    </div>
  )
}

function SalesObjectsSetup() {
  const { activeEmployees } = useData()
  const salesManagers = useQuery(api.sales.managers, {})
  const staff =
    salesManagers ??
    activeEmployees
      .filter((e) => e.position === 'sales' && e.role !== 'owner')
      .map((e) => ({ id: e.id, name: e.name, initials: e.initials, avatarColor: e.avatarColor }))
  const [month, setMonth] = useState(CURRENT_MONTH)
  const objects = useQuery(api.sales.objects) ?? []
  const monthRows = useQuery(api.sales.monthSettings, { month }) ?? []
  const saveObject = useMutation(api.sales.upsertObject)
  const saveMonth = useMutation(api.sales.upsertMonth)

  const [statusFilter, setStatusFilter] = useState<'active' | 'paused' | 'archived' | 'all'>('active')
  const [name, setName] = useState('')
  const [type, setType] = useState<'franchise' | 'service' | 'product'>('franchise')
  const [createStatus, setCreateStatus] = useState<'active' | 'paused' | 'archived'>('active')
  const [managerIds, setManagerIds] = useState<string[]>([])
  const [comment, setComment] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [createShown, setCreateShown] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const isPastMonth = month < CURRENT_MONTH
  const createDateLabel = new Date().toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Asia/Almaty',
  })
  const monthRowByObject = new Map(monthRows.map((row) => [String(row.objectId), row]))
  const nextMonthStart = new Date(`${addMonth(month, 1)}-01T00:00:00+05:00`).getTime()
  const existedInMonth = (object: { createdAt: number }) => object.createdAt < nextMonthStart
  const statusForMonth = (object: { _id: string; status: 'active' | 'paused' | 'archived' }) =>
    monthRowByObject.get(object._id)?.objectStatus ?? object.status
  const filteredObjects = objects.filter(
    (object) =>
      existedInMonth(object) && (statusFilter === 'all' || statusForMonth(object) === statusFilter),
  )
  const statusFilterTabs: { value: typeof statusFilter; label: string }[] = [
    { value: 'active', label: 'Активен' },
    { value: 'paused', label: 'На паузе' },
    { value: 'archived', label: 'Архив' },
    { value: 'all', label: 'Все' },
  ]

  useEffect(() => {
    if (!createOpen) return undefined
    const frame = requestAnimationFrame(() => setCreateShown(true))
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeCreateDrawer()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('keydown', onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createOpen])

  const closeCreateDrawer = () => {
    setCreateShown(false)
    window.setTimeout(() => {
      setCreateOpen(false)
      setError('')
    }, 200)
  }

  const add = async (event?: { preventDefault: () => void }) => {
    event?.preventDefault()
    const clean = name.trim()
    if (!clean || isPastMonth) return
    setBusy(true)
    setError('')
    try {
      await saveObject({
        name: clean,
        type,
        status: createStatus,
        managerIds: managerIds as Id<'employees'>[],
        comment: comment.trim() || undefined,
        month,
      })
      setName('')
      setCreateStatus('active')
      setManagerIds([])
      setComment('')
      closeCreateDrawer()
    } catch (e) {
      setError(errMessage(e, 'Не удалось создать объект продаж.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <Briefcase size={18} className="text-green" />
        <h3 className="sec-title flex-1">Объекты продаж и планы месяца</h3>
        <div className="flex items-center gap-1 rounded-xl bg-chip p-1 order-2 sm:order-none">
          {statusFilterTabs.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setStatusFilter(tab.value)}
              className={`h-8 px-3 rounded-lg text-sm font-semibold transition-colors ${
                statusFilter === tab.value
                  ? 'bg-white text-ink shadow-card'
                  : 'text-muted hover:bg-white/70 hover:text-ink'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 rounded-xl bg-chip p-1 order-2 sm:order-none">
          <button onClick={() => setMonth(addMonth(month, -1))} className="ico-btn w-8 h-8 border-0 bg-transparent" title="Предыдущий месяц">
            <ChevronLeft size={15} />
          </button>
          <span className="px-2 text-sm font-semibold text-ink min-w-[116px] text-center">{formatMonth(month)}</span>
          <button onClick={() => setMonth(addMonth(month, 1))} className="ico-btn w-8 h-8 border-0 bg-transparent" title="Следующий месяц">
            <ChevronRight size={15} />
          </button>
        </div>
        <button
          onClick={() => {
            if (isPastMonth) return
            setError('')
            setCreateShown(false)
            setCreateOpen(true)
          }}
          disabled={isPastMonth}
          className="btn btn-green h-10 px-4 text-sm disabled:opacity-55 order-1 sm:order-none"
          title={isPastMonth ? 'В прошлом периоде создание недоступно' : 'Создать объект продаж'}
        >
          <Plus size={16} /> Создать объект
        </button>
      </div>

      {isPastMonth && (
        <div className="rounded-xl border border-[#d69e2e]/30 bg-[#fff6e6] px-3 py-2 text-sm text-[#8a5a00] mb-3">
          Прошлый период доступен только для просмотра. Создание объектов, планы и назначения
          меняются с текущего месяца и будущих периодов.
        </div>
      )}

      <div>
        {filteredObjects.length > 0 ? (
          <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
            {filteredObjects.map((object) => (
              <SalesObjectRow
                key={`${month}:${object._id}`}
                object={object}
                effectiveStatus={statusForMonth(object)}
                staff={staff}
                month={month}
                monthRow={monthRowByObject.get(object._id)}
                onSaveObject={saveObject}
                onSaveMonth={saveMonth}
                readOnly={isPastMonth}
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted p-3">
            {objects.length > 0 ? 'Нет объектов с выбранным статусом.' : 'Пока нет объектов продаж.'}
          </p>
        )}
      </div>
      <p className="text-[11px] text-muted-2 mt-3">
        Если объект уже использовался в отчётах, его не удаляем физически: переведите в архив,
        и история останется доступной по прошлым месяцам.
      </p>

      {createOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <button
            type="button"
            aria-label="Закрыть создание объекта продаж"
            onClick={closeCreateDrawer}
            className={`absolute inset-0 bg-black/30 transition-opacity duration-200 ${
              createShown ? 'opacity-100' : 'opacity-0'
            }`}
          />
          <div
            className={`relative w-full max-w-md h-full bg-bg shadow-soft flex flex-col transition-transform duration-200 ease-out ${
              createShown ? 'translate-x-0' : 'translate-x-full'
            }`}
          >
            <div className="shrink-0 bg-white border-b border-line px-5 sm:px-6 py-4 flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#e2f2ef] text-green-d grid place-items-center shrink-0">
                <Plus size={19} />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-bold text-ink leading-tight">Создать объект продаж</h2>
                <p className="text-[13px] text-muted mt-0.5">{formatMonth(month)}</p>
              </div>
              <button onClick={closeCreateDrawer} className="ico-btn w-9 h-9 shrink-0" title="Закрыть">
                <X size={16} />
              </button>
            </div>

            <form onSubmit={add} className="flex-1 min-h-0 flex flex-col">
              <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-5 flex flex-col gap-4">
                {error && <p className="rounded-xl border border-[#c53030]/20 bg-[#fff5f5] px-3 py-2 text-sm text-[#c53030]">{error}</p>}
                <div>
                  <label className="block text-[11px] uppercase font-bold text-muted mb-1.5">Объект продаж</label>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Название объекта продаж"
                    autoFocus
                    className="w-full h-10 px-3 rounded-lg border border-line-2 text-sm focus:outline-none focus:border-green-light"
                  />
                </div>
                <div>
                  <label className="block text-[11px] uppercase font-bold text-muted mb-1.5">Тип</label>
                  <Select
                    value={type}
                    onChange={(v) => setType(v as typeof type)}
                    options={[
                      { value: 'franchise', label: 'Франшиза' },
                      { value: 'service', label: 'Услуга' },
                      { value: 'product', label: 'Другой продукт' },
                    ]}
                  />
                </div>
                <div>
                  <label className="block text-[11px] uppercase font-bold text-muted mb-1.5">Статус</label>
                  <Select
                    value={createStatus}
                    onChange={(v) => setCreateStatus(v as typeof createStatus)}
                    options={[
                      { value: 'active', label: 'Активен' },
                      { value: 'paused', label: 'На паузе' },
                      { value: 'archived', label: 'Архив' },
                    ]}
                  />
                </div>
                <div>
                  <label className="block text-[11px] uppercase font-bold text-muted mb-1.5">Ответственный менеджер</label>
                  <ManagerChecks staff={staff} selected={managerIds} onChange={setManagerIds} />
                </div>
                <div>
                  <label className="block text-[11px] uppercase font-bold text-muted mb-1.5">Комментарий</label>
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Комментарий"
                    rows={4}
                    className="w-full px-3 py-2.5 rounded-lg border border-line-2 text-sm focus:outline-none focus:border-green-light resize-y"
                  />
                </div>
                <div>
                  <label className="block text-[11px] uppercase font-bold text-muted mb-1.5">Дата создания</label>
                  <div className="text-sm font-semibold text-muted">{createDateLabel}</div>
                </div>
              </div>

              <div className="shrink-0 bg-white border-t border-line px-5 sm:px-6 py-4 flex items-center justify-end gap-2">
                <button type="button" onClick={closeCreateDrawer} className="btn h-10 px-4">
                  Отмена
                </button>
                <button type="submit" disabled={busy || !name.trim()} className="btn btn-green h-10 px-4 disabled:opacity-60">
                  <Plus size={16} /> Создать объект
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

function ManagerChecks({
  staff,
  selected,
  onChange,
  disabled = false,
}: {
  staff: { id: string; name: string; initials?: string; avatarColor?: string }[]
  selected: string[]
  onChange: (ids: string[]) => void
  disabled?: boolean
}) {
  const set = new Set(selected)
  return (
    <div className="flex flex-wrap gap-1.5 mt-3">
      {staff.map((e) => {
        const on = set.has(e.id)
        return (
          <button
            key={e.id}
            type="button"
            disabled={disabled}
            onClick={() => {
              if (disabled) return
              const next = new Set(set)
              if (on) next.delete(e.id)
              else next.add(e.id)
              onChange([...next])
            }}
            className={`h-8 px-3 rounded-lg text-xs font-semibold border transition-colors disabled:cursor-not-allowed ${
              on ? 'bg-[#e2f2ef] text-green-d border-green-light' : 'bg-white text-muted border-line-2 hover:bg-chip'
            }`}
          >
            {e.name}
          </button>
        )
      })}
      {staff.length === 0 && <span className="text-xs text-muted">Нет менеджеров продаж.</span>}
    </div>
  )
}

function SalesObjectRow({
  object,
  effectiveStatus,
  staff,
  month,
  monthRow,
  onSaveObject,
  onSaveMonth,
  readOnly = false,
}: {
  object: {
    _id: string
    name: string
    type: 'franchise' | 'service' | 'product'
    status: 'active' | 'paused' | 'archived'
    managerIds: string[]
    createdAt: number
    comment?: string
  }
  effectiveStatus: 'active' | 'paused' | 'archived'
  staff: { id: string; name: string; initials?: string; avatarColor?: string }[]
  month: string
  monthRow?: {
    objectStatus?: 'active' | 'paused' | 'archived'
    status: 'selling' | 'not_selling'
    managerPlans: { managerId: string; planDeals: number }[]
  }
  onSaveObject: ReturnType<typeof useMutation<typeof api.sales.upsertObject>>
  onSaveMonth: ReturnType<typeof useMutation<typeof api.sales.upsertMonth>>
  readOnly?: boolean
}) {
  const [name, setName] = useState(object.name)
  const [status, setStatus] = useState(effectiveStatus)
  const [type, setType] = useState(object.type)
  const [comment, setComment] = useState(object.comment ?? '')
  const [managerIds, setManagerIds] = useState<string[]>(
    () => monthRow?.managerPlans.map((p) => p.managerId) ?? object.managerIds,
  )
  const [selling, setSelling] = useState((monthRow?.status ?? 'not_selling') === 'selling')
  const [plans, setPlans] = useState<Record<string, number>>(() => {
    const out: Record<string, number> = {}
    for (const p of monthRow?.managerPlans ?? []) out[p.managerId] = p.planDeals
    return out
  })
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const save = async () => {
    if (readOnly) return
    setBusy(true)
    setSaved(false)
    setError('')
    try {
      await onSaveObject({
        id: object._id as Id<'salesObjects'>,
        name,
        type,
        status,
        managerIds: managerIds as Id<'employees'>[],
        comment: comment.trim() || undefined,
        month,
      })
      await onSaveMonth({
        objectId: object._id as Id<'salesObjects'>,
        month,
        objectStatus: status,
        status: selling && status !== 'archived' ? 'selling' : 'not_selling',
        managerPlans: managerIds.map((id) => ({
          managerId: id as Id<'employees'>,
          planDeals: Math.max(0, Math.floor(plans[id] || 0)),
        })),
      })
      setSaved(true)
    } catch (e) {
      setError(errMessage(e, 'Не удалось сохранить объект продаж.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-2xl border border-line bg-white p-4">
      {readOnly && (
        <div className="mb-3 rounded-lg bg-chip px-3 py-2 text-xs font-semibold text-muted">
          Просмотр прошлого периода
        </div>
      )}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-1">Объект продаж</div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={readOnly}
            className="w-full h-10 px-3 rounded-lg border border-line-2 text-base font-semibold focus:outline-none focus:border-green-light"
          />
        </div>
        <button onClick={save} disabled={busy || !name.trim() || readOnly} className="btn btn-green h-10 px-3 text-sm disabled:opacity-60 shrink-0">
          {saved ? <Check size={15} /> : null}
          Сохранить
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-1">Тип</div>
          <Select
            value={type}
            onChange={(v) => setType(v as typeof type)}
            disabled={readOnly}
            options={[
              { value: 'franchise', label: 'Франшиза' },
              { value: 'service', label: 'Услуга' },
              { value: 'product', label: 'Другой продукт' },
            ]}
          />
        </div>
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-1">Статус</div>
          <Select
            value={status}
            onChange={(v) => setStatus(v as typeof status)}
            disabled={readOnly}
            options={[
              { value: 'active', label: 'Активен' },
              { value: 'paused', label: 'На паузе' },
              { value: 'archived', label: 'Архив' },
            ]}
          />
        </div>
      </div>

      <div className="mt-3">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-1">
          Комментарий
        </div>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Комментарий"
          disabled={readOnly}
          rows={3}
          className="w-full px-3 py-2.5 rounded-lg border border-line-2 text-sm focus:outline-none focus:border-green-light resize-y"
        />
      </div>

      <div className="mt-4 flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setSelling((v) => !v)}
          disabled={status === 'archived' || readOnly}
          className={`h-9 px-3 rounded-lg text-xs font-semibold border transition-colors disabled:opacity-40 ${
            selling && status !== 'archived'
              ? 'bg-[#e2f2ef] text-green-d border-green-light'
              : 'bg-white text-muted border-line-2 hover:bg-chip'
          }`}
        >
          {selling && status !== 'archived' ? 'Продаётся в месяце' : 'Не продаётся в месяце'}
        </button>
        <span className="h-9 px-3 rounded-lg bg-chip inline-flex items-center text-xs font-semibold text-muted">
          План сделок: {num(managerIds.reduce((s, id) => s + (plans[id] || 0), 0))}
        </span>
      </div>

      <div className="mt-4">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Менеджеры</div>
        <ManagerChecks staff={staff} selected={managerIds} onChange={setManagerIds} disabled={readOnly} />
      </div>

      {managerIds.length > 0 && (
        <div className="grid gap-2 mt-3">
          {managerIds.map((id) => {
            const manager = staff.find((e) => e.id === id)
            return (
              <div key={id} className="flex items-center gap-2 rounded-xl bg-chip p-2">
                <span
                  className="w-7 h-7 rounded-full grid place-items-center text-white text-[11px] font-bold shrink-0"
                  style={{ background: manager?.avatarColor ?? '#057269' }}
                >
                  {manager?.initials ?? manager?.name.slice(0, 2).toUpperCase() ?? 'М'}
                </span>
                <span className="text-sm text-ink-2 flex-1 truncate">{manager?.name ?? 'Менеджер'}</span>
                <input
                  type="number"
                  min={0}
                  placeholder="0"
                  value={plans[id] ? String(plans[id]) : ''}
                  disabled={readOnly}
                  onChange={(e) => setPlans((p) => ({ ...p, [id]: Math.max(0, Number(e.target.value) || 0) }))}
                  className="w-20 h-9 px-2 rounded-lg border border-line-2 text-sm text-right placeholder:text-muted focus:outline-none focus:border-green-light"
                />
              </div>
            )
          })}
        </div>
      )}
      {error && <p className="text-sm text-[#c53030] mt-3">{error}</p>}
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
