// Текст ошибки из ConvexError (там сообщение лежит в err.data) с запасным вариантом.
export function errMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'data' in err) {
    const data = (err as { data?: unknown }).data
    if (typeof data === 'string' && data.length > 0) return data
  }
  return fallback
}

// Техническая подробность служебной ошибки. ConvexError несёт понятный текст
// в data и разбирается errMessage; всё остальное (например, запись в удалённый
// документ) приходит без него, и на экране оставалась одна общая заглушка —
// понять причину было нельзя ни владельцу, ни разработчику.
export function errDetail(err: unknown): string | null {
  if (err && typeof err === 'object' && 'data' in err) {
    const data = (err as { data?: unknown }).data
    if (typeof data === 'string' && data.length > 0) return null
  }
  const raw = err instanceof Error ? err.message.trim() : ''
  return raw ? raw.slice(0, 300) : null
}
