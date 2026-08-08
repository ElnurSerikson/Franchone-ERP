// §13.2 и §13.3: контент и постпроектные сценарии.
//
// §1.2 ограничивает первую итерацию: конкретные темы тестов, содержание
// видеороликов, тексты статей и точные цепочки определяются позднее. Здесь —
// именно возможность создать, опубликовать, назначить и отключить.

import { useRef, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import {
  BookOpen, Check, ImageIcon, Loader2, Pencil, Play, Plus, Power, Trash2, Workflow, X,
} from 'lucide-react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import Select from '@/components/ui/Select'
import ConfirmDialog from '@/components/ConfirmDialog'
import { errMessage } from '@/lib/errors'
import { uploadToStorage } from '@/lib/packUpload'
import {
  CONTENT_AVAILABILITY_LABEL,
  CONTENT_KIND_LABEL,
  SCENARIO_ACTION_LABEL,
  SCENARIO_TRIGGER_LABEL,
} from '../../../convex/packModel'
import { Empty, Field, areaCls, inputCls, dateTime, tabStrip } from './ui'

export default function PackLibrary() {
  const [tab, setTab] = useState<'content' | 'scenarios'>('content')
  return (
    <>
      <div className={`${tabStrip} mb-4`}>
        <button
          onClick={() => setTab('content')}
          className={`chip ${tab === 'content' ? 'bg-green text-white' : 'bg-chip text-muted'}`}
        >
          <BookOpen size={12} /> Контент и обучение
        </button>
        <button
          onClick={() => setTab('scenarios')}
          className={`chip ${tab === 'scenarios' ? 'bg-green text-white' : 'bg-chip text-muted'}`}
        >
          <Workflow size={12} /> Постпроектные сценарии
        </button>
      </div>
      {tab === 'content' ? <ContentTab /> : <ScenariosTab />}
    </>
  )
}

// ——— §13.3: контентный функционал ———

function ContentTab() {
  const rows = useQuery(api.packExtras.contentList)
  const packs = useQuery(api.packs.list, {})
  const create = useMutation(api.packExtras.createContent)
  const update = useMutation(api.packExtras.updateContent)
  const remove = useMutation(api.packExtras.removeContent)

  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState('article')
  const [body, setBody] = useState('')
  const [url, setUrl] = useState('')
  const [availability, setAvailability] = useState('always')
  const [afterStage, setAfterStage] = useState('1')
  const [packIds, setPackIds] = useState<string[]>([])
  // §8.1: краткое описание, обложка и вопросы теста.
  const [summary, setSummary] = useState('')
  const [coverId, setCoverId] = useState<Id<'_storage'> | null>(null)
  const [coverName, setCoverName] = useState('')
  const [questions, setQuestions] = useState<Question[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState<{ id: Id<'packContent'>; title: string } | null>(null)

  if (rows === undefined) {
    return (
      <div className="card p-10 grid place-items-center text-muted">
        <Loader2 className="animate-spin" size={20} />
      </div>
    )
  }

  const save = async () => {
    setError('')
    setBusy(true)
    try {
      await create({
        title,
        kind: kind as 'article',
        body: body || undefined,
        url: url || undefined,
        summary: summary || undefined,
        coverId: coverId ?? undefined,
        questions: kind === 'test' ? questions : undefined,
        availability: availability as 'always',
        afterStageOrder: Number(afterStage) || 1,
        packIds: packIds as Id<'packs'>[],
      })
      setOpen(false)
      setTitle('')
      setBody('')
      setUrl('')
      setSummary('')
      setCoverId(null)
      setCoverName('')
      setQuestions([])
      setPackIds([])
    } catch (e) {
      setError(errMessage(e, 'Не удалось сохранить материал.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <h3 className="sec-title">Материалы для клиентов</h3>
        <span className="chip bg-chip text-muted">{rows.length}</span>
        <div className="flex-1" />
        <button onClick={() => setOpen((v) => !v)} className="btn btn-green h-9 px-3 text-sm">
          {open ? <X size={15} /> : <Plus size={15} />} {open ? 'Свернуть' : 'Добавить материал'}
        </button>
      </div>

      {open && (
        <section className="card p-5 mb-4 flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Название">
              <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Как продавать франшизу" />
            </Field>
            <Field label="Тип">
              <Select
                value={kind}
                onChange={setKind}
                options={Object.entries(CONTENT_KIND_LABEL).map(([value, label]) => ({ value, label }))}
              />
            </Field>
          </div>
          {/* §8: видео — ссылка YouTube, ролик проигрывается внутри ERP. */}
          {kind === 'video' && (
            <Field label="Ссылка YouTube" hint="Ролик встроится в кабинет — переходить на сайт не нужно.">
              <input className={inputCls} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://youtu.be/..." />
            </Field>
          )}
          <Field label="Краткое описание">
            <input className={inputCls} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Одна строка для карточки" />
          </Field>
          {/* §8: статья читается внутри ERP. */}
          {kind !== 'video' && (
            <Field label="Текст материала" hint="Показывается в кабинете как есть, без перехода на внешний сайт.">
              <textarea className={`${areaCls} min-h-[140px]`} value={body} onChange={(e) => setBody(e.target.value)} />
            </Field>
          )}
          {/* §8.1: обложка с предпросмотром, заменой и удалением до публикации. */}
          <ImagePick
            label="Обложка"
            storageId={coverId}
            name={coverName}
            onPick={(id, n) => {
              setCoverId(id)
              setCoverName(n)
            }}
            onClear={() => {
              setCoverId(null)
              setCoverName('')
            }}
          />
          {kind === 'test' && <TestBuilder questions={questions} onChange={setQuestions} />}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Когда доступен">
              <Select
                value={availability}
                onChange={setAvailability}
                options={Object.entries(CONTENT_AVAILABILITY_LABEL).map(([value, label]) => ({ value, label }))}
              />
            </Field>
            {availability === 'after_stage' && (
              <Field label="После этапа №">
                <input
                  className={inputCls}
                  type="number"
                  min={0}
                  value={afterStage}
                  onChange={(e) => setAfterStage(e.target.value)}
                />
              </Field>
            )}
          </div>
          <div>
            <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-1.5">
              Кому назначен
            </div>
            <p className="text-[11px] text-muted-2 mb-2">
              Ничего не выбрано — материал виден всем клиентам.
            </p>
            <div className="flex flex-wrap gap-2">
              {(packs?.rows ?? []).map((p) => {
                const on = packIds.includes(p._id as string)
                return (
                  <button
                    key={p._id}
                    type="button"
                    onClick={() =>
                      setPackIds((prev) =>
                        prev.includes(p._id as string)
                          ? prev.filter((x) => x !== (p._id as string))
                          : [...prev, p._id as string],
                      )
                    }
                    className={`chip transition-colors ${
                      on ? 'bg-[#e2f2ef] text-green-d' : 'bg-chip text-muted hover:text-ink-2'
                    }`}
                  >
                    {p.title}
                    {on && <Check size={11} />}
                  </button>
                )
              })}
            </div>
          </div>
          {error && <p className="text-sm text-[#c53030]">{error}</p>}
          <div>
            <button onClick={save} disabled={busy} className="btn btn-green disabled:opacity-60">
              {busy && <Loader2 size={15} className="animate-spin" />} Опубликовать
            </button>
          </div>
        </section>
      )}

      {rows.length === 0 ? (
        <Empty
          icon={BookOpen}
          title="Материалов ещё нет"
          text="Статьи, видео, тесты, инструкции, чек-листы, шаблоны и предложения появятся в кабинете клиента."
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map((c) => (
            <div key={c._id} className="card p-4">
              <div className="flex items-start gap-2 flex-wrap">
                <span className="text-sm font-semibold text-ink flex-1">{c.title}</span>
                <span className="chip bg-chip text-muted">{CONTENT_KIND_LABEL[c.kind] ?? c.kind}</span>
                {c.published ? (
                  <span className="chip bg-[#e2f2ef] text-green-d">Опубликован</span>
                ) : (
                  <span className="chip bg-chip text-muted">Отключён</span>
                )}
              </div>
              <div className="text-[11px] text-muted mt-1">
                {CONTENT_AVAILABILITY_LABEL[c.availability]}
                {c.availability === 'after_stage' ? ` №${c.afterStageOrder}` : ''} ·{' '}
                {c.packTitles.length ? c.packTitles.join(', ') : 'всем клиентам'}
              </div>
              {c.body && <p className="text-[13px] text-ink-2 mt-2 line-clamp-3">{c.body}</p>}
              {c.url && (
                <a href={c.url} target="_blank" rel="noreferrer" className="text-[12px] text-green-d underline mt-2 inline-block">
                  {c.url}
                </a>
              )}
              <div className="mt-3 pt-3 border-t border-line flex items-center gap-2">
                <button
                  onClick={() => void update({ id: c._id, published: !c.published })}
                  className="mini-btn"
                >
                  <Power size={12} /> {c.published ? 'Отключить' : 'Включить'}
                </button>
                <button
                  onClick={() => setConfirm({ id: c._id, title: c.title })}
                  className="mini-btn text-[#c53030]"
                >
                  <Trash2 size={12} /> Удалить
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {confirm && (
        <ConfirmDialog
          title="Удалить материал?"
          description={`«${confirm.title}» исчезнет из кабинетов клиентов.`}
          confirmLabel="Удалить"
          danger
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            await remove({ id: confirm.id })
            setConfirm(null)
          }}
        />
      )}
    </>
  )
}

// ——— §13.2: постпроектные сценарии ———

function ScenariosTab() {
  const rows = useQuery(api.packExtras.scenarios)
  const content = useQuery(api.packExtras.contentList)
  const packs = useQuery(api.packs.list, {})
  const create = useMutation(api.packExtras.createScenario)
  const update = useMutation(api.packExtras.updateScenario)
  const remove = useMutation(api.packExtras.removeScenario)
  const trigger = useMutation(api.packExtras.triggerScenario)

  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [triggerKind, setTriggerKind] = useState('days_after_finish')
  const [days, setDays] = useState('14')
  const [action, setAction] = useState('notify')
  const [contentId, setContentId] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [runFor, setRunFor] = useState<{ id: Id<'packScenarios'>; title: string } | null>(null)

  if (rows === undefined) {
    return (
      <div className="card p-10 grid place-items-center text-muted">
        <Loader2 className="animate-spin" size={20} />
      </div>
    )
  }

  const save = async () => {
    setError('')
    setBusy(true)
    try {
      await create({
        title,
        trigger: triggerKind as 'days_after_finish',
        triggerDays: Number(days) || undefined,
        action: action as 'notify',
        contentId: contentId ? (contentId as Id<'packContent'>) : undefined,
        message: message || undefined,
      })
      setOpen(false)
      setTitle('')
      setMessage('')
      setContentId('')
    } catch (e) {
      setError(errMessage(e, 'Не удалось сохранить сценарий.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <h3 className="sec-title">Сценарии после завершения проекта</h3>
        <span className="chip bg-chip text-muted">{rows.length}</span>
        <div className="flex-1" />
        <button onClick={() => setOpen((v) => !v)} className="btn btn-green h-9 px-3 text-sm">
          {open ? <X size={15} /> : <Plus size={15} />} {open ? 'Свернуть' : 'Новый сценарий'}
        </button>
      </div>

      {open && (
        <section className="card p-5 mb-4 flex flex-col gap-4">
          <Field label="Название сценария">
            <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Через две недели — предложение сопровождения" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Когда запускать">
              <Select
                value={triggerKind}
                onChange={setTriggerKind}
                options={Object.entries(SCENARIO_TRIGGER_LABEL).map(([value, label]) => ({ value, label }))}
              />
            </Field>
            {(triggerKind === 'days_after_finish' || triggerKind === 'no_activity') && (
              <Field label="Через сколько дней">
                <input className={inputCls} type="number" min={1} value={days} onChange={(e) => setDays(e.target.value)} />
              </Field>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Что сделать">
              <Select
                value={action}
                onChange={setAction}
                options={Object.entries(SCENARIO_ACTION_LABEL).map(([value, label]) => ({ value, label }))}
              />
            </Field>
            <Field label="Материал">
              <Select
                value={contentId}
                onChange={setContentId}
                options={[
                  { value: '', label: 'Без материала' },
                  ...(content ?? []).map((c) => ({ value: c._id as string, label: c.title })),
                ]}
              />
            </Field>
          </div>
          <Field label="Сообщение клиенту">
            <textarea className={areaCls} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Текст уведомления" />
          </Field>
          {error && <p className="text-sm text-[#c53030]">{error}</p>}
          <div>
            <button onClick={save} disabled={busy} className="btn btn-green disabled:opacity-60">
              {busy && <Loader2 size={15} className="animate-spin" />} Создать сценарий
            </button>
          </div>
          <p className="text-[11px] text-muted-2">
            Автоматические сценарии («через N дней», «нет активности») проверяются раз в сутки.
            Остальные запускаются вручную по кнопке.
          </p>
        </section>
      )}

      {rows.length === 0 ? (
        <Empty
          icon={Workflow}
          title="Сценариев нет"
          text="Настройте, что происходит после завершения проекта: напоминание, материал, тест, приглашение или предложение услуги."
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map((s) => (
            <div key={s._id} className="card p-4">
              <div className="flex items-start gap-2 flex-wrap">
                <span className="text-sm font-semibold text-ink flex-1">{s.title}</span>
                {s.active ? (
                  <span className="chip bg-[#e2f2ef] text-green-d">Активен</span>
                ) : (
                  <span className="chip bg-chip text-muted">Остановлен</span>
                )}
              </div>
              <div className="text-[11px] text-muted mt-1">
                {SCENARIO_TRIGGER_LABEL[s.trigger]}
                {s.triggerDays ? ` · ${s.triggerDays} дн.` : ''} → {SCENARIO_ACTION_LABEL[s.action]}
                {s.contentTitle ? ` · ${s.contentTitle}` : ''}
              </div>
              {s.message && <p className="text-[13px] text-ink-2 mt-2">{s.message}</p>}
              <div className="text-[11px] text-muted-2 mt-2">
                Отправок: {s.runs}
                {s.lastRunAt ? ` · последняя ${dateTime(s.lastRunAt)}` : ''}
              </div>
              <div className="mt-3 pt-3 border-t border-line flex items-center gap-2 flex-wrap">
                <button onClick={() => void update({ id: s._id, active: !s.active })} className="mini-btn">
                  <Power size={12} /> {s.active ? 'Остановить' : 'Запустить'}
                </button>
                <button onClick={() => setRunFor({ id: s._id, title: s.title })} className="mini-btn">
                  <Play size={12} /> Отправить вручную
                </button>
                <button onClick={() => void remove({ id: s._id })} className="mini-btn text-[#c53030]">
                  <Trash2 size={12} /> Удалить
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {runFor && (
        <ManualRun
          title={runFor.title}
          packs={(packs?.rows ?? []).map((p) => ({ _id: p._id as string, title: p.title }))}
          onClose={() => setRunFor(null)}
          onRun={async (packId) => {
            await trigger({ id: runFor.id, packId: packId as Id<'packs'> })
            setRunFor(null)
          }}
        />
      )}
    </>
  )
}

function ManualRun({
  title,
  packs,
  onClose,
  onRun,
}: {
  title: string
  packs: { _id: string; title: string }[]
  onClose: () => void
  onRun: (packId: string) => Promise<void>
}) {
  const [packId, setPackId] = useState(packs[0]?._id ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center p-4">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative card p-5 w-full max-w-md">
        <div className="flex items-center gap-2 mb-3">
          <Pencil size={15} className="text-green" />
          <h3 className="sec-title flex-1">Отправить сценарий</h3>
          <button onClick={onClose} className="ico-btn w-8 h-8">
            <X size={14} />
          </button>
        </div>
        <p className="text-sm text-muted mb-3">«{title}» — выберите проект.</p>
        <Select
          value={packId}
          onChange={setPackId}
          options={packs.map((p) => ({ value: p._id, label: p.title }))}
        />
        {error && <p className="text-sm text-[#c53030] mt-3">{error}</p>}
        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="btn btn-ghost flex-1">
            Отмена
          </button>
          <button
            onClick={async () => {
              setBusy(true)
              setError('')
              try {
                await onRun(packId)
              } catch (e) {
                setError(errMessage(e, 'Не удалось отправить.'))
                setBusy(false)
              }
            }}
            disabled={busy || !packId}
            className="btn btn-green flex-1 disabled:opacity-60"
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />} Отправить
          </button>
        </div>
      </div>
    </div>
  )
}


// §8.1: изображение обложки, вопроса или варианта ответа. Предпросмотр,
// замена и удаление до публикации; JPG/JPEG, PNG и WebP.
type Question = {
  text: string
  imageId?: Id<'_storage'>
  multiple: boolean
  options: { text: string; imageId?: Id<'_storage'>; correct: boolean }[]
}

function ImagePick({
  label,
  storageId,
  name,
  onPick,
  onClear,
}: {
  label: string
  storageId: Id<'_storage'> | null | undefined
  name: string
  onPick: (id: Id<'_storage'>, name: string) => void
  onClear: () => void
}) {
  const genUrl = useMutation(api.packExtras.contentUploadUrl)
  const ref = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <div>
      <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-1.5">
        {label}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <input
          ref={ref}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (!f) return
            if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type)) {
              setError('Поддерживаются JPG, PNG и WebP')
              return
            }
            setBusy(true)
            setError('')
            try {
              const id = await uploadToStorage(() => genUrl({}), f)
              onPick(id, f.name)
            } catch (err) {
              setError(errMessage(err, 'Не удалось загрузить изображение.'))
            } finally {
              setBusy(false)
            }
          }}
        />
        <button onClick={() => ref.current?.click()} disabled={busy} className="mini-btn">
          {busy ? <Loader2 size={12} className="animate-spin" /> : <ImageIcon size={12} />}
          {storageId ? 'Заменить' : 'Загрузить'}
        </button>
        {storageId && (
          <>
            <span className="chip bg-chip text-ink-2">{name || 'изображение'}</span>
            <button onClick={onClear} className="mini-btn text-[#c53030]">
              <Trash2 size={12} /> Удалить
            </button>
          </>
        )}
      </div>
      {error && <p className="text-[11px] text-[#c53030] mt-1">{error}</p>}
    </div>
  )
}

// §8.1: минимальный конструктор тестов — вопросы, варианты, правильные
// ответы и изображения к вопросам и вариантам.
function TestBuilder({
  questions,
  onChange,
}: {
  questions: Question[]
  onChange: (q: Question[]) => void
}) {
  const patch = (i: number, next: Partial<Question>) =>
    onChange(questions.map((q, k) => (k === i ? { ...q, ...next } : q)))

  return (
    <div className="rounded-2xl border border-line p-4 flex flex-col gap-4">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-semibold text-ink">Вопросы теста</span>
        <span className="chip bg-chip text-muted">{questions.length}</span>
        <div className="flex-1" />
        <button
          onClick={() =>
            onChange([
              ...questions,
              { text: '', multiple: false, options: [{ text: '', correct: true }] },
            ])
          }
          className="mini-btn"
        >
          <Plus size={12} /> Вопрос
        </button>
      </div>

      {questions.length === 0 && (
        <p className="text-[12px] text-muted">
          Добавьте вопросы — тест проходится прямо в кабинете заказчика.
        </p>
      )}

      {questions.map((q, i) => (
        <div key={i} className="rounded-xl bg-chip p-3 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-semibold text-ink">Вопрос {i + 1}</span>
            <div className="flex-1" />
            <button
              onClick={() => onChange(questions.filter((_, k) => k !== i))}
              className="mini-btn text-[#c53030]"
            >
              <Trash2 size={12} />
            </button>
          </div>
          <input
            className={inputCls}
            value={q.text}
            onChange={(e) => patch(i, { text: e.target.value })}
            placeholder="Текст вопроса"
          />
          <ImagePick
            label="Изображение к вопросу"
            storageId={q.imageId ?? null}
            name="загружено"
            onPick={(id) => patch(i, { imageId: id })}
            onClear={() => patch(i, { imageId: undefined })}
          />
          <label className="flex items-center gap-2 text-[12px] text-ink-2 cursor-pointer">
            <input
              type="checkbox"
              checked={q.multiple}
              onChange={(e) => patch(i, { multiple: e.target.checked })}
            />
            Несколько правильных ответов
          </label>

          <div className="flex flex-col gap-2">
            {q.options.map((o, oi) => (
              <div key={oi} className="rounded-lg bg-white border border-line p-2.5 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={o.correct}
                    onChange={(e) =>
                      patch(i, {
                        options: q.options.map((x, k) =>
                          k === oi ? { ...x, correct: e.target.checked } : x,
                        ),
                      })
                    }
                    title="Правильный ответ"
                  />
                  <input
                    className={`${inputCls} h-8`}
                    value={o.text}
                    onChange={(e) =>
                      patch(i, {
                        options: q.options.map((x, k) =>
                          k === oi ? { ...x, text: e.target.value } : x,
                        ),
                      })
                    }
                    placeholder={`Вариант ${oi + 1}`}
                  />
                  <button
                    onClick={() =>
                      patch(i, { options: q.options.filter((_, k) => k !== oi) })
                    }
                    className="mini-btn text-[#c53030]"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
                <ImagePick
                  label="Изображение к варианту"
                  storageId={o.imageId ?? null}
                  name="загружено"
                  onPick={(id) =>
                    patch(i, {
                      options: q.options.map((x, k) => (k === oi ? { ...x, imageId: id } : x)),
                    })
                  }
                  onClear={() =>
                    patch(i, {
                      options: q.options.map((x, k) =>
                        k === oi ? { ...x, imageId: undefined } : x,
                      ),
                    })
                  }
                />
              </div>
            ))}
            <button
              onClick={() =>
                patch(i, { options: [...q.options, { text: '', correct: false }] })
              }
              className="mini-btn self-start"
            >
              <Plus size={12} /> Вариант ответа
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
