import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { Check, ChevronLeft, ChevronRight, Loader2, Plus, Target, Trash2 } from 'lucide-react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import Select from '@/components/ui/Select'
import { errMessage } from '@/lib/errors'
import { num, usd } from '@/lib/format'
import { CURRENT_MONTH, addMonth, formatMonth } from '@/lib/month'
import { th, thRight, td, theadRow } from '@/lib/table'

// Планы таргетолога по объектам продаж (ТАРГЕТ 1.6 §3, §4, §11).
//
// План ставится на календарный месяц и на тройку «таргетолог + объект +
// месяц» — она может быть только одна. Планы можно заводить заранее на
// будущие месяцы (§3).

type PlanRow = {
  _id: Id<'targetLeadPlans'>
  employeeId: Id<'employees'>
  employeeName: string
  objectId: Id<'salesObjects'>
  objectName: string
  planLeads: number
  planBudgetCents: number | null
  planCostCents: number | null
}

const inputCls =
  'w-full h-9 rounded-lg border border-line-2 px-3 text-sm text-ink tabular-nums focus:outline-none focus:border-green-light'

export default function TargetLeadPlansSetup() {
  const [month, setMonth] = useState(CURRENT_MONTH)
  const data = useQuery(api.targetLeads.plans, { month })
  const setPlan = useMutation(api.targetLeads.setPlan)
  const removePlan = useMutation(api.targetLeads.removePlan)

  const [adding, setAdding] = useState(false)
  const [employeeId, setEmployeeId] = useState('')
  const [objectId, setObjectId] = useState('')
  const [leads, setLeads] = useState('')
  const [budget, setBudget] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const rows = (data?.rows ?? []) as PlanRow[]
  const targetologs = data?.targetologs ?? []
  const objects = data?.objects ?? []

  const reset = () => {
    setAdding(false)
    setEmployeeId('')
    setObjectId('')
    setLeads('')
    setBudget('')
  }

  const save = async () => {
    setError('')
    const emp = employeeId || targetologs[0]?._id
    if (!emp) {
      setError('Нет действующих таргетологов.')
      return
    }
    if (!objectId) {
      setError('Выберите объект продаж.')
      return
    }
    const planLeads = Math.round(Number(leads))
    if (!Number.isFinite(planLeads) || planLeads <= 0) {
      setError('План заявок — целое число больше нуля.')
      return
    }
    // §4: бюджет необязателен. Пустое поле — плана по деньгам просто нет.
    const raw = budget.trim().replace(',', '.')
    const planBudgetCents = raw === '' ? null : Math.round(Number(raw) * 100)
    if (planBudgetCents !== null && (!Number.isFinite(planBudgetCents) || planBudgetCents < 0)) {
      setError('Плановый бюджет — неотрицательное число в долларах.')
      return
    }
    setBusy('new')
    try {
      await setPlan({
        employeeId: emp as Id<'employees'>,
        objectId: objectId as Id<'salesObjects'>,
        month,
        planLeads,
        planBudgetCents,
      })
      reset()
    } catch (e) {
      setError(errMessage(e, 'Не удалось сохранить план.'))
    } finally {
      setBusy('')
    }
  }

  const drop = async (id: Id<'targetLeadPlans'>) => {
    setBusy(id)
    setError('')
    try {
      await removePlan({ planId: id })
    } catch (e) {
      setError(errMessage(e, 'Не удалось удалить план.'))
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <Target size={18} className="text-green" />
          <h3 className="sec-title flex-1">Планы таргетолога · заявки по объектам</h3>
          <div className="flex items-center gap-1 rounded-xl bg-chip p-1">
            <button
              onClick={() => setMonth(addMonth(month, -1))}
              className="ico-btn w-8 h-8 border-0 bg-transparent"
              title="Предыдущий месяц"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="px-2 text-sm font-semibold text-ink min-w-[116px] text-center">
              {formatMonth(month)}
            </span>
            <button
              onClick={() => setMonth(addMonth(month, 1))}
              className="ico-btn w-8 h-8 border-0 bg-transparent"
              title="Следующий месяц"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>

        <div className="rounded-xl bg-chip p-3 text-xs text-ink-2 mb-4">
          План ставится на календарный месяц по каждому объекту продаж. Плановый бюджет
          необязателен: без него KPI по заявкам продолжает считаться, не показывается только
          плановая цена заявки. Планы можно заводить заранее на будущие месяцы.
        </div>

        {error && <p className="text-sm text-[#c53030] mb-3">{error}</p>}

        {data === undefined ? (
          <div className="py-6 grid place-items-center text-muted">
            <Loader2 className="animate-spin" size={18} />
          </div>
        ) : (
          <>
            {rows.length === 0 ? (
              <p className="text-sm text-muted mb-4">На этот месяц планов ещё нет.</p>
            ) : (
              <div className="rounded-xl border border-line overflow-hidden overflow-x-auto mb-4">
                <table className="w-full min-w-[700px]">
                  <thead>
                    <tr className={theadRow}>
                      <th className={th}>Таргетолог</th>
                      <th className={th}>Объект продаж</th>
                      <th className={thRight}>План заявок</th>
                      <th className={thRight}>Плановый бюджет</th>
                      <th className={thRight}>Плановая цена заявки</th>
                      <th className={th} />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r._id}>
                        <td className={td}>{r.employeeName}</td>
                        <td className={td}>
                          <span className="font-medium text-ink">{r.objectName}</span>
                        </td>
                        <td className={`${td} text-right tabular-nums`}>{num(r.planLeads)}</td>
                        <td className={`${td} text-right tabular-nums`}>
                          {r.planBudgetCents === null ? (
                            <span className="text-muted-2">Не указан</span>
                          ) : (
                            usd(r.planBudgetCents)
                          )}
                        </td>
                        <td className={`${td} text-right tabular-nums font-semibold text-ink`}>
                          {r.planCostCents === null ? (
                            <span className="text-muted-2 font-normal">—</span>
                          ) : (
                            usd(r.planCostCents)
                          )}
                        </td>
                        <td className={`${td} text-right`}>
                          <button
                            onClick={() => drop(r._id)}
                            disabled={busy === r._id}
                            className="ico-btn w-8 h-8 text-[#c53030] disabled:opacity-40"
                            title="Удалить план"
                            aria-label="Удалить план"
                          >
                            {busy === r._id ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <Trash2 size={14} />
                            )}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {adding ? (
              <div className="rounded-xl border border-line p-4 flex flex-col gap-3">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <Field label="Таргетолог">
                    <Select
                      value={employeeId || targetologs[0]?._id || ''}
                      onChange={setEmployeeId}
                      placeholder="Выберите сотрудника"
                      options={targetologs.map((t) => ({ value: t._id, label: t.name }))}
                    />
                  </Field>
                  <Field label="Объект продаж">
                    <Select
                      value={objectId}
                      onChange={setObjectId}
                      placeholder="Выберите объект"
                      options={objects.map((o) => ({ value: o._id, label: o.name }))}
                    />
                  </Field>
                  <Field label="План заявок">
                    <input
                      className={inputCls}
                      inputMode="numeric"
                      placeholder="200"
                      value={leads}
                      onChange={(e) => setLeads(e.target.value)}
                    />
                  </Field>
                  <Field label="Плановый бюджет, $">
                    <input
                      className={inputCls}
                      inputMode="decimal"
                      placeholder="необязательно"
                      value={budget}
                      onChange={(e) => setBudget(e.target.value)}
                    />
                  </Field>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={save}
                    disabled={busy === 'new'}
                    className="btn btn-green h-9 px-4 text-sm disabled:opacity-60"
                  >
                    {busy === 'new' ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Check size={14} />
                    )}
                    Сохранить план
                  </button>
                  <button onClick={reset} className="btn btn-ghost h-9 px-4 text-sm">
                    Отмена
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setAdding(true)}
                disabled={targetologs.length === 0 || objects.length === 0}
                className="btn btn-green h-9 px-4 text-sm disabled:opacity-50"
              >
                <Plus size={15} /> Добавить план
              </button>
            )}
            {targetologs.length === 0 && (
              <p className="text-sm text-muted mt-3">Нет действующих таргетологов.</p>
            )}
          </>
        )}
      </div>

      <WeightBlock />
    </div>
  )
}

// §11: вес показателя «Выполнение плана по количеству заявок» в общем KPI.
// Сумма весов всех активных показателей должна составлять 100%. Пока у
// таргетолога это единственный показатель, поэтому его вес равен 100%.
function WeightBlock() {
  return (
    <div className="card p-5">
      <h3 className="sec-title mb-3">Показатели KPI · Таргетолог</h3>
      <div className="rounded-xl border border-line overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className={theadRow}>
              <th className={th}>Показатель</th>
              <th className={thRight}>Вес в общем KPI</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className={td}>
                <div className="font-medium text-ink">Выполнение плана по количеству заявок</div>
                <div className="text-[11px] text-muted">
                  Σ min(факт; план) ÷ Σ планов по объектам
                </div>
              </td>
              <td className={`${td} text-right tabular-nums font-semibold text-ink`}>100%</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted mt-3">
        Это единственный действующий показатель KPI таргетолога, поэтому его вес равен 100% —
        сумма весов всех активных показателей всегда составляет 100%. Итоговый коэффициент
        уходит в расчёт выплаты: выплата = оклад × KPI.
      </p>
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
