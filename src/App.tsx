import { Suspense, lazy, useEffect, useMemo } from 'react'
import { Authenticated, Unauthenticated, AuthLoading, useQuery, useMutation } from 'convex/react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { api } from '../convex/_generated/api'
import { AppProvider, useAccessState, useCurrentUser } from './store'
import { usePerms } from './lib/usePerms'
import { AvatarsProvider } from './components/ui/Avatar'
import Layout from './components/Layout'
import Login from './pages/Login'
import AccessRevoked from './pages/AccessRevoked'
import Dashboard from './pages/Dashboard'
import Tasks from './pages/Tasks'
import Reports from './pages/Reports'
import Kpi from './pages/Kpi'
import Team from './pages/Team'
import Activity from './pages/Activity'
import Effectiveness from '@/pages/Effectiveness'
import Meetings from '@/pages/Meetings'
import Settings from './pages/Settings'

// Модуль упаковки и кабинет клиента грузятся отдельными чанками. Раздел видят
// не все, а кабинет — только заказчик: держать их в основном бандле значит
// заставлять каждого сотрудника скачивать чужой экран при первом заходе.
const Packs = lazy(() => import('@/pages/Packs'))
const PackDetail = lazy(() => import('@/pages/PackDetail'))
const ClientApp = lazy(() => import('@/pages/client/ClientApp'))

// Гейт маршрута по матрице прав (§9). perm — 'owner' или «section:action».
function Guard({ perm, children }: { perm: string; children: JSX.Element }) {
  const { ready, isOwner, can } = usePerms()
  if (!ready) return <FullScreenLoader />
  const [section, action] = perm.split(':')
  const ok = perm === 'owner' ? isOwner : can(section, action)
  return ok ? children : <Navigate to="/" replace />
}

function FullScreenLoader() {
  return (
    <div className="min-h-screen grid place-items-center text-muted">
      <Loader2 className="animate-spin" size={22} />
    </div>
  )
}

// Гейт раздела «Упаковки» (ТЗ Упаковка §3). Доступ решает сервер: помимо
// матрицы прав раздел открывает само назначение упаковщиком (BR-11).
function PackGuard({ children }: { children: JSX.Element }) {
  const access = useQuery(api.packs.access, {})
  if (access === undefined) return <FullScreenLoader />
  return access.canView ? children : <Navigate to="/" replace />
}

// Отметка присутствия.
//
// Сессия живёт неделю и продлевается сама, поэтому по авторизациям не видно,
// работает человек в ERP или не заходил месяц. Пока вкладка открыта и видима,
// раз в пять минут отмечаемся; свёрнутая или фоновая вкладка молчит, иначе
// забытое окно считалось бы рабочим днём.
function usePresence(enabled: boolean) {
  const ping = useMutation(api.activity.ping)
  useEffect(() => {
    if (!enabled) return
    const beat = () => {
      if (document.visibilityState === 'visible') void ping({}).catch(() => {})
    }
    beat()
    const timer = setInterval(beat, 5 * 60 * 1000)
    document.addEventListener('visibilitychange', beat)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', beat)
    }
  }, [enabled, ping])
}

// Справочник загруженных фото: один запрос на всё приложение, дальше каждый
// <Avatar id={…}> берёт ссылку отсюда.
function Avatars({ children }: { children: JSX.Element }) {
  const rows = useQuery(api.employees.avatars, {})
  const urls = useMemo(
    () => Object.fromEntries((rows ?? []).map((r) => [r.id as string, r.url])),
    [rows],
  )
  return <AvatarsProvider urls={urls}>{children}</AvatarsProvider>
}

function AuthedApp() {
  // Деактивированного пользователя выкидываем из кабинета сразу, не дожидаясь
  // истечения сессии. Мутации дополнительно закрыты на сервере (requireEmployee).
  const access = useAccessState()
  const me = useCurrentUser()
  usePresence(access === 'ok')
  if (access === 'loading') return <FullScreenLoader />
  if (access === 'blocked') return <AccessRevoked />

  // ТЗ Упаковка §10: у заказчика упаковки собственная оболочка. Ни один раздел
  // ERP ему не доступен — не только скрыт, но и не смонтирован.
  if (me.role === 'client') {
    return (
      <Suspense fallback={<FullScreenLoader />}>
        <ClientApp />
      </Suspense>
    )
  }

  return (
    <BrowserRouter>
      <AppProvider>
        <Avatars>
        <Suspense fallback={<FullScreenLoader />}>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Dashboard />} />
              <Route path="tasks" element={<Guard perm="tasks:view"><Tasks /></Guard>} />
              <Route path="reports" element={<Reports />} />
              <Route path="kpi" element={<Guard perm="kpi:view"><Kpi /></Guard>} />
              <Route path="team" element={<Guard perm="team:view"><Team /></Guard>} />
              <Route path="activity" element={<Guard perm="activity:view"><Activity /></Guard>} />
              {/* ТЗ СИСТЕМА §3: раздел для управленческого контроля админа. */}
              <Route path="effectiveness" element={<Guard perm="owner"><Effectiveness /></Guard>} />
              {/* §4.2: встречи создают и видят все сотрудники. */}
              <Route path="meetings" element={<Meetings />} />
              {/* ТЗ Упаковка: производство и запуск франшизы. */}
              <Route path="packs" element={<PackGuard><Packs /></PackGuard>} />
              <Route path="packs/:id" element={<PackGuard><PackDetail /></PackGuard>} />
              <Route path="settings" element={<Guard perm="owner"><Settings /></Guard>} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </Suspense>
        </Avatars>
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
