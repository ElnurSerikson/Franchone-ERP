import { Navigate, Route, Routes } from 'react-router-dom'
import { AppProvider, useApp } from './store'
import type { Role } from './types'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Tasks from './pages/Tasks'
import Kpi from './pages/Kpi'
import Team from './pages/Team'
import Settings from './pages/Settings'

function Guard({ allow, children }: { allow: Role[]; children: JSX.Element }) {
  const { role } = useApp()
  return allow.includes(role) ? children : <Navigate to="/" replace />
}

export default function App() {
  return (
    <AppProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="tasks" element={<Tasks />} />
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
  )
}
