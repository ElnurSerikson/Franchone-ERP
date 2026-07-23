import { useState, type FormEvent } from 'react'
import { useAuthActions } from '@convex-dev/auth/react'
import { Loader2, Mail, ArrowLeft } from 'lucide-react'

function errMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'data' in err) {
    const data = (err as { data?: unknown }).data
    if (typeof data === 'string' && data.length > 0) return data
  }
  return fallback
}

export default function Login() {
  const { signIn } = useAuthActions()
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const sendCode = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await signIn('resend-otp', { email: email.trim() })
      setStep('code')
    } catch (err) {
      setError(errMessage(err, 'Не удалось отправить код. Попробуйте ещё раз.'))
    } finally {
      setLoading(false)
    }
  }

  const verify = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await signIn('resend-otp', { email: email.trim(), code: code.trim() })
      // при успехе <Authenticated> отрисует приложение
    } catch (err) {
      setError(errMessage(err, 'Неверный или просроченный код.'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Brand */}
        <div className="flex flex-col items-center mb-7">
          <img src="/logo-wordmark.png" alt="FRANCHONE" className="w-56 h-auto mb-2.5" />
          <div className="text-xs text-muted tracking-wide">ERP · Панель управления</div>
        </div>

        <div className="card p-6">
          {step === 'email' ? (
            <form onSubmit={sendCode}>
              <h1 className="text-xl font-bold text-ink mb-1">Вход</h1>
              <p className="text-sm text-muted mb-5">
                Введите рабочий email — пришлём код для входа. Доступ только по приглашению.
              </p>
              <label className="block text-sm font-medium text-ink-2 mb-1.5">Email</label>
              <div className="relative mb-4">
                <Mail size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  type="email"
                  required
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@franchone.kz"
                  className="w-full h-11 pl-10 pr-3 rounded-xl bg-white border border-line-2 text-sm focus:outline-none focus:border-green-light"
                />
              </div>
              {error && <p className="text-sm text-[#c53030] mb-3">{error}</p>}
              <button type="submit" disabled={loading} className="btn btn-green w-full disabled:opacity-60">
                {loading ? <Loader2 size={16} className="animate-spin" /> : null}
                Получить код
              </button>
            </form>
          ) : (
            <form onSubmit={verify}>
              <button
                type="button"
                onClick={() => {
                  setStep('email')
                  setCode('')
                  setError(null)
                }}
                className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink mb-3"
              >
                <ArrowLeft size={14} /> изменить email
              </button>
              <h1 className="text-xl font-bold text-ink mb-1">Введите код</h1>
              <p className="text-sm text-muted mb-5">
                Отправили 6-значный код на <b className="text-ink-2">{email}</b>. Код действует 10 минут.
              </p>
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                autoFocus
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="______"
                className="w-full h-14 text-center tracking-[0.5em] text-2xl font-bold rounded-xl bg-white border border-line-2 focus:outline-none focus:border-green-light mb-4"
              />
              {error && <p className="text-sm text-[#c53030] mb-3">{error}</p>}
              <button
                type="submit"
                disabled={loading || code.length < 6}
                className="btn btn-green w-full disabled:opacity-60"
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : null}
                Войти
              </button>
              <button
                type="button"
                onClick={sendCode}
                disabled={loading}
                className="w-full text-xs text-muted hover:text-ink mt-3"
              >
                Отправить код повторно
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-xs text-muted-2 mt-5">
          Нет доступа? Обратитесь к владельцу — он добавит вас в команду.
        </p>
      </div>
    </div>
  )
}
