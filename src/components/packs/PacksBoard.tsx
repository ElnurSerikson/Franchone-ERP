// §8: дашборд владельца. За несколько секунд отвечает на вопросы: сколько
// проектов идёт, где риск, кто задерживает, как загружены упаковщики и какое
// вознаграждение уже начислено.

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from 'convex/react'
import {
  AlertTriangle, Boxes, Clock, Loader2, MoonStar, Plus, RotateCcw, TrendingUp, UserCheck, Wallet,
} from 'lucide-react'
import { api } from '../../../convex/_generated/api'
import StatCard from '@/components/ui/StatCard'
import Avatar from '@/components/ui/Avatar'
import Select from '@/components/ui/Select'
import DatePicker from '@/components/ui/DatePicker'
import { ProgressBar } from '@/components/ui/Progress'
import { kzt } from '@/lib/format'
import { th, thRight, td, theadRow } from '@/lib/table'
import { HEALTH, PACK_STATUS, SIDE_LABEL } from '../../../convex/packModel'
import { Deadline, Empty, HealthChip, PackStatusChip, SideChip, dateOnly } from './ui'

export default function PacksBoard({ onCreate }: { onCreate: () => void }) {
  const [packerId, setPackerId] = useState('')
  const [clientId, setClientId] = useState('')
  const [status, setStatus] = useState('')
  const [health, setHealth] = useState('')
  const [side, setSide] = useState('')
  const [stageOrder, setStageOrder] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [onlyOverdue, setOnlyOverdue] = useState(false)
  const [onlyIdle, setOnlyIdle] = useState(false)

  const data = useQuery(api.packs.list, {
    packerId: packerId ? (packerId as never) : undefined,
    clientId: clientId ? (clientId as never) : undefined,
    status: status || undefined,
    health: health || undefined,
    side: side || undefined,
    stageOrder: stageOrder === '' ? undefined : Number(stageOrder),
    from: from || undefined,
    to: to || undefined,
    onlyOverdue: onlyOverdue || undefined,
    onlyIdle: onlyIdle || undefined,
  })
  const packers = useQuery(api.packs.packersKpi)

  if (data === undefined) {
    return (
      <div className="card p-10 grid place-items-center text-muted">
        <Loader2 className="animate-spin" size={20} />
      </div>
    )
  }
  if (data === null) return null

  const s = data.stats
  const now = Date.now()

  return (
    <>
      {/* §8.1: верхние показатели */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4 mb-4">
        <StatCard
          highlight
          label="Активные упаковки"
          value={String(s.active)}
          foot={`в сроке ${s.onTrack} · риск ${s.risky} · просрочено ${s.overdue}`}
          icon={Boxes}
        />
        <StatCard
          label="Ждём клиента"
          value={String(s.waitingClient)}
          foot={`ждём FRANCHONE: ${s.waitingUs}`}
          icon={UserCheck}
        />
        <StatCard
          label="Без активности"
          value={String(s.idle)}
          foot={`завершено за период: ${s.finished}`}
          icon={MoonStar}
        />
        <StatCard
          label="Вознаграждение упаковщиков"
          value={kzt(s.rewardAccrued)}
          foot={`план ${kzt(s.rewardPlanned)} · выплачено ${kzt(s.rewardPaid)}`}
          icon={Wallet}
        />
      </div>

      {/* §8.3: фильтры */}
      <section className="card p-4 mb-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Select
            value={packerId}
            onChange={setPackerId}
            options={[
              { value: '', label: 'Все упаковщики' },
              ...data.packers.map((p) => ({ value: p._id as string, label: p.name })),
            ]}
          />
          <Select
            value={clientId}
            onChange={setClientId}
            options={[
              { value: '', label: 'Все клиенты' },
              ...data.clients.map((c) => ({ value: c._id as string, label: c.name })),
            ]}
          />
          <Select
            value={status}
            onChange={setStatus}
            options={[
              { value: '', label: 'Любой статус' },
              ...Object.entries(PACK_STATUS).map(([k, x]) => ({ value: k, label: x.label })),
            ]}
          />
          <Select
            value={health}
            onChange={setHealth}
            options={[
              { value: '', label: 'Любое здоровье' },
              ...Object.entries(HEALTH).map(([k, x]) => ({ value: k, label: x.label, dot: x.color })),
            ]}
          />
          <Select
            value={side}
            onChange={setSide}
            options={[
              { value: '', label: 'Любая сторона' },
              ...Object.entries(SIDE_LABEL).map(([k, label]) => ({ value: k, label })),
            ]}
          />
          {/* §8.3: фильтр по текущему этапу. Названия у проектов свои, общий
              ориентир — номер этапа. */}
          <Select
            value={stageOrder}
            onChange={setStageOrder}
            options={[
              { value: '', label: 'Любой этап' },
              ...data.stageOptions.map((o) => ({
                value: String(o.order),
                label: o.order === 0 ? `Нулевой · ${o.title}` : `Этап ${o.order} · ${o.title}`,
              })),
            ]}
          />
        </div>
        {/* §8.3: период. Он же задаёт окно для показателя «завершено». */}
        <div className="grid gap-3 sm:grid-cols-3 mt-3">
          <DatePicker value={from} onChange={setFrom} placeholder="Период с" />
          <DatePicker value={to} onChange={setTo} placeholder="по" />
          {(from || to) && (
            <button
              onClick={() => {
                setFrom('')
                setTo('')
              }}
              className="btn btn-ghost h-9 px-3 text-sm justify-self-start"
            >
              <RotateCcw size={14} /> Весь период
            </button>
          )}
        </div>
        <div className="flex items-center gap-4 flex-wrap mt-3">
          <label className="flex items-center gap-2 text-sm text-ink-2 cursor-pointer">
            <input type="checkbox" checked={onlyOverdue} onChange={(e) => setOnlyOverdue(e.target.checked)} />
            Только с просрочкой
          </label>
          <label className="flex items-center gap-2 text-sm text-ink-2 cursor-pointer">
            <input type="checkbox" checked={onlyIdle} onChange={(e) => setOnlyIdle(e.target.checked)} />
            Только без активности
          </label>
          <div className="flex-1" />
          <button onClick={onCreate} className="btn btn-green h-9 px-3 text-sm">
            <Plus size={15} /> Создать упаковку
          </button>
        </div>
      </section>

      {/* §8.2: таблица проектов */}
      {data.rows.length === 0 ? (
        <Empty
          icon={Boxes}
          title="Упаковок нет"
          text="Создайте проект: настройте клиента, упаковщика, сроки, стоимость, процент и этапы — и откройте его клиенту."
        />
      ) : (
        <div className="card overflow-hidden mb-5">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px]">
              <thead>
                <tr className={theadRow}>
                  <th className={th}>Упаковка</th>
                  <th className={th}>Клиент</th>
                  <th className={th}>Упаковщик</th>
                  <th className={th}>Текущий этап</th>
                  <th className={th}>Готовность</th>
                  <th className={th}>Здоровье</th>
                  <th className={th}>Ждём</th>
                  <th className={th}>Ближайший дедлайн</th>
                  <th className={th}>План завершения</th>
                  <th className={thRight}>Просрочек</th>
                  {data.isOwner && <th className={thRight}>KPI упаковщика</th>}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r._id} className="hover:bg-chip/40 transition-colors">
                    <td className={td}>
                      <Link to={`/packs/${r._id}`} className="font-semibold text-ink hover:text-green-d">
                        {r.title}
                      </Link>
                      <div className="flex items-center gap-1.5 mt-1">
                        <PackStatusChip status={r.status} />
                        {r.idle && (
                          <span className="chip bg-chip text-muted" title="Давно не было событий">
                            без активности
                          </span>
                        )}
                        {r.isTemplate && <span className="chip bg-chip text-muted">шаблон</span>}
                      </div>
                    </td>
                    <td className={td}>
                      {r.client ? (
                        <span className="inline-flex items-center gap-2">
                          <Avatar initials={r.client.initials} color={r.client.avatarColor} size={26} />
                          <span className="whitespace-nowrap">{r.client.name}</span>
                        </span>
                      ) : (
                        <span className="text-muted-2">не назначен</span>
                      )}
                    </td>
                    <td className={td}>
                      {r.packer && (
                        <span className="inline-flex items-center gap-2">
                          <Avatar initials={r.packer.initials} color={r.packer.avatarColor} size={26} />
                          <span className="whitespace-nowrap">{r.packer.name}</span>
                        </span>
                      )}
                    </td>
                    <td className={td}>
                      <span className="text-ink-2">{r.currentStage?.title ?? '—'}</span>
                    </td>
                    <td className={td}>
                      <div className="w-28">
                        <ProgressBar value={r.progress / 100} />
                        <div className="text-[11px] text-muted mt-1 tabular-nums">
                          {r.progress}% · {r.approvedStages}/{r.mainStages}
                        </div>
                      </div>
                    </td>
                    <td className={td}>
                      <HealthChip health={r.health} reason={r.healthReason} />
                      <div className="text-[11px] text-muted mt-1 max-w-[220px]">{r.healthReason}</div>
                    </td>
                    <td className={td}>
                      <SideChip side={r.side} />
                    </td>
                    <td className={td}>
                      <Deadline at={r.nextDueAt} now={now} />
                    </td>
                    <td className={`${td} whitespace-nowrap`}>{r.plannedFinish}</td>
                    <td className={`${td} text-right tabular-nums`}>
                      {r.overdueCount > 0 ? (
                        <span className="chip bg-[#fdeaea] text-[#c53030]">{r.overdueCount}</span>
                      ) : (
                        <span className="text-muted-2">0</span>
                      )}
                    </td>
                    {data.isOwner && (
                      <td className={`${td} text-right tabular-nums whitespace-nowrap`}>
                        <div className="font-semibold text-ink">{kzt(r.accrued)}</div>
                        <div className="text-[11px] text-muted">из {kzt(r.reward)}</div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* §14.3: нагрузка упаковщиков и их начисления одним взглядом. */}
      {data.isOwner && packers && packers.length > 0 && (
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp size={16} className="text-green" />
            <h3 className="sec-title">Упаковщики</h3>
          </div>
          <div className="flex flex-col divide-y divide-line">
            {packers.map((p) => (
              <div key={p._id} className="py-3 first:pt-0 last:pb-0 flex items-center gap-3 flex-wrap">
                <Avatar initials={p.initials} color={p.avatarColor} size={34} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-ink truncate">{p.name}</div>
                  <div className="text-[11px] text-muted truncate">{p.positionLabel}</div>
                </div>
                <span className="chip bg-chip text-ink-2">активных: {p.active}</span>
                <span className="chip bg-chip text-ink-2">завершено: {p.done}</span>
                <div className="text-right tabular-nums w-48">
                  <div className="text-sm font-bold text-ink">{kzt(p.accrued)}</div>
                  <div className="text-[11px] text-muted">
                    начислено из {kzt(p.reward)} · выплачено {kzt(p.paid)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Подсказка про красные проекты — то, ради чего дашборд и открывают. */}
      {s.overdue > 0 && (
        <div className="mt-4 rounded-xl border border-[#f5c6c6] bg-[#fdeaea] p-3 flex items-start gap-2.5">
          <AlertTriangle size={16} className="text-[#c53030] shrink-0 mt-0.5" />
          <div className="text-sm text-[#8a2020]">
            Просроченных проектов: {s.overdue}. Откройте карточку — в журнале видно, на чьей стороне
            остановка и с какого момента.
          </div>
        </div>
      )}
      <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-2">
        <Clock size={12} /> Сроки считаются по часовому поясу Алматы. Данные обновлены{' '}
        {dateOnly(now)}.
      </div>
    </>
  )
}
