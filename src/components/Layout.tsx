import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import Topbar from './Topbar'

export default function Layout() {
  return (
    <div className="min-h-screen flex bg-bg">
      <Sidebar />
      <main className="flex-1 min-w-0 px-6 lg:px-8 py-6">
        <Topbar />
        <Outlet />
      </main>
    </div>
  )
}
