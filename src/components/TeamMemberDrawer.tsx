import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { UserPlus, Pencil, X, Loader2, CheckCircle2, Mail, Save } from 'lucide-react'
import type { Employee } from '@/types'
import { errMessage } from '@/lib/errors'
import Select from './ui/Select'

const inputCls =
  'w-full rounded-lg border border-line-2 px-3 py-2.5 text-sm text-ink placeholder:text-muted focus:outline-none focus:border-green-light bg-white'
const labelCls = 'block text-sm font-medium text-ink-2 mb-1.5'

const today = () => new Date().toISOString().slice(0, 10)

// Drawer участника команды: без `employee` — приглашение, с ним — редактирование.
export default function TeamMemberDrawer({
  employee,
  onClose,
}: {
  employee?: Employee
  onClose: () => void
}) {
  const invite = useMutation(api.employees.invite)
  const updateMember = useMutation(api.employees.updateMember)
  const isEdit = !!employee

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

  // ——— форма (в режиме правки — предзаполнена) ———
  const parts = (employee?.name ?? '').trim().split(/\s+/).filter(Boolean)
  const [firstName, setFirstName] = useState(parts[0] ?? '')
  const [lastName, setLastName] = useState(parts.slice(1).join(' '))
  const [email, setEmail] = useState(employee?.email ?? '')
  const [phone, setPhone] = useState(employee?.phone ?? '')
  // Справочники должностей и отделов (§11).
  const positions = useQuery(api.positions.list) ?? []
  const departments = useQuery(api.departments.list) ?? []
  // У владельца в position техническое значение (модель KPI), титул —
  // в positionLabel; пикер должностей ему не показываем.
  const isOwnerEdit = isEdit && employee!.role === 'owner'
  const [position, setPosition] = useState(employee?.position ?? '')
  const [department, setDepartment] = useState(employee?.department ?? '')

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [invited, setInvited] = useState<{ name: string; email: string } | null>(null)

  // Автовыбор первого варианта при приглашении, когда справочники загрузились.
  useEffect(() => {
    if (!position && positions.length) setPosition(positions[0].slug)
  }, [positions, position])
  useEffect(() => {
    if (!department && departments.length) setDepartment(departments[0].name)
  }, [departments, department])

  const posMeta = useMemo(() => positions.find((p) => p.slug === position), [positions, position])

  const canSubmit =
    firstName.trim() && lastName.trim() && email.trim() && !!position && !!department && !loading

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setError(null)
    setLoading(true)
    try {
      const person = {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        phone: phone.trim(),
      }
      if (isEdit) {
        // Должность/отдел шлём только когда реально меняли. Должность владельца
        // не трогаем (кастомный титул), отдел — можно.
        const posChanged = !isOwnerEdit && position !== employee!.position
        const deptChanged = department !== employee!.department
        await updateMember({
          id: employee!.id as Id<'employees'>,
          ...person,
          ...(posChanged ? { position, positionLabel: posMeta?.label ?? position } : {}),
          ...(deptChanged ? { department } : {}),
        })
        close()
      } else {
        const name = `${person.firstName} ${person.lastName}`.trim()
        await invite({
          ...person,
          position,
          positionLabel: posMeta?.label ?? position,
          department,
          role: 'employee',
          salary: 0,
          hiredAt: today(),
        })
        setInvited({ name, email: person.email.toLowerCase() })
      }
    } catch (err) {
      setError(
        errMessage(
          err,
          isEdit ? 'Не удалось сохранить изменения.' : 'Не удалось пригласить сотрудника.',
        ),
      )
    } finally {
      setLoading(false)
    }
  }

  const reset = () => {
    setFirstName('')
    setLastName('')
    setEmail('')
    setPhone('')
    setPosition(positions[0]?.slug ?? '')
    setDepartment(departments[0]?.name ?? '')
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
            {isEdit ? <Pencil size={18} /> : <UserPlus size={19} />}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-ink leading-tight">
              {isEdit ? 'Редактировать сотрудника' : 'Пригласить сотрудника'}
            </h2>
            <p className="text-[13px] text-muted mt-0.5">
              {isEdit ? 'Изменения применятся сразу' : 'Отправим письмо со ссылкой на вход'}
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
              <Field label="Имя">
                <input
                  ref={firstRef}
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className={inputCls}
                  placeholder="Введите имя"
                  required
                />
              </Field>
              <Field label="Фамилия">
                <input
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className={inputCls}
                  placeholder="Введите фамилию"
                  required
                />
              </Field>
              <Field label="Email (логин)">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputCls}
                  placeholder="you@franchone.kz"
                  required
                />
              </Field>
              <Field label="Телефон">
                <input
                  inputMode="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className={inputCls}
                  placeholder="+7 701 111 22 33"
                />
              </Field>
              <Field label="Должность">
                {isOwnerEdit ? (
                  <>
                    <div className="w-full rounded-lg border border-line-2 bg-chip px-3 py-2.5 text-sm text-ink-2 select-none">
                      {employee!.positionLabel}
                    </div>
                    <p className="text-[11px] text-muted-2 mt-1.5">
                      Должность владельца не меняется
                    </p>
                  </>
                ) : (
                  <Select
                    value={position}
                    onChange={setPosition}
                    options={positions.map((p) => ({ value: p.slug, label: p.label }))}
                  />
                )}
              </Field>
              <Field label="Отдел">
                <Select
                  value={department}
                  onChange={setDepartment}
                  options={departments.map((d) => ({ value: d.name, label: d.name }))}
                />
              </Field>
            </div>

            {/* footer */}
            <div className="shrink-0 border-t border-line bg-white px-5 sm:px-6 py-4 [padding-bottom:max(1rem,env(safe-area-inset-bottom))]">
              {error && <p className="text-sm text-[#c53030] mb-3">{error}</p>}
              <div className="flex items-center gap-2">
                <button type="button" onClick={close} className="btn btn-ghost flex-1">
                  Отмена
                </button>
                <button type="submit" disabled={!canSubmit} className="btn btn-green flex-1 disabled:opacity-60">
                  {loading ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : isEdit ? (
                    <Save size={16} />
                  ) : (
                    <UserPlus size={16} />
                  )}
                  {isEdit ? 'Сохранить' : 'Пригласить'}
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

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      {children}
    </div>
  )
}
