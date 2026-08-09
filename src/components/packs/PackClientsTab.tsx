// Заказчики упаковки (ТЗ Упаковка §3, §4.1). Отдельный список: в «Команде»
// им не место — это не сотрудники. Доступ в кабинет клиент получает тем же
// кодом на рабочую почту, что и сотрудник входит в ERP.

import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { Check, Loader2, Pencil, Plus, UserRound, X } from 'lucide-react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import Avatar from '@/components/ui/Avatar'
import AvatarEdit from '@/components/ui/AvatarEdit'
import { errMessage } from '@/lib/errors'
import { th, td, theadRow } from '@/lib/table'
import { Empty, Field, inputCls, dateTime } from './ui'

type Row = {
  _id: Id<'employees'>
  name: string
  email: string
  phone: string
  initials: string
  avatarColor: string
  status: 'active' | 'archived'
  company: string
  packs: number
  lastLoginAt: number | null
}

export default function PackClientsTab() {
  const rows = useQuery(api.packs.clients)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Row | null>(null)

  if (rows === undefined) {
    return (
      <div className="card p-10 grid place-items-center text-muted">
        <Loader2 className="animate-spin" size={20} />
      </div>
    )
  }

  return (
    <>
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <UserRound size={16} className="text-green" />
        <h3 className="sec-title">Клиенты</h3>
        <span className="chip bg-chip text-muted">{rows.length}</span>
        <div className="flex-1" />
        <button onClick={() => setCreating(true)} className="btn btn-green h-9 px-3 text-sm">
          <Plus size={15} /> Новый клиент
        </button>
      </div>

      {rows.length === 0 ? (
        <Empty
          icon={UserRound}
          title="Клиентов пока нет"
          text="Заведите заказчика — он войдёт в кабинет по коду на свою почту и увидит только свой проект."
        />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead>
                <tr className={theadRow}>
                  <th className={th}>Клиент</th>
                  <th className={th}>Бизнес</th>
                  <th className={th}>Почта / логин</th>
                  <th className={th}>Телефон</th>
                  <th className={th}>Проектов</th>
                  <th className={th}>Последний вход</th>
                  <th className={th}>Доступ</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody>
                {(rows as Row[]).map((r) => (
                  <tr key={r._id} className="hover:bg-chip/40 transition-colors">
                    <td className={td}>
                      <span className="inline-flex items-center gap-2.5">
                        <Avatar id={r._id} initials={r.initials} color={r.avatarColor} size={30} />
                        <span className="font-semibold text-ink whitespace-nowrap">{r.name}</span>
                      </span>
                    </td>
                    <td className={td}>{r.company}</td>
                    <td className={td}>{r.email}</td>
                    <td className={td}>{r.phone || '—'}</td>
                    <td className={td}>{r.packs}</td>
                    <td className={td}>
                      {r.lastLoginAt ? dateTime(r.lastLoginAt) : <span className="text-muted-2">ни разу</span>}
                    </td>
                    <td className={td}>
                      {r.status === 'active' ? (
                        <span className="chip bg-[#e2f2ef] text-green-d">Открыт</span>
                      ) : (
                        <span className="chip bg-chip text-muted">Закрыт</span>
                      )}
                    </td>
                    <td className={`${td} text-right`}>
                      <button onClick={() => setEditing(r)} className="mini-btn">
                        <Pencil size={12} /> Изменить
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {(creating || editing) && (
        <ClientDrawer row={editing} onClose={() => (editing ? setEditing(null) : setCreating(false))} />
      )}
    </>
  )
}

function ClientDrawer({ row, onClose }: { row: Row | null; onClose: () => void }) {
  const create = useMutation(api.packs.createClient)
  const update = useMutation(api.packs.updateClient)
  const [name, setName] = useState(row?.name ?? '')
  const [email, setEmail] = useState(row?.email ?? '')
  const [phone, setPhone] = useState(row?.phone ?? '')
  const [company, setCompany] = useState(row?.company === 'Клиент' ? '' : (row?.company ?? ''))
  const [active, setActive] = useState(row ? row.status === 'active' : true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const save = async () => {
    setError('')
    setBusy(true)
    try {
      if (row) {
        await update({
          id: row._id,
          name,
          email,
          phone,
          company,
          status: active ? 'active' : 'archived',
        })
      } else {
        await create({ name, email, phone, company })
      }
      onClose()
    } catch (e) {
      setError(errMessage(e, 'Не удалось сохранить клиента.'))
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-md h-full bg-bg flex flex-col">
        <div className="shrink-0 bg-white border-b border-line px-5 sm:px-6 py-4 flex items-center gap-3">
          <span className="w-9 h-9 rounded-xl bg-[#e2f2ef] text-green-d grid place-items-center shrink-0">
            <UserRound size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold text-ink truncate">
              {row ? 'Клиент' : 'Новый клиент'}
            </h2>
            <p className="text-[11px] text-muted">Вход в кабинет — по коду на эту почту</p>
          </div>
          <button onClick={onClose} className="ico-btn w-9 h-9" aria-label="Закрыть">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-5 flex flex-col gap-4">
          {/* Фото заказчика ставит команда — сам он его только видит у себя в
              кабинете. У нового клиента фото появится после сохранения:
              привязывать файл ещё не к кому. */}
          {row ? (
            <Field label="Фото">
              <AvatarEdit
                id={row._id}
                initials={row.initials}
                color={row.avatarColor}
                size={64}
                showRemove
                hint="JPG, PNG или WebP до 8 МБ"
              />
            </Field>
          ) : (
            <div className="rounded-xl bg-chip p-3 text-[11px] text-muted">
              Фото можно будет загрузить сразу после сохранения — откройте карточку клиента
              ещё раз.
            </div>
          )}
          <Field label="Имя и фамилия">
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Айдана Сериковна" />
          </Field>
          <Field label="Название бизнеса" hint="Показывается в кабинете рядом с именем.">
            <input className={inputCls} value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Кофейня у дома" />
          </Field>
          <Field label="Почта" hint="Это логин. На неё придёт код входа.">
            <input className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="client@example.com" />
          </Field>
          <Field label="Телефон">
            <input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+7 700 000 00 00" />
          </Field>
          {row && (
            <label className="flex items-center gap-2 text-sm text-ink-2 cursor-pointer">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
              Доступ в кабинет открыт
            </label>
          )}
          <div className="rounded-xl bg-chip p-3 text-[11px] text-muted">
            Клиент видит только свой проект: карту этапов, сроки, материалы и то, что требуется от
            него. Стоимость проекта, процент и вознаграждение упаковщика ему недоступны.
          </div>
        </div>

        <div className="shrink-0 bg-white border-t border-line px-5 sm:px-6 py-4 flex flex-col gap-3">
          {error && <p className="text-sm text-[#c53030]">{error}</p>}
          <div className="flex gap-2">
            <button onClick={onClose} className="btn btn-ghost flex-1">
              Отмена
            </button>
            <button onClick={save} disabled={busy} className="btn btn-green flex-1 disabled:opacity-60">
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
              Сохранить
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
