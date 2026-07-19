import { Search, Bell, Mail, Eye } from 'lucide-react'
import type { Role } from '@/types'
import { useApp, useCurrentUser, roleLabel } from '@/store'
import Avatar from './ui/Avatar'

const roles: Role[] = ['owner', 'head', 'employee']

export default function Topbar() {
  const { role, setRole } = useApp()
  const user = useCurrentUser()

  return (
    <div className="flex items-center gap-3 mb-6">
      {/* Search */}
      <div className="relative flex-1 max-w-md">
        <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
        <input
          className="w-full h-11 pl-10 pr-16 rounded-xl bg-card border border-line-2 text-sm placeholder:text-muted focus:outline-none focus:border-green-light"
          placeholder="Поиск по задачам, сотрудникам, кампаниям…"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-muted border border-line-2 rounded-md px-1.5 py-0.5">
          ⌘ F
        </span>
      </div>

      <div className="flex-1" />

      {/* Демо: переключатель роли */}
      <div className="hidden md:flex items-center gap-2 h-11 pl-3 pr-2 rounded-xl bg-card border border-line-2">
        <Eye size={16} className="text-muted" />
        <span className="text-xs text-muted">Просмотр как</span>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
          className="text-sm font-semibold text-ink bg-transparent focus:outline-none cursor-pointer"
        >
          {roles.map((r) => (
            <option key={r} value={r}>
              {roleLabel[r]}
            </option>
          ))}
        </select>
      </div>

      <button className="ico-btn" title="Уведомления">
        <Bell size={18} />
      </button>
      <button className="ico-btn" title="Сообщения">
        <Mail size={18} />
      </button>

      {/* User */}
      <div className="flex items-center gap-2.5 pl-1">
        <Avatar initials={user.initials} color={user.avatarColor} size={40} />
        <div className="hidden lg:block leading-tight">
          <div className="text-sm font-semibold text-ink">{user.name}</div>
          <div className="text-[11px] text-muted">{user.email}</div>
        </div>
      </div>
    </div>
  )
}
