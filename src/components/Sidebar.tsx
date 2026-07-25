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
  X,
  type LucideIcon,
} from 'lucide-react'
import { useAuthActions } from '@convex-dev/auth/react'
import { useCurrentUser, roleLabel } from '@/store'
import { usePerms } from '@/lib/usePerms'
import { useData } from '@/lib/useData'
import { useIsPhone, useIsDesktop } from '@/lib/useMediaQuery'
import Avatar from './ui/Avatar'

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  // Право на раздел: undefined — всегда виден; 'owner' — только владелец;
  // иначе «section:action» из матрицы прав (§9).
  perm?: string
  badge?: number
}

const menu: NavItem[] = [
  { to: '/', label: 'Дашборд', icon: LayoutDashboard },
  { to: '/tasks', label: 'Задачи', icon: CheckSquare, perm: 'tasks:view' },
  { to: '/reports', label: 'Отчёты', icon: ClipboardList },
  { to: '/kpi', label: 'KPI', icon: Target, perm: 'kpi:view' },
]

const manage: NavItem[] = [
  { to: '/team', label: 'Команда', icon: Users, perm: 'team:view' },
  { to: '/activity', label: 'Активность', icon: Activity, perm: 'activity:view' },
  { to: '/settings', label: 'Настройки', icon: Settings, perm: 'owner' },
]

function Item({
  item,
  collapsed,
  onNavigate,
}: {
  item: NavItem
  collapsed: boolean
  onNavigate?: () => void
}) {
  const Icon = item.icon
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      onClick={onNavigate}
      className={({ isActive }) =>
        `group relative flex items-center h-11 rounded-xl text-sm font-medium transition-colors ${
          collapsed ? 'w-11 justify-center mx-auto px-0' : 'gap-3 px-3'
        } ${isActive ? 'nav-item-active' : 'text-ink-2/80 hover:bg-chip'}`
      }
    >
      {({ isActive }) => (
        <>
          <Icon size={19} strokeWidth={2} />
          {!collapsed && <span className="flex-1">{item.label}</span>}
          {/* На активном пункте плашка тёмная — счётчик переключаем на белый. */}
          {!collapsed && item.badge ? (
            <span
              className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                isActive ? 'bg-white/15 text-white' : 'bg-green-light/25 text-green-d'
              }`}
            >
              {item.badge}
            </span>
          ) : null}
          {collapsed && item.badge ? (
            <span
              className={`absolute top-1.5 right-1.5 w-2 h-2 rounded-full ring-2 ${
                isActive ? 'bg-white ring-dark' : 'bg-green ring-card'
              }`}
            />
          ) : null}
          {/* Бейдж с названием раздела при наведении на иконку в рейле */}
          {collapsed && (
            <span className="pointer-events-none absolute left-full ml-2 top-1/2 -translate-y-1/2 z-50 whitespace-nowrap rounded-lg bg-dark px-2.5 py-1.5 text-xs font-medium text-white opacity-0 shadow-soft transition-opacity group-hover:opacity-100">
              {item.label}
            </span>
          )}
        </>
      )}
    </NavLink>
  )
}

export default function Sidebar({
  drawerOpen,
  onClose,
}: {
  drawerOpen: boolean
  onClose: () => void
}) {
  const user = useCurrentUser()
  const { signOut } = useAuthActions()
  const { tasks } = useData()
  const activeTasks = tasks.filter((t) => t.status !== 'done').length

  const isPhone = useIsPhone() // < md — режим drawer
  const isDesktop = useIsDesktop() // >= lg — полный сайдбар по умолчанию

  // Пользовательский pref сворачивания (null = не задан → зависит от вьюпорта).
  const [collapsedPref, setCollapsedPref] = useState<boolean | null>(() => {
    const v = localStorage.getItem('sidebar-collapsed')
    return v === null ? null : v === '1'
  })
  // На телефоне drawer всегда развёрнут; планшет по умолчанию свёрнут; десктоп — развёрнут.
  const collapsed = isPhone ? false : (collapsedPref ?? !isDesktop)

  const toggle = () => {
    const next = !collapsed
    setCollapsedPref(next)
    localStorage.setItem('sidebar-collapsed', next ? '1' : '0')
  }

  // Видимость раздела — по матрице прав (§9). Владелец видит всё.
  const { can, isOwner } = usePerms()
  const visible = (items: NavItem[]) =>
    items.filter((i) => {
      if (!i.perm) return true
      if (i.perm === 'owner') return isOwner
      const [section, action] = i.perm.split(':')
      return can(section, action)
    })
  // whitespace-nowrap + overflow-hidden: в свёрнутом рейле заголовок прячется через
  // invisible, но продолжает резервировать ровно одну строку — иконки разделов
  // остаются на той же высоте, что и в развёрнутом сайдбаре.
  const label =
    'text-[11px] font-semibold text-muted-2 tracking-wider px-3 mb-1 whitespace-nowrap overflow-hidden'
  const onNavigate = isPhone ? onClose : undefined

  return (
    <>
      {/* Затемнение под мобильным drawer */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={onClose}
          aria-hidden
        />
      )}

      <aside
        className={`shrink-0 h-screen bg-card border-r border-line flex flex-col py-5 fixed top-0 left-0 z-50 shadow-soft transition-transform duration-200 ease-in-out w-[280px] px-4 ${
          drawerOpen ? 'translate-x-0' : '-translate-x-full'
        } md:sticky md:top-0 md:left-auto md:z-30 md:shadow-none md:translate-x-0 md:transition-[width] ${
          collapsed ? 'md:w-[76px] md:px-3' : 'md:w-[264px] md:px-4'
        }`}
      >
        {/* Brand + toggle/close */}
        <div className={`flex mb-6 ${collapsed ? 'justify-center' : 'items-center gap-2 px-1'}`}>
          {collapsed ? (
            // В рейле: иконка бренда, по ховеру в той же ячейке — кнопка раскрытия.
            <div className="group relative w-9 h-9">
              <div className="w-9 h-9 rounded-xl bg-green flex items-center justify-center text-white text-[17px] font-extrabold select-none transition-opacity group-hover:opacity-0">
                F
              </div>
              <button
                onClick={toggle}
                aria-label="Развернуть меню"
                title="Развернуть меню"
                className="absolute inset-0 rounded-xl flex items-center justify-center bg-chip text-ink-2 hover:text-ink opacity-0 transition-opacity group-hover:opacity-100"
              >
                <PanelLeftOpen size={18} />
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-green flex items-center justify-center text-white text-[17px] font-extrabold shrink-0 select-none">
                  F
                </div>
                <span className="text-[20px] font-extrabold tracking-tight leading-none select-none">
                  <span className="text-ink">FRANCH</span>
                  <span className="text-green">ONE</span>
                </span>
              </div>
              <div className="flex-1" />
              {isPhone ? (
                <button
                  onClick={onClose}
                  aria-label="Закрыть меню"
                  className="w-9 h-9 rounded-lg flex items-center justify-center text-muted hover:text-ink hover:bg-chip transition-colors shrink-0 md:hidden"
                >
                  <X size={18} />
                </button>
              ) : (
                <button
                  onClick={toggle}
                  aria-label="Свернуть меню"
                  title="Свернуть меню"
                  className="w-8 h-8 rounded-lg items-center justify-center text-muted hover:text-ink hover:bg-chip transition-colors shrink-0 hidden md:flex"
                >
                  <PanelLeftClose size={18} />
                </button>
              )}
            </>
          )}
        </div>

        {/* Menu */}
        <div className={`${label} ${collapsed ? 'invisible' : ''}`}>МЕНЮ</div>
        <nav className="flex flex-col gap-1">
          {visible(menu).map((i) => (
            <Item
              key={i.to}
              item={i.to === '/tasks' ? { ...i, badge: activeTasks } : i}
              collapsed={collapsed}
              onNavigate={onNavigate}
            />
          ))}
        </nav>

        {visible(manage).length > 0 && (
          <>
            <div className={`my-4 border-t border-line ${collapsed ? 'mx-1' : ''}`} />
            <div className={`${label} ${collapsed ? 'invisible' : ''}`}>УПРАВЛЕНИЕ</div>
            <nav className="flex flex-col gap-1">
              {visible(manage).map((i) => (
                <Item key={i.to} item={i} collapsed={collapsed} onNavigate={onNavigate} />
              ))}
            </nav>
          </>
        )}

        <div className="flex-1" />

        {/* Profile */}
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
              {/* Должность, а не роль: роль — это уровень доступа, а под именем
                  полезнее видеть, чем человек занимается. */}
              <div className="text-[11px] text-muted truncate">
                {user.positionLabel || roleLabel[user.role]}
              </div>
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
    </>
  )
}
