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
  BookOpen, CalendarDays, FolderOpen, Home, Loader2, LogOut, Sparkles,
} from 'lucide-react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import Avatar from '@/components/ui/Avatar'
import Select from '@/components/ui/Select'
import ClientHome from './ClientHome'
import ClientStages from './ClientStages'
import {
  ClientCalendar, ClientHub, ClientLearn, ClientMaterials,
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
// `short` — подпись под иконкой на телефоне, там на слово ровно одна строка.
// Разделов ровно пять и на телефоне, и на широком экране. Отдельной страницы
// пазла нет: он живёт на «Обзоре», рядом с готовностью проекта.
const NAV = [
  { to: '/', label: 'Обзор', short: 'Обзор', icon: Home, end: true },
  { to: '/stages', label: 'Документы', short: 'Документы', icon: FolderOpen, end: false },
  { to: '/calendar', label: 'Сроки', short: 'Сроки', icon: CalendarDays, end: false },
  { to: '/learn', label: 'Полезное', short: 'Полезное', icon: BookOpen, end: false },
  { to: '/hub', label: 'Итоговый комплект', short: 'Комплект', icon: Sparkles, end: false },
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
          <p className="text-[15px] text-muted mb-4">
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
          <p className="text-[15px] text-muted mb-4">
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
        <div className="client-shell min-h-screen bg-bg flex flex-col">
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
                <div className="text-[13px] text-muted truncate">
                  Кабинет клиента FRANCHONE
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Avatar initials={data.me.initials} color={data.me.avatarColor} size={32} />
                <div className="min-w-0 hidden sm:block">
                  <div className="text-[13px] font-semibold text-ink truncate max-w-[140px]">
                    {data.me.name}
                  </div>
                  <div className="text-[12px] text-muted truncate max-w-[140px]">
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
              {/* Телефон: пять крупных иконок в ряд, подпись под иконкой.
                  Горизонтальной прокрутки нет — вся навигация видна сразу,
                  как в мобильном приложении. */}
              <div className="grid grid-cols-5 gap-1 md:hidden">
                {NAV.map((n) => {
                  const Icon = n.icon
                  return (
                    <NavLink
                      key={n.to}
                      to={n.to}
                      end={n.end}
                      className={({ isActive }) =>
                        `flex flex-col items-center justify-center gap-1 py-2 rounded-xl transition-colors ${
                          isActive ? 'bg-green text-white' : 'text-muted active:bg-chip'
                        }`
                      }
                    >
                      <Icon size={24} strokeWidth={1.75} />
                      {/* Подпись под иконкой остаётся мелкой: пять слов и так
                          делят ширину телефона, крупнее — начнут обрезаться. */}
                      <span className="text-[11px] font-semibold leading-none truncate max-w-full">
                        {n.short}
                      </span>
                    </NavLink>
                  )
                })}
              </div>

              {/* Планшет и десктоп: строка вкладок с полными названиями. */}
              <div className="hidden md:flex items-center gap-2 flex-wrap">
                {NAV.map((n) => {
                  const Icon = n.icon
                  return (
                    <NavLink
                      key={n.to}
                      to={n.to}
                      end={n.end}
                      className={({ isActive }) =>
                        `inline-flex items-center gap-2 h-12 px-5 rounded-xl text-base font-semibold whitespace-nowrap transition-colors ${
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
              <Route path="learn" element={<ClientLearn />} />
              <Route path="hub" element={<ClientHub />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>

          <footer className="border-t border-line bg-card">
            <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 text-[13px] text-muted-2">
              FRANCHONE · упаковка франшизы. Все материалы и история согласований останутся
              доступны и после завершения проекта.
            </div>
          </footer>
        </div>
      </PackCtx.Provider>
    </BrowserRouter>
  )
}
