import { useState } from 'react'
import { useMutation } from 'convex/react'
import { UserPlus, Pencil, UserX, UserCheck, Mail, Phone } from 'lucide-react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import type { Employee } from '@/types'
import PageHeader from '@/components/PageHeader'
import Avatar from '@/components/ui/Avatar'
import TeamMemberDrawer from '@/components/TeamMemberDrawer'
import { usePerms } from '@/lib/usePerms'
import ConfirmDialog from '@/components/ConfirmDialog'
import { useData } from '@/lib/useData'
import { errMessage } from '@/lib/errors'
import { roleLabel, useCurrentUser } from '@/store'
import { th, thCenter, td, theadRow } from '@/lib/table'
import { plural } from '@/lib/format'


export default function Team() {
  const { employees } = useData()
  const me = useCurrentUser()
  const setActive = useMutation(api.employees.setActive)
  const { can } = usePerms()
  const canInvite = can('team', 'create')

  const departments = Array.from(new Set(employees.map((e) => e.department)))

  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Employee | null>(null)
  const [target, setTarget] = useState<Employee | null>(null) // подтверждение статуса
  const [busy, setBusy] = useState(false)
  const [confirmError, setConfirmError] = useState<string | null>(null)

  const willActivate = target ? target.status !== 'active' : false

  const applyStatus = async () => {
    if (!target) return
    setBusy(true)
    setConfirmError(null)
    try {
      await setActive({ id: target.id as Id<'employees'>, active: willActivate })
      setTarget(null)
    } catch (err) {
      setConfirmError(errMessage(err, 'Не удалось изменить статус сотрудника.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Команда"
        subtitle={
          `${employees.length} ${plural(employees.length, 'сотрудник', 'сотрудника', 'сотрудников')}` +
          ` · ${departments.length} ${plural(departments.length, 'отдел', 'отдела', 'отделов')}`
        }
        actions={
          canInvite ? (
            <button className="btn btn-green" onClick={() => setCreating(true)}>
              <UserPlus size={16} /> Добавить сотрудника
            </button>
          ) : undefined
        }
      />

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px]">
            <thead>
              <tr className={theadRow}>
                <th
                  className={`${th} sticky left-0 z-20 bg-[#e2f2ef] border-r border-line md:static md:z-auto md:border-r-0`}
                >
                  Сотрудник
                </th>
                <th className={th}>Должность</th>
                <th className={th}>Отдел</th>
                <th className={th}>Роль</th>
                <th className={th}>Статус</th>
                <th className={thCenter}>Действия</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => {
                const active = e.status === 'active'
                const isSelf = e.id === me.id
                // Себя и владельца выключить нельзя — бэкенд это тоже запрещает.
                const blocked = active && (isSelf || e.role === 'owner')
                return (
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
                      {active ? (
                        <span className="chip bg-[#e2f2ef] text-green-d">Активен</span>
                      ) : (
                        <span className="chip bg-chip text-muted">Неактивен</span>
                      )}
                    </td>
                    <td className={td}>
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          onClick={() => setEditing(e)}
                          className="ico-btn w-9 h-9"
                          title="Редактировать"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => setTarget(e)}
                          disabled={blocked}
                          className="ico-btn w-9 h-9 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white"
                          title={
                            blocked
                              ? isSelf
                                ? 'Нельзя деактивировать себя'
                                : 'Нельзя деактивировать владельца'
                              : active
                                ? 'Деактивировать'
                                : 'Активировать'
                          }
                        >
                          {active ? <UserX size={14} /> : <UserCheck size={14} />}
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

      {creating && <TeamMemberDrawer onClose={() => setCreating(false)} />}
      {editing && <TeamMemberDrawer employee={editing} onClose={() => setEditing(null)} />}

      {target && (
        <ConfirmDialog
          title={willActivate ? 'Вернуть в команду?' : 'Деактивировать члена команды?'}
          description={
            willActivate ? (
              <>
                <b className="text-ink-2">{target.name}</b> снова получит доступ к системе.
              </>
            ) : (
              <>
                <b className="text-ink-2">{target.name}</b> потеряет доступ к системе. Данные и
                история сохранятся — вернуть можно в любой момент.
              </>
            )
          }
          confirmLabel="Да"
          cancelLabel="Нет"
          danger={!willActivate}
          loading={busy}
          error={confirmError}
          onConfirm={applyStatus}
          onCancel={() => {
            setTarget(null)
            setConfirmError(null)
          }}
        />
      )}
    </>
  )
}
