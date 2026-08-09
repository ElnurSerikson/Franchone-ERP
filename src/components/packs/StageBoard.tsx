// §5, §11: этапы проекта с материалами, версиями и комментариями — рабочий
// экран упаковщика. Сценарий согласования (§5.3) выполняется отсюда:
// подготовить материалы → передать этап → получить замечания → загрузить новую
// версию → передать повторно.

import { useRef, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import {
  Check, ChevronDown, ChevronRight, Clock, FileUp, Link2, Loader2, Lock,
  Paperclip, Plus, RotateCcw, Star, Trash2,
} from 'lucide-react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import Avatar from '@/components/ui/Avatar'
import Select from '@/components/ui/Select'
import DatePicker from '@/components/ui/DatePicker'
import { errMessage } from '@/lib/errors'
import { uploadToStorage } from '@/lib/packUpload'
import {
  MATERIAL_KIND_LABEL, MATERIAL_STATUS, PACKER_MATERIAL_STATUSES,
} from '../../../convex/packModel'
import {
  AttachmentLink, Deadline, MaterialChip, StageChip, dateTime, inputCls, areaCls,
} from './ui'

type Board = NonNullable<ReturnType<typeof useBoard>>
function useBoard(packId: Id<'packs'>) {
  return useQuery(api.packStages.board, { packId })
}

export default function StageBoard({ packId }: { packId: Id<'packs'> }) {
  const board = useBoard(packId)
  const [open, setOpen] = useState<string | null>(null)

  if (board === undefined) {
    return (
      <div className="card p-10 grid place-items-center text-muted">
        <Loader2 className="animate-spin" size={20} />
      </div>
    )
  }
  if (!board) return null

  return (
    <div className="flex flex-col gap-3">
      {board.stages.map((s) => (
        <StageCard
          key={s._id}
          packId={packId}
          stage={s}
          board={board}
          open={open === (s._id as string)}
          onToggle={() => setOpen(open === (s._id as string) ? null : (s._id as string))}
        />
      ))}
    </div>
  )
}

type Stage = Board['stages'][number]

function StageCard({
  packId,
  stage,
  board,
  open,
  onToggle,
}: {
  packId: Id<'packs'>
  stage: Stage
  board: Board
  open: boolean
  onToggle: () => void
}) {
  const reopen = useMutation(api.packStages.reopenStage)

  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [mode, setMode] = useState<'' | 'reopen'>('')

  const act = async (name: string, fn: () => Promise<unknown>) => {
    setBusy(name)
    setError('')
    try {
      await fn()
      setMode('')
      setNote('')
    } catch (e) {
      setError(errMessage(e, 'Не удалось выполнить действие.'))
    } finally {
      setBusy('')
    }
  }

  const blocked = stage.status === 'locked'

  return (
    <section className={`card overflow-hidden ${blocked ? 'opacity-70' : ''}`}>
      <button
        onClick={onToggle}
        className="w-full text-left px-5 py-4 flex items-start gap-3 hover:bg-chip/40 transition-colors"
      >
        <span className="mt-0.5 text-muted shrink-0">
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 flex-wrap">
            {blocked && <Lock size={13} className="text-muted-2" />}
            <span className="text-[15px] font-semibold text-ink">{stage.title}</span>
            <StageChip status={stage.status} />
            {stage.kind === 'zero' && (
              <span className="chip bg-chip text-muted">подготовительный</span>
            )}
            <span className="chip bg-chip text-ink-2">вес {stage.weight}%</span>
            {stage.returnCount > 0 && (
              <span className="chip bg-[#fdefe4] text-[#c05621]">
                возвратов: {stage.returnCount}
              </span>
            )}
          </span>
          <span className="flex items-center gap-3 flex-wrap text-[12px] text-muted mt-1">
            {stage.startDate && stage.endDate && (
              <span>
                {stage.startDate} — {stage.endDate}
              </span>
            )}
            {stage.dueAt && stage.status !== 'approved' && (
              <span className="inline-flex items-center gap-1">
                <Clock size={12} />
                <Deadline at={stage.dueAt} now={board.now} />
                {stage.awaiting === 'client' ? ' · ждём клиента' : ' · за нами'}
              </span>
            )}
            {stage.approvedAt && (
              <span className="text-green-d">
                утверждён {dateTime(stage.approvedAt)}
                {stage.approvedOnTime === false ? ' (с опозданием)' : ''}
              </span>
            )}
            {stage.readiness.required > 0 && stage.status !== 'approved' && (
              <span>
                обязательных материалов: {stage.readiness.done}/{stage.readiness.required}
              </span>
            )}
          </span>
        </span>
      </button>

      {open && (
        <div className="px-5 pb-5 border-t border-line pt-4 flex flex-col gap-4">
          {(stage.clientNote || stage.internalNote || stage.doneCondition) && (
            <div className="grid gap-2 sm:grid-cols-3">
              {stage.clientNote && (
                <Box title="Описание для клиента" text={stage.clientNote} />
              )}
              {stage.internalNote && (
                <Box title="Внутренний комментарий" text={stage.internalNote} internal />
              )}
              {stage.doneCondition && <Box title="Условия завершения" text={stage.doneCondition} />}
            </div>
          )}

          {/* ТЗ v1.1 §5.3, §9.2: отдельного действия «передать этап» нет.
              Этап уходит на приёмку, когда загружены все обязательные
              материалы, и принимается, когда заказчик принял их все. */}
          {board.canWork && board.launched && stage.status !== 'approved' && (
            <div className="rounded-xl bg-chip p-3 text-[12px] text-ink-2">
              {stage.readiness.required === 0
                ? 'У этапа нет обязательных материалов — добавьте их, иначе этап не уйдёт на приёмку.'
                : stage.readiness.done < stage.readiness.required
                  ? `Готово ${stage.readiness.done} из ${stage.readiness.required} обязательных материалов. Как только все будут «Готов к проверке», этап уйдёт заказчику автоматически.`
                  : 'Все обязательные материалы переданы. Этап принимается, когда заказчик примет каждый из них.'}
            </div>
          )}

          {/* §15: принятый этап переоткрывает только администратор. */}
          {board.isOwner && stage.status === 'approved' && (
            <div>
              <button
                onClick={() => setMode(mode === 'reopen' ? '' : 'reopen')}
                className="btn btn-ghost h-8 px-3 text-sm"
              >
                <RotateCcw size={13} /> Переоткрыть этап
              </button>
            </div>
          )}

          {mode === 'reopen' && (
            <ActionBox
              title="Переоткрыть принятый этап"
              hint="Вес этапа выйдет из прогресса и фактического KPI до повторной приёмки. Причина сохранится в системе."
              danger
              value={note}
              onChange={setNote}
              placeholder="Причина переоткрытия"
              busy={busy === 'reopen'}
              label="Переоткрыть"
              onSubmit={() => act('reopen', () => reopen({ id: stage._id, reason: note }))}
              onCancel={() => setMode('')}
            />
          )}

          {error && <p className="text-sm text-[#c53030]">{error}</p>}

          <Materials packId={packId} stage={stage} board={board} />
        </div>
      )}
    </section>
  )
}

function Box({ title, text, internal }: { title: string; text: string; internal?: boolean }) {
  return (
    <div className={`rounded-xl p-3 ${internal ? 'bg-[#fff6e6]' : 'bg-chip'}`}>
      <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-1">
        {title}
        {internal && ' · клиент не видит'}
      </div>
      <div className="text-[13px] text-ink-2 whitespace-pre-line">{text}</div>
    </div>
  )
}

function ActionBox({
  title,
  hint,
  value,
  onChange,
  placeholder,
  busy,
  label,
  onSubmit,
  onCancel,
  danger,
}: {
  title: string
  hint: string
  value: string
  onChange: (v: string) => void
  placeholder: string
  busy: boolean
  label: string
  onSubmit: () => void
  onCancel: () => void
  danger?: boolean
}) {
  return (
    <div className={`rounded-xl border p-3 flex flex-col gap-2 ${danger ? 'border-[#f3d9a4] bg-[#fff6e6]' : 'border-line'}`}>
      <div className="text-sm font-semibold text-ink">{title}</div>
      <p className="text-[11px] text-muted">{hint}</p>
      <textarea
        className={areaCls}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      <div className="flex gap-2">
        <button onClick={onSubmit} disabled={busy} className="btn btn-green h-8 px-3 text-sm disabled:opacity-60">
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} {label}
        </button>
        <button onClick={onCancel} className="btn btn-ghost h-8 px-3 text-sm">
          Отмена
        </button>
      </div>
    </div>
  )
}

// ——— §11: материалы этапа ———

function Materials({ packId, stage, board }: { packId: Id<'packs'>; stage: Stage; board: Board }) {
  const addMaterial = useMutation(api.packStages.addMaterial)
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState('file')
  const [side, setSide] = useState('team')
  const [required, setRequired] = useState(true)
  const [dueDate, setDueDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const save = async () => {
    setError('')
    setBusy(true)
    try {
      await addMaterial({
        stageId: stage._id,
        title,
        kind: kind as 'file',
        required,
        side: side as 'team',
        dueDate: dueDate || undefined,
      })
      setTitle('')
      setAdding(false)
    } catch (e) {
      setError(errMessage(e, 'Не удалось добавить материал.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <Paperclip size={14} className="text-green" />
        <span className="text-sm font-semibold text-ink">Материалы</span>
        <span className="chip bg-chip text-muted">{stage.materials.length}</span>
        <div className="flex-1" />
        {board.canWork && (
          <button onClick={() => setAdding((v) => !v)} className="mini-btn">
            <Plus size={12} /> Добавить
          </button>
        )}
      </div>

      {adding && (
        <div className="rounded-xl border border-line p-3 mb-3 flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              className={inputCls}
              placeholder="Название материала"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <Select
              value={kind}
              onChange={setKind}
              options={Object.entries(MATERIAL_KIND_LABEL).map(([value, label]) => ({ value, label }))}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              value={side}
              onChange={setSide}
              options={[
                { value: 'team', label: 'Готовит FRANCHONE' },
                { value: 'client', label: 'Загружает клиент (исходники)' },
              ]}
            />
            <DatePicker value={dueDate} onChange={setDueDate} placeholder="Плановый срок" />
          </div>
          <label className="flex items-center gap-2 text-sm text-ink-2 cursor-pointer">
            <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
            Обязательный — без него этап нельзя передать клиенту
          </label>
          {error && <p className="text-sm text-[#c53030]">{error}</p>}
          <div className="flex gap-2">
            <button onClick={save} disabled={busy} className="btn btn-green h-8 px-3 text-sm disabled:opacity-60">
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Добавить
            </button>
            <button onClick={() => setAdding(false)} className="btn btn-ghost h-8 px-3 text-sm">
              Отмена
            </button>
          </div>
        </div>
      )}

      {stage.materials.length === 0 ? (
        <p className="text-[12px] text-muted">
          Материалов нет. Добавьте состав упаковки — обязательные элементы контролируют передачу
          этапа.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {stage.materials.map((m) => (
            <MaterialRow key={m._id} packId={packId} material={m} board={board} />
          ))}
        </div>
      )}
    </div>
  )
}

function MaterialRow({
  packId,
  material,
  board,
}: {
  packId: Id<'packs'>
  material: Stage['materials'][number]
  board: Board
}) {
  const update = useMutation(api.packStages.updateMaterial)
  const remove = useMutation(api.packStages.removeMaterial)
  const addVersion = useMutation(api.packStages.addVersion)
  const genUrl = useMutation(api.packs.generateUploadUrl)
  const fileRef = useRef<HTMLInputElement>(null)

  const [open, setOpen] = useState(false)
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const upload = async (file: File) => {
    setBusy('file')
    setError('')
    try {
      const storageId = await uploadToStorage(() => genUrl({}), file)
      await addVersion({ materialId: material._id, kind: 'file', name: file.name, storageId })
    } catch (e) {
      setError(errMessage(e, 'Не удалось загрузить файл.'))
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="rounded-xl border border-line p-3">
      <div className="flex items-start gap-2 flex-wrap">
        <button onClick={() => setOpen((v) => !v)} className="text-muted shrink-0 mt-0.5">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-semibold text-ink">{material.title}</span>
            <MaterialChip status={material.status} />
            {material.required && <span className="chip bg-chip text-ink-2">обязательный</span>}
            {material.side === 'client' && (
              <span className="chip bg-[#e8effd] text-[#2563eb]">от клиента</span>
            )}
          </div>
          <div className="text-[11px] text-muted mt-0.5">
            {MATERIAL_KIND_LABEL[material.kind] ?? material.kind}
            {material.version > 0 ? ` · версия ${material.version}` : ' · версий нет'}
            {material.dueDate ? ` · срок ${material.dueDate}` : ''}
            {material.owner ? ` · ${material.owner.name}` : ''}
          </div>
          {/* §9.2: упаковщик видит решения и оценки заказчика. §10: своевременность
              считается по дате передачи на проверку, а не по дате приёмки. */}
          <div className="flex items-center gap-2 flex-wrap mt-1">
            {material.rating ? (
              <span className="chip bg-[#fff6e6] text-[#b7791f]">
                <Star size={11} /> {material.rating} из 5
              </span>
            ) : null}
            {material.readyAt && (
              <span
                className={`chip ${
                  material.readyOnTime === false
                    ? 'bg-[#fdeaea] text-[#c53030]'
                    : 'bg-[#e2f2ef] text-green-d'
                }`}
              >
                передан {dateTime(material.readyAt)}
                {material.readyOnTime === false ? ' · с опозданием' : ' · в срок'}
              </span>
            )}
            {material.decidedAt && (
              <span className="chip bg-chip text-muted">
                решение {dateTime(material.decidedAt)}
              </span>
            )}
          </div>
        </div>
        {board.canWork && (
          <div className="shrink-0">
            <Select
              variant="ghost"
              align="right"
              value={material.status}
              onChange={(v) => void update({ id: material._id, status: v as 'ready' })}
              // §5.2: «Принят» и «На доработке» ставит заказчик — их здесь нет.
              options={PACKER_MATERIAL_STATUSES.map((value) => ({
                value,
                label: MATERIAL_STATUS[value].label,
              }))}
            />
          </div>
        )}
      </div>

      {open && (
        <div className="mt-3 pt-3 border-t border-line flex flex-col gap-3">
          {material.description && (
            <div className="text-[12px] text-ink-2">{material.description}</div>
          )}

          {/* §11.2: история версий */}
          <div>
            <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-1.5">
              История версий
            </div>
            {material.versions.length === 0 ? (
              <p className="text-[12px] text-muted">Версий ещё нет.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {material.versions.map((v) => (
                  <div key={v._id} className="flex items-center gap-2 flex-wrap text-[12px]">
                    <span className="chip bg-chip text-ink-2">v{v.version}</span>
                    <AttachmentLink kind={v.kind} name={v.name} url={v.url} />
                    <span className="text-muted-2">
                      {dateTime(v.at)} · {v.by?.name ?? '—'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {board.canWork && material.side === 'team' && (
            <div className="flex items-center gap-2 flex-wrap">
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void upload(f)
                  e.target.value = ''
                }}
              />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={busy === 'file'}
                className="mini-btn"
              >
                {busy === 'file' ? <Loader2 size={12} className="animate-spin" /> : <FileUp size={12} />}
                Загрузить файл
              </button>
              <input
                className={`${inputCls} h-8 w-full sm:w-56`}
                placeholder="или вставьте ссылку"
                value={link}
                onChange={(e) => setLink(e.target.value)}
              />
              <button
                onClick={async () => {
                  if (!link.trim()) return
                  setBusy('link')
                  setError('')
                  try {
                    await addVersion({
                      materialId: material._id,
                      kind: 'link',
                      name: link.trim(),
                      url: link.trim(),
                    })
                    setLink('')
                  } catch (e) {
                    setError(errMessage(e, 'Не удалось добавить ссылку.'))
                  } finally {
                    setBusy('')
                  }
                }}
                disabled={busy === 'link' || !link.trim()}
                className="mini-btn disabled:opacity-50"
              >
                {busy === 'link' ? <Loader2 size={12} className="animate-spin" /> : <Link2 size={12} />}
                Добавить
              </button>
              {board.canManage && (
                <button
                  onClick={() => void remove({ id: material._id })}
                  className="mini-btn text-[#c53030]"
                >
                  <Trash2 size={12} /> Удалить материал
                </button>
              )}
            </div>
          )}
          {error && <p className="text-sm text-[#c53030]">{error}</p>}

          {material.comments.length > 0 && (
            <div>
              <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-1.5">
                Комментарии к материалу
              </div>
              <CommentList comments={material.comments} packId={packId} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ——— §11.3: комментарии к материалу ———
//
// Отдельного блока заметок у этапа больше нет: обсуждение правок идёт во
// внешних каналах (§16), а всё, что нужно сказать по делу, пишется прямо
// под материалом.

function CommentList({
  comments,
  packId,
}: {
  comments: Stage['comments']
  packId: Id<'packs'>
}) {
  const resolve = useMutation(api.packStages.resolveComment)
  void packId
  if (comments.length === 0) {
    return <p className="text-[12px] text-muted">Комментариев пока нет.</p>
  }
  return (
    <div className="flex flex-col gap-2">
      {comments.map((c) => (
        <div
          key={c._id}
          className={`rounded-xl p-3 ${c.scope === 'internal' ? 'bg-[#fff6e6]' : 'bg-chip'}`}
        >
          <div className="flex items-center gap-2 flex-wrap">
            {c.author && <Avatar initials={c.author.initials} color={c.author.avatarColor} size={20} />}
            <span className="text-[12px] font-semibold text-ink">{c.author?.name ?? '—'}</span>
            <span className="text-[11px] text-muted-2">{dateTime(c.at)}</span>
            {c.scope === 'internal' && (
              <span className="chip bg-white text-[#b7791f]">внутренний</span>
            )}
            {c.resolved && (
              <span className="chip bg-[#e2f2ef] text-green-d">
                <Check size={11} /> решено
              </span>
            )}
            <div className="flex-1" />
            <button
              onClick={() => void resolve({ id: c._id, resolved: !c.resolved })}
              className="text-[11px] text-muted hover:text-ink-2"
            >
              {c.resolved ? 'вернуть в работу' : 'отметить решённым'}
            </button>
          </div>
          <div className="text-[13px] text-ink-2 mt-1.5 whitespace-pre-line">{c.text}</div>
          {c.attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {c.attachments.map((a, i) => (
                <AttachmentLink key={i} kind={a.kind} name={a.name} url={a.url} />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
