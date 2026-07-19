import { Outlet } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import Sidebar from './Sidebar'
import Topbar from './Topbar'
import { useData } from '@/lib/useData'

export default function Layout() {
  const { loading } = useData()
  return (
    <div className="min-h-screen flex bg-bg">
      <Sidebar />
      <main className="flex-1 min-w-0 px-6 lg:px-8 py-6">
        <Topbar />
        {loading ? (
          <div className="flex items-center justify-center gap-2 text-muted py-40">
            <Loader2 size={18} className="animate-spin" />
            Загрузка данных…
          </div>
        ) : (
          <Outlet />
        )}
      </main>
    </div>
  )
}
