import { useState, type FormEvent } from 'react'
import { useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { X, Loader2 } from 'lucide-react'
import DatePicker from './ui/DatePicker'
import type { Employee, Priority } from '@/types'

const inputCls =
  'w-full rounded-lg border border-line-2 px-3 py-2 text-sm text-ink focus:outline-none focus:border-green-light bg-white'

const priorities: { v: Priority; label: string }[] = [
  { v: 'low', label: 'Низкий' },
  { v: 'medium', label: 'Средний' },
  { v: 'high', label: 'Высокий' },
  { v: 'urgent', label: 'Срочный' },
]

export default function TaskCreateModal({
  employees,
  onClose,
}: {
  employees: Employee[]
  onClose: () => void
}) {
  const create = useMutation(api.tasks.create)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [assigneeId, setAssigneeId] = useState(employees[0]?.id ?? '')
  const [priority, setPriority] = useState<Priority>('medium')
  const [deadline, setDeadline] = useState('')
  const [tags, setTags] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !assigneeId || !deadline) return
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
      onClose()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-white rounded-card shadow-soft"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-line">
          <h2 className="text-lg font-bold text-ink">Новая задача</h2>
          <button type="button" onClick={onClose} className="ico-btn w-9 h-9">
            <X size={16} />
          </button>
        </div>

        <div className="p-6 flex flex-col gap-4">
          <div>
            <label className="block text-sm font-medium text-ink-2 mb-1.5">Название</label>
            <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} required className={inputCls} placeholder="Что нужно сделать?" />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-2 mb-1.5">Описание</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={`${inputCls} resize-y`} placeholder="Детали задачи…" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-ink-2 mb-1.5">Исполнитель</label>
              <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className={inputCls}>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>{e.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-2 mb-1.5">Приоритет</label>
              <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)} className={inputCls}>
                {priorities.map((p) => (
                  <option key={p.v} value={p.v}>{p.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-2 mb-1.5">Срок</label>
              <DatePicker value={deadline} onChange={setDeadline} />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-2 mb-1.5">Метки</label>
              <input value={tags} onChange={(e) => setTags(e.target.value)} className={inputCls} placeholder="через запятую" />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-line">
          <button type="button" onClick={onClose} className="btn btn-ghost">Отмена</button>
          <button
            type="submit"
            disabled={loading || !title.trim() || !deadline}
            className="btn btn-green disabled:opacity-60"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : null}
            Создать задачу
          </button>
        </div>
      </form>
    </div>
  )
}
