import { UserPlus, Search, Pencil, Archive, MoreHorizontal, Mail, Phone } from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import Avatar from '@/components/ui/Avatar'
import { KpiChip } from '@/components/ui/StatusChip'
import { useData } from '@/lib/useData'
import { employeeKpi } from '@/lib/selectors'
import { kzt, pct } from '@/lib/format'
import { roleLabel } from '@/store'

const th = 'text-left text-[11px] font-semibold text-muted uppercase tracking-wide px-4 py-3'
const td = 'px-4 py-3 text-sm text-ink-2 border-t border-line align-middle'

export default function Team() {
  const { employees, smmMetrics, campaigns } = useData()
  const departments = Array.from(new Set(employees.map((e) => e.department)))
  return (
    <>
      <PageHeader
        title="Команда"
        subtitle={`${employees.length} сотрудников · ${departments.length} отдела`}
        actions={
          <button className="btn btn-green">
            <UserPlus size={16} /> Добавить сотрудника
          </button>
        }
      />

      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative w-full sm:w-64">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            className="w-full h-10 pl-9 pr-3 rounded-xl bg-card border border-line-2 text-sm placeholder:text-muted focus:outline-none focus:border-green-light"
            placeholder="Поиск сотрудника…"
          />
        </div>
        <button className="mini-btn h-10 px-3">Все отделы</button>
        <button className="mini-btn h-10 px-3">Все роли</button>
        <button className="mini-btn h-10 px-3">Активные</button>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px]">
            <thead>
              <tr className="bg-chip/60">
                <th className={`${th} sticky left-0 z-20 bg-[#f4f5f6]`}>Сотрудник</th>
                <th className={th}>Должность</th>
                <th className={th}>Отдел</th>
                <th className={th}>Роль</th>
                <th className={th}>Оклад</th>
                <th className={th}>KPI</th>
                <th className={th}>Статус</th>
                <th className={`${th} text-right`}>Действия</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => {
                const { kpi } = employeeKpi(e, smmMetrics, campaigns)
                return (
                  <tr key={e.id} className="hover:bg-chip/40 transition-colors">
                    <td className={`${td} sticky left-0 z-10 bg-card`}>
                      <div className="flex items-center gap-3">
                        <Avatar initials={e.initials} color={e.avatarColor} size={38} />
                        <div>
                          <div className="font-semibold text-ink">{e.name}</div>
                          <div className="flex items-center gap-3 text-[11px] text-muted mt-0.5">
                            <span className="inline-flex items-center gap-1">
                              <Mail size={11} /> {e.email}
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <Phone size={11} /> {e.phone}
                            </span>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className={td}>{e.positionLabel}</td>
                    <td className={td}>{e.department}</td>
                    <td className={td}>
                      <span className="chip bg-chip text-ink-2">{roleLabel[e.role]}</span>
                    </td>
                    <td className={td}>{e.salary ? kzt(e.salary) : '—'}</td>
                    <td className={td}>
                      {kpi === null ? (
                        <span className="text-muted-2">—</span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-ink">{pct(kpi)}</span>
                          <KpiChip value={kpi} />
                        </div>
                      )}
                    </td>
                    <td className={td}>
                      <span className="chip bg-[#e2f2ef] text-green-d">Активен</span>
                    </td>
                    <td className={td}>
                      <div className="flex items-center justify-end gap-1">
                        <button className="ico-btn w-9 h-9" title="Редактировать">
                          <Pencil size={14} />
                        </button>
                        <button className="ico-btn w-9 h-9" title="В архив">
                          <Archive size={14} />
                        </button>
                        <button className="ico-btn w-9 h-9" title="Ещё">
                          <MoreHorizontal size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
