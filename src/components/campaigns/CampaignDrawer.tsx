import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { X, Megaphone, Pencil, Trash2, Loader2, Plus, Check } from 'lucide-react'
import { api } from '../../../convex/_generated/api'
import type { Doc, Id } from '../../../convex/_generated/dataModel'
import Select from '@/components/ui/Select'
import DatePicker from '@/components/ui/DatePicker'
import { useApp } from '@/store'
import { kzt } from '@/lib/format'
import { formatMonth } from '@/lib/month'

type Campaign = Doc<'campaigns'>

const inputCls =
  'w-full rounded-lg border border-line-2 px-3 py-2.5 text-sm text-ink placeholder:text-muted focus:outline-none focus:border-green-light bg-white'
const labelCls = 'block text-sm font-medium text-ink-2 mb-1.5'

// Базовые аккаунты из KPI_TARGETOLOG; остальные подтягиваются из реестра,
// а новый можно завести прямо в форме — список не зашит намертво.
const BASE_ACCOUNTS = ['FRANCHONE', 'ANUAR']
const MONEY = ['FRANCHONE', 'Партнёр'] as const
const STATUSES = ['Активна', 'Пауза', 'Завершена'] as const

type Form = {
  code: string
  campaign: string
  brand: string
  account: string
  category: string
  moneySource: (typeof MONEY)[number]
  status: (typeof STATUSES)[number]
  startedAt: string
  endedAt: string
  note: string
}

const empty: Form = {
  code: '',
  campaign: '',
  brand: '',
  account: 'FRANCHONE',
  category: 'Свои услуги',
  moneySource: 'FRANCHONE',
  status: 'Активна',
  startedAt: '',
  endedAt: '',
  note: '',
}

export default function CampaignDrawer({
  campaign,
  month,
  onClose,
}: {
  campaign: Campaign | null
  month: string
  onClose: () => void
}) {
  const { role } = useApp()
  // Планы и веса — «жёлтые ячейки» руководителя: таргетолог их видит, но не правит.
  const canEditPlan = role === 'owner' || role === 'head'
  const isEdit = !!campaign

  const create = useMutation(api.campaigns.create)
  const update = useMutation(api.campaigns.update)
  const archive = useMutation(api.campaigns.archive)
  const setPlan = useMutation(api.campaigns.setPlan)
  const plans = useQuery(api.campaigns.plans, { month })
  const registry = useQuery(api.campaigns.registry, {})

  const plan = plans?.find((p) => p.campaignId === campaign?._id)

  const [f, setF] = useState<Form>(
    campaign
      ? {
          code: campaign.code,
          campaign: campaign.campaign,
          brand: campaign.brand,
          account: campaign.account,
          category: campaign.category,
          moneySource: campaign.moneySource,
          status: campaign.status,
          startedAt: campaign.startedAt ?? '',
          endedAt: campaign.endedAt ?? '',
          note: campaign.note ?? '',
        }
      : empty,
  )
  const [planBudget, setPlanBudget] = useState(0)
  const [planLeads, setPlanLeads] = useState(0)
  const [weight, setWeight] = useState(0)
  const [shown, setShown] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [error, setError] = useState('')
  const [newAccount, setNewAccount] = useState<string | null>(null)
  const [extraAccounts, setExtraAccounts] = useState<string[]>([])

  // Уже заведённые аккаунты + добавленные в этой сессии + текущий выбранный.
  const accounts = useMemo(
    () =>
      Array.from(
        new Set(
          [...BASE_ACCOUNTS, ...(registry ?? []).map((c) => c.account), ...extraAccounts, f.account]
            .map((a) => a.trim())
            .filter(Boolean),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [registry, extraAccounts, f.account],
  )

  useEffect(() => setShown(true), [])
  // План приезжает отдельным запросом — подставляем, когда он загрузился.
  useEffect(() => {
    if (!plan) return
    setPlanBudget(plan.planBudget)
    setPlanLeads(plan.planLeads)
    setWeight(plan.weight)
  }, [plan])

  const close = () => {
    setShown(false)
    setTimeout(onClose, 200)
  }
  const set = (patch: Partial<Form>) => {
    setF((p) => ({ ...p, ...patch }))
    setError('')
  }

  // Новый аккаунт живёт в списке до сохранения кампании; после сохранения он
  // появится у всех сам — список строится из реестра.
  const addAccount = () => {
    const name = (newAccount ?? '').trim()
    if (!name) return
    setExtraAccounts((a) => [...a, name])
    set({ account: name })
    setNewAccount(null)
  }

  const planCpl = planLeads > 0 ? planBudget / planLeads : 0

  const save = async () => {
    if (!f.code.trim()) return setError('Укажите ID кампании')
    if (!f.campaign.trim()) return setError('Укажите название кампании')
    setSaving(true)
    try {
      let id = campaign?._id
      if (isEdit) {
        await update({
          id: id as Id<'campaigns'>,
          account: f.account,
          category: f.category,
          brand: f.brand,
          campaign: f.campaign,
          moneySource: f.moneySource,
          status: f.status,
          startedAt: f.startedAt,
          endedAt: f.endedAt,
          note: f.note,
        })
      } else {
        id = await create({
          code: f.code,
          account: f.account,
          category: f.category,
          brand: f.brand,
          campaign: f.campaign,
          moneySource: f.moneySource,
          status: f.status,
          startedAt: f.startedAt,
          note: f.note,
        })
      }
      if (canEditPlan && id) {
        await setPlan({ campaignId: id, month, planBudget, planLeads, weight })
      }
      close()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить кампанию')
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!campaign) return
    setSaving(true)
    try {
      await archive({ id: campaign._id })
      close()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось убрать кампанию')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        onClick={close}
        className={`absolute inset-0 bg-black/30 transition-opacity duration-200 ${
          shown ? 'opacity-100' : 'opacity-0'
        }`}
      />
      <div
        className={`relative w-full max-w-md h-full bg-bg shadow-soft flex flex-col transition-transform duration-200 ease-out ${
          shown ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="shrink-0 bg-white border-b border-line px-5 sm:px-6 py-4 flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#e2f2ef] text-green-d grid place-items-center shrink-0">
            {isEdit ? <Pencil size={18} /> : <Megaphone size={19} />}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-ink leading-tight">
              {isEdit ? 'Редактировать кампанию' : 'Новая кампания'}
            </h2>
            <p className="text-[13px] text-muted mt-0.5">
              {isEdit ? campaign!.code : 'Сначала заводим карточку, потом план на месяц'}
            </p>
          </div>
          <button onClick={close} className="ico-btn w-9 h-9 shrink-0" title="Закрыть">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-5 flex flex-col gap-4">
          <Field label="ID кампании">
            <input
              className={`${inputCls} ${isEdit ? 'bg-chip text-muted' : ''}`}
              placeholder="FR-004"
              value={f.code}
              disabled={isEdit}
              onChange={(e) => set({ code: e.target.value.toUpperCase() })}
            />
            {isEdit && (
              <p className="text-[11px] text-muted-2 mt-1">
                ID менять нельзя: по нему ежедневные отчёты связаны с кампанией.
              </p>
            )}
          </Field>

          <Field label="Название кампании">
            <input
              className={inputCls}
              placeholder="Подбор франшизы"
              value={f.campaign}
              onChange={(e) => set({ campaign: e.target.value })}
            />
          </Field>

          <Field label="Бренд / услуга">
            <input
              className={inputCls}
              placeholder="Подбор франшизы"
              value={f.brand}
              onChange={(e) => set({ brand: e.target.value })}
            />
          </Field>

          <Field label="Аккаунт">
            {newAccount === null ? (
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <Select
                    value={f.account}
                    onChange={(v) => set({ account: v })}
                    options={accounts.map((a) => ({ value: a, label: a }))}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setNewAccount('')}
                  className="ico-btn w-10 h-10 shrink-0"
                  title="Добавить аккаунт"
                >
                  <Plus size={16} />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  className={inputCls}
                  placeholder="Название аккаунта"
                  value={newAccount}
                  onChange={(e) => setNewAccount(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addAccount()
                    }
                    if (e.key === 'Escape') setNewAccount(null)
                  }}
                />
                <button
                  type="button"
                  onClick={addAccount}
                  disabled={!newAccount.trim()}
                  className="ico-btn w-10 h-10 shrink-0 disabled:opacity-40"
                  title="Добавить"
                >
                  <Check size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => setNewAccount(null)}
                  className="ico-btn w-10 h-10 shrink-0"
                  title="Отмена"
                >
                  <X size={16} />
                </button>
              </div>
            )}
          </Field>

          <Field label="Категория">
            <input
              className={inputCls}
              placeholder="Свои услуги"
              value={f.category}
              onChange={(e) => set({ category: e.target.value })}
            />
          </Field>

          <Field label="Источник денег">
            <Select
              value={f.moneySource}
              onChange={(v) => set({ moneySource: v as Form['moneySource'] })}
              options={MONEY.map((m) => ({ value: m, label: m }))}
            />
            <p className="text-[11px] text-muted-2 mt-1">
              За чей счёт оплачивается реклама — своя или партнёрская.
            </p>
          </Field>

          <Field label="Статус">
            <Select
              value={f.status}
              onChange={(v) => set({ status: v as Form['status'] })}
              options={STATUSES.map((s) => ({ value: s, label: s }))}
            />
            <p className="text-[11px] text-muted-2 mt-1">
              В ежедневный отчёт попадают только активные кампании.
            </p>
          </Field>

          <Field label="Дата запуска">
            <DatePicker
              value={f.startedAt}
              onChange={(v) => set({ startedAt: v })}
              placeholder="Когда запустили"
            />
          </Field>

          <Field label="Дата завершения">
            <DatePicker
              value={f.endedAt}
              onChange={(v) => set({ endedAt: v })}
              placeholder="Пока не завершена"
            />
          </Field>

          <Field label="Комментарий">
            <textarea
              className={`${inputCls} min-h-[76px] resize-y`}
              placeholder="Что важно помнить по этой кампании"
              value={f.note}
              onChange={(e) => set({ note: e.target.value })}
            />
          </Field>

          <div className="border-t border-line pt-4">
            <div className="flex items-baseline gap-2 mb-3">
              <h3 className="sec-title">План на месяц</h3>
              <span className="text-[11px] text-muted">{formatMonth(month)}</span>
            </div>

            {!canEditPlan && (
              <p className="text-[11px] text-muted-2 mb-3">
                План и вес задаёт руководитель — поля только для просмотра.
              </p>
            )}

            <div className="flex flex-col gap-4">
              <Field label="План бюджета, ₸">
                <input
                  type="number"
                  min={0}
                  className={`${inputCls} ${canEditPlan ? '' : 'bg-chip text-muted'}`}
                  value={planBudget}
                  disabled={!canEditPlan}
                  onChange={(e) => setPlanBudget(Number(e.target.value) || 0)}
                />
              </Field>
              <Field label="План заявок">
                <input
                  type="number"
                  min={0}
                  className={`${inputCls} ${canEditPlan ? '' : 'bg-chip text-muted'}`}
                  value={planLeads}
                  disabled={!canEditPlan}
                  onChange={(e) => setPlanLeads(Number(e.target.value) || 0)}
                />
              </Field>
              <Field label="Вес в KPI">
                <input
                  type="number"
                  min={0}
                  max={1}
                  step="0.05"
                  className={`${inputCls} ${canEditPlan ? '' : 'bg-chip text-muted'}`}
                  value={weight}
                  disabled={!canEditPlan}
                  onChange={(e) => setWeight(Number(e.target.value) || 0)}
                />
                <p className="text-[11px] text-muted-2 mt-1">
                  Сумма весов всех кампаний месяца должна давать 100%.
                </p>
              </Field>
              <div className="rounded-xl bg-chip px-3 py-2.5 flex items-center justify-between">
                <span className="text-sm text-muted">План CPL</span>
                <span className="text-sm font-semibold text-ink tabular-nums">
                  {planLeads > 0 ? kzt(planCpl) : '—'}
                </span>
              </div>
            </div>

            {planBudget > 0 && planLeads === 0 && (
              <p className="text-[11px] text-[#c53030] mt-3">
                Без плана заявок кампания не попадёт в итоговый KPI — так же, как в Excel.
              </p>
            )}
          </div>
        </div>

        <div className="shrink-0 bg-white border-t border-line px-5 sm:px-6 py-4 flex flex-col gap-3">
          {error && <p className="text-sm text-[#c53030]">{error}</p>}
          {confirmDel ? (
            <div className="rounded-xl border border-[#f6cbcb] bg-[#fdeaea] p-3">
              <p className="text-sm text-ink-2 mb-3">
                Убрать «{f.campaign || f.code}» из реестра? Отчёты и расчёты за прошлые месяцы
                останутся в базе.
              </p>
              <div className="flex gap-2">
                <button onClick={remove} disabled={saving} className="btn btn-dark h-9 px-3 text-sm">
                  Убрать
                </button>
                <button onClick={() => setConfirmDel(false)} className="btn btn-ghost h-9 px-3 text-sm">
                  Отмена
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={save}
                disabled={saving}
                className="btn btn-green flex-1 disabled:opacity-60"
              >
                {saving && <Loader2 size={15} className="animate-spin" />}
                {isEdit ? 'Сохранить' : 'Создать кампанию'}
              </button>
              {isEdit && (
                <button
                  onClick={() => setConfirmDel(true)}
                  className="ico-btn w-10 h-10 text-muted hover:text-[#c53030]"
                  title="Убрать из реестра"
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      {children}
    </div>
  )
}
