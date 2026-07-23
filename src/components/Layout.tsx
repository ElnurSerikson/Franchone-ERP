import { useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import Sidebar from './Sidebar'
import Topbar from './Topbar'
import { useData } from '@/lib/useData'

export default function Layout() {
  const { loading } = useData()
  const [drawerOpen, setDrawerOpen] = useState(false)

  // Блокируем скролл body, пока открыт мобильный drawer.
  useEffect(() => {
    document.body.style.overflow = drawerOpen ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [drawerOpen])

  return (
    <div className="min-h-screen flex bg-bg">
      <Sidebar drawerOpen={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <main className="flex-1 min-w-0 overflow-x-clip px-4 sm:px-5 md:px-6 lg:px-8 py-4 md:py-6">
        <Topbar onMenu={() => setDrawerOpen(true)} />
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
