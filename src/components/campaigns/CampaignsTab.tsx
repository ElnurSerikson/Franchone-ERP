import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { Plus, Loader2, Megaphone, ArrowUp, ArrowDown } from 'lucide-react'
import { api } from '../../../convex/_generated/api'
import CampaignDrawer, { type RegistryRow } from './CampaignDrawer'
import Select from '@/components/ui/Select'
import { goalMeta } from '../../../convex/campaignGoals'
import { errMessage } from '@/lib/errors'
import { th, td, theadRow } from '@/lib/table'
import { longDate } from '@/lib/format'

// Реестр рекламных кампаний (ТЗ таргетолога §7.3). Кампании автоматически
// группируются: активные → пауза → завершённые. Статус меняется прямо в
// таблице, без открытия карточки; внутри группы порядок двигается стрелками.
// Планов и весов здесь нет — новое ТЗ их не предусматривает.

const STATUSES = ['Активна', 'Пауза', 'Завершена'] as const

const STATUS_CHIP: Record<string, string> = {
  Активна: 'bg-[#e2f2ef] text-green-d',
  Пауза: 'bg-[#fff6e6] text-[#b7791f]',
  Завершена: 'bg-chip text-muted',
}

const GROUP_TITLE: Record<string, string> = {
  Активна: 'Активные',
  Пауза: 'На паузе',
  Завершена: 'Завершённые',
}

export default function CampaignsTab() {
  const registry = useQuery(api.target.registry, {})
  const setStatus = useMutation(api.target.setStatus)
  const reorder = useMutation(api.target.reorder)
  const [open, setOpen] = useState<{ campaign: RegistryRow | null } | null>(null)
  const [error, setError] = useState('')

  const run = async (fn: () => Promise<unknown>) => {
    setError('')
    try {
      await fn()
    } catch (e) {
      setError(errMessage(e, 'Не удалось изменить кампанию.'))
    }
  }

  if (registry === undefined) {
    return (
      <div className="card p-10 grid place-items-center text-muted">
        <Loader2 className="animate-spin" size={20} />
      </div>
    )
  }

  const rows = registry as RegistryRow[]

  return (
    <>
      <div className="flex items-center gap-3 flex-wrap mb-5">
        <div className="flex-1" />
        <button onClick={() => setOpen({ campaign: null })} className="btn btn-green">
          <Plus size={16} /> Добавить кампанию
        </button>
      </div>

      {error && <p className="text-sm text-[#c53030] mb-3">{error}</p>}

      {rows.length === 0 ? (
        <div className="card p-10 text-center">
          <span className="w-12 h-12 rounded-full bg-chip text-muted grid place-items-center mx-auto mb-3">
            <Megaphone size={20} />
          </span>
          <div className="sec-title mb-1">В реестре пока нет кампаний</div>
          <p className="text-sm text-muted max-w-md mx-auto">
            Заведите кампанию — она сразу появится строкой в ежедневном отчёте таргетолога и
            начнёт копить историю по своему объекту продаж.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {STATUSES.map((status) => {
            const group = rows.filter((r) => r.status === status)
            if (group.length === 0) return null
            return (
              <section key={status}>
                {/* Заголовок группы вынесен из карточки: иначе над зелёной
                    шапкой таблицы оставалась белая полоса. Карточка начинается
                    сразу строкой колонок — как в «Команде». */}
                <div className="flex items-center gap-2 mb-3">
                  <h3 className="sec-title">{GROUP_TITLE[status]}</h3>
                  <span className="chip bg-chip text-muted-2">{group.length}</span>
                </div>
                <div className="card overflow-hidden overflow-x-auto">
                  <table className="w-full min-w-[840px]">
                    <thead>
                      <tr className={theadRow}>
                        <th className={th}>ID</th>
                        <th className={th}>Объект продаж</th>
                        <th className={th}>Цель</th>
                        <th className={th}>Аккаунт</th>
                        <th className={th}>Деньги</th>
                        <th className={th}>Запуск</th>
                        <th className={th}>Статус</th>
                        <th className={th}>Порядок</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.map((c, i) => (
                        <tr key={c._id} className="hover:bg-chip/40 transition-colors">
                          <td className={`${td} cursor-pointer`} onClick={() => setOpen({ campaign: c })}>
                            <span className="chip bg-[#e2f2ef] text-green-d whitespace-nowrap">{c.code}</span>
                          </td>
                          <td className={`${td} cursor-pointer`} onClick={() => setOpen({ campaign: c })}>
                            {c.objectName ? (
                              <span className="font-medium text-ink whitespace-nowrap">{c.objectName}</span>
                            ) : (
                              // Кампании, заведённые до связки со справочником:
                              // без объекта они выпадают из аналитики по объектам.
                              <span
                                className="chip bg-[#fff6e6] text-[#b7791f] whitespace-nowrap"
                                title="Кампания не привязана к объекту продаж"
                              >
                                Объект не выбран
                              </span>
                            )}
                          </td>
                          <td className={td}>
                            {/* Показываем единицу результата, а не полное название цели:
                                «Сообщения WhatsApp» вместо «Максимум переписок WhatsApp».
                                Соответствие один к одному, зато строка вдвое короче — иначе
                                таблица распирается и колонка «Порядок» уезжает за край. */}
                            <span className="text-ink-2 whitespace-nowrap">{goalMeta(c.goal).metric}</span>
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
                          <td className={`${td} whitespace-nowrap`}>{c.startedAt ? longDate(c.startedAt) : '—'}</td>
                          <td className={td}>
                            {/* §7.3: статус меняется прямо в таблице. */}
                            <Select
                              value={c.status}
                              onChange={(v) => run(() => setStatus({ id: c._id, status: v as typeof STATUSES[number] }))}
                              options={STATUSES.map((s) => ({ value: s, label: s }))}
                              variant="ghost"
                              className={`chip ${STATUS_CHIP[c.status] ?? 'bg-chip text-ink-2'}`}
                            />
                          </td>
                          <td className={td}>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => run(() => reorder({ id: c._id, direction: 'up' }))}
                                disabled={i === 0}
                                className="ico-btn w-8 h-8 disabled:opacity-30 disabled:hover:bg-white"
                                title="Выше"
                                aria-label="Переместить выше"
                              >
                                <ArrowUp size={14} />
                              </button>
                              <button
                                onClick={() => run(() => reorder({ id: c._id, direction: 'down' }))}
                                disabled={i === group.length - 1}
                                className="ico-btn w-8 h-8 disabled:opacity-30 disabled:hover:bg-white"
                                title="Ниже"
                                aria-label="Переместить ниже"
                              >
                                <ArrowDown size={14} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )
          })}
        </div>
      )}

      {open && <CampaignDrawer campaign={open.campaign} onClose={() => setOpen(null)} />}
    </>
  )
}
