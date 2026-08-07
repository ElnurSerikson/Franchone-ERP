// §14.3: аналитика модуля упаковки. Плюс настройки сроков и порога «жёлтого»
// индикатора (§6.1, §6.3) — они прямо влияют на то, что показывает аналитика.

import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { BarChart3, Check, Gauge, Loader2, RotateCcw, Settings2, Timer, Users } from 'lucide-react'
import { api } from '../../../convex/_generated/api'
import StatCard from '@/components/ui/StatCard'
import DatePicker from '@/components/ui/DatePicker'
import { pct } from '@/lib/format'
import { errMessage } from '@/lib/errors'
import { th, thRight, td, theadRow } from '@/lib/table'
import { Field, dateTime, inputCls } from './ui'

export default function PackAnalyticsTab({ isOwner }: { isOwner: boolean }) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const data = useQuery(api.packExtras.analytics, {
    from: from || undefined,
    to: to || undefined,
  })

  if (data === undefined) {
    return (
      <div className="card p-10 grid place-items-center text-muted">
        <Loader2 className="animate-spin" size={20} />
      </div>
    )
  }
  if (!data) return null

  const maxMonth = Math.max(...data.months.map((m) => m.approved), 1)

  return (
    <>
      <section className="card p-4 mb-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Период с">
            <DatePicker value={from} onChange={setFrom} placeholder="с начала" />
          </Field>
          <Field label="по">
            <DatePicker value={to} onChange={setTo} placeholder="по сегодня" />
          </Field>
          <div className="flex items-end">
            <button
              onClick={() => {
                setFrom('')
                setTo('')
              }}
              className="btn btn-ghost h-9 px-3 text-sm"
            >
              <RotateCcw size={14} /> Весь период
            </button>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4 mb-4">
        <StatCard
          highlight
          label="Средняя длительность проекта"
          value={`${data.avgProjectDays.toFixed(1)} дн.`}
          foot={`завершено проектов: ${data.finished}`}
          icon={Timer}
        />
        <StatCard
          label="Средняя длительность этапа"
          value={`${data.avgStageDays.toFixed(1)} дн.`}
          foot={`утверждено этапов: ${data.approvedStages}`}
          icon={BarChart3}
        />
        <StatCard
          label="Этапы в срок"
          value={pct(data.onTimeRate)}
          foot={`возвратов на доработку: ${data.returns}`}
          icon={Gauge}
        />
        <StatCard
          label="Активность после завершения"
          value={`${data.clientsActiveAfter} / ${data.clientsFinished}`}
          foot="клиентов заходили в кабинет после сдачи"
          icon={Users}
        />
      </div>

      {/* Задержки по сторонам — главный аргумент в разговоре с клиентом. */}
      <div className="grid gap-4 lg:grid-cols-2 mb-4">
        <div className="card p-5">
          <h3 className="sec-title mb-3">Кто задерживает сейчас</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-chip p-3">
              <div className="text-[11px] text-muted">На стороне FRANCHONE</div>
              <div className="text-xl font-bold text-[#5a4bd6]">{data.lateOnUs}</div>
              <div className="text-[11px] text-muted mt-0.5">
                средняя просрочка {data.avgLateUsDays.toFixed(1)} дн.
              </div>
            </div>
            <div className="rounded-xl bg-chip p-3">
              <div className="text-[11px] text-muted">На стороне клиента</div>
              <div className="text-xl font-bold text-[#2563eb]">{data.lateOnClient}</div>
              <div className="text-[11px] text-muted mt-0.5">
                средняя просрочка {data.avgLateClientDays.toFixed(1)} дн.
              </div>
            </div>
          </div>
          <p className="text-[11px] text-muted-2 mt-3">
            Считаются живые просроченные таймеры этапов: у кого сейчас на руках работа и насколько
            он вышел за срок.
          </p>
        </div>

        <div className="card p-5">
          <h3 className="sec-title mb-3">Динамика по месяцам</h3>
          {data.months.length === 0 ? (
            <p className="text-sm text-muted">Пока нет утверждённых этапов.</p>
          ) : (
            <div className="flex items-end gap-3 flex-wrap">
              {data.months.map((m) => (
                <div key={m.month} className="text-center">
                  <div
                    className="w-9 rounded-t-md bg-green"
                    style={{ height: Math.max(6, (m.approved / maxMonth) * 90) }}
                    title={`утверждено этапов: ${m.approved}, завершено проектов: ${m.finished}`}
                  />
                  <div className="text-[10px] text-muted-2 mt-1">{m.month.slice(5)}</div>
                  <div className="text-[10px] text-ink-2">{m.approved}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* §14.3: нагрузка упаковщиков */}
      <div className="card overflow-hidden mb-4">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px]">
            <thead>
              <tr className={theadRow}>
                <th className={th}>Упаковщик</th>
                <th className={thRight}>Активных проектов</th>
                <th className={thRight}>Утверждено этапов за период</th>
              </tr>
            </thead>
            <tbody>
              {data.load.length === 0 ? (
                <tr>
                  <td className={td} colSpan={3}>
                    <span className="text-muted">Данных пока нет.</span>
                  </td>
                </tr>
              ) : (
                data.load.map((l) => (
                  <tr key={l.name} className="hover:bg-chip/40 transition-colors">
                    <td className={`${td} font-semibold text-ink`}>{l.name}</td>
                    <td className={`${td} text-right tabular-nums`}>{l.active}</td>
                    <td className={`${td} text-right tabular-nums`}>{l.stages}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* §14.3: количество и причины возвратов */}
      <div className="card p-5 mb-4">
        <div className="flex items-center gap-2 mb-3">
          <h3 className="sec-title">Причины возвратов</h3>
          <span className="chip bg-chip text-muted">{data.returns}</span>
        </div>
        {data.returnReasons.length === 0 ? (
          <p className="text-sm text-muted">Возвратов на доработку не было.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {data.returnReasons.map((r, i) => (
              <div key={i} className="rounded-xl border border-line p-3">
                <div className="text-[11px] text-muted">
                  {r.pack} · {r.stage} · {dateTime(r.at)}
                </div>
                <div className="text-[13px] text-ink-2 mt-1">{r.text}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {isOwner && <ModuleSettings />}
    </>
  )
}

// §6.1, §6.3: сроки по умолчанию и порог жёлтого индикатора.
function ModuleSettings() {
  const settings = useQuery(api.packExtras.moduleSettings)
  const save = useMutation(api.packExtras.setModuleSettings)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  if (!settings) return null
  const val = (k: keyof typeof settings) => draft[k] ?? String(settings[k])

  const commit = async () => {
    setBusy(true)
    setError('')
    try {
      await save({
        warnHours: Number(val('warnHours')),
        reviewDays: Number(val('reviewDays')),
        rereviewDays: Number(val('rereviewDays')),
        fixDays: Number(val('fixDays')),
        idleDays: Number(val('idleDays')),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setError(errMessage(e, 'Не удалось сохранить настройки.'))
    } finally {
      setBusy(false)
    }
  }

  const rows: { key: keyof typeof settings; label: string; hint: string }[] = [
    { key: 'warnHours', label: 'Жёлтый за, часов', hint: 'За сколько часов до срока индикатор становится жёлтым (§6.3)' },
    { key: 'reviewDays', label: 'Первичная проверка, дней', hint: 'Срок ответа клиента на новый этап' },
    { key: 'rereviewDays', label: 'Повторная проверка, дней', hint: 'Срок ответа на доработанный этап' },
    { key: 'fixDays', label: 'Доработка, дней', hint: 'Срок FRANCHONE на исправление замечаний' },
    { key: 'idleDays', label: 'Без активности, дней', hint: 'Через сколько дней тишины проект попадает в «без активности»' },
  ]

  return (
    <section className="card p-5">
      <div className="flex items-center gap-2 mb-4">
        <Settings2 size={16} className="text-green" />
        <h3 className="sec-title">Сроки и индикаторы по умолчанию</h3>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {rows.map((r) => (
          <Field key={r.key} label={r.label} hint={r.hint}>
            <input
              className={inputCls}
              type="number"
              min={1}
              value={val(r.key)}
              onChange={(e) => setDraft((d) => ({ ...d, [r.key]: e.target.value }))}
            />
          </Field>
        ))}
      </div>
      {error && <p className="text-sm text-[#c53030] mt-3">{error}</p>}
      <div className="mt-4 flex items-center gap-2">
        <button onClick={commit} disabled={busy} className="btn btn-green h-9 px-3 text-sm disabled:opacity-60">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Сохранить
        </button>
        {saved && <span className="text-sm text-green-d">Сохранено</span>}
        <span className="text-[11px] text-muted-2">
          Новые значения применяются к этапам, которые создаются дальше; у существующих сроки
          правятся в карточке проекта.
        </span>
      </div>
    </section>
  )
}
