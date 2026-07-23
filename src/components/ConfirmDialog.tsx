import { useEffect, type ReactNode } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'

// Небольшое окно подтверждения: на телефоне — bottom-sheet, на sm+ — по центру.
export default function ConfirmDialog({
  title,
  description,
  confirmLabel = 'Да',
  cancelLabel = 'Нет',
  danger = false,
  loading = false,
  error,
  onConfirm,
  onCancel,
}: {
  title: string
  description?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  loading?: boolean
  error?: string | null
  onConfirm: () => void
  onCancel: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [loading, onCancel])

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/30 p-0 sm:p-4"
      onClick={() => !loading && onCancel()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-sm bg-white rounded-t-card sm:rounded-card shadow-soft [padding-bottom:env(safe-area-inset-bottom)] sm:pb-0"
      >
        <div className="p-6 flex flex-col items-center text-center">
          <div
            className={`w-12 h-12 rounded-full grid place-items-center mb-3 ${
              danger ? 'bg-[#fdeaea] text-[#c53030]' : 'bg-chip text-ink-2'
            }`}
          >
            <AlertTriangle size={22} />
          </div>
          <h3 className="text-lg font-bold text-ink">{title}</h3>
          {description && <div className="text-sm text-muted mt-1.5">{description}</div>}
          {error && <p className="text-sm text-[#c53030] mt-3">{error}</p>}
        </div>

        <div className="flex items-center gap-2 px-6 pb-6">
          <button onClick={onCancel} disabled={loading} className="btn btn-ghost flex-1 disabled:opacity-60">
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={`btn flex-1 disabled:opacity-60 text-white ${
              danger ? 'bg-[#c53030] hover:bg-[#a52626]' : 'btn-green'
            }`}
          >
            {loading && <Loader2 size={16} className="animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
