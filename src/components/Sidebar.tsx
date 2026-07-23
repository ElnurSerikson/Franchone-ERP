import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  CheckSquare,
  ClipboardList,
  Target,
  Users,
  Activity,
  Settings,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  type LucideIcon,
} from 'lucide-react'
import { useAuthActions } from '@convex-dev/auth/react'
import type { Role } from '@/types'
import { useApp, useCurrentUser, roleLabel } from '@/store'
import { useData } from '@/lib/useData'
import Avatar from './ui/Avatar'

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  roles: Role[]
  badge?: number
}

const menu: NavItem[] = [
  { to: '/', label: 'Дашборд', icon: LayoutDashboard, roles: ['owner', 'head', 'employee'] },
  { to: '/tasks', label: 'Задачи', icon: CheckSquare, roles: ['owner', 'head', 'employee'] },
  { to: '/reports', label: 'Отчёты', icon: ClipboardList, roles: ['owner', 'head', 'employee'] },
  { to: '/kpi', label: 'KPI', icon: Target, roles: ['owner', 'head', 'employee'] },
]

const manage: NavItem[] = [
  { to: '/team', label: 'Команда', icon: Users, roles: ['owner', 'head'] },
  { to: '/activity', label: 'Активность', icon: Activity, roles: ['owner', 'head'] },
  { to: '/settings', label: 'Настройки', icon: Settings, roles: ['owner'] },
]

function Item({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const Icon = item.icon
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      title={collapsed ? item.label : undefined}
      className={({ isActive }) =>
        `relative flex items-center h-11 rounded-xl text-sm font-medium transition-colors ${
          collapsed ? 'w-11 justify-center mx-auto px-0' : 'gap-3 px-3'
        } ${isActive ? 'nav-item-active' : 'text-ink-2/80 hover:bg-chip'}`
      }
    >
      <Icon size={19} strokeWidth={2} />
      {!collapsed && <span className="flex-1">{item.label}</span>}
      {!collapsed && item.badge ? (
        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-green-light/25 text-green-d">
          {item.badge}
        </span>
      ) : null}
      {collapsed && item.badge ? (
        <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-green ring-2 ring-card" />
      ) : null}
    </NavLink>
  )
}

export default function Sidebar() {
  const { role } = useApp()
  const user = useCurrentUser()
  const { signOut } = useAuthActions()
  const { tasks } = useData()
  const activeTasks = tasks.filter((t) => t.status !== 'done').length
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('sidebar-collapsed') === '1',
  )

  const toggle = () => {
    setCollapsed((c) => {
      localStorage.setItem('sidebar-collapsed', c ? '0' : '1')
      return !c
    })
  }

  const visible = (items: NavItem[]) => items.filter((i) => i.roles.includes(role))
  const label = 'text-[11px] font-semibold text-muted-2 tracking-wider px-3 mb-1'

  return (
    <aside
      className={`shrink-0 h-screen sticky top-0 bg-card border-r border-line flex flex-col py-5 transition-[width] duration-200 ease-in-out ${
        collapsed ? 'w-[76px] px-3' : 'w-[264px] px-4'
      }`}
    >
      {/* Brand + toggle */}
      <div className={`flex mb-6 ${collapsed ? 'flex-col items-center gap-2' : 'items-center gap-2 px-1'}`}>
        {collapsed ? (
          <div className="w-9 h-9 rounded-xl bg-green flex items-center justify-center text-white font-extrabold shrink-0">
            F
          </div>
        ) : (
          <img src="/logo-franchone.png" alt="FRANCHONE" className="h-[30px] w-auto shrink-0" />
        )}
        {!collapsed && <div className="flex-1" />}
        <button
          onClick={toggle}
          aria-label={collapsed ? 'Развернуть меню' : 'Свернуть меню'}
          title={collapsed ? 'Развернуть меню' : 'Свернуть меню'}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-muted hover:text-ink hover:bg-chip transition-colors shrink-0"
        >
          {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </button>
      </div>

      {/* Menu */}
      {!collapsed && <div className={label}>МЕНЮ</div>}
      <nav className="flex flex-col gap-1">
        {visible(menu).map((i) => (
          <Item
            key={i.to}
            item={i.to === '/tasks' ? { ...i, badge: activeTasks } : i}
            collapsed={collapsed}
          />
        ))}
      </nav>

      {visible(manage).length > 0 && (
        <>
          <div className={`my-4 border-t border-line ${collapsed ? 'mx-1' : ''}`} />
          {!collapsed && <div className={label}>УПРАВЛЕНИЕ</div>}
          <nav className="flex flex-col gap-1">
            {visible(manage).map((i) => (
              <Item key={i.to} item={i} collapsed={collapsed} />
            ))}
          </nav>
        </>
      )}

      <div className="flex-1" />

      {/* Profile (заменяет промо-карточку demo) */}
      {collapsed ? (
        <button
          onClick={() => void signOut()}
          title={`${user.name} · выйти`}
          className="mx-auto rounded-full hover:ring-2 hover:ring-line-2 transition-all"
        >
          <Avatar initials={user.initials} color={user.avatarColor} size={40} />
        </button>
      ) : (
        <div className="rounded-2xl bg-chip border border-line p-3 flex items-center gap-3">
          <Avatar initials={user.initials} color={user.avatarColor} size={40} />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-ink truncate">{user.name}</div>
            <div className="text-[11px] text-muted truncate">{roleLabel[user.role]}</div>
          </div>
          <button
            onClick={() => void signOut()}
            className="text-muted hover:text-ink transition-colors"
            title="Выйти"
          >
            <LogOut size={17} />
          </button>
        </div>
      )}
    </aside>
  )
}
