// Общие детали кабинета заказчика: цветовые роли, заголовок страницы и
// шапка секции. Всё «сочное» задано здесь один раз — чтобы кабинет был
// системой, а не россыпью случайных градиентов по экранам.

import type { CSSProperties, ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

// Роль → пара цветов. grad — для градиентных плиток и кнопок, wash/gb — для
// карточек с цветной кромкой (.g-card), soft/text — для чипов и подписей.
export const TINT = {
  teal: { grad: 'from-[#0a857a] to-[#4db3a6]', a: '#0a857a', b: '#4db3a6', wash: '#e6f4f1', soft: '#e2f2ef', text: '#044f48' },
  violet: { grad: 'from-[#7c5cd6] to-[#a78bfa]', a: '#7c5cd6', b: '#a78bfa', wash: '#f2edfd', soft: '#f1ecfd', text: '#5b3fb0' },
  blue: { grad: 'from-[#2563eb] to-[#60a5fa]', a: '#2563eb', b: '#60a5fa', wash: '#ecf2fe', soft: '#e8effd', text: '#1d4ed8' },
  amber: { grad: 'from-[#d97706] to-[#f6c66b]', a: '#d97706', b: '#f6c66b', wash: '#fdf3e3', soft: '#fff6e6', text: '#92400e' },
  rose: { grad: 'from-[#d6336c] to-[#fb7185]', a: '#d6336c', b: '#fb7185', wash: '#fdecf2', soft: '#fde8ef', text: '#be185d' },
} as const
export type Tint = keyof typeof TINT

// Инлайн-переменные для .g-card: мягкая заливка и цветная кромка своей роли.
export function gcard(t: Tint): CSSProperties {
  const c = TINT[t]
  return {
    '--wash': c.wash,
    '--gb-a': `${c.a}55`,
    '--gb-b': `${c.b}44`,
    '--lift-shadow': `${c.a}40`,
  } as CSSProperties
}

// Заголовок страницы: живой градиент + подзаголовок, въезжают по очереди.
export function PageTitle({ title, sub }: { title: string; sub: string }) {
  return (
    <>
      <h1 className="text-3xl sm:text-4xl font-extrabold title-pan mb-1.5 rise w-fit">{title}</h1>
      <p className="text-[15px] text-muted mb-6 rise d1">{sub}</p>
    </>
  )
}

// Шапка секции: градиентная плитка с иконкой + заголовок + необязательный чип.
export function SectionHead({
  icon: Icon,
  tint,
  title,
  chip,
}: {
  icon: LucideIcon
  tint: Tint
  title: string
  chip?: ReactNode
}) {
  return (
    <div className="flex items-center gap-3 flex-wrap mb-4">
      <span className={`icon-tile bg-gradient-to-br ${TINT[tint].grad}`}>
        <Icon size={19} />
      </span>
      <h2 className="sec-title text-xl">{title}</h2>
      {chip}
    </div>
  )
}
