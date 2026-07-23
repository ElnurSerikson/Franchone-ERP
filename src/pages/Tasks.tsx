import { useState } from 'react'
import { Plus, MessageSquare, Paperclip, CheckSquare, ListFilter, LayoutGrid } from 'lucide-react'
import { useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import PageHeader from '@/components/PageHeader'
import Avatar from '@/components/ui/Avatar'
import { PriorityChip, statusMeta } from '@/components/ui/StatusChip'
import TaskModal from '@/components/TaskModal'
import TaskCreateModal from '@/components/TaskCreateModal'
import { useData } from '@/lib/useData'
import { isOverdue } from '@/lib/selectors'
import { shortDate } from '@/lib/format'
import type { Employee, Task, TaskStatus } from '@/types'

const columns: TaskStatus[] = ['assigned', 'in_progress', 'done']

function TaskCard({
  task,
  assignee,
  onOpen,
  onDragStart,
  onDragEnd,
  dragging,
}: {
  task: Task
  assignee?: Employee
  onOpen: () => void
  onDragStart: () => void
  onDragEnd: () => void
  dragging: boolean
}) {
  const doneItems = task.checklist.filter((c) => c.done).length
  const over = isOverdue(task)

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      className={`bg-card border border-line rounded-2xl p-3.5 shadow-card hover:shadow-soft transition-all cursor-pointer ${
        dragging ? 'opacity-40' : ''
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <PriorityChip priority={task.priority} />
        {task.status === 'done' && task.completedOnTime === false ? (
          <span className="text-[10px] font-semibold text-[#c53030] bg-[#fdeaea] px-2 py-0.5 rounded-full">
            с опозданием
          </span>
        ) : task.kpiRef ? (
          <span className="text-[10px] font-semibold text-green-d bg-[#e3f6ee] px-2 py-0.5 rounded-full">KPI</span>
        ) : null}
      </div>

      <div className="text-sm font-semibold text-ink leading-snug mb-1">{task.title}</div>
      {task.description && <p className="text-xs text-muted line-clamp-2 mb-2">{task.description}</p>}

      {task.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {task.tags.map((t) => (
            <span key={t} className="text-[11px] text-ink-2 bg-chip px-2 py-0.5 rounded-md">{t}</span>
          ))}
        </div>
      )}

      {task.checklist.length > 0 && (
        <div className="flex items-center gap-2 mb-3">
          <div className="flex-1 h-1.5 rounded-full bg-line overflow-hidden">
            <div className="h-full bg-green rounded-full" style={{ width: `${(doneItems / task.checklist.length) * 100}%` }} />
          </div>
          <span className="text-[11px] text-muted whitespace-nowrap">{doneItems}/{task.checklist.length}</span>
        </div>
      )}

      <div className="flex items-center justify-between pt-2 border-t border-line">
        <div className="flex items-center gap-3 text-muted">
          {assignee && <Avatar initials={assignee.initials} color={assignee.avatarColor} size={26} />}
          <span className={`text-[11px] ${over ? 'text-[#c53030] font-semibold' : ''}`}>
            {over ? 'Просрочено ' : ''}{shortDate(task.deadline)}
          </span>
        </div>
        <div className="flex items-center gap-3 text-muted text-[11px]">
          {task.checklist.length > 0 && (
            <span className="inline-flex items-center gap-1"><CheckSquare size={13} />{doneItems}/{task.checklist.length}</span>
          )}
          {task.comments > 0 && <span className="inline-flex items-center gap-1"><MessageSquare size={13} />{task.comments}</span>}
          {task.attachments > 0 && <span className="inline-flex items-center gap-1"><Paperclip size={13} />{task.attachments}</span>}
        </div>
      </div>
    </div>
  )
}

export default function Tasks() {
  const { tasks, employees } = useData()
  const setStatus = useMutation(api.tasks.setStatus)
  const [dragId, setDragId] = useState<string | null>(null)
  const [overCol, setOverCol] = useState<TaskStatus | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const assigneeOf = (id: string) => employees.find((e) => e.id === id)
  const openTask = tasks.find((t) => t.id === openId) ?? null

  const handleDrop = (col: TaskStatus) => {
    const t = tasks.find((x) => x.id === dragId)
    if (t && t.status !== col) setStatus({ id: t.id as Id<'tasks'>, status: col })
    setDragId(null)
    setOverCol(null)
  }

  return (
    <>
      <PageHeader
        title="Задачи"
        subtitle="Kanban-доска команды. Перетаскивайте карточки — статус сохраняется в базу."
        actions={
          <>
            <button className="btn btn-ghost"><ListFilter size={16} /> Фильтры</button>
            <button className="btn btn-ghost"><LayoutGrid size={16} /> Доска</button>
            <button className="btn btn-green" onClick={() => setCreating(true)}><Plus size={16} /> Добавить задачу</button>
          </>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {columns.map((col) => {
          const meta = statusMeta[col]
          const list = tasks.filter((t) => t.status === col)
          return (
            <div key={col} className="flex flex-col">
              <div className="flex items-center justify-between mb-3 px-1">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{ background: meta.dot }} />
                  <span className="text-sm font-semibold text-ink">{meta.label}</span>
                  <span className="text-xs text-muted bg-chip px-1.5 py-0.5 rounded-md">{list.length}</span>
                </div>
                <button className="text-muted hover:text-ink" title="Добавить" onClick={() => setCreating(true)}>
                  <Plus size={16} />
                </button>
              </div>
              <div
                onDragOver={(e) => {
                  e.preventDefault()
                  if (overCol !== col) setOverCol(col)
                }}
                onDrop={() => handleDrop(col)}
                className={`flex flex-col gap-3 rounded-2xl p-2 min-h-[140px] flex-1 transition-colors ${
                  overCol === col ? 'bg-green-light/15 ring-2 ring-green-light/40' : 'bg-black/[0.015]'
                }`}
              >
                {list.map((t) => (
                  <TaskCard
                    key={t.id}
                    task={t}
                    assignee={assigneeOf(t.assigneeId)}
                    dragging={dragId === t.id}
                    onOpen={() => setOpenId(t.id)}
                    onDragStart={() => setDragId(t.id)}
                    onDragEnd={() => {
                      setDragId(null)
                      setOverCol(null)
                    }}
                  />
                ))}
                {list.length === 0 && <div className="text-xs text-muted-2 text-center py-6">Перетащите сюда</div>}
              </div>
            </div>
          )
        })}
      </div>

      {openTask && <TaskModal task={openTask} employees={employees} onClose={() => setOpenId(null)} />}
      {creating && <TaskCreateModal employees={employees} onClose={() => setCreating(false)} />}
    </>
  )
}
