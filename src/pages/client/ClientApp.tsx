// Кабинет клиента (ТЗ Упаковка §10, §13). Отдельная оболочка приложения:
// заказчик не видит ни одного раздела ERP — ни дашборда команды, ни задач, ни
// KPI. Только свой проект и то, что требуется от него.
//
// Финансовых данных здесь нет по построению: клиентские запросы (packClient.*)
// их не отдают, поэтому и показать их интерфейс не может.

import { createContext, useContext, useState } from 'react'
import { BrowserRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { useQuery } from 'convex/react'
import { useAuthActions } from '@convex-dev/auth/react'
import {
  BookOpen, CalendarDays, FolderOpen, Gift, Home, Loader2, LogOut, Sparkles,
} from 'lucide-react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import Avatar from '@/components/ui/Avatar'
import Select from '@/components/ui/Select'
import ClientHome from './ClientHome'
import ClientStages from './ClientStages'
import {
  ClientCalendar, ClientHub, ClientLearn, ClientMaterials, ClientRewards,
} from './ClientExtras'

// Текущий проект клиента: у него почти всегда один, но архитектура допускает
// несколько — переключатель живёт в шапке.
const PackCtx = createContext<{ packId: Id<'packs'> | null }>({ packId: null })
export function useClientPack() {
  return useContext(PackCtx).packId
}

// ТЗ v1.1 §16: отдельного центра уведомлений в модуле нет — заказчик
// получает только целевые Telegram-сообщения (§12). Поэтому вкладки
// «Уведомления» здесь тоже нет.
const NAV = [
  { to: '/', label: 'Обзор', icon: Home, end: true },
  { to: '/stages', label: 'Документы', icon: FolderOpen, end: false },
  { to: '/calendar', label: 'Сроки', icon: CalendarDays, end: false },
  { to: '/rewards', label: 'Пазл и подарок', icon: Gift, end: false },
  { to: '/learn', label: 'Полезное', icon: BookOpen, end: false },
  { to: '/hub', label: 'Итоговый комплект', icon: Sparkles, end: false },
]

export default function ClientApp() {
  // §10: у клиента может быть больше одной франшизы. Выбранный проект держим
  // здесь и передаём вниз — без переключателя вторая упаковка была бы
  // недоступна вовсе.
  const [picked, setPicked] = useState<Id<'packs'> | null>(null)
  const data = useQuery(api.packClient.dashboard, picked ? { packId: picked } : {})
  const { signOut } = useAuthActions()

  if (data === undefined) {
    return (
      <div className="min-h-screen grid place-items-center text-muted">
        <Loader2 className="animate-spin" size={22} />
      </div>
    )
  }
  if (!data) {
    return (
      <div className="min-h-screen grid place-items-center p-6">
        <div className="card p-8 max-w-md text-center">
          <div className="sec-title mb-2">Кабинет недоступен</div>
          <p className="text-sm text-muted mb-4">
            Похоже, доступ закрыт. Свяжитесь с командой FRANCHONE.
          </p>
          <button onClick={() => void signOut()} className="btn btn-ghost inline-flex">
            <LogOut size={15} /> Выйти
          </button>
        </div>
      </div>
    )
  }

  if (!data.pack) {
    return (
      <div className="min-h-screen grid place-items-center p-6">
        <div className="card p-8 max-w-md text-center">
          <span className="w-12 h-12 rounded-full bg-chip text-muted grid place-items-center mx-auto mb-3">
            <Sparkles size={20} />
          </span>
          <div className="sec-title mb-2">Проект ещё готовится</div>
          <p className="text-sm text-muted mb-4">
            {data.me.name}, как только команда FRANCHONE откроет вам проект упаковки франшизы, он
            появится здесь — вместе с этапами, сроками и материалами.
          </p>
          <button onClick={() => void signOut()} className="btn btn-ghost inline-flex">
            <LogOut size={15} /> Выйти
          </button>
        </div>
      </div>
    )
  }

  const packId = data.pack._id

  return (
    <BrowserRouter>
      <PackCtx.Provider value={{ packId }}>
        <div className="min-h-screen bg-bg flex flex-col">
          {/* Шапка кабинета */}
          <header className="sticky top-0 z-30 bg-card border-b border-line">
            <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-green flex items-center justify-center text-white text-[17px] font-extrabold shrink-0 select-none">
                F
              </div>
              <div className="min-w-0 flex-1">
                {data.packs.length > 1 ? (
                  <Select
                    variant="ghost"
                    value={packId as string}
                    onChange={(v) => setPicked(v as Id<'packs'>)}
                    options={data.packs.map((p) => ({ value: p._id as string, label: p.title }))}
                  />
                ) : (
                  <div className="text-[15px] font-bold text-ink truncate leading-tight">
                    {data.pack.title}
                  </div>
                )}
                <div className="text-[11px] text-muted truncate">
                  Кабинет клиента FRANCHONE
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Avatar initials={data.me.initials} color={data.me.avatarColor} size={32} />
                <div className="min-w-0 hidden sm:block">
                  <div className="text-[12px] font-semibold text-ink truncate max-w-[140px]">
                    {data.me.name}
                  </div>
                  <div className="text-[10px] text-muted truncate max-w-[140px]">
                    {data.me.company}
                  </div>
                </div>
                <button
                  onClick={() => void signOut()}
                  className="ico-btn w-9 h-9"
                  aria-label="Выйти"
                  title="Выйти"
                >
                  <LogOut size={16} />
                </button>
              </div>
            </div>

            {/* Навигация. Разделов восемь — на телефоне это лента с
                горизонтальной прокруткой от края до края, как канбан в
                «Задачах»: гамбургер прятал бы половину кабинета. */}
            <nav className="max-w-6xl mx-auto px-4 sm:px-6 pb-3">
              <div className="flex items-center gap-2 flex-nowrap overflow-x-auto no-scrollbar -mx-4 px-4 sm:mx-0 sm:px-0">
                {NAV.map((n) => {
                  const Icon = n.icon
                  return (
                    <NavLink
                      key={n.to}
                      to={n.to}
                      end={n.end}
                      className={({ isActive }) =>
                        `inline-flex items-center gap-2 h-11 px-4 rounded-xl text-[15px] font-semibold whitespace-nowrap transition-colors ${
                          isActive
                            ? 'bg-green text-white'
                            : 'bg-chip text-ink-2 hover:bg-line-2 hover:text-ink'
                        }`
                      }
                    >
                      <Icon size={17} /> {n.label}
                    </NavLink>
                  )
                })}
              </div>
            </nav>
          </header>

          <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-5">
            <Routes>
              <Route index element={<ClientHome />} />
              <Route path="stages" element={<ClientStages />} />
              <Route path="materials" element={<ClientMaterials />} />
              <Route path="calendar" element={<ClientCalendar />} />
              <Route path="rewards" element={<ClientRewards />} />
              <Route path="learn" element={<ClientLearn />} />
              <Route path="hub" element={<ClientHub />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>

          <footer className="border-t border-line bg-card">
            <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 text-[11px] text-muted-2">
              FRANCHONE · упаковка франшизы. Все материалы и история согласований останутся
              доступны и после завершения проекта.
            </div>
          </footer>
        </div>
      </PackCtx.Provider>
    </BrowserRouter>
  )
}
