import { useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import {
  X, Trash2, Paperclip, Link2, Send, Clock, Check, History, CheckSquare, Square, Upload,
} from 'lucide-react'
import type { Employee, Priority, Task, TaskStatus } from '@/types'
import { isOverdue } from '@/lib/selectors'
import { shortDate } from '@/lib/format'
import Avatar from './ui/Avatar'
import DatePicker from './ui/DatePicker'
import { statusMeta } from './ui/StatusChip'

const statuses: TaskStatus[] = ['assigned', 'in_progress', 'done']
const priorities: { v: Priority; label: string }[] = [
  { v: 'low', label: 'Низкий' },
  { v: 'medium', label: 'Средний' },
  { v: 'high', label: 'Высокий' },
  { v: 'urgent', label: 'Срочный' },
]

const inputCls =
  'w-full rounded-lg border border-line-2 px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:border-green-light bg-white'

function relTime(ms: number) {
  return new Date(ms).toLocaleString('ru-RU', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

export default function TaskModal({
  task,
  employees,
  onClose,
}: {
  task: Task
  employees: Employee[]
  onClose: () => void
}) {
  const tid = task.id as Id<'tasks'>
  const comments = useQuery(api.tasks.comments, { taskId: tid }) ?? []
  const events = useQuery(api.tasks.events, { taskId: tid }) ?? []
  const attachments = useQuery(api.tasks.attachments, { taskId: tid }) ?? []

  const update = useMutation(api.tasks.update)
  const setStatus = useMutation(api.tasks.setStatus)
  const remove = useMutation(api.tasks.remove)
  const addComment = useMutation(api.tasks.addComment)
  const toggleItem = useMutation(api.tasks.toggleChecklistItem)
  const addLink = useMutation(api.tasks.addLink)
  const removeAttachment = useMutation(api.tasks.removeAttachment)
  const generateUploadUrl = useMutation(api.tasks.generateUploadUrl)
  const addFile = useMutation(api.tasks.addFile)

  const [comment, setComment] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const reporter = employees.find((e) => e.id === task.reporterId)
  const overdue = isOverdue(task)

  const onUpload = async (file: File) => {
    const url = await generateUploadUrl()
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': file.type },
      body: file,
    })
    const { storageId } = await res.json()
    await addFile({ taskId: tid, storageId, name: file.name })
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div
        className="w-full max-w-xl h-full bg-bg overflow-y-auto shadow-soft"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="sticky top-0 z-10 bg-white border-b border-line px-6 py-4 flex items-center gap-3">
          <div className="flex-1 flex items-center gap-2">
            {statuses.map((s) => (
              <button
                key={s}
                onClick={() => setStatus({ id: tid, status: s })}
                className={`chip border ${
                  task.status === s
                    ? 'bg-dark text-white border-dark'
                    : 'bg-white text-muted border-line-2 hover:bg-chip'
                }`}
              >
                {statusMeta[s].label}
              </button>
            ))}
          </div>
          <button
            onClick={async () => {
              if (confirm('Удалить задачу?')) {
                await remove({ id: tid })
                onClose()
              }
            }}
            className="ico-btn w-9 h-9"
            title="Удалить"
          >
            <Trash2 size={16} />
          </button>
          <button onClick={onClose} className="ico-btn w-9 h-9" title="Закрыть">
            <X size={16} />
          </button>
        </div>

        <div className="p-6 flex flex-col gap-6">
          {/* title + status banner */}
          <div>
            <input
              defaultValue={task.title}
              onBlur={(e) => {
                const val = e.target.value.trim()
                if (val && val !== task.title) update({ id: tid, patch: { title: val } })
              }}
              className="w-full text-xl font-bold text-ink bg-transparent focus:outline-none"
            />
            {task.status === 'done' ? (
              <span
                className={`chip mt-2 ${
                  task.completedOnTime
                    ? 'bg-[#e3f6ee] text-green-d'
                    : 'bg-[#fdeaea] text-[#c53030]'
                }`}
              >
                <Check size={12} />
                {task.completedOnTime ? 'Выполнено в срок' : 'Выполнено с опозданием'}
                {task.completedAt ? ` · ${shortDate(new Date(task.completedAt).toISOString())}` : ''}
              </span>
            ) : overdue ? (
              <span className="chip mt-2 bg-[#fdeaea] text-[#c53030]">
                <Clock size={12} /> Просрочено · срок {shortDate(task.deadline)}
              </span>
            ) : null}
          </div>

          {/* meta grid */}
          <div className="grid grid-cols-2 gap-4">
            <Field label="Исполнитель">
              <select
                value={task.assigneeId}
                onChange={(e) => update({ id: tid, patch: { assigneeId: e.target.value as Id<'employees'> } })}
                className={inputCls}
              >
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>{e.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Приоритет">
              <select
                value={task.priority}
                onChange={(e) => update({ id: tid, patch: { priority: e.target.value as Priority } })}
                className={inputCls}
              >
                {priorities.map((p) => (
                  <option key={p.v} value={p.v}>{p.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Срок">
              <DatePicker
                value={task.deadline}
                onChange={(v) => v && update({ id: tid, patch: { deadline: v } })}
              />
            </Field>
            <Field label="Постановщик">
              <div className="flex items-center gap-2 h-[34px]">
                {reporter && <Avatar initials={reporter.initials} color={reporter.avatarColor} size={22} />}
                <span className="text-sm text-ink-2 truncate">{reporter?.name ?? '—'}</span>
              </div>
            </Field>
          </div>

          {/* description */}
          <div>
            <div className="text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Описание</div>
            <textarea
              defaultValue={task.description ?? ''}
              onBlur={(e) => update({ id: tid, patch: { description: e.target.value } })}
              placeholder="Добавьте описание…"
              rows={3}
              className={`${inputCls} resize-y`}
            />
          </div>

          {/* checklist */}
          {task.checklist.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">Чек-лист</div>
              <div className="flex flex-col gap-1.5">
                {task.checklist.map((it, i) => (
                  <button
                    key={it.id}
                    onClick={() => toggleItem({ taskId: tid, index: i })}
                    className="flex items-center gap-2 text-sm text-ink-2 hover:text-ink text-left"
                  >
                    {it.done ? <CheckSquare size={16} className="text-green" /> : <Square size={16} className="text-muted" />}
                    <span className={it.done ? 'line-through text-muted' : ''}>{it.text}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* attachments */}
          <div>
            <div className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">Вложения</div>
            <div className="flex flex-col gap-1.5 mb-2">
              {attachments.map((a) => (
                <div key={a._id} className="flex items-center gap-2 text-sm">
                  {a.kind === 'file' ? <Paperclip size={14} className="text-muted" /> : <Link2 size={14} className="text-muted" />}
                  <a href={a.url ?? '#'} target="_blank" rel="noreferrer" className="text-green-d hover:underline truncate flex-1">
                    {a.name}
                  </a>
                  <button onClick={() => removeAttachment({ id: a._id })} className="text-muted hover:text-[#c53030]">
                    <X size={13} />
                  </button>
                </div>
              ))}
              {attachments.length === 0 && <div className="text-xs text-muted-2">Пока нет вложений</div>}
            </div>
            <div className="flex items-center gap-2">
              <input
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="Вставьте ссылку…"
                className={inputCls}
              />
              <button
                onClick={() => {
                  if (linkUrl.trim()) {
                    addLink({ taskId: tid, name: linkUrl.trim(), url: linkUrl.trim() })
                    setLinkUrl('')
                  }
                }}
                className="mini-btn h-9 shrink-0"
              >
                <Link2 size={14} /> Ссылка
              </button>
              <button onClick={() => fileRef.current?.click()} className="mini-btn h-9 shrink-0">
                <Upload size={14} /> Файл
              </button>
              <input
                ref={fileRef}
                type="file"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) onUpload(f)
                  e.target.value = ''
                }}
              />
            </div>
          </div>

          {/* comments */}
          <div>
            <div className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">Комментарии</div>
            <div className="flex flex-col gap-3 mb-3">
              {comments.map((c) => (
                <div key={c._id} className="flex gap-2.5">
                  <Avatar initials={c.author?.initials ?? '—'} color={c.author?.color ?? '#9498a1'} size={28} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-semibold text-ink">{c.author?.name ?? '—'}</span>
                      <span className="text-[11px] text-muted">{relTime(c.createdAt)}</span>
                    </div>
                    <div className="text-sm text-ink-2 whitespace-pre-wrap">{c.text}</div>
                  </div>
                </div>
              ))}
              {comments.length === 0 && <div className="text-xs text-muted-2">Обсуждения пока нет</div>}
            </div>
            <div className="flex items-end gap-2">
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Написать комментарий…"
                rows={2}
                className={`${inputCls} resize-none`}
              />
              <button
                onClick={() => {
                  if (comment.trim()) {
                    addComment({ taskId: tid, text: comment })
                    setComment('')
                  }
                }}
                className="btn btn-green h-9 px-3 shrink-0"
              >
                <Send size={14} />
              </button>
            </div>
          </div>

          {/* history */}
          <div>
            <div className="text-xs font-semibold text-muted uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <History size={13} /> История
            </div>
            <div className="flex flex-col gap-2">
              {[...events].reverse().map((e) => (
                <div key={e._id} className="flex items-center gap-2 text-xs text-muted">
                  <span className="w-1.5 h-1.5 rounded-full bg-line-2 shrink-0" />
                  <span className="text-ink-2">{e.author?.name ?? '—'}</span>
                  {e.type === 'created' && <span>создал(а) задачу</span>}
                  {e.type === 'status' && (
                    <span>
                      перевёл(а): {e.fromStatus ? statusLabel(e.fromStatus) : '—'} → {e.toStatus ? statusLabel(e.toStatus) : '—'}
                    </span>
                  )}
                  {e.type === 'assignee' && <span>сменил(а) исполнителя</span>}
                  <span className="ml-auto">{relTime(e.createdAt)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">{label}</div>
      {children}
    </div>
  )
}

function statusLabel(s: string): string {
  return s === 'assigned' || s === 'in_progress' || s === 'done'
    ? statusMeta[s as TaskStatus].label
    : s
}
