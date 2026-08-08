// §9: панель упаковщика. Объединяет его повседневную работу: задачи, встречи,
// KPI и назначенные проекты упаковки. Данные подтягиваются из существующих
// модулей ERP, а не дублируются вручную (§9).

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from 'convex/react'
import {
  AlertTriangle, ArrowUpRight, Bell, Boxes, CalendarDays, CheckSquare, Clock, Loader2,
  MessageSquare, RotateCcw, Send, Target, Wallet, type LucideIcon,
} from 'lucide-react'
import { api } from '../../../convex/_generated/api'
import StatCard from '@/components/ui/StatCard'
import DatePicker from '@/components/ui/DatePicker'
import { ProgressBar } from '@/components/ui/Progress'
import { kzt, pct } from '@/lib/format'
import { Deadline, Empty, HealthChip, SideChip, dateTime } from './ui'

export default function PackerPanel() {
  // §7.4: «общий KPI за выбранный период». Пусто — за всё время.
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const panel = useQuery(api.packs.packerPanel, {})
  const kpi = useQuery(api.packs.kpi, { from: from || undefined, to: to || undefined })
  const period = !!(from || to)

  if (panel === undefined || kpi === undefined) {
    return (
      <div className="card p-10 grid place-items-center text-muted">
        <Loader2 className="animate-spin" size={20} />
      </div>
    )
  }
  if (!panel) return null
  const t = panel.todayBlock
  const now = Date.now()

  return (
    <>
      {/* §7.4: период для агрегированного KPI. */}
      <section className="card p-4 mb-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <DatePicker value={from} onChange={setFrom} placeholder="KPI с даты" />
          <DatePicker value={to} onChange={setTo} placeholder="по дату" />
          {period && (
            <button
              onClick={() => {
                setFrom('')
                setTo('')
              }}
              className="btn btn-ghost h-9 px-3 text-sm justify-self-start"
            >
              <RotateCcw size={14} /> За всё время
            </button>
          )}
        </div>
      </section>

      {/* §9.3: блок KPI */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4 mb-4">
        <StatCard
          highlight
          label={period ? 'Начислено за период' : 'Начислено вознаграждения'}
          value={kzt(period ? (kpi?.accruedInPeriod ?? 0) : (kpi?.accrued ?? 0))}
          foot={
            period
              ? `утверждено этапов за период: ${kpi?.approvedInPeriod ?? 0}`
              : `остаток до 100%: ${kzt(Math.max(0, kpi?.left ?? 0))}`
          }
          icon={Wallet}
        />
        {/* §7.3: плановое, начисленное и выплаченное — три разные величины. */}
        <StatCard
          label="Выплачено"
          value={kzt(kpi?.paid ?? 0)}
          foot={`к выплате: ${kzt(Math.max(0, kpi?.unpaid ?? 0))} · план ${kzt(kpi?.rewardPlanned ?? 0)}`}
          icon={Target}
        />
        {/* §9.4, §10: успеваемость — передача материалов на проверку
            относительно сроков исполнения. Задержка заказчика её не портит. */}
        <StatCard
          label="Передано в срок"
          value={pct(kpi?.onTimeRate ?? 0)}
          foot={`${kpi?.handedOnTime ?? 0} из ${kpi?.handedTotal ?? 0} материалов${
            kpi?.rating ? ` · оценка ${kpi.rating.toFixed(1)}` : ''
          }`}
          icon={CheckSquare}
        />
        <StatCard
          label="Этапы в работе"
          value={String(kpi?.inWork ?? 0)}
          foot={`принято этапов ${kpi?.approvedStages ?? 0} · возвратов ${kpi?.returns ?? 0}`}
          icon={Clock}
        />
      </div>

      {/* §9.1: блок «Сегодня» */}
      <section className="card p-5 mb-4">
        <div className="flex items-center gap-2 mb-4">
          <CalendarDays size={16} className="text-green" />
          <h3 className="sec-title">Сегодня</h3>
          <span className="text-xs text-muted">{panel.today}</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 mb-4">
          <Mini label="Задачи на сегодня" value={t.tasksToday} to="/tasks" />
          <Mini label="Просроченные задачи" value={t.tasksOverdue} tone={t.tasksOverdue > 0 ? 'red' : undefined} to="/tasks" />
          <Mini label="Встречи сегодня" value={t.meetingsToday} to="/meetings" />
          <Mini label="Новые комментарии клиентов" value={t.newClientComments} tone={t.newClientComments > 0 ? 'amber' : undefined} />
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Bucket
            icon={Clock}
            title="Этапы с дедлайном сегодня"
            empty="На сегодня дедлайнов нет."
            items={t.stagesDueToday.map((x) => ({
              key: `${x.packId}-${x.stage}`,
              to: `/packs/${x.packId}`,
              main: x.stage,
              sub: x.pack,
            }))}
          />
          <Bucket
            icon={AlertTriangle}
            tone="amber"
            title="Возвращены на доработку"
            empty="Возвратов нет."
            items={t.returnedStages.map((x) => ({
              key: `${x.packId}-${x.stage}`,
              to: `/packs/${x.packId}`,
              main: x.stage,
              sub: x.pack,
            }))}
          />
          <Bucket
            icon={Send}
            tone="green"
            title="Готовы к передаче клиенту"
            empty="Готовых к передаче этапов нет."
            items={t.toHandover.map((x) => ({
              key: `${x.packId}-${x.stage}`,
              to: `/packs/${x.packId}`,
              main: x.stage,
              sub: x.pack,
            }))}
          />
        </div>

        {t.meetingsSoon.length > 0 && (
          <div className="mt-4 pt-4 border-t border-line">
            <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-2">
              Ближайшие встречи
            </div>
            <div className="flex flex-wrap gap-2">
              {t.meetingsSoon.map((m) => (
                <Link key={m._id} to="/meetings" className="chip bg-chip text-ink-2 hover:bg-line-2">
                  <CalendarDays size={11} /> {m.date} {m.time} · {m.title}
                </Link>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* §9.1: срочные уведомления */}
      {panel.notifications.length > 0 && (
        <section className="card p-5 mb-4">
          <div className="flex items-center gap-2 mb-3">
            <Bell size={16} className="text-[#b7791f]" />
            <h3 className="sec-title">Уведомления</h3>
            <span className="chip bg-[#fff6e6] text-[#b7791f]">{panel.notifications.length}</span>
          </div>
          <div className="flex flex-col gap-2">
            {panel.notifications.map((n) => (
              <Link
                key={n._id}
                to={n.link ?? `/packs/${n.packId}`}
                className="rounded-xl border border-line p-3 hover:bg-chip/60 transition-colors"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-ink">{n.title}</span>
                  <span className="text-[11px] text-muted-2">{dateTime(n.at)}</span>
                </div>
                {n.text && <div className="text-[13px] text-ink-2 mt-1 whitespace-pre-line">{n.text}</div>}
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* §9.2: блок «Мои упаковки» */}
      <div className="flex items-center gap-2 mb-3">
        <Boxes size={16} className="text-green" />
        <h3 className="sec-title">Мои упаковки</h3>
        <span className="chip bg-chip text-muted">{panel.cards.length}</span>
      </div>
      {panel.cards.length === 0 ? (
        <Empty
          icon={Boxes}
          title="Назначенных проектов нет"
          text="Как только вас назначат упаковщиком или участником проекта, он появится здесь."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {panel.cards.map((c) => (
            <Link
              key={c._id}
              to={`/packs/${c._id}`}
              className="card p-5 hover:shadow-soft transition-shadow"
            >
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-base font-semibold text-ink">{c.title}</span>
                    <HealthChip health={c.health} reason={c.healthReason} />
                  </div>
                  <div className="text-xs text-muted mt-1">
                    {c.client ? c.client.name : 'клиент не назначен'} · {c.currentStage?.title ?? 'все этапы утверждены'}
                  </div>
                </div>
                <ArrowUpRight size={16} className="text-muted-2 shrink-0" />
              </div>

              <div className="mt-3">
                <div className="flex items-baseline justify-between mb-1.5">
                  <span className="text-sm text-ink-2">Общий прогресс</span>
                  <span className="text-sm font-bold text-ink tabular-nums">{c.progress}%</span>
                </div>
                <ProgressBar value={c.progress / 100} />
              </div>

              <div className="mt-3 text-[11px] text-muted">{c.healthReason}</div>

              <div className="mt-3 pt-3 border-t border-line grid grid-cols-2 gap-3 text-[13px]">
                <div>
                  <div className="text-[11px] text-muted">Кто должен действовать</div>
                  <div className="mt-1">
                    <SideChip side={c.side} />
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-muted">Ближайший срок</div>
                  <div className="mt-1">
                    <Deadline at={c.nextDueAt} now={now} />
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-muted">Плановое завершение</div>
                  <div className="mt-1 text-ink-2">{c.plannedFinish}</div>
                </div>
                <div>
                  <div className="text-[11px] text-muted">Открытые вопросы</div>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 text-ink-2">
                      <MessageSquare size={12} /> {c.openComments}
                    </span>
                    <span className="inline-flex items-center gap-1 text-ink-2">
                      <AlertTriangle size={12} /> {c.reworkMaterials}
                    </span>
                  </div>
                </div>
              </div>

              {/* §9.2: проектный KPI и вознаграждение по проекту. */}
              <div className="mt-3 rounded-xl bg-chip p-3 flex items-center gap-4 flex-wrap">
                <div>
                  <div className="text-[11px] text-muted">Проектный KPI</div>
                  <div className="text-sm font-bold text-ink tabular-nums">{c.kpi}%</div>
                </div>
                <div>
                  <div className="text-[11px] text-muted">Начислено</div>
                  <div className="text-sm font-bold text-green-d tabular-nums">{kzt(c.accrued)}</div>
                </div>
                <div>
                  <div className="text-[11px] text-muted">Полное вознаграждение</div>
                  <div className="text-sm font-semibold text-ink-2 tabular-nums">{kzt(c.reward)}</div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* §7.4: KPI по каждому проекту и динамика по месяцам */}
      {kpi && kpi.rows.length > 0 && (
        <section className="card p-5 mt-5">
          <div className="flex items-center gap-2 mb-4">
            <Target size={16} className="text-green" />
            <h3 className="sec-title">KPI по проектам</h3>
          </div>
          <div className="flex flex-col divide-y divide-line">
            {kpi.rows.map((r) => (
              <div key={r._id} className="py-3 first:pt-0 last:pb-0 flex items-center gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-ink truncate">{r.title}</div>
                  <div className="text-[11px] text-muted truncate">
                    {r.client?.name ?? 'без клиента'} · этапов {r.approvedStages}/{r.mainStages}
                  </div>
                </div>
                <div className="w-40 hidden sm:block">
                  <ProgressBar value={r.kpi / 100} />
                </div>
                <div className="w-14 text-right text-sm font-bold text-ink tabular-nums">{r.kpi}%</div>
                <div className="w-44 text-right tabular-nums">
                  <div className="text-sm font-semibold text-green-d">{kzt(r.accrued)}</div>
                  <div className="text-[11px] text-muted">
                    выплачено {kzt(r.paid)} · осталось {kzt(Math.max(0, r.left))}
                  </div>
                </div>
              </div>
            ))}
          </div>
          {kpi.months.length > 0 && (
            <div className="mt-4 pt-4 border-t border-line">
              <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-2">
                Динамика начислений по месяцам
              </div>
              <div className="flex items-end gap-2 flex-wrap">
                {kpi.months.map((m) => (
                  <div key={m.month} className="text-center">
                    <div
                      className="w-10 rounded-t-md bg-green"
                      style={{
                        height: Math.max(
                          6,
                          (m.sum / Math.max(...kpi.months.map((x) => x.sum), 1)) * 64,
                        ),
                      }}
                      title={kzt(m.sum)}
                    />
                    <div className="text-[10px] text-muted-2 mt-1">{m.month.slice(5)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}
    </>
  )
}

function Mini({
  label,
  value,
  tone,
  to,
}: {
  label: string
  value: number
  tone?: 'red' | 'amber'
  to?: string
}) {
  const color =
    tone === 'red' ? 'text-[#c53030]' : tone === 'amber' ? 'text-[#b7791f]' : 'text-ink'
  const body = (
    <div className="rounded-xl bg-chip p-3 text-center h-full">
      <div className={`text-xl font-bold ${color}`}>{value}</div>
      <div className="text-[11px] text-muted mt-0.5 leading-tight">{label}</div>
    </div>
  )
  return to ? (
    <Link to={to} className="block hover:opacity-90 transition-opacity">
      {body}
    </Link>
  ) : (
    body
  )
}

function Bucket({
  icon: Icon,
  title,
  items,
  empty,
  tone,
}: {
  icon: LucideIcon
  title: string
  items: { key: string; to: string; main: string; sub: string }[]
  empty: string
  tone?: 'amber' | 'green'
}) {
  const color =
    tone === 'amber' ? 'text-[#b7791f]' : tone === 'green' ? 'text-green' : 'text-muted'
  return (
    <div className="rounded-xl border border-line p-3">
      <div className="flex items-center gap-2 mb-2">
        <Icon size={14} className={color} />
        <span className="text-sm font-semibold text-ink">{title}</span>
        {items.length > 0 && <span className="chip bg-chip text-muted">{items.length}</span>}
      </div>
      {items.length === 0 ? (
        <p className="text-[12px] text-muted">{empty}</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {items.map((i) => (
            <Link
              key={i.key}
              to={i.to}
              className="block rounded-lg bg-chip px-2.5 py-2 hover:bg-line-2 transition-colors"
            >
              <div className="text-[13px] font-medium text-ink truncate">{i.main}</div>
              <div className="text-[11px] text-muted truncate">{i.sub}</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
