// §10.4 и §13.1: дополнительные разделы кабинета клиента — все материалы и
// история версий, календарь проекта, награды, обучающие материалы,
// уведомления и итоговый хаб готовой франшизы.

import { useEffect } from 'react'
import { useMutation, useQuery } from 'convex/react'
import {
  BellRing, BookOpen, CalendarDays, CheckCircle2, FolderOpen, Gift, Loader2, Sparkles,
} from 'lucide-react'
import { api } from '../../../convex/_generated/api'
import { longDate } from '@/lib/format'
import { CONTENT_KIND_LABEL, EVENT_LABEL, MATERIAL_KIND_LABEL } from '../../../convex/packModel'
import {
  AttachmentLink, Empty, MaterialChip, RewardChip, dateTime,
} from '@/components/packs/ui'
import { useClientPack } from './ClientApp'

function Loading() {
  return (
    <div className="card p-10 grid place-items-center text-muted">
      <Loader2 className="animate-spin" size={20} />
    </div>
  )
}

// §10.4: все материалы и история версий.
export function ClientMaterials() {
  const packId = useClientPack()
  const rows = useQuery(api.packClient.materials, packId ? { packId } : 'skip')
  if (!packId || rows === undefined) return <Loading />

  const byStage = new Map<string, typeof rows>()
  for (const m of rows) {
    const arr = byStage.get(m.stage) ?? []
    arr.push(m)
    byStage.set(m.stage, arr)
  }

  return (
    <>
      <h1 className="text-xl font-bold text-ink mb-1">Материалы проекта</h1>
      <p className="text-sm text-muted mb-5">
        Все доступные вам материалы и полная история версий.
      </p>
      {rows.length === 0 ? (
        <Empty
          icon={FolderOpen}
          title="Материалов пока нет"
          text="Они появятся, когда команда передаст первый этап на проверку."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {[...byStage.entries()].map(([stage, items]) => (
            <section key={stage} className="card p-5">
              <h2 className="sec-title mb-3">{stage}</h2>
              <div className="flex flex-col gap-2">
                {items.map((m) => (
                  <div key={m._id} className="rounded-xl border border-line p-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13px] font-semibold text-ink flex-1">{m.title}</span>
                      <MaterialChip status={m.status} />
                      <span className="chip bg-chip text-muted">
                        {MATERIAL_KIND_LABEL[m.kind] ?? m.kind}
                      </span>
                    </div>
                    {m.description && (
                      <p className="text-[12px] text-muted mt-1">{m.description}</p>
                    )}
                    {m.versions.length > 0 && (
                      <div className="flex flex-col gap-1.5 mt-2">
                        {m.versions.map((v) => (
                          <div key={v._id} className="flex items-center gap-2 flex-wrap text-[12px]">
                            <span className="chip bg-chip text-ink-2">v{v.version}</span>
                            <AttachmentLink kind={v.kind} name={v.name} url={v.url} />
                            <span className="text-muted-2">{dateTime(v.at)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  )
}

// §6.2, §10.4: календарь проекта глазами клиента.
export function ClientCalendar() {
  const packId = useClientPack()
  const data = useQuery(api.packStages.calendar, packId ? { packId } : 'skip')
  if (!packId || data === undefined) return <Loading />
  if (!data) return null

  const byDate = new Map<string, typeof data.items>()
  for (const i of data.items) {
    const arr = byDate.get(i.date) ?? []
    arr.push(i)
    byDate.set(i.date, arr)
  }

  return (
    <>
      <h1 className="text-xl font-bold text-ink mb-1">Календарь проекта</h1>
      <p className="text-sm text-muted mb-5">
        Плановые и фактические даты этапов, проверок и контрольных точек.
      </p>
      <div className="flex flex-col gap-3">
        {[...byDate.entries()].map(([date, items]) => (
          <div key={date} className="card p-4">
            <div className="flex items-center gap-2 mb-2">
              <CalendarDays size={14} className="text-green" />
              <span className="text-sm font-semibold text-ink">{longDate(date)}</span>
              {date === data.today && <span className="chip bg-[#e2f2ef] text-green-d">сегодня</span>}
              {date < data.today && <span className="chip bg-chip text-muted">прошло</span>}
            </div>
            <div className="flex flex-col gap-1.5">
              {items.map((i, k) => (
                <div key={k} className="text-[13px] text-ink-2 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-light shrink-0" />
                  {i.title}
                  <span className="text-[11px] text-muted-2">{i.fact ? 'факт' : 'план'}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

// §12, §10.4: награды.
export function ClientRewards() {
  const data = useQuery(api.packClient.dashboard, {})
  if (data === undefined) return <Loading />
  const rewards = data?.rewards ?? []

  return (
    <>
      <h1 className="text-xl font-bold text-ink mb-1">Награды</h1>
      <p className="text-sm text-muted mb-5">
        Награда сохраняется, если вы отвечаете по этапу в срок — утверждаете его или присылаете
        замечания. Принимать результат без проверки не требуется.
      </p>
      {rewards.length === 0 ? (
        <Empty
          icon={Gift}
          title="Наград пока нет"
          text="Они появятся по мере прохождения этапов."
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {rewards.map((r) => (
            <div key={r._id} className="card p-4 flex items-start gap-3">
              {r.imageUrl ? (
                <img src={r.imageUrl} alt="" className="w-12 h-12 rounded-xl object-cover shrink-0" />
              ) : (
                <span className="w-12 h-12 rounded-xl bg-[#e2f2ef] text-green-d grid place-items-center shrink-0">
                  <Gift size={20} />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-ink">{r.title}</span>
                  <RewardChip status={r.status} />
                </div>
                {r.condition && <div className="text-[11px] text-muted mt-0.5">{r.condition}</div>}
                {r.description && <p className="text-[13px] text-ink-2 mt-1">{r.description}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

// §10.4, §13.3: обучающие материалы, тесты, видео и рекомендации.
export function ClientLearn() {
  const packId = useClientPack()
  const rows = useQuery(api.packClient.content, packId ? { packId } : 'skip')
  if (!packId || rows === undefined) return <Loading />

  return (
    <>
      <h1 className="text-xl font-bold text-ink mb-1">Обучение и материалы</h1>
      <p className="text-sm text-muted mb-5">
        Статьи, видео, тесты, инструкции и рекомендации от команды FRANCHONE.
      </p>
      {rows.length === 0 ? (
        <Empty
          icon={BookOpen}
          title="Материалов пока нет"
          text="Часть материалов открывается по мере прохождения этапов, часть — после завершения проекта."
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map((c) => (
            <div key={c._id} className="card p-4">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-ink flex-1">{c.title}</span>
                <span className="chip bg-chip text-muted">
                  {CONTENT_KIND_LABEL[c.kind] ?? c.kind}
                </span>
              </div>
              {c.body && <p className="text-[13px] text-ink-2 mt-2 whitespace-pre-line">{c.body}</p>}
              {c.url && (
                <a
                  href={c.url}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-ghost h-8 px-3 text-sm mt-3 inline-flex"
                >
                  Открыть
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  )
}

// §10.4, §14.1: уведомления внутри кабинета.
export function ClientNotifications() {
  const rows = useQuery(api.packClient.notifications, {})
  const markRead = useMutation(api.packClient.markRead)

  // Открыли ленту — значит, прочитали. Счётчик в шапке гаснет сам.
  useEffect(() => {
    if (rows && rows.some((n) => !n.read)) void markRead({})
  }, [rows, markRead])

  if (rows === undefined) return <Loading />

  return (
    <>
      <h1 className="text-xl font-bold text-ink mb-1">Уведомления</h1>
      <p className="text-sm text-muted mb-5">
        Ключевые события проекта: передача этапа, сроки, награды и завершение.
      </p>
      {rows.length === 0 ? (
        <Empty icon={BellRing} title="Уведомлений нет" />
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((n) => (
            <div key={n._id} className={`card p-4 ${n.read ? '' : 'border-green-light'}`}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-ink">{n.title}</span>
                <span className="text-[11px] text-muted-2">{dateTime(n.at)}</span>
                {!n.read && <span className="chip bg-[#e2f2ef] text-green-d">новое</span>}
              </div>
              {n.text && (
                <div className="text-[13px] text-ink-2 mt-1 whitespace-pre-line">{n.text}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  )
}

// §13.1: итоговый хаб — постоянный кабинет готовой франшизы.
export function ClientHub() {
  const packId = useClientPack()
  const data = useQuery(api.packClient.hub, packId ? { packId } : 'skip')
  if (!packId || data === undefined) return <Loading />
  if (!data) return null

  if (!data.open) {
    return (
      <Empty
        icon={Sparkles}
        title="Итоговый хаб откроется после завершения"
        text="Когда проект достигнет 100%, здесь появятся все итоговые документы, актуальные версии, история согласований и полученные награды. Кабинет останется у вас навсегда."
      />
    )
  }

  return (
    <>
      <h1 className="text-xl font-bold text-ink mb-1">Итоговый хаб · {data.title}</h1>
      <p className="text-sm text-muted mb-5">
        Проект завершён{data.finishedAt ? ` ${longDate(new Date(data.finishedAt).toISOString().slice(0, 10))}` : ''}. Всё
        нужное остаётся здесь.
      </p>

      {data.note && <div className="card p-4 mb-4 text-[13px] text-ink-2">{data.note}</div>}

      <section className="card p-5 mb-4">
        <div className="flex items-center gap-2 mb-3">
          <FolderOpen size={16} className="text-green" />
          <h2 className="sec-title">Итоговые документы</h2>
          <span className="chip bg-chip text-muted">{data.materials.length}</span>
        </div>
        {data.materials.length === 0 ? (
          <p className="text-sm text-muted">Документов нет.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {data.materials.map((m) => (
              <div key={m._id} className="rounded-xl border border-line p-3 flex items-center gap-2 flex-wrap">
                <span className="text-[13px] font-semibold text-ink flex-1">{m.title}</span>
                <span className="chip bg-chip text-muted">{m.stage}</span>
                {m.latest && (
                  <AttachmentLink kind={m.latest.kind} name={m.latest.name} url={m.latest.url} />
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {data.rewards.length > 0 && (
        <section className="card p-5 mb-4">
          <div className="flex items-center gap-2 mb-3">
            <Gift size={16} className="text-green" />
            <h2 className="sec-title">Полученные награды</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {data.rewards.map((r) => (
              <span key={r._id} className="inline-flex items-center gap-2 chip bg-chip text-ink-2">
                <CheckCircle2 size={12} className="text-green" /> {r.title}
              </span>
            ))}
          </div>
        </section>
      )}

      <section className="card p-5">
        <div className="flex items-center gap-2 mb-3">
          <CalendarDays size={16} className="text-green" />
          <h2 className="sec-title">История проекта и согласований</h2>
        </div>
        <div className="flex flex-col gap-1.5">
          {data.events.map((e) => (
            <div key={e._id} className="text-[12px] text-ink-2 flex gap-2 flex-wrap py-1 border-b border-line last:border-0">
              <span className="text-muted-2 w-32 shrink-0">{dateTime(e.at)}</span>
              <span className="font-medium">{EVENT_LABEL[e.type] ?? e.type}</span>
              {e.stage && <span className="text-muted">· {e.stage}</span>}
              {e.note && <span className="text-muted">{e.note}</span>}
            </div>
          ))}
        </div>
      </section>
    </>
  )
}
