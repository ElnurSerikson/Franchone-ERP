import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { UserPlus, X, Loader2, CheckCircle2, Mail } from 'lucide-react'
import Select from './ui/Select'
import DatePicker from './ui/DatePicker'

const inputCls =
  'w-full rounded-lg border border-line-2 px-3 py-2.5 text-sm text-ink placeholder:text-muted focus:outline-none focus:border-green-light bg-white'
const labelCls = 'block text-sm font-medium text-ink-2 mb-1.5'

type Position = 'smm' | 'targetolog' | 'sales' | 'packer'

const POSITIONS: { value: Position; label: string; dept: string }[] = [
  { value: 'smm', label: 'SMM-специалист', dept: 'Маркетинг' },
  { value: 'targetolog', label: 'Таргетолог', dept: 'Маркетинг' },
  { value: 'sales', label: 'Менеджер по продажам', dept: 'Продажи' },
  { value: 'packer', label: 'Упаковщик / проект-менеджер', dept: 'Производство' },
]

const DEPARTMENTS = ['Руководство', 'Маркетинг', 'Продажи', 'Производство']

const ROLES = [
  { value: 'employee', label: 'Сотрудник' },
  { value: 'head', label: 'Руководитель отдела' },
]

const today = () => new Date().toISOString().slice(0, 10)

function errMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'data' in err) {
    const data = (err as { data?: unknown }).data
    if (typeof data === 'string' && data.length > 0) return data
  }
  return fallback
}

export default function TeamInviteDrawer({ onClose }: { onClose: () => void }) {
  const invite = useMutation(api.employees.invite)

  const [shown, setShown] = useState(false)
  const firstRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true))
    // Фокус на первое поле, но без прокрутки формы (иначе прячется верхняя метка).
    firstRef.current?.focus({ preventScroll: true })
    return () => cancelAnimationFrame(id)
  }, [])

  const close = () => {
    setShown(false)
    setTimeout(onClose, 200)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ——— форма ———
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [position, setPosition] = useState<Position>('smm')
  const [department, setDepartment] = useState('Маркетинг')
  const [role, setRole] = useState('employee')
  const [salary, setSalary] = useState('')
  const [hiredAt, setHiredAt] = useState(today())

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [invited, setInvited] = useState<{ name: string; email: string } | null>(null)

  const posMeta = useMemo(() => POSITIONS.find((p) => p.value === position)!, [position])

  const onPosition = (v: string) => {
    const p = v as Position
    setPosition(p)
    setDepartment(POSITIONS.find((x) => x.value === p)?.dept ?? department)
  }

  const canSubmit = firstName.trim() && lastName.trim() && email.trim() && !loading

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setError(null)
    setLoading(true)
    try {
      const name = `${firstName.trim()} ${lastName.trim()}`.trim()
      await invite({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        phone: phone.trim(),
        position,
        positionLabel: posMeta.label,
        department,
        role: role as 'head' | 'employee',
        salary: Number(salary) || 0,
        hiredAt,
      })
      setInvited({ name, email: email.trim().toLowerCase() })
    } catch (err) {
      setError(errMessage(err, 'Не удалось пригласить сотрудника. Попробуйте ещё раз.'))
    } finally {
      setLoading(false)
    }
  }

  const reset = () => {
    setFirstName('')
    setLastName('')
    setEmail('')
    setPhone('')
    setPosition('smm')
    setDepartment('Маркетинг')
    setRole('employee')
    setSalary('')
    setHiredAt(today())
    setError(null)
    setInvited(null)
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        onClick={close}
        className={`absolute inset-0 bg-black/30 transition-opacity duration-200 ${
          shown ? 'opacity-100' : 'opacity-0'
        }`}
      />
      <div
        className={`relative w-full max-w-md h-full bg-bg shadow-soft flex flex-col transition-transform duration-200 ease-out ${
          shown ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* header */}
        <div className="shrink-0 bg-white border-b border-line px-5 sm:px-6 py-4 flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#e2f2ef] text-green-d grid place-items-center shrink-0">
            <UserPlus size={19} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-ink leading-tight">Пригласить сотрудника</h2>
            <p className="text-[13px] text-muted mt-0.5">
              Новый участник получит письмо со ссылкой на вход
            </p>
          </div>
          <button onClick={close} className="ico-btn w-9 h-9 shrink-0" title="Закрыть">
            <X size={16} />
          </button>
        </div>

        {invited ? (
          <SuccessPanel invited={invited} onMore={reset} onDone={close} />
        ) : (
          <form onSubmit={submit} className="flex-1 min-h-0 flex flex-col">
            <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-5 flex flex-col gap-4">
              <Section title="Профиль">
                <Field label="Имя">
                  <input
                    ref={firstRef}
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className={inputCls}
                    placeholder="Нурай"
                    required
                  />
                </Field>
                <Field label="Фамилия">
                  <input
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className={inputCls}
                    placeholder="Сагатова"
                    required
                  />
                </Field>
                <Field label="Email (логин)">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={inputCls}
                    placeholder="nuray@franchone.kz"
                    required
                  />
                </Field>
                <Field label="Телефон">
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className={inputCls}
                    placeholder="+7 707 000 00 00"
                  />
                </Field>
              </Section>

              <Section title="Должность и доступ">
                <Field label="Должность">
                  <Select
                    value={position}
                    onChange={onPosition}
                    options={POSITIONS.map((p) => ({ value: p.value, label: p.label }))}
                  />
                </Field>
                <Field label="Отдел">
                  <Select
                    value={department}
                    onChange={setDepartment}
                    options={DEPARTMENTS.map((d) => ({ value: d, label: d }))}
                  />
                </Field>
                <Field label="Роль">
                  <Select value={role} onChange={setRole} options={ROLES} />
                </Field>
              </Section>

              <Section title="Оплата">
                <Field label="Оклад, ₸">
                  <input
                    inputMode="numeric"
                    value={salary}
                    onChange={(e) => setSalary(e.target.value.replace(/[^\d]/g, ''))}
                    className={inputCls}
                    placeholder="0"
                  />
                </Field>
                <Field label="Дата найма">
                  <DatePicker value={hiredAt} onChange={setHiredAt} />
                </Field>
              </Section>
            </div>

            {/* footer */}
            <div className="shrink-0 border-t border-line bg-white px-5 sm:px-6 py-4 [padding-bottom:max(1rem,env(safe-area-inset-bottom))]">
              {error && <p className="text-sm text-[#c53030] mb-3">{error}</p>}
              <div className="flex items-center gap-2">
                <button type="button" onClick={close} className="btn btn-ghost flex-1">
                  Отмена
                </button>
                <button type="submit" disabled={!canSubmit} className="btn btn-green flex-1 disabled:opacity-60">
                  {loading ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
                  Пригласить
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

function SuccessPanel({
  invited,
  onMore,
  onDone,
}: {
  invited: { name: string; email: string }
  onMore: () => void
  onDone: () => void
}) {
  return (
    <div className="flex-1 flex flex-col">
      <div className="flex-1 overflow-y-auto px-6 py-10 flex flex-col items-center text-center">
        <div className="w-16 h-16 rounded-full bg-[#e2f2ef] text-green-d grid place-items-center mb-4">
          <CheckCircle2 size={30} />
        </div>
        <h3 className="text-lg font-bold text-ink mb-1">{invited.name} приглашён(а)</h3>
        <p className="text-sm text-muted max-w-xs">
          Отправили письмо со ссылкой на вход на почту:
        </p>
        <div className="inline-flex items-center gap-2 mt-2 px-3 py-1.5 rounded-lg bg-chip text-sm font-medium text-ink-2">
          <Mail size={14} className="text-muted" /> {invited.email}
        </div>
        <p className="text-[13px] text-muted-2 mt-4 max-w-xs">
          Вход по коду, без пароля: сотрудник введёт свой email на странице входа и получит код.
        </p>
      </div>
      <div className="shrink-0 border-t border-line bg-white px-5 sm:px-6 py-4 [padding-bottom:max(1rem,env(safe-area-inset-bottom))] flex items-center gap-2">
        <button onClick={onMore} className="btn btn-ghost flex-1">
          Пригласить ещё
        </button>
        <button onClick={onDone} className="btn btn-green flex-1">
          Готово
        </button>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold text-muted-2 uppercase tracking-wider mb-2">
        {title}
      </div>
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      {children}
    </div>
  )
}
