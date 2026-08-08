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
import { PriorityChip, statusMeta, priorityStyle } from '@/components/ui/StatusChip'
import Select from '@/components/ui/Select'
import TaskModal from '@/components/TaskModal'
import TaskCreateModal from '@/components/TaskCreateModal'
import { usePerms } from '@/lib/usePerms'
import { useData } from '@/lib/useData'
import { isOverdue, taskStatsByEmployee } from '@/lib/selectors'
import { shortDate, pct } from '@/lib/format'
import type { Employee, Task, TaskStatus } from '@/types'

const columns: TaskStatus[] = ['assigned', 'in_progress', 'done']

// Приоритеты в порядке важности, а не алфавита: в списке ищут «срочный».
const PRIORITY_DOT: Record<string, string> = {
  urgent: '#c53030',
  high: '#c05621',
  medium: '#2563eb',
  low: '#9aa0a6',
}

const PRIORITIES = (['urgent', 'high', 'medium', 'low'] as const).map((key) => ({
  key,
  label: priorityStyle[key].label,
  dot: PRIORITY_DOT[key],
}))

const filterCls = 'w-full sm:w-auto sm:min-w-[168px]'

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

// Варианты фильтра по срокам. Считаются от сегодняшнего дня в поясе
// организации: доска общая, а браузеры у людей могут стоять в разных поясах.
const DUE_OPTIONS = [
  { key: 'overdue', label: 'Просрочено' },
  { key: 'today', label: 'Срок сегодня' },
  { key: 'tomorrow', label: 'Срок завтра' },
  { key: 'week', label: 'На этой неделе' },
  { key: 'none', label: 'Без срока' },
] as const

type DueKey = (typeof DUE_OPTIONS)[number]['key']

function orgToday(): string {
  return new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 10)
}

function shift(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10)
}

// Конец текущей недели — воскресенье включительно.
function weekEnd(today: string): string {
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay()
  return shift(today, dow === 0 ? 0 : 7 - dow)
}

function matchesDue(task: Task, due: DueKey | ''): boolean {
  if (!due) return true
  const today = orgToday()
  if (due === 'none') return !task.deadline
  if (!task.deadline) return false
  // Просроченной считается только незакрытая задача: у выполненной срок уже
  // не горит, а её опоздание видно отдельной пометкой на карточке.
  if (due === 'overdue') return task.deadline < today && task.status !== 'done'
  if (due === 'today') return task.deadline === today
  if (due === 'tomorrow') return task.deadline === shift(today, 1)
  return task.deadline >= today && task.deadline <= weekEnd(today)
}

export default function Tasks() {
  const { tasks: allTasks, employees } = useData()
  const setStatus = useMutation(api.tasks.setStatus)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [view, setView] = useState<'board' | 'stats'>('board')
  const suppressClick = useRef(false)
  const { can } = usePerms()
  const canCreateTask = can('tasks', 'create')

  // Фильтры. Колонки остаются на месте при любом выборе — меняется только
  // то, какие карточки в них попадают: доска должна оставаться доской, а не
  // перестраиваться под каждый фильтр.
  const [fAssignee, setFAssignee] = useState('')
  const [fPriority, setFPriority] = useState('')
  const [fStatus, setFStatus] = useState<TaskStatus | ''>('')
  const [fDue, setFDue] = useState<DueKey | ''>('')

  const tasks = allTasks.filter(
    (t) =>
      (!fAssignee || t.assigneeId === fAssignee) &&
      (!fPriority || t.priority === fPriority) &&
      (!fStatus || t.status === fStatus) &&
      matchesDue(t, fDue),
  )
  const filtered = !!(fAssignee || fPriority || fStatus || fDue)
  const resetFilters = () => {
    setFAssignee('')
    setFPriority('')
    setFStatus('')
    setFDue('')
  }

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  )

  const assigneeOf = (id: string) => employees.find((e) => e.id === id)
  // Открытую карточку и перетаскиваемую ищем среди всех задач, а не среди
  // отфильтрованных: иначе смена фильтра при открытом окне обнуляла бы его.
  const openTask = allTasks.find((t) => t.id === openId) ?? null
  const activeTask = allTasks.find((t) => t.id === activeId) ?? null

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
    const t = allTasks.find((x) => x.id === e.active.id)
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

      {view === 'board' && (
        <div className="flex items-center gap-2 flex-wrap mb-4">
          {/* Свой компонент, а не <select>: нативный список macOS рисует
              система, и к оформлению панели он отношения не имеет. */}
          <Select
            className={filterCls}
            value={fAssignee}
            onChange={setFAssignee}
            placeholder="Все ответственные"
            options={[
              { value: '', label: 'Все ответственные' },
              ...employees.map((e) => ({ value: e.id, label: e.name, dot: e.avatarColor })),
            ]}
          />
          <Select
            className={filterCls}
            value={fPriority}
            onChange={setFPriority}
            placeholder="Любой приоритет"
            options={[
              { value: '', label: 'Любой приоритет' },
              ...PRIORITIES.map((p) => ({ value: p.key, label: p.label, dot: p.dot })),
            ]}
          />
          <Select
            className={filterCls}
            value={fStatus}
            onChange={(v) => setFStatus(v as TaskStatus | '')}
            placeholder="Любой статус"
            options={[
              { value: '', label: 'Любой статус' },
              ...columns.map((c) => ({
                value: c,
                label: statusMeta[c].label,
                dot: statusMeta[c].dot,
              })),
            ]}
          />
          <Select
            className={filterCls}
            value={fDue}
            onChange={(v) => setFDue(v as DueKey | '')}
            placeholder="Любой срок"
            options={[
              { value: '', label: 'Любой срок' },
              ...DUE_OPTIONS.map((d) => ({ value: d.key, label: d.label })),
            ]}
          />
          {filtered && (
            <>
              <button onClick={resetFilters} className="mini-btn">
                Сбросить
              </button>
              <span className="text-[13px] text-muted">
                {tasks.length} из {allTasks.length}
              </span>
            </>
          )}
        </div>
      )}

      {view === 'stats' && <TaskStatsView tasks={allTasks} employees={employees} />}

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
                    <div className="text-xs text-muted-2 text-center py-6">
                      {filtered ? 'Нет задач по фильтру' : 'Перетащите сюда'}
                    </div>
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
