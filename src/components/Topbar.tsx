import { useState } from 'react'
import { Search, Bell, Mail, Eye, Menu, X } from 'lucide-react'
import type { Role } from '@/types'
import { useApp, useCurrentUser, roleLabel } from '@/store'
import Avatar from './ui/Avatar'
import Select from './ui/Select'

const roles: Role[] = ['owner', 'head', 'employee']

export default function Topbar({ onMenu }: { onMenu: () => void }) {
  const { role, setRole, isOwner } = useApp()
  const user = useCurrentUser()
  const [searchOpen, setSearchOpen] = useState(false)

  return (
    <div className="flex items-center gap-2 md:gap-3 mb-4 md:mb-6">
      {/* Бургер — только на телефоне */}
      <button
        onClick={onMenu}
        aria-label="Меню"
        className="md:hidden inline-flex items-center justify-center w-11 h-11 rounded-xl border border-line-2 bg-card text-ink-2 hover:bg-chip transition-colors shrink-0"
      >
        <Menu size={20} />
      </button>

      {/* Поиск — полное поле на md+ */}
      <div className="relative flex-1 max-w-md hidden md:block">
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

      {/* Поиск-иконка — только на телефоне */}
      <button
        onClick={() => setSearchOpen(true)}
        aria-label="Поиск"
        className="md:hidden inline-flex items-center justify-center w-11 h-11 rounded-xl border border-line-2 bg-card text-ink-2 hover:bg-chip transition-colors shrink-0"
      >
        <Search size={18} />
      </button>

      {/* Владелец может посмотреть панель «глазами» другой роли (на телефоне — в drawer) */}
      {isOwner && (
        <div className="hidden md:flex items-center gap-2 h-11 pl-3 pr-2 rounded-xl bg-card border border-line-2">
          <Eye size={16} className="text-muted" />
          <span className="text-xs text-muted">Просмотр как</span>
          <Select
            variant="ghost"
            align="right"
            value={role}
            onChange={(v) => setRole(v as Role)}
            options={roles.map((r) => ({ value: r, label: roleLabel[r] }))}
          />
        </div>
      )}

      <button className="ico-btn shrink-0" title="Уведомления">
        <Bell size={18} />
      </button>
      <button className="ico-btn shrink-0 hidden sm:inline-flex" title="Сообщения">
        <Mail size={18} />
      </button>

      {/* User */}
      <div className="flex items-center gap-2.5 pl-1 shrink-0">
        <Avatar initials={user.initials} color={user.avatarColor} size={40} />
        <div className="hidden lg:block leading-tight">
          <div className="text-sm font-semibold text-ink">{user.name}</div>
          <div className="text-[11px] text-muted">{user.email}</div>
        </div>
      </div>

      {/* Оверлей поиска на телефоне */}
      {searchOpen && (
        <div className="md:hidden fixed inset-x-0 top-0 z-50 bg-card border-b border-line px-3 py-2.5 flex items-center gap-2 [padding-top:max(0.625rem,env(safe-area-inset-top))]">
          <Search size={18} className="text-muted shrink-0" />
          <input
            autoFocus
            className="flex-1 h-11 bg-transparent text-base placeholder:text-muted focus:outline-none"
            placeholder="Поиск…"
          />
          <button
            onClick={() => setSearchOpen(false)}
            aria-label="Закрыть поиск"
            className="inline-flex items-center justify-center w-10 h-10 rounded-lg text-muted hover:text-ink hover:bg-chip transition-colors shrink-0"
          >
            <X size={18} />
          </button>
        </div>
      )}
    </div>
  )
}
