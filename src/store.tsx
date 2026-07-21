import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'
import type { Employee, Role } from '@/types'
import { mapEmployee } from '@/lib/mappers'

interface AppState {
  role: Role // эффективная роль для видимости (владелец может смотреть «как другая роль»)
  setRole: (r: Role) => void
  isOwner: boolean
}

const AppCtx = createContext<AppState | null>(null)

// Запасной пользователь на время загрузки данных.
const PLACEHOLDER: Employee = {
  id: '',
  name: '—',
  role: 'employee',
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

// Реальный вошедший сотрудник (по авторизации, матчинг по email).
export function useCurrentUser(): Employee {
  const doc = useQuery(api.users.currentEmployee, {})
  return doc ? mapEmployee(doc) : PLACEHOLDER
}

export function AppProvider({ children }: { children: ReactNode }) {
  const user = useCurrentUser()
  const isOwner = user.role === 'owner'
  const [viewAs, setViewAs] = useState<Role | null>(null)

  const role: Role = isOwner && viewAs ? viewAs : user.role
  const setRole = (r: Role) => {
    if (isOwner) setViewAs(r)
  }

  const value = useMemo(() => ({ role, setRole, isOwner }), [role, isOwner])
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>
}

export function useApp() {
  const ctx = useContext(AppCtx)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}

export const roleLabel: Record<Role, string> = {
  owner: 'Владелец',
  head: 'Руководитель',
  employee: 'Сотрудник',
}
