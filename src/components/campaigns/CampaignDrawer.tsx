import { useEffect, useState, type ReactNode } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { X, Megaphone, Loader2, Lock } from 'lucide-react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import Select from '@/components/ui/Select'
import DatePicker from '@/components/ui/DatePicker'
import { errMessage } from '@/lib/errors'
import { TODAY } from '@/lib/constants'
import { CAMPAIGN_GOALS, type CampaignGoalSlug } from '../../../convex/campaignGoals'

// Карточка рекламной кампании (ТЗ таргетолога §7.1). Кампания обязательно
// привязана к одному объекту продаж и одной цели. Свободных «бренда» и
// «категории» больше нет — их роль выполняет объект продаж (§2.2).
// Планов, весов и KPI здесь нет: новое ТЗ их не предусматривает.

const inputCls =
  'w-full rounded-lg border border-line-2 px-3 py-2.5 text-sm text-ink placeholder:text-muted focus:outline-none focus:border-green-light bg-white'
const labelCls = 'block text-sm font-medium text-ink-2 mb-1.5'

const ACCOUNTS = ['FRANCHONE', 'Anuar'] as const
const MONEY = ['FRANCHONE', 'Партнёр'] as const

export type RegistryRow = {
  _id: Id<'campaigns'>
  code: string
  campaign: string
  account: string
  moneySource: string
  status: string
  goal?: string
  startedAt?: string
  note?: string
  objectId?: Id<'salesObjects'>
  objectName: string | null
}

export default function CampaignDrawer({
  campaign,
  presetObjectId,
  onClose,
}: {
  campaign: RegistryRow | null
  // Объект, выбранный заранее: когда кампанию заводят из карточки объекта
  // продаж, спрашивать его ещё раз незачем.
  presetObjectId?: Id<'salesObjects'>
  onClose: () => void
}) {
  const isEdit = !!campaign
  const create = useMutation(api.target.createCampaign)
  const update = useMutation(api.target.updateCampaign)
  // Архивный объект в списке не показываем, но у уже сохранённой кампании
  // оставляем её собственный — иначе поле молча опустеет при открытии.
  const objects = useQuery(
    api.target.objectOptions,
    campaign?.objectId ? { includeId: campaign.objectId } : {},
  )

  const [code, setCode] = useState(campaign?.code ?? '')
  const [objectId, setObjectId] = useState<string>(campaign?.objectId ?? presetObjectId ?? '')
  const [goal, setGoal] = useState<string>(campaign?.goal ?? '')
  const [account, setAccount] = useState<string>(campaign?.account ?? 'FRANCHONE')
  const [moneySource, setMoneySource] = useState<string>(campaign?.moneySource ?? 'FRANCHONE')
  const [startedAt, setStartedAt] = useState(campaign?.startedAt ?? TODAY)
  const [note, setNote] = useState(campaign?.note ?? '')

  const [shown, setShown] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => setShown(true), [])
  const close = () => {
    setShown(false)
    setTimeout(onClose, 200)
  }

  // §7.2: у кампании с отчётами цель менять нельзя — она задаёт смысл уже
  // накопленных результатов. Окончательное решение за сервером; здесь просто
  // не даём трогать поле у сохранённой кампании с заданной целью.
  const goalLocked = isEdit && !!campaign?.goal

  const save = async () => {
    setError('')
    if (!objectId) {
      setError('Выберите объект продаж — без него кампания не сохраняется.')
      return
    }
    if (!goal) {
      setError('Выберите цель — от неё зависят единица результата и формула цены.')
      return
    }
    setSaving(true)
    try {
      if (isEdit && campaign) {
        await update({
          id: campaign._id,
          objectId: objectId as Id<'salesObjects'>,
          ...(goalLocked ? {} : { goal: goal as CampaignGoalSlug }),
          account,
          moneySource: moneySource as (typeof MONEY)[number],
          startedAt,
          note,
        })
      } else {
        await create({
          code,
          objectId: objectId as Id<'salesObjects'>,
          goal: goal as CampaignGoalSlug,
          account,
          moneySource: moneySource as (typeof MONEY)[number],
          startedAt,
          note,
        })
      }
      close()
    } catch (e) {
      setError(errMessage(e, 'Не удалось сохранить кампанию.'))
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className={`absolute inset-0 bg-black/30 transition-opacity ${shown ? 'opacity-100' : 'opacity-0'}`}
        onClick={close}
      />
      <div
        className={`relative w-full max-w-md h-full bg-bg flex flex-col transition-transform duration-200 ${
          shown ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="shrink-0 bg-white border-b border-line px-5 sm:px-6 py-4 flex items-center gap-3">
          <span className="w-9 h-9 rounded-xl bg-[#e2f2ef] text-green-d grid place-items-center shrink-0">
            <Megaphone size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold text-ink truncate">
              {isEdit ? campaign?.code : 'Новая кампания'}
            </h2>
            <p className="text-[11px] text-muted">
              {isEdit ? 'Карточка рекламной кампании' : 'Один объект продаж, одна цель'}
            </p>
          </div>
          <button onClick={close} className="ico-btn w-9 h-9" aria-label="Закрыть">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-5 flex flex-col gap-4">
          {!isEdit && (
            <Field label="ID кампании">
              <input
                className={inputCls}
                placeholder="FR-001"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />
              <p className="text-[11px] text-muted-2 mt-1">
                Короткий человекочитаемый код — по нему кампанию узнают в отчёте. Менять его
                потом нельзя: на него завязаны накопленные строки.
              </p>
            </Field>
          )}

          <Field label="Объект продаж">
            <Select
              value={objectId}
              onChange={setObjectId}
              placeholder="Выберите объект"
              options={(objects ?? []).map((o) => ({
                value: o._id,
                label: o.status === 'archived' ? `${o.name} (архив)` : o.name,
              }))}
            />
            <p className="text-[11px] text-muted-2 mt-1">
              Справочник общий с отделом продаж: по объекту собирается вся история — и
              рекламная, и продажная.
            </p>
          </Field>

          <Field label="Цель кампании">
            <Select
              value={goal}
              onChange={setGoal}
              disabled={goalLocked}
              placeholder="Выберите цель"
              options={CAMPAIGN_GOALS.map((g) => ({ value: g.slug, label: g.label }))}
            />
            <p className="text-[11px] text-muted-2 mt-1 flex items-start gap-1">
              {goalLocked && <Lock size={11} className="mt-0.5 shrink-0" />}
              <span>
                {goalLocked
                  ? 'Цель менять нельзя — нужна другая, заведите новую кампанию.'
                  : 'Определяет единицу результата и формулу цены. После первых отчётов изменить будет нельзя.'}
              </span>
            </p>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Аккаунт">
              <Select
                value={account}
                onChange={setAccount}
                options={ACCOUNTS.map((a) => ({ value: a, label: a }))}
              />
            </Field>
            <Field label="Источник денег">
              <Select
                value={moneySource}
                onChange={setMoneySource}
                options={MONEY.map((m) => ({ value: m, label: m }))}
              />
            </Field>
          </div>

          <Field label="Дата начала">
            <DatePicker value={startedAt} onChange={setStartedAt} max={TODAY} />
          </Field>

          <Field label="Комментарий">
            <textarea
              className={`${inputCls} min-h-[76px] resize-y`}
              placeholder="Что важно помнить по этому запуску"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
        </div>

        <div className="shrink-0 bg-white border-t border-line px-5 sm:px-6 py-4 flex flex-col gap-3">
          {error && <p className="text-sm text-[#c53030]">{error}</p>}
          <div className="flex gap-2">
            <button onClick={close} className="btn btn-ghost flex-1">
              Отмена
            </button>
            <button onClick={save} disabled={saving} className="btn btn-green flex-1 disabled:opacity-60">
              {saving && <Loader2 size={15} className="animate-spin" />}
              {isEdit ? 'Сохранить' : 'Создать'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <span className={labelCls}>{label}</span>
      {children}
    </div>
  )
}
