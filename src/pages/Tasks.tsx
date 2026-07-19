import { Plus, MessageSquare, Paperclip, CheckSquare, ListFilter, LayoutGrid } from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import Avatar from '@/components/ui/Avatar'
import { PriorityChip } from '@/components/ui/StatusChip'
import { statusMeta } from '@/components/ui/StatusChip'
import { employees, tasks } from '@/data/mock'
import { isOverdue } from '@/lib/selectors'
import { shortDate } from '@/lib/format'
import type { Task, TaskStatus } from '@/types'

const columns: TaskStatus[] = ['backlog', 'progress', 'review', 'done']

function TaskCard({ task }: { task: Task }) {
  const a = employees.find((e) => e.id === task.assigneeId)!
  const doneItems = task.checklist.filter((c) => c.done).length
  const over = isOverdue(task)

  return (
    <div className="bg-card border border-line rounded-2xl p-3.5 shadow-card hover:shadow-soft transition-shadow cursor-pointer">
      <div className="flex items-center justify-between mb-2">
        <PriorityChip priority={task.priority} />
        {task.kpiRef && (
          <span className="text-[10px] font-semibold text-green-d bg-[#e3f6ee] px-2 py-0.5 rounded-full">
            KPI
          </span>
        )}
      </div>

      <div className="text-sm font-semibold text-ink leading-snug mb-1">{task.title}</div>
      {task.description && <p className="text-xs text-muted line-clamp-2 mb-2">{task.description}</p>}

      {task.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {task.tags.map((t) => (
            <span key={t} className="text-[11px] text-ink-2 bg-chip px-2 py-0.5 rounded-md">
              {t}
            </span>
          ))}
        </div>
      )}

      {task.checklist.length > 0 && (
        <div className="flex items-center gap-2 mb-3">
          <div className="flex-1 h-1.5 rounded-full bg-line overflow-hidden">
            <div
              className="h-full bg-green rounded-full"
              style={{ width: `${(doneItems / task.checklist.length) * 100}%` }}
            />
          </div>
          <span className="text-[11px] text-muted whitespace-nowrap">
            {doneItems}/{task.checklist.length}
          </span>
        </div>
      )}

      <div className="flex items-center justify-between pt-2 border-t border-line">
        <div className="flex items-center gap-3 text-muted">
          <Avatar initials={a.initials} color={a.avatarColor} size={26} />
          <span className={`text-[11px] ${over ? 'text-[#c53030] font-semibold' : ''}`}>
            {over ? 'Просрочено ' : ''}
            {shortDate(task.deadline)}
          </span>
        </div>
        <div className="flex items-center gap-3 text-muted text-[11px]">
          {task.checklist.length > 0 && (
            <span className="inline-flex items-center gap-1">
              <CheckSquare size={13} />
              {doneItems}/{task.checklist.length}
            </span>
          )}
          {task.comments > 0 && (
            <span className="inline-flex items-center gap-1">
              <MessageSquare size={13} />
              {task.comments}
            </span>
          )}
          {task.attachments > 0 && (
            <span className="inline-flex items-center gap-1">
              <Paperclip size={13} />
              {task.attachments}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

export default function Tasks() {
  return (
    <>
      <PageHeader
        title="Задачи"
        subtitle="Kanban-доска команды. Планируй, распределяй и контролируй сроки."
        actions={
          <>
            <button className="btn btn-ghost">
              <ListFilter size={16} /> Фильтры
            </button>
            <button className="btn btn-ghost">
              <LayoutGrid size={16} /> Доска
            </button>
            <button className="btn btn-green">
              <Plus size={16} /> Добавить задачу
            </button>
          </>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
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
                <button className="text-muted hover:text-ink" title="Добавить">
                  <Plus size={16} />
                </button>
              </div>
              <div className="flex flex-col gap-3 rounded-2xl bg-black/[0.015] p-2 min-h-[120px] flex-1">
                {list.map((t) => (
                  <TaskCard key={t.id} task={t} />
                ))}
                {list.length === 0 && (
                  <div className="text-xs text-muted-2 text-center py-6">Нет задач</div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}
