// §4: конструктор новой упаковки. Создание пошаговое, с возможностью
// сохранить черновик и продолжить позднее — черновик и есть результат этого
// мастера: проект создаётся в статусе «Черновик» и клиенту не виден до
// отдельного действия «Запустить и открыть клиенту» (§4.4).

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from 'convex/react'
import { Boxes, Check, ChevronLeft, ChevronRight, Loader2, X } from 'lucide-react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import DatePicker from '@/components/ui/DatePicker'
import Select from '@/components/ui/Select'
import { errMessage } from '@/lib/errors'
import { kzt } from '@/lib/format'
import { TODAY } from '@/lib/constants'
import { Field, areaCls, inputCls } from './ui'

// ТЗ v1.1 §2, §9.2: экономику проекта задаёт только администратор, поэтому
// упаковщику этот шаг не показывается вовсе — сервер его цифры всё равно
// обнуляет, и вводить их значило бы обещать несуществующее.
const ALL_STEPS = [
  { key: 'project', label: 'Проект' },
  { key: 'client', label: 'Клиент' },
  { key: 'economy', label: 'Экономика' },
  { key: 'stages', label: 'Этапы' },
] as const

export default function PackWizard({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const create = useMutation(api.packs.create)
  const board = useQuery(api.packs.list, {})
  const clients = useQuery(api.packs.clients)
  const templates = useQuery(api.packs.templates)

  const [step, setStep] = useState(0)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [startDate, setStartDate] = useState(TODAY)
  const [dueDate, setDueDate] = useState(addMonths(TODAY, 2))
  const [clientId, setClientId] = useState('')
  const [price, setPrice] = useState('')
  const [percent, setPercent] = useState('20')
  const [workingDays, setWorkingDays] = useState(false)
  const [templateId, setTemplateId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Ответственный упаковщик не выбирается: им становится тот, кто создал
  // проект. Сервер подставляет создателя сам, поменять можно в карточке.
  const isOwner = !!board?.isOwner
  const steps = ALL_STEPS.filter((s) => s.key !== 'economy' || isOwner)
  const current = steps[Math.min(step, steps.length - 1)]?.key

  const reward = Math.round((Number(price || 0) * Number(percent || 0)) / 100)

  const save = async () => {
    setError('')
    if (!title.trim()) {
      setStep(0)
      setError('Укажите название упаковки.')
      return
    }
    setBusy(true)
    try {
      const id = await create({
        title: title.trim(),
        description: description.trim() || undefined,
        startDate,
        dueDate,
        clientId: clientId ? (clientId as Id<'employees'>) : undefined,
        price: Number(price || 0),
        packerPercent: Number(percent || 0),
        workingDays,
        templateId: templateId ? (templateId as Id<'packs'>) : undefined,
      })
      onClose()
      navigate(`/packs/${id}`)
    } catch (e) {
      setError(errMessage(e, 'Не удалось создать упаковку.'))
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-lg h-full bg-bg flex flex-col">
        <div className="shrink-0 bg-white border-b border-line px-5 sm:px-6 py-4 flex items-center gap-3">
          <span className="w-9 h-9 rounded-xl bg-[#e2f2ef] text-green-d grid place-items-center shrink-0">
            <Boxes size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold text-ink truncate">Новая упаковка</h2>
            <p className="text-[11px] text-muted">
              Сохранится черновиком — клиент увидит проект только после запуска
            </p>
          </div>
          <button onClick={onClose} className="ico-btn w-9 h-9" aria-label="Закрыть">
            <X size={16} />
          </button>
        </div>

        {/* Шаги */}
        <div className="shrink-0 bg-white border-b border-line px-5 sm:px-6 py-3 flex items-center gap-2 flex-nowrap overflow-x-auto no-scrollbar">
          {steps.map((s, i) => (
            <button
              key={s.key}
              onClick={() => setStep(i)}
              className={`chip whitespace-nowrap transition-colors ${
                i === step
                  ? 'bg-green text-white'
                  : i < step
                    ? 'bg-[#e2f2ef] text-green-d'
                    : 'bg-chip text-muted'
              }`}
            >
              {i < step && <Check size={11} />} {i + 1}. {s.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-5 flex flex-col gap-4">
          {current === 'project' && (
            <>
              <Field label="Название упаковки">
                <input
                  className={inputCls}
                  placeholder="Франшиза «Кофейня у дома»"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Дата старта">
                  <DatePicker value={startDate} onChange={setStartDate} />
                </Field>
                <Field label="Общий срок проекта">
                  <DatePicker value={dueDate} onChange={setDueDate} min={startDate} />
                </Field>
              </div>
              <Field
                label="Режим отсчёта сроков"
                hint="В рабочих днях выходные не расходуют срок ответа клиента и доработки."
              >
                <Select
                  value={workingDays ? 'work' : 'calendar'}
                  onChange={(v) => setWorkingDays(v === 'work')}
                  options={[
                    { value: 'calendar', label: 'Календарные дни' },
                    { value: 'work', label: 'Рабочие дни' },
                  ]}
                />
              </Field>
              <Field label="Описание / комментарий">
                <textarea
                  className={areaCls}
                  placeholder="Необязательно"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </Field>
            </>
          )}

          {current === 'client' && (
            <Field
              label="Клиент"
              hint="Обязателен перед запуском. Клиента можно завести во вкладке «Клиенты»."
            >
              <Select
                value={clientId}
                onChange={setClientId}
                placeholder="Выберите клиента"
                options={[
                  { value: '', label: 'Пока не назначен' },
                  ...(clients ?? [])
                    .filter((c) => c.status === 'active')
                    .map((c) => ({ value: c._id as string, label: `${c.name} · ${c.company}` })),
                ]}
              />
            </Field>
          )}

          {current === 'economy' && (
            <>
              <div className="rounded-xl bg-[#fff6e6] border border-[#f3d9a4] p-3 text-[11px] text-[#8a5a12]">
                Это внутренние поля. Клиент не видит ни стоимость проекта, ни процент, ни
                вознаграждение упаковщика — ни в кабинете, ни в сетевых запросах.
              </div>
              <Field label="Стоимость проекта, ₸">
                <input
                  className={inputCls}
                  type="number"
                  min={0}
                  step={50000}
                  placeholder="1000000"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                />
              </Field>
              <Field label="Процент упаковщика, %">
                <input
                  className={inputCls}
                  type="number"
                  min={0}
                  max={100}
                  placeholder="20"
                  value={percent}
                  onChange={(e) => setPercent(e.target.value)}
                />
              </Field>
              <div className="rounded-xl bg-chip p-3">
                <div className="text-[11px] text-muted mb-1">
                  Полное вознаграждение упаковщика · W = P × R / 100
                </div>
                <div className="text-lg font-bold text-ink tabular-nums">{kzt(reward)}</div>
                <div className="text-[11px] text-muted mt-1">
                  Начисляется по мере утверждения этапов: A = W × K / 100.
                </div>
              </div>
            </>
          )}

          {current === 'stages' && (
            <>
              <Field
                label="Структура этапов"
                hint="По умолчанию — нулевой этап и пять основных по 20%. Названия, сроки и веса правятся в карточке проекта до запуска."
              >
                <Select
                  value={templateId}
                  onChange={setTemplateId}
                  options={[
                    { value: '', label: 'Новый проект — базовый шаблон (0 + 5 этапов)' },
                    ...(templates ?? []).map((t) => ({
                      value: t._id as string,
                      label: `${t.isTemplate ? '★ ' : ''}${t.title} · ${t.stages} эт., ${t.weightSum}%`,
                    })),
                  ]}
                />
              </Field>
              <div className="rounded-xl border border-line p-3 text-sm text-ink-2">
                <div className="font-semibold text-ink mb-2">Что произойдёт дальше</div>
                <ol className="list-decimal pl-4 flex flex-col gap-1 text-[13px]">
                  <li>Проект создастся черновиком — клиенту он ещё не виден.</li>
                  <li>Откроется карточка: там правятся этапы, веса, сроки и материалы.</li>
                  <li>Система проверит, что сумма весов ровно 100% и всё заполнено.</li>
                  <li>Кнопка «Запустить и открыть клиенту» откроет кабинет заказчику.</li>
                </ol>
              </div>
            </>
          )}
        </div>

        <div className="shrink-0 bg-white border-t border-line px-5 sm:px-6 py-4 flex flex-col gap-3">
          {error && <p className="text-sm text-[#c53030]">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={() => (step === 0 ? onClose() : setStep(step - 1))}
              className="btn btn-ghost"
            >
              <ChevronLeft size={15} /> {step === 0 ? 'Отмена' : 'Назад'}
            </button>
            <div className="flex-1" />
            {step < steps.length - 1 ? (
              <button onClick={() => setStep(step + 1)} className="btn btn-ghost">
                Далее <ChevronRight size={15} />
              </button>
            ) : null}
            <button onClick={save} disabled={busy} className="btn btn-green disabled:opacity-60">
              {busy && <Loader2 size={15} className="animate-spin" />}
              Сохранить черновик
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function addMonths(iso: string, months: number): string {
  const d = new Date(`${iso}T12:00:00+05:00`)
  d.setUTCMonth(d.getUTCMonth() + months)
  return new Date(d.getTime() + 5 * 3600 * 1000).toISOString().slice(0, 10)
}
