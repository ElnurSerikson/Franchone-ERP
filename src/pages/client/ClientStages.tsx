// §10.2: карта этапов в кабинете клиента и действия по §10.3.
//
// Экран отвечает на один вопрос: что от меня требуется прямо сейчас. Поэтому
// на виду только название этапа, его состояние одним словом и документы с
// кнопками решения. Веса, плановые даты, номера версий и типы файлов — это
// внутренняя кухня производства; клиенту она не помогает решать и только
// мешает найти то, что ждёт ответа.

import { useRef, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import {
  Check, ChevronDown, ChevronRight, FileUp, Link2, Loader2, Star, Undo2,
} from 'lucide-react'
import { api } from '../../../convex/_generated/api'
import { errMessage } from '@/lib/errors'
import { uploadToStorage } from '@/lib/packUpload'
import {
  AttachmentLink, Deadline, MaterialChip, StageChip, dateTime, inputCls,
} from '@/components/packs/ui'
import { useClientPack } from './ClientApp'

export default function ClientStages() {
  const packId = useClientPack()
  const data = useQuery(api.packClient.stages, packId ? { packId } : 'skip')
  // undefined — список ещё не трогали руками: тогда сам собой раскрыт этап,
  // который ждёт ответа. Человек попадает сразу на дело, а не на список.
  const [picked, setPicked] = useState<string | null | undefined>(undefined)

  if (!packId || data === undefined) {
    return (
      <div className="card p-10 grid place-items-center text-muted">
        <Loader2 className="animate-spin" size={20} />
      </div>
    )
  }
  if (!data) return null

  const auto = (data.stages.find((s) => s.canAct)?._id as string | undefined) ?? null
  const open = picked === undefined ? auto : picked

  return (
    <>
      <h1 className="text-3xl font-extrabold title-gradient mb-1 rise">Документы</h1>
      <p className="text-[15px] text-muted mb-5 rise d1">
        Откройте документ и решите: принять или вернуть на доработку. Правки обсуждаем в
        привычном канале.
      </p>

      <div className="flex flex-col gap-3">
        {data.stages.map((s, i) => (
          <StageCard
            key={s._id}
            stage={s}
            index={i}
            now={data.now}
            open={open === (s._id as string)}
            onToggle={() => setPicked(open === (s._id as string) ? null : (s._id as string))}
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
  index,
  now,
  open,
  onToggle,
}: {
  stage: Stage
  index: number
  now: number
  open: boolean
  onToggle: () => void
}) {
  const approved = stage.status === 'approved'
  const locked = stage.status === 'locked'

  return (
    <section
      className={`card overflow-hidden rise ${['d1', 'd2', 'd3', 'd4', 'd5'][Math.min(index, 4)]} ${
        // Этап, который ждёт ответа, подсвечен: до него глаз должен дойти
        // первым, даже если список длинный.
        stage.canAct ? 'ring-2 ring-[#cddcf9] bg-gradient-to-br from-[#f7faff] to-white' : ''
      } ${locked ? 'opacity-70' : ''}`}
    >
      <button
        onClick={onToggle}
        className="w-full text-left px-5 py-4 flex items-center gap-3 hover:bg-chip/40 transition-colors"
      >
        <span className="text-muted-2 shrink-0">
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 flex-wrap">
            <span className={`text-[15px] font-semibold ${locked ? 'text-muted' : 'text-ink'}`}>
              {stage.title}
            </span>
            {/* Одно состояние на этап, а не три чипа рядом: принятому хватает
                галочки, заблокированному — приглушённого названия. */}
            {stage.canAct ? (
              <span className="chip bg-[#e8effd] text-[#2563eb]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#2563eb] dot-pulse" />
                нужен ваш ответ
              </span>
            ) : approved ? (
              <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-green-d">
                <Check size={14} /> принят
              </span>
            ) : locked ? null : (
              <StageChip status={stage.status} />
            )}
          </span>
          {/* Срок показываем только там, где он про клиента. */}
          {stage.canAct && stage.dueAt && (
            <span className="block text-[13px] mt-1">
              <Deadline at={stage.dueAt} now={now} />
            </span>
          )}
        </span>
      </button>

      {open && (
        <div className="px-5 pb-5 border-t border-line pt-4 flex flex-col gap-3">
          {stage.note && (
            <p className="text-[15px] text-ink-2 whitespace-pre-line">{stage.note}</p>
          )}
          {stage.materials.length === 0 ? (
            <p className="text-[13px] text-muted">
              Документы появятся, когда команда передаст этап на проверку.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {stage.materials.map((m) => (
                <MaterialRow key={m._id} material={m} />
              ))}
            </div>
          )}
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

  const mine = material.side === 'client'
  // Прошлые версии прячем: пока она одна, показывать «историю» не из чего.
  const history = material.versions.slice(1)
  const more = history.length > 0 || !!material.description

  return (
    <div
      className={`rounded-xl border p-3 transition-colors ${
        material.canDecide ? 'border-[#cddcf9] bg-[#f7faff]' : 'border-line'
      }`}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[15px] font-semibold text-ink min-w-0 flex-1">{material.title}</span>
        <MaterialChip status={material.status} />
        {mine && <span className="chip bg-[#e8effd] text-[#2563eb]">загружаете вы</span>}
      </div>

      {/* Файл — отдельной строкой: имена бывают в полсотни символов и в одной
          строке с названием перетягивают на себя весь документ. */}
      {material.versions[0] && (
        <div className="mt-2 flex">
          <AttachmentLink
            kind={material.versions[0].kind}
            name={material.versions[0].name}
            url={material.versions[0].url}
          />
        </div>
      )}

      {/* Решение — сразу в строке, а не под раскрытием: это главное действие
          экрана, ради него сюда и заходят. */}
      {(material.canDecide || material.canRate) && (
        <div className="mt-3 pt-3 border-t border-line flex flex-col gap-2.5">
          {material.canDecide && <Decision material={material} />}
          {material.canRate && <Stars material={material} />}
        </div>
      )}

      {mine && (
        <div className="mt-3 pt-3 border-t border-line flex items-center gap-2 flex-wrap">
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
            className={`${inputCls} h-9 w-full sm:w-56`}
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
      {error && <p className="text-[13px] text-[#c53030] mt-2">{error}</p>}

      {more && (
        <>
          <button
            onClick={() => setOpen((v) => !v)}
            className="mt-2 inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink-2"
          >
            {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            {open ? 'Свернуть' : 'Подробнее'}
          </button>
          {open && (
            <div className="mt-2 flex flex-col gap-2">
              {material.description && (
                <p className="text-[13px] text-ink-2">{material.description}</p>
              )}
              {history.map((v) => (
                <div key={v._id} className="flex items-center gap-2 flex-wrap text-[13px]">
                  <span className="chip bg-chip text-ink-2">v{v.version}</span>
                  <AttachmentLink kind={v.kind} name={v.name} url={v.url} />
                  <span className="text-muted-2">{dateTime(v.at)}</span>
                </div>
              ))}
            </div>
          )}
        </>
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
    <div className="flex items-center gap-2">
      <span className="text-[13px] text-muted">Оценка</span>
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
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => act('accept', () => accept({ materialId: material._id }))}
          disabled={!!busy}
          className="btn h-10 px-4 text-[15px] text-white bg-gradient-to-r from-green-2 to-green-d shadow-[0_8px_18px_-8px_rgba(4,79,72,0.9)] hover:opacity-95 disabled:opacity-60"
        >
          {busy === 'accept' ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          Принять
        </button>
        <button
          onClick={() => act('back', () => back({ materialId: material._id }))}
          disabled={!!busy}
          className="btn btn-ghost h-9 px-3 text-[15px] disabled:opacity-60"
        >
          {busy === 'back' ? <Loader2 size={14} className="animate-spin" /> : <Undo2 size={14} />}
          На доработку
        </button>
      </div>
      {error && <p className="text-[13px] text-[#c53030]">{error}</p>}
    </div>
  )
}
