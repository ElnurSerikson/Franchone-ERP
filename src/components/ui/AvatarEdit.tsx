// Аватар, который можно поменять: то же фото (или кружок с инициалами), но
// при наведении поверх появляется камера, а клик открывает выбор файла.
//
// Права проверяет сервер (employees.setAvatar): сотрудник — своё фото,
// владелец — любое, фото заказчика — владелец или упаковщик. Здесь только
// показываем контрол тем, кому он положен, чтобы не звать на отказ.

import { useRef, useState } from 'react'
import { useMutation } from 'convex/react'
import { Camera, Loader2, Trash2 } from 'lucide-react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { errMessage } from '@/lib/errors'
import { uploadToStorage } from '@/lib/packUpload'
import Avatar, { useAvatarUrl } from './Avatar'

const TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_MB = 8

export default function AvatarEdit({
  id,
  initials,
  color,
  size = 64,
  showRemove = false,
  hint,
}: {
  id: Id<'employees'>
  initials: string
  color: string
  size?: number
  /** Показать отдельную кнопку «Удалить фото» — там, где есть место. */
  showRemove?: boolean
  hint?: string
}) {
  const genUrl = useMutation(api.employees.avatarUploadUrl)
  const setAvatar = useMutation(api.employees.setAvatar)
  const removeAvatar = useMutation(api.employees.removeAvatar)
  const url = useAvatarUrl(id as string)
  const ref = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const pick = async (f: File) => {
    if (!TYPES.includes(f.type)) {
      setError('Подойдут JPG, PNG или WebP')
      return
    }
    if (f.size > MAX_MB * 1024 * 1024) {
      setError(`Файл больше ${MAX_MB} МБ`)
      return
    }
    setBusy(true)
    setError('')
    try {
      const storageId = await uploadToStorage(() => genUrl({}), f)
      await setAvatar({ id, storageId })
    } catch (e) {
      setError(errMessage(e, 'Не удалось загрузить фото.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-3">
      <div className="relative inline-flex group shrink-0">
        <Avatar id={id as string} initials={initials} color={color} size={size} />
        <input
          ref={ref}
          type="file"
          accept={TYPES.join(',')}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) void pick(f)
          }}
        />
        <button
          type="button"
          onClick={() => ref.current?.click()}
          disabled={busy}
          title={url ? 'Заменить фото' : 'Загрузить фото'}
          aria-label={url ? 'Заменить фото' : 'Загрузить фото'}
          className="absolute inset-0 grid place-items-center rounded-full bg-black/45 text-white opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
        >
          {busy ? (
            <Loader2 size={Math.round(size * 0.34)} className="animate-spin" />
          ) : (
            <Camera size={Math.round(size * 0.34)} />
          )}
        </button>
      </div>

      {(showRemove || hint || error) && (
        <div className="min-w-0">
          {hint && !error && <div className="text-[12px] text-muted">{hint}</div>}
          {error && <div className="text-[12px] text-[#c53030]">{error}</div>}
          {showRemove && url && (
            <button
              type="button"
              onClick={async () => {
                setBusy(true)
                setError('')
                try {
                  await removeAvatar({ id })
                } catch (e) {
                  setError(errMessage(e, 'Не удалось удалить фото.'))
                } finally {
                  setBusy(false)
                }
              }}
              disabled={busy}
              className="mini-btn text-[#c53030] mt-1"
            >
              <Trash2 size={12} /> Удалить фото
            </button>
          )}
        </div>
      )}
    </div>
  )
}
