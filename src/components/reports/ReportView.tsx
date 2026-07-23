import { useQuery } from 'convex/react'
import type { Doc } from '../../../convex/_generated/dataModel'
import { api } from '../../../convex/_generated/api'
import { Clock, PencilLine } from 'lucide-react'
import { kzt, num } from '@/lib/format'
import { REPORT_STATUS, reportTime, cpl } from '@/lib/reports'

type Report = Doc<'dailyReports'>

const th = 'text-left text-[11px] font-semibold text-green-d uppercase tracking-wide px-3 py-2'
const td = 'px-3 py-2 text-sm text-ink-2 border-t border-line'

// Read-only отображение отчёта: статус, содержимое по должности, история правок.
export default function ReportView({ report }: { report: Report }) {
  const st = REPORT_STATUS[report.onTime ? 'onTime' : 'late']
  // В отчёте лежит только ID кампании — название достаём из реестра.
  // Реестр берём целиком: кампанию могли поставить на паузу после сдачи отчёта.
  const registry = useQuery(api.campaigns.registry, report.targetolog ? {} : 'skip')
  const byCode = new Map((registry ?? []).map((c) => [c.code, c]))

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`chip ${st.chip}`}>
          <Clock size={12} /> {st.label}
        </span>
        <span className="text-sm text-muted">Отправлен: {reportTime(report.submittedAt)}</span>
        {report.editCount > 0 && report.editedAt && (
          <span className="chip bg-chip text-muted-2">
            <PencilLine size={12} /> Изменён {report.editCount}× · {reportTime(report.editedAt)}
          </span>
        )}
      </div>

      {report.smm && (
        <table className="w-full">
          <thead>
            <tr className="bg-[#e2f2ef]">
              <th className={th}>Страница</th>
              <th className={th}>Формат</th>
              <th className={th}>Кол-во</th>
            </tr>
          </thead>
          <tbody>
            {report.smm.map((r, i) => (
              <tr key={i}>
                <td className={td}>{r.page}</td>
                <td className={td}>{r.type}</td>
                <td className={`${td} font-semibold text-ink`}>{r.count}</td>
              </tr>
            ))}
            <tr>
              <td className={`${td} font-semibold text-ink`} colSpan={2}>
                Итого публикаций
              </td>
              <td className={`${td} font-bold text-green-d`}>
                {report.smm.reduce((s, r) => s + r.count, 0)}
              </td>
            </tr>
          </tbody>
        </table>
      )}

      {report.targetolog && (
        <div className="overflow-x-auto -mx-1 px-1">
          <table className="w-full min-w-[420px]">
            <thead>
              <tr className="bg-[#e2f2ef]">
                <th className={th}>Кампания</th>
                <th className={th}>Бюджет</th>
                <th className={th}>Заявки</th>
                <th className={th}>CPL</th>
              </tr>
            </thead>
            <tbody>
              {report.targetolog.map((r, i) => (
                <tr key={i}>
                  <td className={td}>
                    <div className="font-medium text-ink">
                      {byCode.get(r.code)?.campaign ?? r.code}
                    </div>
                    <div className="text-[11px] text-muted">
                      {r.code}
                      {byCode.get(r.code) ? ` · ${byCode.get(r.code)!.brand}` : ''}
                    </div>
                  </td>
                  <td className={td}>{kzt(r.budget)}</td>
                  <td className={`${td} font-semibold text-ink`}>{r.leads}</td>
                  <td className={td}>{kzt(cpl(r.budget, r.leads))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {report.sales && (
        <div className="grid grid-cols-2 gap-3">
          <Metric label="Обработано заявок" value={num(report.sales.leads)} />
          <Metric label="Звонки / встречи" value={num(report.sales.meetings)} />
          <Metric label="Продаж, шт" value={num(report.sales.sales)} />
          <Metric label="Сумма продаж" value={kzt(report.sales.revenue)} />
          {report.sales.note ? (
            <div className="col-span-2 rounded-xl border border-line p-3 text-sm text-ink-2">
              {report.sales.note}
            </div>
          ) : null}
        </div>
      )}

      {report.note ? (
        <div className="rounded-xl border border-line p-3">
          <div className="text-[11px] text-muted uppercase tracking-wide mb-1">
            Комментарий / ссылка
          </div>
          <div className="text-sm text-ink-2 break-words">{report.note}</div>
        </div>
      ) : null}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line p-3">
      <div className="text-xs text-muted mb-1">{label}</div>
      <div className="text-lg font-bold text-ink">{value}</div>
    </div>
  )
}
