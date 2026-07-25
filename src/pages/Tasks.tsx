import { useRef, useState, type ReactNode } from 'react'
import { Plus, MessageSquare, Paperclip, CheckSquare, LayoutGrid, BarChart3 } from 'lucide-react'
import { useMutation } from 'convex/react'
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  closestCorners,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import PageHeader from '@/components/PageHeader'
import Avatar from '@/components/ui/Avatar'
import { ProgressBar } from '@/components/ui/Progress'
import { PriorityChip, statusMeta } from '@/components/ui/StatusChip'
import TaskModal from '@/components/TaskModal'
import TaskCreateModal from '@/components/TaskCreateModal'
import { usePerms } from '@/lib/usePerms'
import { useData } from '@/lib/useData'
import { isOverdue, taskStatsByEmployee } from '@/lib/selectors'
import { shortDate, pct } from '@/lib/format'
import type { Employee, Task, TaskStatus } from '@/types'

const columns: TaskStatus[] = ['assigned', 'in_progress', 'done']

// Презентационная карточка (без drag-обвязки — её даёт DraggableCard).
function TaskCard({ task, assignee }: { task: Task; assignee?: Employee }) {
  const doneItems = task.checklist.filter((c) => c.done).length
  const over = isOverdue(task)

  return (
    <div className="bg-card border border-line rounded-2xl p-3.5 shadow-card hover:shadow-soft transition-all cursor-pointer select-none">
      <div className="flex items-center justify-between mb-2">
        <PriorityChip priority={task.priority} />
        {task.status === 'done' && task.completedOnTime === false ? (
          <span className="text-[10px] font-semibold text-[#c53030] bg-[#fdeaea] px-2 py-0.5 rounded-full">
            с опозданием
          </span>
        ) : task.kpiRef ? (
          <span className="text-[10px] font-semibold text-green-d bg-[#e2f2ef] px-2 py-0.5 rounded-full">KPI</span>
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
            {task.deadline ? `${over ? 'Просрочено ' : ''}${shortDate(task.deadline)}` : 'Без срока'}
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

// Перетаскиваемая обёртка. Короткий тап открывает задачу, удержание — тащит.
function DraggableCard({
  task,
  assignee,
  onOpen,
}: {
  task: Task
  assignee?: Employee
  onOpen: () => void
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id })
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={onOpen}
      className={isDragging ? 'opacity-40' : ''}
    >
      <TaskCard task={task} assignee={assignee} />
    </div>
  )
}

// Колонка-приёмник.
function Column({
  col,
  count,
  onAdd,
  children,
}: {
  col: TaskStatus
  count: number
  onAdd?: () => void
  children: ReactNode
}) {
  const meta = statusMeta[col]
  const { setNodeRef, isOver } = useDroppable({ id: col })
  return (
    <div className="flex flex-col shrink-0 w-[82vw] max-w-[320px] snap-start md:w-auto md:max-w-none md:shrink">
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: meta.dot }} />
          <span className="text-sm font-semibold text-ink">{meta.label}</span>
          <span className="text-xs text-muted bg-chip px-1.5 py-0.5 rounded-md">{count}</span>
        </div>
        {onAdd && (
          <button className="text-muted hover:text-ink p-1 -m-1" title="Добавить" onClick={onAdd}>
            <Plus size={16} />
          </button>
        )}
      </div>
      <div
        ref={setNodeRef}
        className={`flex flex-col gap-3 rounded-2xl p-2 min-h-[140px] flex-1 transition-colors ${
          isOver ? 'bg-green-light/15 ring-2 ring-green-light/40' : 'bg-black/[0.015]'
        }`}
      >
        {children}
      </div>
    </div>
  )
}

export default function Tasks() {
  const { tasks, employees } = useData()
  const setStatus = useMutation(api.tasks.setStatus)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [view, setView] = useState<'board' | 'stats'>('board')
  const suppressClick = useRef(false)
  const { can } = usePerms()
  const canCreateTask = can('tasks', 'create')

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  )

  const assigneeOf = (id: string) => employees.find((e) => e.id === id)
  const openTask = tasks.find((t) => t.id === openId) ?? null
  const activeTask = tasks.find((t) => t.id === activeId) ?? null

  const openGuarded = (id: string) => {
    // Гасим «хвостовой» клик, который браузер шлёт после перетаскивания.
    if (suppressClick.current) return
    setOpenId(id)
  }

  const onDragStart = (e: DragStartEvent) => setActiveId(e.active.id as string)

  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null)
    suppressClick.current = true
    setTimeout(() => (suppressClick.current = false), 200)
    const overId = e.over?.id as TaskStatus | undefined
    if (!overId || !columns.includes(overId)) return
    const t = tasks.find((x) => x.id === e.active.id)
    if (t && t.status !== overId) setStatus({ id: t.id as Id<'tasks'>, status: overId })
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
            {canCreateTask && (
              <button className="btn btn-green" onClick={() => setCreating(true)}><Plus size={16} /> Добавить задачу</button>
            )}
          </>
        }
      />

      {view === 'stats' && <TaskStatsView tasks={tasks} employees={employees} />}

      <div className={view === 'stats' ? 'hidden' : ''}>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        >
          <div className="flex md:grid md:grid-cols-3 gap-3 md:gap-4 overflow-x-auto md:overflow-visible snap-x snap-mandatory md:snap-none no-scrollbar -mx-4 px-4 md:mx-0 md:px-0 pb-2 md:pb-0">
            {columns.map((col) => {
              const list = tasks.filter((t) => t.status === col)
              return (
                <Column key={col} col={col} count={list.length} onAdd={canCreateTask ? () => setCreating(true) : undefined}>
                  {list.map((t) => (
                    <DraggableCard
                      key={t.id}
                      task={t}
                      assignee={assigneeOf(t.assigneeId)}
                      onOpen={() => openGuarded(t.id)}
                    />
                  ))}
                  {list.length === 0 && (
                    <div className="text-xs text-muted-2 text-center py-6">Перетащите сюда</div>
                  )}
                </Column>
              )
            })}
          </div>

          <DragOverlay>
            {activeTask ? (
              <div className="rotate-2 w-[300px] max-w-[82vw]">
                <TaskCard task={activeTask} assignee={assigneeOf(activeTask.assigneeId)} />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>

      {openTask && <TaskModal task={openTask} employees={employees} onClose={() => setOpenId(null)} />}
      {creating && <TaskCreateModal employees={employees} onClose={() => setCreating(false)} />}
    </>
  )
}

function TaskStatsView({ tasks, employees }: { tasks: Task[]; employees: Employee[] }) {
  const stats = taskStatsByEmployee(tasks, employees)
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 mb-5">
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
  const color = value >= 0.9 ? '#057269' : value >= 0.7 ? '#d69e2e' : '#c53030'
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
