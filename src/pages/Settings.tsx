import { useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { Sliders, Users2, Building2, Timer, Check, Plus, Trash2, Pencil, Lock, X } from 'lucide-react'
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
import { PERM_SECTIONS, ACTION_LABEL, permKey } from '../../convex/permModel'

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
      <div className="mt-5">
        <ReportDeadlineCard />
      </div>

      {/* Матрица прав (§9) */}
      <div className="mt-5">
        <PermissionsCard />
      </div>

      {/* Справочники отделов и должностей (§11) */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 mt-5">
        <CatalogCard kind="departments" />
        <CatalogCard kind="positions" />
      </div>

      {/* Справочная информация */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 mt-5">
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Building2 size={18} className="text-green" />
            <h3 className="sec-title">Справочная информация</h3>
          </div>
          <div className="flex flex-col gap-3 text-sm">
            <Row label="Аккаунты" value="FRANCHONE · ANUAR" />
            <Row label="Источники денег" value="FRANCHONE · Партнёр" />
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

// ——— Матрица прав (§9) ———
// Владелец включает/выключает действия для ролей «Руководитель» и «Сотрудник».
// Владелец всегда имеет всё; роли/оклады/сама матрица — только владелец (вне
// матрицы). Руководитель действует в рамках своего отдела, сотрудник — только
// над своими данными (скоуп применяется на сервере).
function PermissionsCard() {
  const data = useQuery(api.permissions.matrix)
  const setMatrix = useMutation(api.permissions.setMatrix)
  const [tab, setTab] = useState<'head' | 'employee'>('head')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (data === undefined) return null
  if (data === null) return null // не владелец

  const allowed = new Set(tab === 'head' ? data.head : data.employee)
  const toggle = async (key: string) => {
    const next = new Set(allowed)
    if (next.has(key)) {
      next.delete(key)
    } else {
      next.add(key)
      // «Только свои» и «Все» — взаимоисключающие режимы просмотра.
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
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <Users2 size={18} className="text-green" />
        <h3 className="sec-title flex-1">Матрица прав</h3>
        <div className="flex items-center gap-1 p-1 bg-chip rounded-xl">
          {(['head', 'employee'] as const).map((r) => (
            <button
              key={r}
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
      <p className="text-[11px] text-muted-2 mb-4">
        Владелец всегда имеет полный доступ. Роли, оклады и сама матрица меняются только
        владельцем. Руководитель действует в своём отделе, сотрудник — только над своими данными.
      </p>
      {error && <p className="text-sm text-[#c53030] mb-3">{error}</p>}

      <div className="flex flex-col divide-y divide-line">
        {PERM_SECTIONS.map((s) => (
          <div key={s.key} className="flex items-center gap-3 py-3 first:pt-0 flex-wrap">
            <div className="w-28 shrink-0 text-sm font-medium text-ink">{s.label}</div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] text-muted mr-0.5">Просмотр:</span>
              {(['view', 'viewAll'] as const)
                .filter((a) => (s.actions as string[]).includes(a))
                .map((a) => (
                  <PermBtn
                    key={a}
                    label={ACTION_LABEL[a]}
                    on={allowed.has(permKey(s.key, a))}
                    busy={busy}
                    onClick={() => toggle(permKey(s.key, a))}
                  />
                ))}
              {s.actions.some((a) => a !== 'view' && a !== 'viewAll') && (
                <span className="w-px h-5 bg-line-2 mx-1" />
              )}
              {s.actions
                .filter((a) => a !== 'view' && a !== 'viewAll')
                .map((a) => (
                  <PermBtn
                    key={a}
                    label={ACTION_LABEL[a]}
                    on={allowed.has(permKey(s.key, a))}
                    busy={busy}
                    onClick={() => toggle(permKey(s.key, a))}
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
  const staff = activeEmployees.filter((e) => e.position === 'sales' && e.role !== 'owner')
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
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <Sliders size={18} className="text-green" />
        <h3 className="sec-title flex-1">KPI · Отдел продаж</h3>
        <SaveBar dirty={dirty} saving={saving} saved={saved} onSave={save} />
      </div>

      <FormulaNote>
        <b>МИН(выручка за месяц ÷ план выручки; 1)</b>, выплата — <b>оклад × KPI</b>. Выручка
        собирается из ежедневных отчётов отдела продаж.
      </FormulaNote>

      {error && <p className="text-sm text-[#c53030] mb-3">{error}</p>}

      {staff.length === 0 ? (
        <p className="text-sm text-muted">Нет действующих менеджеров по продажам.</p>
      ) : (
        <div className="flex flex-col gap-4">
          <EmployeePicker
            staff={staff}
            value={selected}
            onChange={(v) => {
              setEmpId(v)
              setSalary(null)
              setPlan(null)
              setSaved(false)
            }}
          />
          <SalaryField
            value={curSalary}
            onChange={(v) => {
              setSalary(v)
              setSaved(false)
            }}
            hint="персональный оклад сотрудника"
          />
          <div className="pt-4 border-t border-line">
            <SalaryField
              label="План выручки, ₸"
              value={curPlan}
              onChange={(v) => {
                setPlan(v)
                setSaved(false)
              }}
              hint="персональная цель месяца"
            />
          </div>
          {curSalary > 0 && curPlan === 0 && (
            <p className="text-[11px] text-[#c53030]">
              Без плана выручки KPI продаж не считается, и выплата останется нулевой.
            </p>
          )}
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
