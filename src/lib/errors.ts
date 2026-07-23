// Текст ошибки из ConvexError (там сообщение лежит в err.data) с запасным вариантом.
export function errMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'data' in err) {
    const data = (err as { data?: unknown }).data
    if (typeof data === 'string' && data.length > 0) return data
  }
  return fallback
}
