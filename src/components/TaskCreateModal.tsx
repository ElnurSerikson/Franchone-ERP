import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { X, Loader2, ListPlus } from 'lucide-react'
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
  // Назначать можно только действующих сотрудников.
  const assignable = employees.filter((e) => e.status === 'active')

  const [shown, setShown] = useState(false)
  const firstRef = useRef<HTMLInputElement>(null)
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

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [assigneeId, setAssigneeId] = useState(assignable[0]?.id ?? '')
  const [priority, setPriority] = useState<Priority>('medium')
  const [deadline, setDeadline] = useState('')
  const [tags, setTags] = useState('')
  const [loading, setLoading] = useState(false)

  const canSubmit = title.trim() && assigneeId && deadline && !loading

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setLoading(true)
    try {
      await create({
        title: title.trim(),
        description: description.trim() || undefined,
        assigneeId: assigneeId as Id<'employees'>,
        priority,
        deadline,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      })
      close()
    } finally {
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
              />
            </Field>
            <Field label="Исполнитель">
              <Select
                value={assigneeId}
                onChange={setAssigneeId}
                options={assignable.map((e) => ({ value: e.id, label: e.name, dot: e.avatarColor }))}
              />
            </Field>
            <Field label="Приоритет">
              <Select value={priority} onChange={(v) => setPriority(v as Priority)} options={PRIORITY_OPTS} />
            </Field>
            <Field label="Срок">
              <DatePicker value={deadline} onChange={setDeadline} />
            </Field>
            <Field label="Метки">
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

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      {children}
    </div>
  )
}
