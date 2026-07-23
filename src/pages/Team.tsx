import { useState } from 'react'
import { UserPlus, Pencil, Archive, MoreHorizontal, Mail, Phone } from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import Avatar from '@/components/ui/Avatar'
import TeamInviteDrawer from '@/components/TeamInviteDrawer'
import { useData } from '@/lib/useData'
import { roleLabel } from '@/store'

const th = 'text-left text-[11px] font-semibold text-muted uppercase tracking-wide px-4 py-3'
const td = 'px-4 py-3 text-sm text-ink-2 border-t border-line align-middle'

export default function Team() {
  const { employees } = useData()
  const departments = Array.from(new Set(employees.map((e) => e.department)))
  const [inviting, setInviting] = useState(false)
  return (
    <>
      <PageHeader
        title="Команда"
        subtitle={`${employees.length} сотрудников · ${departments.length} отдела`}
        actions={
          <button className="btn btn-green" onClick={() => setInviting(true)}>
            <UserPlus size={16} /> Добавить сотрудника
          </button>
        }
      />

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px]">
            <thead>
              <tr className="bg-chip">
                <th
                  className={`${th} sticky left-0 z-20 bg-chip border-r border-line md:static md:z-auto md:border-r-0`}
                >
                  Сотрудник
                </th>
                <th className={th}>Должность</th>
                <th className={th}>Отдел</th>
                <th className={th}>Роль</th>
                <th className={th}>Статус</th>
                <th className={`${th} text-right`}>Действия</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => (
                <tr key={e.id} className="hover:bg-chip/40 transition-colors">
                  <td
                    className={`${td} sticky left-0 z-10 bg-card border-r border-line md:static md:z-auto md:border-r-0 md:bg-transparent`}
                  >
                    <div className="flex items-center gap-3">
                      <Avatar initials={e.initials} color={e.avatarColor} size={38} />
                      <div className="min-w-0">
                        <div className="font-semibold text-ink whitespace-nowrap">{e.name}</div>
                        <div className="flex flex-col sm:flex-row sm:items-center gap-0.5 sm:gap-3 text-[11px] text-muted mt-0.5">
                          <span className="inline-flex items-center gap-1 whitespace-nowrap">
                            <Mail size={11} className="shrink-0" /> {e.email}
                          </span>
                          <span className="inline-flex items-center gap-1 whitespace-nowrap">
                            <Phone size={11} className="shrink-0" /> {e.phone}
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
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {inviting && <TeamInviteDrawer onClose={() => setInviting(false)} />}
    </>
  )
}
