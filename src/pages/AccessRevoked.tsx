import { useAuthActions } from '@convex-dev/auth/react'
import { ShieldOff, LogOut } from 'lucide-react'

// Экран для сотрудника, которому отключили доступ (в том числе прямо во время
// работы — запрос статуса реактивный, поэтому подмена происходит мгновенно).
export default function AccessRevoked() {
  const { signOut } = useAuthActions()

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center px-4 py-8 [padding-bottom:max(2rem,env(safe-area-inset-bottom))]">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-7">
          <span className="text-[20px] font-extrabold tracking-tight leading-none select-none">
            <span className="text-ink">FRANCH</span>
            <span className="text-green">ONE</span>
          </span>
          <div className="text-xs text-muted tracking-wide mt-2">ERP · Панель управления</div>
        </div>

        <div className="card p-6 text-center">
          <div className="w-14 h-14 rounded-full bg-[#fdeaea] text-[#c53030] grid place-items-center mx-auto mb-4">
            <ShieldOff size={26} />
          </div>
          <h1 className="text-xl font-bold text-ink mb-1.5">Доступ отключён</h1>
          <p className="text-sm text-muted">
            Ваша учётная запись деактивирована, поэтому доступ к панели закрыт. Если это ошибка —
            обратитесь к руководителю, он вернёт доступ в один клик.
          </p>
          <button onClick={() => void signOut()} className="btn btn-green w-full mt-6">
            <LogOut size={16} /> Выйти
          </button>
        </div>

        <p className="text-center text-xs text-muted-2 mt-5">
          Данные, задачи и отчёты сохранены — при восстановлении доступа всё будет на месте.
        </p>
      </div>
    </div>
  )
}
