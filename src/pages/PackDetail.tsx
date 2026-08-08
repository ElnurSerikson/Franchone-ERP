// Карточка проекта упаковки (ТЗ Упаковка). Здесь ведётся производство:
// этапы и материалы (§5, §11), структура и экономика (§4, §7), календарь
// (§6.2), награды (§12), журнал (§14.2) и связанная работа (§9.4).

import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery } from 'convex/react'
import {
  Archive, ArrowLeft, Boxes, CalendarDays, CheckCircle2, Gift, ListChecks, Loader2,
  Pause, Play, PuzzleIcon, Rocket, Settings2, Star, Users, Wallet,
} from 'lucide-react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import PageHeader from '@/components/PageHeader'
import Avatar from '@/components/ui/Avatar'
import { ProgressBar } from '@/components/ui/Progress'
import { errMessage } from '@/lib/errors'
import { kzt } from '@/lib/format'
import StageBoard from '@/components/packs/StageBoard'
import PackStructure from '@/components/packs/PackStructure'
import { PackCalendarTab, PackRewardsTab, PackWorkTab } from '@/components/packs/PackTabs'
import {
  Deadline, HealthChip, PackStatusChip, SideChip, areaCls, dateOnly, tabStrip,
} from '@/components/packs/ui'

type Tab = 'stages' | 'structure' | 'calendar' | 'rewards' | 'work'

export default function PackDetail() {
  const { id } = useParams<{ id: string }>()
  const packId = id as Id<'packs'>
  const navigate = useNavigate()
  const pack = useQuery(api.packs.get, { id: packId })
  const checks = useQuery(api.packs.checks, { id: packId })

  const launch = useMutation(api.packs.launch)
  const pause = useMutation(api.packs.pause)
  const resume = useMutation(api.packs.resume)
  const finish = useMutation(api.packs.finish)
  const archive = useMutation(api.packs.archive)
  const removeDraft = useMutation(api.packs.remove)

  const [tab, setTab] = useState<Tab>('stages')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [pausing, setPausing] = useState(false)
  const [reason, setReason] = useState('')

  if (pack === undefined) {
    return (
      <div className="card p-10 grid place-items-center text-muted">
        <Loader2 className="animate-spin" size={20} />
      </div>
    )
  }
  if (!pack) {
    return (
      <div className="card p-10 text-center">
        <div className="sec-title mb-1">Проект не найден</div>
        <p className="text-sm text-muted mb-4">
          Возможно, он удалён или к нему нет доступа.
        </p>
        <Link to="/packs" className="btn btn-ghost inline-flex">
          <ArrowLeft size={15} /> К списку упаковок
        </Link>
      </div>
    )
  }

  const act = async (name: string, fn: () => Promise<unknown>) => {
    setBusy(name)
    setError('')
    try {
      await fn()
      setPausing(false)
      setReason('')
    } catch (e) {
      setError(errMessage(e, 'Не удалось выполнить действие.'))
    } finally {
      setBusy('')
    }
  }

  const tabs: { key: Tab; label: string; icon: typeof Boxes; show: boolean }[] = [
    { key: 'stages', label: 'Этапы и материалы', icon: ListChecks, show: true },
    { key: 'structure', label: 'Структура и экономика', icon: Settings2, show: pack.canManage },
    { key: 'calendar', label: 'Календарь', icon: CalendarDays, show: true },
    { key: 'rewards', label: 'Пазл и подарок', icon: Gift, show: true },
    { key: 'work', label: 'Задачи и встречи', icon: Users, show: true },
  ]

  return (
    <>
      <PageHeader
        title={pack.title}
        subtitle={`${pack.client?.name ?? 'клиент не назначен'} · упаковщик ${pack.packer?.name ?? '—'}`}
        actions={
          <>
            <Link to="/packs" className="btn btn-ghost">
              <ArrowLeft size={15} /> К списку
            </Link>
            {pack.canManage && !pack.launchedAt && (
              <button
                onClick={() => act('launch', () => launch({ id: packId }))}
                disabled={!!busy || !checks?.canLaunch}
                className="btn btn-green disabled:opacity-50"
                title={checks?.canLaunch ? 'Открыть проект клиенту' : 'Сначала пройдите проверки на вкладке «Структура и экономика»'}
              >
                {busy === 'launch' ? <Loader2 size={15} className="animate-spin" /> : <Rocket size={15} />}
                Запустить и открыть клиенту
              </button>
            )}
            {pack.canManage && pack.status === 'active' && (
              <button onClick={() => setPausing((v) => !v)} className="btn btn-ghost">
                <Pause size={15} /> Пауза
              </button>
            )}
            {pack.canManage && pack.status === 'paused' && (
              <button
                onClick={() => act('resume', () => resume({ id: packId }))}
                disabled={!!busy}
                className="btn btn-ghost"
              >
                {busy === 'resume' ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
                Возобновить
              </button>
            )}
            {pack.canManage && pack.progress >= 100 && pack.status !== 'done' && (
              <button
                onClick={() => act('finish', () => finish({ id: packId }))}
                disabled={!!busy}
                className="btn btn-green"
              >
                {busy === 'finish' ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                Завершить и открыть хаб
              </button>
            )}
            {pack.isOwner && pack.status === 'done' && (
              <button
                onClick={() => act('archive', () => archive({ id: packId, archived: true }))}
                disabled={!!busy}
                className="btn btn-ghost"
              >
                <Archive size={15} /> В архив
              </button>
            )}
            {pack.isOwner && pack.status === 'archived' && (
              <button
                onClick={() => act('unarchive', () => archive({ id: packId, archived: false }))}
                disabled={!!busy}
                className="btn btn-ghost"
              >
                <Archive size={15} /> Вернуть из архива
              </button>
            )}
          </>
        }
      />

      {error && <p className="text-sm text-[#c53030] mb-3">{error}</p>}

      {pausing && (
        <div className="card p-4 mb-4 flex flex-col gap-3">
          <div className="text-sm font-semibold text-ink">Приостановить проект</div>
          <p className="text-[12px] text-muted">
            Таймеры остановятся, а после возобновления сроки сдвинутся ровно на длительность паузы.
            Причина обязательна и уйдёт в журнал (§5.2).
          </p>
          <textarea
            className={areaCls}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Причина приостановки"
          />
          <div className="flex gap-2">
            <button
              onClick={() => act('pause', () => pause({ id: packId, reason }))}
              disabled={!!busy || !reason.trim()}
              className="btn btn-green h-8 px-3 text-sm disabled:opacity-50"
            >
              {busy === 'pause' ? <Loader2 size={13} className="animate-spin" /> : <Pause size={13} />}
              Приостановить
            </button>
            <button onClick={() => setPausing(false)} className="btn btn-ghost h-8 px-3 text-sm">
              Отмена
            </button>
          </div>
        </div>
      )}

      {/* Шапка проекта */}
      <section className="card p-5 mb-4">
        <div className="flex items-start gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <PackStatusChip status={pack.status} />
              <HealthChip health={pack.health} reason={pack.healthReason} />
              <SideChip side={pack.side} />
              {!pack.launchedAt && (
                <span className="chip bg-[#fff6e6] text-[#b7791f]">клиенту ещё не открыт</span>
              )}
              {pack.hubOpenedAt && (
                <span className="chip bg-[#e2f2ef] text-green-d">итоговый хаб открыт</span>
              )}
            </div>
            <p className="text-sm text-ink-2">{pack.healthReason}</p>
            {pack.pausedReason && (
              <p className="text-sm text-[#b7791f] mt-1">Причина паузы: {pack.pausedReason}</p>
            )}
            {pack.description && (
              <p className="text-[13px] text-muted mt-2 whitespace-pre-line">{pack.description}</p>
            )}
          </div>

          <div className="w-full sm:w-64">
            <div className="flex items-baseline justify-between mb-1.5">
              <span className="text-sm text-ink-2">Готовность</span>
              <span className="text-lg font-bold text-ink tabular-nums">{pack.progress}%</span>
            </div>
            <ProgressBar value={pack.progress / 100} />
            <div className="text-[11px] text-muted mt-1">
              утверждено этапов {pack.approvedStages} из {pack.mainStages} · сумма весов{' '}
              {pack.weightSum}%
            </div>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-line grid gap-4 sm:grid-cols-2 xl:grid-cols-4 text-[13px]">
          <Info label="Старт / общий срок" value={`${pack.startDate} → ${pack.dueDate}`} />
          <Info label="Плановое завершение по этапам" value={pack.plannedFinish} />
          <Info
            label="Ближайший дедлайн"
            value={<Deadline at={pack.nextDueAt} now={pack.now} />}
          />
          <Info
            label="Текущий этап"
            value={pack.currentStage?.title ?? 'все этапы утверждены'}
          />
        </div>

        {/* §3: внутренние суммы. У клиента этого экрана нет в принципе. */}
        {pack.canManage && (
          <div className="mt-4 pt-4 border-t border-line flex items-center gap-4 flex-wrap">
            <span className="inline-flex items-center gap-2 chip bg-chip text-ink-2">
              <Wallet size={12} /> стоимость {kzt(pack.price)}
            </span>
            <span className="chip bg-chip text-ink-2">процент упаковщика {pack.packerPercent}%</span>
            <span className="chip bg-chip text-ink-2">полное вознаграждение {kzt(pack.reward)}</span>
            <span className="chip bg-[#e2f2ef] text-green-d">начислено {kzt(pack.accrued)}</span>
            <span className="chip bg-chip text-ink-2">выплачено {kzt(pack.paid)}</span>
            <span className="text-[11px] text-muted-2">клиент этих полей не получает</span>
          </div>
        )}

        <div className="mt-4 pt-4 border-t border-line flex items-center gap-3 flex-wrap">
          {/* §7, §11.2: пазл, подарок и средняя оценка заказчика. */}
          <span className="chip bg-chip text-ink-2">
            <PuzzleIcon size={12} /> пазл {pack.puzzle.collected}/{pack.puzzle.total}
          </span>
          {pack.gift.earned && (
            <span className="chip bg-[#e2f2ef] text-green-d">
              <Gift size={12} /> подарок заслужен
            </span>
          )}
          {pack.rating !== null && (
            <span className="chip bg-[#fff6e6] text-[#b7791f]">
              <Star size={12} /> оценка {pack.rating.toFixed(1)}
            </span>
          )}
          {pack.client && (
            <span className="inline-flex items-center gap-2 chip bg-chip text-ink-2">
              <Avatar initials={pack.client.initials} color={pack.client.avatarColor} size={18} />
              {pack.client.name} · клиент
            </span>
          )}
          {pack.packer && (
            <span className="inline-flex items-center gap-2 chip bg-chip text-ink-2">
              <Avatar initials={pack.packer.initials} color={pack.packer.avatarColor} size={18} />
              {pack.packer.name} · упаковщик
            </span>
          )}
          {pack.members.map((m) =>
            m ? (
              <span key={m._id} className="inline-flex items-center gap-2 chip bg-chip text-muted">
                <Avatar initials={m.initials} color={m.avatarColor} size={18} />
                {m.name}
              </span>
            ) : null,
          )}
          <div className="flex-1" />
          <span className="text-[11px] text-muted-2">
            последнее событие {dateOnly(pack.lastActivityAt)}
          </span>
        </div>
      </section>

      <div className={`${tabStrip} mb-4`}>
        {tabs
          .filter((t) => t.show)
          .map((t) => {
            const Icon = t.icon
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`chip whitespace-nowrap transition-colors ${
                  tab === t.key ? 'bg-green text-white' : 'bg-chip text-muted hover:text-ink-2'
                }`}
              >
                <Icon size={12} /> {t.label}
              </button>
            )
          })}
        <div className="flex-1" />
        {pack.isOwner && !pack.launchedAt && (
          <button
            onClick={async () => {
              setError('')
              try {
                await removeDraft({ id: packId })
                navigate('/packs')
              } catch (e) {
                setError(errMessage(e, 'Не удалось удалить черновик.'))
              }
            }}
            className="mini-btn text-[#c53030]"
          >
            Удалить черновик
          </button>
        )}
      </div>

      {tab === 'stages' && <StageBoard packId={packId} />}
      {tab === 'structure' && (
        <PackStructure packId={packId} canManage={pack.canManage} launched={!!pack.launchedAt} />
      )}
      {tab === 'calendar' && <PackCalendarTab packId={packId} canManage={pack.canManage} />}
      {tab === 'rewards' && <PackRewardsTab packId={packId} isOwner={pack.isOwner} />}
      {tab === 'work' && <PackWorkTab packId={packId} />}
    </>
  )
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] text-muted">{label}</div>
      <div className="text-ink-2 mt-0.5">{value}</div>
    </div>
  )
}
