import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { CopyPlus, Loader2 } from 'lucide-react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import Select from '@/components/ui/Select'
import { errMessage, errDetail } from '@/lib/errors'
import { CURRENT_MONTH, formatMonth } from '@/lib/month'

// Перенос плановых значений из прошедшего месяца в текущий.
//
// Кнопка появляется ТОЛЬКО когда открыт текущий месяц, а в источниках —
// только более ранние месяцы, и только те, где действительно есть данные.
// Оба правила продублированы на сервере: интерфейс не единственная защита.

export type CopySection = 'smm' | 'salesRevenue' | 'salesObjects' | 'targetLeads'

export default function CopyFromMonth({
  section,
  month,
  employeeId,
  what,
  onDone,
}: {
  section: CopySection
  // Месяц, открытый в разделе сейчас.
  month: string
  // Разделы SMM и плана выручки настраиваются по одному сотруднику.
  employeeId?: Id<'employees'>
  // Что именно переносится — пишем прямо, чтобы перезапись не была сюрпризом.
  what: string
  onDone?: () => void
}) {
  const atCurrent = month === CURRENT_MONTH
  const data = useQuery(
    api.planCopy.sourceMonths,
    atCurrent ? { section, ...(employeeId ? { employeeId } : {}) } : 'skip',
  )
  const copy = useMutation(api.planCopy.copy)

  const [from, setFrom] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  // Только для текущего месяца — прошлый и будущий переносом не трогаем.
  if (!atCurrent) return null

  const months = data?.months ?? []
  const picked = from || months[0] || ''

  const run = async () => {
    if (!picked) return
    setBusy(true)
    setError('')
    setDone('')
    try {
      const res = await copy({
        section,
        from: picked,
        ...(employeeId ? { employeeId } : {}),
      })
      setDone(
        res.copied === 0
          ? `В ${formatMonth(picked)} переносить нечего.`
          : `Перенесено строк: ${res.copied}` +
              (res.replaced > 0 ? ` · заменено прежних: ${res.replaced}` : ''),
      )
      onDone?.()
    } catch (e) {
      const detail = errDetail(e)
      setError(errMessage(e, 'Не удалось перенести.') + (detail ? ` (${detail})` : ''))
    } finally {
      setBusy(false)
    }
  }

  if (data === undefined) return null
  if (months.length === 0) {
    return (
      <p className="text-[11px] text-muted-2 mt-3">
        Переносить пока не из чего: в прошлых месяцах данных нет.
      </p>
    )
  }

  return (
    <div className="mt-4 pt-4 border-t border-line">
      <div className="flex items-end gap-2 flex-wrap">
        <div className="w-52">
          <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-1.5">
            Взять значения из месяца
          </div>
          <Select
            value={picked}
            onChange={(v) => {
              setFrom(v)
              setDone('')
              setError('')
            }}
            options={months.map((m) => ({ value: m, label: formatMonth(m) }))}
          />
        </div>
        <button
          onClick={run}
          disabled={busy}
          className="btn btn-ghost h-9 px-4 text-sm disabled:opacity-60"
          title={`Перенести в ${formatMonth(CURRENT_MONTH)}`}
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <CopyPlus size={14} />}
          Перенести в {formatMonth(CURRENT_MONTH)}
        </button>
      </div>
      <p className="text-[11px] text-muted-2 mt-2">
        {what} за {formatMonth(CURRENT_MONTH)} будут заменены значениями выбранного месяца.
        Фактические результаты не переносятся — они собираются из отчётов нового месяца.
      </p>
      {error && <p className="text-sm text-[#c53030] mt-2">{error}</p>}
      {done && <p className="text-sm text-green-d mt-2">{done}</p>}
    </div>
  )
}
