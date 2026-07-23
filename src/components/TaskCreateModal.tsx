import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { X, Loader2, ListPlus, Link2, Upload, Paperclip } from 'lucide-react'
import DatePicker from './ui/DatePicker'
import Select, { type SelectOption } from './ui/Select'
import type { Employee, Priority } from '@/types'

const inputCls =
  'w-full rounded-lg border border-line-2 px-3 py-2.5 text-sm text-ink placeholder:text-muted focus:outline-none focus:border-green-light bg-white'
const labelCls = 'block text-sm font-medium text-ink-2 mb-1.5'

export const PRIORITY_OPTS: SelectOption[] = [
  { value: 'low', label: 'Низкий', dot: '#9498a1' },
  { value: 'medium', label: 'Средний', dot: '#2563eb' },
  { value: 'high', label: 'Высокий', dot: '#c05621' },
  { value: 'urgent', label: 'Срочный', dot: '#c53030' },
]

// Вложение, добавленное до создания задачи. Файлы держим локально и заливаем
// только при отправке — иначе отменённая форма оставляла бы мусор в хранилище.
type Pending =
  | { kind: 'link'; name: string; url: string }
  | { kind: 'file'; name: string; file: File }

// Drawer создания задачи — тот же шаблон, что и у карточки сотрудника:
// выезжает справа, шапка с иконкой, поля в одну колонку, липкий футер.
export default function TaskCreateModal({
  employees,
  onClose,
}: {
  employees: Employee[]
  onClose: () => void
}) {
  const create = useMutation(api.tasks.create)
  const addLinkMut = useMutation(api.tasks.addLink)
  const addFileMut = useMutation(api.tasks.addFile)
  const generateUploadUrl = useMutation(api.tasks.generateUploadUrl)

  // Назначать можно только действующих сотрудников.
  const assignable = employees.filter((e) => e.status === 'active')

  const [shown, setShown] = useState(false)
  const firstRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true))
    // Фокус на первое поле, но без прокрутки формы (иначе прячется верхняя метка).
    firstRef.current?.focus({ preventScroll: true })
    return () => cancelAnimationFrame(id)
  }, [])

  const close = () => {
    setShown(false)
    setTimeout(onClose, 200)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Ничего не предвыбираем — исполнителя и приоритет выбирает пользователь.
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [priority, setPriority] = useState<Priority | ''>('')
  const [deadline, setDeadline] = useState('')
  const [tags, setTags] = useState('')
  const [attachments, setAttachments] = useState<Pending[]>([])
  const [linkUrl, setLinkUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Обязательно всё, кроме меток и вложений.
  const canSubmit =
    title.trim() && description.trim() && assigneeId && priority && deadline && !loading

  const addLink = () => {
    const url = linkUrl.trim()
    if (!url) return
    setAttachments((a) => [...a, { kind: 'link', name: url, url }])
    setLinkUrl('')
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setError(null)
    setLoading(true)
    try {
      const taskId = await create({
        title: title.trim(),
        description: description.trim(),
        assigneeId: assigneeId as Id<'employees'>,
        priority: priority as Priority,
        deadline,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      })

      // Вложения цепляем уже к созданной задаче.
      for (const a of attachments) {
        if (a.kind === 'link') {
          await addLinkMut({ taskId, name: a.name, url: a.url })
        } else {
          const uploadUrl = await generateUploadUrl()
          const res = await fetch(uploadUrl, {
            method: 'POST',
            headers: { 'Content-Type': a.file.type },
            body: a.file,
          })
          const { storageId } = await res.json()
          await addFileMut({ taskId, storageId, name: a.name })
        }
      }
      close()
    } catch {
      setError('Не удалось создать задачу. Попробуйте ещё раз.')
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        onClick={close}
        className={`absolute inset-0 bg-black/30 transition-opacity duration-200 ${
          shown ? 'opacity-100' : 'opacity-0'
        }`}
      />
      <div
        className={`relative w-full max-w-md h-full bg-bg shadow-soft flex flex-col transition-transform duration-200 ease-out ${
          shown ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* header */}
        <div className="shrink-0 bg-white border-b border-line px-5 sm:px-6 py-4 flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#e2f2ef] text-green-d grid place-items-center shrink-0">
            <ListPlus size={19} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-ink leading-tight">Новая задача</h2>
            <p className="text-[13px] text-muted mt-0.5">Появится в колонке «Назначено»</p>
          </div>
          <button onClick={close} className="ico-btn w-9 h-9 shrink-0" title="Закрыть">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={submit} className="flex-1 min-h-0 flex flex-col">
          <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-5 flex flex-col gap-4">
            <Field label="Название">
              <input
                ref={firstRef}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className={inputCls}
                placeholder="Что нужно сделать?"
                required
              />
            </Field>
            <Field label="Описание">
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className={`${inputCls} resize-y`}
                placeholder="Детали задачи…"
                required
              />
            </Field>
            <Field label="Исполнитель">
              <Select
                value={assigneeId}
                onChange={setAssigneeId}
                placeholder="Выберите исполнителя"
                options={assignable.map((e) => ({ value: e.id, label: e.name, dot: e.avatarColor }))}
              />
            </Field>
            <Field label="Приоритет">
              <Select
                value={priority}
                onChange={(v) => setPriority(v as Priority)}
                placeholder="Выберите приоритет"
                options={PRIORITY_OPTS}
              />
            </Field>
            <Field label="Срок">
              <DatePicker value={deadline} onChange={setDeadline} />
            </Field>

            <Field label="Вложения" hint="необязательно">
              {attachments.length > 0 && (
                <div className="flex flex-col gap-1.5 mb-2">
                  {attachments.map((a, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 text-sm rounded-lg border border-line-2 bg-white px-2.5 py-2"
                    >
                      {a.kind === 'file' ? (
                        <Paperclip size={14} className="text-muted shrink-0" />
                      ) : (
                        <Link2 size={14} className="text-muted shrink-0" />
                      )}
                      <span className="flex-1 truncate text-ink-2">{a.name}</span>
                      <button
                        type="button"
                        onClick={() => setAttachments((list) => list.filter((_, j) => j !== i))}
                        className="text-muted hover:text-[#c53030] shrink-0"
                        title="Убрать"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2">
                <input
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addLink()
                    }
                  }}
                  className={inputCls}
                  placeholder="Вставьте ссылку…"
                />
                <button type="button" onClick={addLink} className="mini-btn h-10 shrink-0">
                  <Link2 size={14} /> Ссылка
                </button>
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="mini-btn h-10 shrink-0"
                >
                  <Upload size={14} /> Файл
                </button>
              </div>
              <input
                ref={fileRef}
                type="file"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) setAttachments((a) => [...a, { kind: 'file', name: f.name, file: f }])
                  e.target.value = ''
                }}
              />
            </Field>

            <Field label="Метки" hint="необязательно">
              <input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                className={inputCls}
                placeholder="через запятую"
              />
            </Field>
          </div>

          {/* footer */}
          <div className="shrink-0 border-t border-line bg-white px-5 sm:px-6 py-4 [padding-bottom:max(1rem,env(safe-area-inset-bottom))]">
            {error && <p className="text-sm text-[#c53030] mb-3">{error}</p>}
            <div className="flex items-center gap-2">
              <button type="button" onClick={close} className="btn btn-ghost flex-1">
                Отмена
              </button>
              <button type="submit" disabled={!canSubmit} className="btn btn-green flex-1 disabled:opacity-60">
                {loading ? <Loader2 size={16} className="animate-spin" /> : <ListPlus size={16} />}
                Создать задачу
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label className={labelCls}>
        {label}
        {hint && <span className="text-muted-2 font-normal"> · {hint}</span>}
      </label>
      {children}
    </div>
  )
}
