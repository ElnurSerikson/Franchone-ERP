// Аватар сотрудника или заказчика: загруженное фото, а если его нет —
// прежний цветной кружок с инициалами. Кружок остаётся полноценным
// вариантом: фото необязательно, и пустых «серых силуэтов» в интерфейсе нет.
//
// Ссылку на фото компонент берёт сам, по id, из общего справочника
// (AvatarsProvider) — иначе пришлось бы добавлять URL в полтора десятка
// запросов, которые сегодня отдают только имя, инициалы и цвет.

import { createContext, useContext, type ReactNode } from 'react'

const AvatarUrls = createContext<Record<string, string>>({})

export function AvatarsProvider({
  urls,
  children,
}: {
  urls: Record<string, string>
  children: ReactNode
}) {
  return <AvatarUrls.Provider value={urls}>{children}</AvatarUrls.Provider>
}

/** Есть ли у человека загруженное фото — нужно там, где его можно удалить. */
export function useAvatarUrl(id?: string | null): string | undefined {
  const urls = useContext(AvatarUrls)
  return id ? urls[id] : undefined
}

interface AvatarProps {
  initials: string
  color: string
  size?: number
  ring?: boolean
  /** id сотрудника — по нему подтягивается загруженное фото. */
  id?: string | null
  /** Готовая ссылка. Нужна там, где справочник недоступен (кабинет клиента). */
  src?: string | null
}

export default function Avatar({ initials, color, size = 40, ring, id, src }: AvatarProps) {
  const urls = useContext(AvatarUrls)
  const url = src ?? (id ? urls[id] : undefined)
  const cls = `inline-flex items-center justify-center rounded-full text-white font-semibold shrink-0 overflow-hidden ${
    ring ? 'ring-2 ring-white' : ''
  }`

  if (url) {
    return (
      <img
        src={url}
        alt={initials}
        className={`${cls} object-cover`}
        style={{ width: size, height: size }}
        draggable={false}
      />
    )
  }
  return (
    <div
      className={cls}
      style={{ width: size, height: size, background: color, fontSize: size * 0.36 }}
    >
      {initials}
    </div>
  )
}
