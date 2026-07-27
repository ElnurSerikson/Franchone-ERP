import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { permKey } from '../../convex/permModel'

// Права текущего пользователя для гейтинга интерфейса (§9). Сервер — источник
// правды; это лишь чтобы не показывать недоступные кнопки/разделы.
export function usePerms() {
  const data = useQuery(api.permissions.mine)
  const allowed = new Set(data?.allowed ?? [])
  const isOwner = data?.isOwner ?? false
  return {
    ready: data !== undefined,
    isOwner,
    role: data?.role ?? null,
    // «Просмотр» доступен и в режиме «Только свои», и в «Все» — как на сервере.
    can: (section: string, action: string) =>
      isOwner ||
      (action === 'view'
        ? allowed.has(permKey(section, 'view')) || allowed.has(permKey(section, 'viewAll'))
        : allowed.has(permKey(section, action))),
  }
}
