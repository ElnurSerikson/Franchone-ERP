import { useEffect, useState } from 'react'

// Реактивный матчер media-query. Используется для переключения поведения
// (drawer vs sidebar, поповер vs bottom-sheet) на узких экранах.
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  )

  useEffect(() => {
    const m = window.matchMedia(query)
    const onChange = () => setMatches(m.matches)
    onChange()
    m.addEventListener('change', onChange)
    return () => m.removeEventListener('change', onChange)
  }, [query])

  return matches
}

// Готовые пороги под брейкпоинты Tailwind.
export const useIsPhone = () => useMediaQuery('(max-width: 767px)') // < md
export const useIsSmDown = () => useMediaQuery('(max-width: 639px)') // < sm
export const useIsDesktop = () => useMediaQuery('(min-width: 1024px)') // >= lg
