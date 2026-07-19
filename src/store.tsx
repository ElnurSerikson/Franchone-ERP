import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import type { Role } from '@/types'
import { employees } from '@/data/mock'

interface AppState {
  role: Role
  setRole: (r: Role) => void
  userId: string
  setUserId: (id: string) => void
}

const AppCtx = createContext<AppState | null>(null)

// Для демонстрации ролевого доступа: по каждой роли — репрезентативный пользователь.
const roleUser: Record<Role, string> = {
  owner: 'u1', // Ануар
  head: 'u4', // Аружан — руководитель отдела продаж
  employee: 'u2', // Нурай — SMM
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [role, setRoleState] = useState<Role>('owner')
  const [userId, setUserId] = useState<string>(roleUser.owner)

  const setRole = (r: Role) => {
    setRoleState(r)
    setUserId(roleUser[r])
  }

  const value = useMemo(() => ({ role, setRole, userId, setUserId }), [role, userId])
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>
}

export function useApp() {
  const ctx = useContext(AppCtx)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}

export function useCurrentUser() {
  const { userId } = useApp()
  return employees.find((e) => e.id === userId)!
}

export const roleLabel: Record<Role, string> = {
  owner: 'Владелец',
  head: 'Руководитель',
  employee: 'Сотрудник',
}
