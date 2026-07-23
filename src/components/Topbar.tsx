import { Bell, Menu } from 'lucide-react'

// Тонкая верхняя полоса: бургер (на телефоне) слева, колокольчик уведомлений справа.
export default function Topbar({ onMenu }: { onMenu: () => void }) {
  return (
    <div className="flex items-center gap-2 md:gap-3 mb-4 md:mb-6">
      {/* Бургер — только на телефоне */}
      <button
        onClick={onMenu}
        aria-label="Меню"
        className="md:hidden inline-flex items-center justify-center w-11 h-11 rounded-xl border border-line-2 bg-card text-ink-2 hover:bg-chip transition-colors shrink-0"
      >
        <Menu size={20} />
      </button>

      <div className="flex-1" />

      <button className="ico-btn shrink-0" title="Уведомления">
        <Bell size={18} />
      </button>
    </div>
  )
}
