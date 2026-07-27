import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { X, Loader2, ListPlus, Link2, Upload, Paperclip } from 'lucide-react'
import DatePicker from './ui/DatePicker'
import Select, { type SelectOption } from './ui/Select'
import { useCurrentUser } from '@/store'
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

function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} МБ`
}

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

  // Назначать можно только действующих сотрудников и только в своём скоупе —
  // как проверяет сервер (inScope): владелец — всех, руководитель — свой отдел,
  // сотрудник — только себя. Так список не предлагает того, кого сервер отклонит.
  const me = useCurrentUser()
  const assignable = employees
    .filter((e) => e.status === 'active')
    .filter((e) =>
      me.role === 'owner' ? true : me.role === 'head' ? e.department === me.department : e.id === me.id,
    )

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
  const [dragging, setDragging] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Единственный доступный исполнитель (сотрудник ставит задачу только себе) —
  // выбираем сразу, чтобы не заставлять открывать список из одного пункта.
  useEffect(() => {
    if (!assigneeId && assignable.length === 1) setAssigneeId(assignable[0].id)
  }, [assignable, assigneeId])

  // Достаточно названия и исполнителя. Остальное — по желанию: описание и срок
  // необязательны, а приоритет по умолчанию «средний».
  const canSubmit = title.trim() && assigneeId && !loading

  const addLink = () => {
    let url = linkUrl.trim()
    if (!url) return
    // Без схемы ссылка открывалась бы как относительная — дописываем https.
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`
    setAttachments((a) => [...a, { kind: 'link', name: url, url }])
    setLinkUrl('')
  }

  const addFiles = (list: FileList | null) => {
    if (!list?.length) return
    setAttachments((a) => [
      ...a,
      ...Array.from(list).map((file) => ({ kind: 'file' as const, name: file.name, file })),
    ])
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setError(null)
    setLoading(true)
    try {
      const taskId = await create({
        title: title.trim(),
        description: description.trim() || undefined,
        assigneeId: assigneeId as Id<'employees'>,
        priority: (priority || 'medium') as Priority,
        deadline: deadline || undefined,
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
            <Field label="Описание" hint="необязательно">
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className={`${inputCls} resize-y`}
                placeholder="Детали задачи…"
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
            <Field label="Приоритет" hint="по умолчанию средний">
              <Select
                value={priority}
                onChange={(v) => setPriority(v as Priority)}
                placeholder="Выберите приоритет"
                options={PRIORITY_OPTS}
              />
            </Field>
            <Field label="Срок" hint="необязательно">
              <DatePicker value={deadline} onChange={setDeadline} />
            </Field>

            <Field
              label="Вложения"
              hint={attachments.length ? `${attachments.length} шт.` : 'необязательно'}
            >
              <div className="flex flex-col gap-2">
                {/* Зона файлов: клик или перетаскивание */}
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault()
                    setDragging(true)
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault()
                    setDragging(false)
                    addFiles(e.dataTransfer.files)
                  }}
                  className={`w-full rounded-xl border-2 border-dashed px-4 py-5 flex flex-col items-center gap-1 transition-colors ${
                    dragging
                      ? 'border-green-light bg-[#e2f2ef]'
                      : 'border-line-2 bg-white hover:border-green-light hover:bg-[#e2f2ef]/40'
                  }`}
                >
                  <Upload size={18} className="text-green-d" />
                  <span className="text-sm font-medium text-ink-2">Перетащите файлы сюда</span>
                  <span className="text-[11px] text-muted-2">или нажмите, чтобы выбрать</span>
                </button>

                {/* Ссылка — отдельным полем, а не третьей кнопкой в ряд */}
                <div className="flex items-center gap-2">
                  <div className="relative flex-1 min-w-0">
                    <Link2
                      size={14}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
                    />
                    <input
                      value={linkUrl}
                      onChange={(e) => setLinkUrl(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          addLink()
                        }
                      }}
                      className={`${inputCls} pl-9`}
                      placeholder="Вставьте ссылку…"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={addLink}
                    disabled={!linkUrl.trim()}
                    className="shrink-0 h-[42px] px-4 rounded-lg border border-line-2 bg-white text-sm font-semibold text-ink-2 hover:bg-chip transition-colors disabled:opacity-50 disabled:hover:bg-white"
                  >
                    Добавить
                  </button>
                </div>

                {/* Что уже прикреплено */}
                {attachments.map((a, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2.5 rounded-lg border border-line bg-white px-3 py-2"
                  >
                    <span className="w-8 h-8 rounded-lg bg-chip grid place-items-center shrink-0 text-muted">
                      {a.kind === 'file' ? <Paperclip size={14} /> : <Link2 size={14} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-ink truncate">{a.name}</div>
                      <div className="text-[11px] text-muted-2">
                        {a.kind === 'file' ? fileSize(a.file.size) : 'Ссылка'}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setAttachments((list) => list.filter((_, j) => j !== i))}
                      className="w-7 h-7 grid place-items-center rounded-md text-muted hover:text-[#c53030] hover:bg-chip transition-colors shrink-0"
                      title="Убрать"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
              <input
                ref={fileRef}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  addFiles(e.target.files)
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
