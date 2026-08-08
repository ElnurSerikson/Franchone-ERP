// §10.2: карта этапов в кабинете клиента и действия по §10.3.
//
// Клиент видит нулевой этап и основные с названиями, описаниями, весами,
// статусами, сроками и доступными материалами. Закрытые этапы доступны для
// просмотра, но не для изменения. Внутренние комментарии команды сюда не
// приходят (BR-12) — их просто нет в ответе сервера.

import { useRef, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import {
  Check, ChevronDown, ChevronRight, Clock, FileUp, Link2, Loader2, Paperclip, Star, Undo2,
} from 'lucide-react'
import { api } from '../../../convex/_generated/api'
import { errMessage } from '@/lib/errors'
import { uploadToStorage } from '@/lib/packUpload'
import { MATERIAL_KIND_LABEL } from '../../../convex/packModel'
import {
  AttachmentLink, Deadline, MaterialChip, StageChip, dateTime, inputCls,
} from '@/components/packs/ui'
import { useClientPack } from './ClientApp'

export default function ClientStages() {
  const packId = useClientPack()
  const data = useQuery(api.packClient.stages, packId ? { packId } : 'skip')
  const [open, setOpen] = useState<string | null>(null)

  if (!packId || data === undefined) {
    return (
      <div className="card p-10 grid place-items-center text-muted">
        <Loader2 className="animate-spin" size={20} />
      </div>
    )
  }
  if (!data) return null

  return (
    <>
      <h1 className="text-xl font-bold text-ink mb-1">Документы по этапам</h1>
      <p className="text-sm text-muted mb-5">
        Откройте документ, при желании поставьте оценку и выберите: принять или вернуть на
        доработку. Правки обсуждаем в привычном канале — комментарий здесь не нужен. Этап
        считается принятым, когда приняты все его обязательные документы.
      </p>

      <div className="flex flex-col gap-3">
        {data.stages.map((s) => (
          <StageCard
            key={s._id}
            stage={s}
            now={data.now}
            open={open === (s._id as string)}
            onToggle={() => setOpen(open === (s._id as string) ? null : (s._id as string))}
          />
        ))}
      </div>
    </>
  )
}

type Data = NonNullable<ReturnType<typeof useQuery<typeof api.packClient.stages>>>
type Stage = Data['stages'][number]

function StageCard({
  stage,
  now,
  open,
  onToggle,
}: {
  stage: Stage
  now: number
  open: boolean
  onToggle: () => void
}) {
  return (
    <section className="card overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full text-left px-5 py-4 flex items-start gap-3 hover:bg-chip/40 transition-colors"
      >
        <span className="mt-0.5 text-muted shrink-0">
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 flex-wrap">
            <span className="text-[15px] font-semibold text-ink">{stage.title}</span>
            <StageChip status={stage.status} />
            {stage.kind === 'zero' && (
              <span className="chip bg-chip text-muted">подготовительный</span>
            )}
            <span className="chip bg-chip text-ink-2">{stage.weight}% готовности</span>
            {stage.canAct && (
              <span className="chip bg-[#e8effd] text-[#2563eb]">нужен ваш ответ</span>
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
                <Clock size={12} /> <Deadline at={stage.dueAt} now={now} />
              </span>
            )}
            {stage.approvedAt && (
              <span className="text-green-d">утверждён {dateTime(stage.approvedAt)}</span>
            )}
          </span>
        </span>
      </button>

      {open && (
        <div className="px-5 pb-5 border-t border-line pt-4 flex flex-col gap-4">
          {stage.note && (
            <div className="rounded-xl bg-chip p-3 text-[13px] text-ink-2 whitespace-pre-line">
              {stage.note}
            </div>
          )}
          {stage.doneCondition && (
            <div className="text-[12px] text-muted">
              Условия завершения: {stage.doneCondition}
            </div>
          )}

          {stage.canAct && (
            <div className="rounded-xl border border-[#cddcf9] bg-[#f5f8ff] p-3 text-[12px] text-ink-2">
              Этап ждёт вашего решения. Примите или верните на доработку каждый обязательный
              документ ниже — как только приняты все, этап закрывается, а часть пазла открывается
              (при условии, что вы успели в срок).
            </div>
          )}

          {/* Материалы этапа */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Paperclip size={14} className="text-green" />
              <span className="text-sm font-semibold text-ink">Материалы</span>
              <span className="chip bg-chip text-muted">{stage.materials.length}</span>
            </div>
            {stage.materials.length === 0 ? (
              <p className="text-[12px] text-muted">
                Материалы появятся, когда команда передаст этап на проверку.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {stage.materials.map((m) => (
                  <MaterialRow key={m._id} material={m} />
                ))}
              </div>
            )}
          </div>

        </div>
      )}
    </section>
  )
}

function MaterialRow({ material }: { material: Stage['materials'][number] }) {
  const upload = useMutation(api.packClient.uploadVersion)
  const genUrl = useMutation(api.packClient.generateUploadUrl)
  const fileRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

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
            {material.side === 'client' && (
              <span className="chip bg-[#e8effd] text-[#2563eb]">загружаете вы</span>
            )}
            {material.required && <span className="chip bg-chip text-ink-2">обязательный</span>}
          </div>
          <div className="text-[11px] text-muted mt-0.5">
            {MATERIAL_KIND_LABEL[material.kind] ?? material.kind}
            {material.version > 0 ? ` · версия ${material.version}` : ' · пока не загружен'}
            {material.dueDate ? ` · до ${material.dueDate}` : ''}
          </div>
        </div>
        {material.versions[0] && (
          <AttachmentLink
            kind={material.versions[0].kind}
            name={material.versions[0].name}
            url={material.versions[0].url}
          />
        )}
      </div>

      {open && (
        <div className="mt-3 pt-3 border-t border-line flex flex-col gap-3">
          {material.description && (
            <div className="text-[12px] text-ink-2">{material.description}</div>
          )}

          {/* §6.3: оценка от 1 до 5 звёзд. Не заменяет «Принять». */}
          {material.canRate && <Stars material={material} />}

          {/* §6.2: два решения. Обязательный комментарий не требуется. */}
          {material.canDecide && <Decision material={material} />}

          <div>
            <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-1.5">
              История версий
            </div>
            {material.versions.length === 0 ? (
              <p className="text-[12px] text-muted">Версий пока нет.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {material.versions.map((v) => (
                  <div key={v._id} className="flex items-center gap-2 flex-wrap text-[12px]">
                    <span className="chip bg-chip text-ink-2">v{v.version}</span>
                    <AttachmentLink kind={v.kind} name={v.name} url={v.url} />
                    <span className="text-muted-2">
                      {dateTime(v.at)} · {v.by?.name ?? 'FRANCHONE'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* §3: клиент грузит свои исходники */}
          {material.side === 'client' && (
            <div className="flex items-center gap-2 flex-wrap">
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (!f) return
                  setBusy('file')
                  setError('')
                  try {
                    const storageId = await uploadToStorage(() => genUrl({}), f)
                    await upload({ materialId: material._id, kind: 'file', name: f.name, storageId })
                  } catch (err) {
                    setError(errMessage(err, 'Не удалось загрузить файл.'))
                  } finally {
                    setBusy('')
                  }
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
                    await upload({
                      materialId: material._id,
                      kind: 'link',
                      name: link.trim(),
                      url: link.trim(),
                    })
                    setLink('')
                  } catch (err) {
                    setError(errMessage(err, 'Не удалось добавить ссылку.'))
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
            </div>
          )}
          {error && <p className="text-sm text-[#c53030]">{error}</p>}

        </div>
      )}
    </div>
  )
}

// §6.3: оценка заказчика от 1 до 5 звёзд. На статус не влияет и «Принять»
// не заменяет — нужна упаковщику, администратору и сводной аналитике.
function Stars({ material }: { material: Stage['materials'][number] }) {
  const rate = useMutation(api.packClient.rateMaterial)
  const [busy, setBusy] = useState(0)
  const value = material.rating ?? 0
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[12px] text-muted">Ваша оценка:</span>
      <div className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            onClick={async () => {
              setBusy(n)
              try {
                await rate({ materialId: material._id, rating: n })
              } finally {
                setBusy(0)
              }
            }}
            disabled={busy > 0}
            aria-label={`Оценка ${n}`}
            className="p-0.5 disabled:opacity-60"
          >
            <Star
              size={18}
              className={n <= value ? 'text-[#d69e2e]' : 'text-muted-2'}
              fill={n <= value ? '#d69e2e' : 'none'}
            />
          </button>
        ))}
      </div>
      {value > 0 && <span className="text-[11px] text-muted-2">{value} из 5</span>}
    </div>
  )
}

// §6.2: «Принять» и «На доработку». Комментарий не требуется — содержание
// правок стороны обсуждают вне ERP (§1.2, §16).
function Decision({ material }: { material: Stage['materials'][number] }) {
  const accept = useMutation(api.packClient.acceptMaterial)
  const back = useMutation(api.packClient.returnMaterial)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const act = async (name: string, fn: () => Promise<unknown>) => {
    setBusy(name)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError(errMessage(e, 'Не удалось сохранить решение.'))
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="rounded-xl border border-[#cddcf9] bg-[#f5f8ff] p-3 flex flex-col gap-2">
      <div className="text-[12px] text-ink-2">
        Документ ждёт вашего решения.
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => act('accept', () => accept({ materialId: material._id }))}
          disabled={!!busy}
          className="btn btn-green h-9 px-3 text-sm disabled:opacity-60"
        >
          {busy === 'accept' ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          Принять
        </button>
        <button
          onClick={() => act('back', () => back({ materialId: material._id }))}
          disabled={!!busy}
          className="btn btn-ghost h-9 px-3 text-sm disabled:opacity-60"
        >
          {busy === 'back' ? <Loader2 size={14} className="animate-spin" /> : <Undo2 size={14} />}
          На доработку
        </button>
      </div>
      {error && <p className="text-sm text-[#c53030]">{error}</p>}
    </div>
  )
}
