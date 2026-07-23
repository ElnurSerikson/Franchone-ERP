import { Authenticated, Unauthenticated, AuthLoading } from 'convex/react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { AppProvider, useApp, useAccessState } from './store'
import type { Role } from './types'
import Layout from './components/Layout'
import Login from './pages/Login'
import AccessRevoked from './pages/AccessRevoked'
import Dashboard from './pages/Dashboard'
import Tasks from './pages/Tasks'
import Reports from './pages/Reports'
import Kpi from './pages/Kpi'
import Team from './pages/Team'
import Activity from './pages/Activity'
import Settings from './pages/Settings'

function Guard({ allow, children }: { allow: Role[]; children: JSX.Element }) {
  const { role } = useApp()
  return allow.includes(role) ? children : <Navigate to="/" replace />
}

function FullScreenLoader() {
  return (
    <div className="min-h-screen grid place-items-center text-muted">
      <Loader2 className="animate-spin" size={22} />
    </div>
  )
}

function AuthedApp() {
  // Деактивированного пользователя выкидываем из кабинета сразу, не дожидаясь
  // истечения сессии. Мутации дополнительно закрыты на сервере (requireEmployee).
  const access = useAccessState()
  if (access === 'loading') return <FullScreenLoader />
  if (access === 'blocked') return <AccessRevoked />

  return (
    <BrowserRouter>
      <AppProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="tasks" element={<Tasks />} />
            <Route path="reports" element={<Reports />} />
            <Route path="kpi" element={<Kpi />} />
            <Route
              path="team"
              element={
                <Guard allow={['owner', 'head']}>
                  <Team />
                </Guard>
              }
            />
            <Route
              path="activity"
              element={
                <Guard allow={['owner', 'head']}>
                  <Activity />
                </Guard>
              }
            />
            <Route
              path="settings"
              element={
                <Guard allow={['owner']}>
                  <Settings />
                </Guard>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </AppProvider>
    </BrowserRouter>
  )
}

export default function App() {
  return (
    <>
      <AuthLoading>
        <div className="min-h-screen grid place-items-center text-muted">
          <Loader2 className="animate-spin" size={22} />
        </div>
      </AuthLoading>
      <Unauthenticated>
        <Login />
      </Unauthenticated>
      <Authenticated>
        <AuthedApp />
      </Authenticated>
    </>
  )
}
