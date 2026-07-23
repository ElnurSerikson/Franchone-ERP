import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

// Поповер, привязанный к триггеру и вынесенный в портал.
// Зачем: обычный absolute-поповер обрезается ближайшим контейнером с
// overflow (тело drawer'а прокручиваемое) — календарь и длинные списки
// показывались наполовину. Портал + position: fixed под обрезку не попадают,
// а при нехватке места снизу поповер разворачивается вверх.
export default function AnchoredPopover({
  anchorRef,
  onClose,
  align = 'left',
  minWidth,
  children,
}: {
  anchorRef: RefObject<HTMLElement>
  onClose: () => void
  align?: 'left' | 'right'
  minWidth?: number
  children: ReactNode
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  // onClose держим в ref: инлайновая стрелка из родителя меняет ссылку каждый
  // рендер, а с ней в зависимостях эффект уходил бы в цикл.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useLayoutEffect(() => {
    const anchor = anchorRef.current
    const panel = panelRef.current
    if (!anchor || !panel) return

    const place = () => {
      const a = anchor.getBoundingClientRect()
      const h = panel.offsetHeight
      const w = panel.offsetWidth
      const gap = 6
      const pad = 8

      let top = a.bottom + gap
      if (top + h > window.innerHeight - pad) {
        const above = a.top - h - gap
        top = above >= pad ? above : Math.max(pad, window.innerHeight - h - pad)
      }
      let left = align === 'right' ? a.right - w : a.left
      left = Math.min(Math.max(pad, left), Math.max(pad, window.innerWidth - w - pad))

      setPos((prev) => (prev && prev.top === top && prev.left === left ? prev : { top, left }))
    }

    place()
    // Содержимое может менять высоту (месяц с 6 строками вместо 5) — переставляем.
    const ro = new ResizeObserver(place)
    ro.observe(panel)

    // При прокрутке/ресайзе не закрываем, а пересчитываем позицию: закрытие на
    // любой скролл схлопывало бы поповер от случайного движения колеса.
    let raf = 0
    const onMove = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(place)
    }
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
    }
  }, [anchorRef, align])

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (panelRef.current?.contains(t)) return
      if (anchorRef.current?.contains(t)) return
      onCloseRef.current()
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [anchorRef])

  return createPortal(
    <div
      ref={panelRef}
      className="fixed z-[70]"
      style={{
        top: pos?.top ?? 0,
        left: pos?.left ?? 0,
        minWidth,
        // до первого замера прячем, чтобы не мигало в левом верхнем углу
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      {children}
    </div>,
    document.body,
  )
}
