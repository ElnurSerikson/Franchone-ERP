// Единый стиль таблиц системы. Эталон — таблица «Команды»: бледно-зелёная
// шапка, прижатая к верху карточки, без второй строки-заголовка над ней.
// Держим здесь, а не копией в каждом файле, иначе таблицы разъезжаются.

const thBase = 'text-[11px] font-semibold text-green-d uppercase tracking-wide px-4 py-3'

export const theadRow = 'bg-[#e2f2ef]'
export const th = `text-left ${thBase}`
export const thRight = `text-right ${thBase}`
export const thCenter = `text-center ${thBase}`
export const td = 'px-4 py-3 text-sm text-ink-2 border-t border-line align-middle'
