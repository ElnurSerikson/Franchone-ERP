import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  CheckSquare,
  Target,
  Users,
  Settings,
  LogOut,
  type LucideIcon,
} from 'lucide-react'
import type { Role } from '@/types'
import { useApp, useCurrentUser, roleLabel } from '@/store'
import { tasks } from '@/data/mock'
import Avatar from './ui/Avatar'

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  roles: Role[]
  badge?: number
}

const activeTasks = tasks.filter((t) => t.status !== 'done').length

const menu: NavItem[] = [
  { to: '/', label: 'Дашборд', icon: LayoutDashboard, roles: ['owner', 'head', 'employee'] },
  { to: '/tasks', label: 'Задачи', icon: CheckSquare, roles: ['owner', 'head', 'employee'], badge: activeTasks },
  { to: '/kpi', label: 'KPI', icon: Target, roles: ['owner', 'head', 'employee'] },
]

const manage: NavItem[] = [
  { to: '/team', label: 'Команда', icon: Users, roles: ['owner', 'head'] },
  { to: '/settings', label: 'Настройки', icon: Settings, roles: ['owner'] },
]

function Item({ item }: { item: NavItem }) {
  const Icon = item.icon
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      className={({ isActive }) => `nav-item ${isActive ? 'nav-item-active' : ''}`}
    >
      <Icon size={19} strokeWidth={2} />
      <span className="flex-1">{item.label}</span>
      {item.badge ? (
        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-green-light/25 text-green-d">
          {item.badge}
        </span>
      ) : null}
    </NavLink>
  )
}

export default function Sidebar() {
  const { role } = useApp()
  const user = useCurrentUser()

  const visible = (items: NavItem[]) => items.filter((i) => i.roles.includes(role))

  return (
    <aside className="w-[264px] shrink-0 h-screen sticky top-0 bg-card border-r border-line flex flex-col px-4 py-5">
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-2 mb-6">
        <div className="w-9 h-9 rounded-xl bg-green flex items-center justify-center text-white font-extrabold">
          F
        </div>
        <div className="leading-tight">
          <div className="font-extrabold tracking-tight text-ink">FRANCHONE</div>
          <div className="text-[11px] text-muted -mt-0.5">ERP · Панель</div>
        </div>
      </div>

      {/* Menu */}
      <div className="text-[11px] font-semibold text-muted-2 tracking-wider px-3 mb-1">МЕНЮ</div>
      <nav className="flex flex-col gap-1">{visible(menu).map((i) => <Item key={i.to} item={i} />)}</nav>

      {visible(manage).length > 0 && (
        <>
          <div className="my-4 border-t border-line" />
          <div className="text-[11px] font-semibold text-muted-2 tracking-wider px-3 mb-1">УПРАВЛЕНИЕ</div>
          <nav className="flex flex-col gap-1">{visible(manage).map((i) => <Item key={i.to} item={i} />)}</nav>
        </>
      )}

      <div className="flex-1" />

      {/* Profile card (заменяет промо-карточку demo) */}
      <div className="rounded-2xl bg-chip border border-line p-3 flex items-center gap-3">
        <Avatar initials={user.initials} color={user.avatarColor} size={40} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-ink truncate">{user.name}</div>
          <div className="text-[11px] text-muted truncate">{roleLabel[role]}</div>
        </div>
        <button className="text-muted hover:text-ink transition-colors" title="Выйти">
          <LogOut size={17} />
        </button>
      </div>
    </aside>
  )
}
