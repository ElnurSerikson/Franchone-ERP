// Короткий салют в фирменных цветах. Ложится поверх родителя (тому нужен
// `relative`) и исчезает сам — ни библиотеки, ни canvas, просто три десятка
// улетающих квадратиков.
//
// Правило: празднуем событие, а не факт. Салют бьёт один раз — когда число
// выросло с прошлого визита, — и молчит при каждом следующем открытии
// страницы. Иначе поздравление превращается в фон и перестаёт что-то значить.

import { useEffect, useMemo, useRef, useState } from 'react'

const COLORS = ['#057269', '#4db3a6', '#7c5cd6', '#d6336c', '#d69e2e', '#2563eb']

/** Выросло ли значение с прошлого раза. Первый визит не празднуем. */
export function useCelebrate(key: string, value: number): boolean {
  const [fire, setFire] = useState(false)
  const seen = useRef(false)

  useEffect(() => {
    if (!key) return
    const storeKey = `celebrate:${key}`
    const prev = localStorage.getItem(storeKey)
    localStorage.setItem(storeKey, String(value))
    // Первое знакомство: запомнили и промолчали.
    if (prev === null) return
    if (Number(prev) < value && !seen.current) {
      seen.current = true
      setFire(true)
      const t = setTimeout(() => setFire(false), 1800)
      return () => clearTimeout(t)
    }
  }, [key, value])

  return fire
}

export default function Confetti({ show, pieces = 34 }: { show: boolean; pieces?: number }) {
  // Раскладку считаем один раз: пересчёт на каждом кадре дёргал бы частицы.
  const bits = useMemo(
    () =>
      Array.from({ length: pieces }, (_, i) => {
        const angle = (i / pieces) * Math.PI * 2
        const spread = 90 + ((i * 37) % 120)
        return {
          left: `${12 + ((i * 29) % 76)}%`,
          top: `${28 + ((i * 17) % 34)}%`,
          dx: `${Math.cos(angle) * spread}px`,
          dy: `${Math.sin(angle) * spread + 140}px`,
          rot: `${((i * 53) % 720) - 360}deg`,
          color: COLORS[i % COLORS.length],
          delay: `${(i % 7) * 40}ms`,
        }
      }),
    [pieces],
  )

  if (!show) return null
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden z-20" aria-hidden>
      {bits.map((b, i) => (
        <span
          key={i}
          className="confetti-piece"
          style={
            {
              left: b.left,
              top: b.top,
              background: b.color,
              animationDelay: b.delay,
              '--dx': b.dx,
              '--dy': b.dy,
              '--rot': b.rot,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  )
}
