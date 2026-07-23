import { useState } from 'react'
import { Plus, MessageSquare, Paperclip, CheckSquare, LayoutGrid, BarChart3 } from 'lucide-react'
import { useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import PageHeader from '@/components/PageHeader'
import Avatar from '@/components/ui/Avatar'
import { ProgressBar } from '@/components/ui/Progress'
import { PriorityChip, statusMeta } from '@/components/ui/StatusChip'
import TaskModal from '@/components/TaskModal'
import TaskCreateModal from '@/components/TaskCreateModal'
import { useData } from '@/lib/useData'
import { isOverdue, taskStatsByEmployee } from '@/lib/selectors'
import { shortDate, pct } from '@/lib/format'
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
  const [view, setView] = useState<'board' | 'stats'>('board')

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
            <div className="flex items-center gap-1 p-1 bg-chip rounded-xl">
              <button
                onClick={() => setView('board')}
                className={`h-8 px-3 rounded-lg text-sm font-semibold inline-flex items-center gap-1.5 transition-colors ${
                  view === 'board' ? 'bg-white text-ink shadow-card' : 'text-muted hover:text-ink'
                }`}
              >
                <LayoutGrid size={15} /> Доска
              </button>
              <button
                onClick={() => setView('stats')}
                className={`h-8 px-3 rounded-lg text-sm font-semibold inline-flex items-center gap-1.5 transition-colors ${
                  view === 'stats' ? 'bg-white text-ink shadow-card' : 'text-muted hover:text-ink'
                }`}
              >
                <BarChart3 size={15} /> Статистика
              </button>
            </div>
            <button className="btn btn-green" onClick={() => setCreating(true)}><Plus size={16} /> Добавить задачу</button>
          </>
        }
      />

      {view === 'stats' && <TaskStatsView tasks={tasks} employees={employees} />}

      <div className={`grid grid-cols-1 md:grid-cols-3 gap-4 ${view === 'stats' ? 'hidden' : ''}`}>
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

function TaskStatsView({ tasks, employees }: { tasks: Task[]; employees: Employee[] }) {
  const stats = taskStatsByEmployee(tasks, employees)
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 mb-5">
      {stats.map((s) => (
        <div key={s.employee.id} className="card p-5">
          <div className="flex items-center gap-3 mb-4">
            <Avatar initials={s.employee.initials} color={s.employee.avatarColor} size={40} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-ink truncate">{s.employee.name}</div>
              <div className="text-xs text-muted truncate">{s.employee.positionLabel}</div>
            </div>
            {s.overdue > 0 && <span className="chip bg-[#fdeaea] text-[#c53030]">{s.overdue} просроч.</span>}
          </div>
          <div className="grid grid-cols-4 gap-2 mb-4">
            <Metric label="Постав." value={s.total} />
            <Metric label="Выполн." value={s.done} />
            <Metric label="В срок" value={s.onTime} tone="green" />
            <Metric label="Опозд." value={s.late} tone="red" />
          </div>
          <StatBar label="Выполнение задач" value={s.completionPct} />
          <StatBar label="Соблюдение сроков" value={s.onTimePct} />
        </div>
      ))}
      {stats.length === 0 && <div className="text-sm text-muted">Нет данных по задачам.</div>}
    </div>
  )
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: 'green' | 'red' }) {
  const color = tone === 'green' ? 'text-green-d' : tone === 'red' ? 'text-[#c53030]' : 'text-ink'
  return (
    <div className="rounded-xl bg-chip p-2.5 text-center">
      <div className={`text-lg font-bold ${color}`}>{value}</div>
      <div className="text-[10px] text-muted mt-0.5">{label}</div>
    </div>
  )
}

function StatBar({ label, value }: { label: string; value: number }) {
  const color = value >= 0.9 ? '#1c7d4d' : value >= 0.7 ? '#d69e2e' : '#c53030'
  return (
    <div className="mb-3 last:mb-0">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-muted">{label}</span>
        <span className="text-xs font-semibold text-ink">{pct(value)}</span>
      </div>
      <ProgressBar value={value} color={color} />
    </div>
  )
}
