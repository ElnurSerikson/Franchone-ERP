import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import type { Employee, Role } from '@/types'
import { useData } from '@/lib/useData'

interface AppState {
  role: Role
  setRole: (r: Role) => void
}

const AppCtx = createContext<AppState | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<Role>('owner')
  const value = useMemo(() => ({ role, setRole }), [role])
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>
}

export function useApp() {
  const ctx = useContext(AppCtx)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}

// Запасной пользователь на время загрузки данных из базы.
const PLACEHOLDER: Employee = {
  id: '',
  name: '—',
  role: 'owner',
  position: 'sales',
  positionLabel: '',
  department: '',
  salary: 0,
  email: '',
  phone: '',
  avatarColor: '#9498a1',
  initials: '—',
  status: 'active',
  hiredAt: '',
}

// Для демонстрации ролевого доступа подбираем репрезентативного сотрудника роли.
function pickForRole(list: Employee[], role: Role): Employee {
  if (!list.length) return PLACEHOLDER
  if (role === 'owner') return list.find((e) => e.role === 'owner') ?? list[0]
  if (role === 'head') return list.find((e) => e.role === 'head') ?? list[0]
  return (
    list.find((e) => e.position === 'smm') ??
    list.find((e) => e.role === 'employee') ??
    list[0]
  )
}

export function useCurrentUser(): Employee {
  const { role } = useApp()
  const { employees } = useData()
  return pickForRole(employees, role)
}

export const roleLabel: Record<Role, string> = {
  owner: 'Владелец',
  head: 'Руководитель',
  employee: 'Сотрудник',
}
