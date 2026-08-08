// Общая модель модуля «Производство и запуск франшизы» (ТЗ Упаковка v1.0).
// Импортируется и сервером (convex), и фронтом (src), как permModel и kpiMath:
// чистый TypeScript без серверных зависимостей.
//
// Здесь живут все правила, которые обязаны совпадать на обеих сторонах:
// статусы, прогресс, KPI, индикатор здоровья и тексты причин. Дублировать их
// в компонентах нельзя — иначе клиент увидит один процент, а владелец другой.

export const DAY_MS = 24 * 60 * 60 * 1000

// §6.3: «до дедлайна остаётся настраиваемый короткий период». По умолчанию —
// двое суток; значение меняется в Настройках.
export const DEFAULT_WARN_HOURS = 48
// §6.1: сроки реакции сторон по умолчанию, в днях.
export const DEFAULT_REVIEW_DAYS = 3
export const DEFAULT_REREVIEW_DAYS = 2
export const DEFAULT_FIX_DAYS = 3
// §8.1: сколько дней без событий делают проект «без активности».
export const DEFAULT_IDLE_DAYS = 7

// ——— Базовый шаблон проекта (ТЗ v1.1 §4) ———
//
// Нулевой этап и пять основных. По v1.1 §4.2 нулевой этап тоже имеет вес и
// участвует в прогрессе и KPI, поэтому сумма 100% делится между всеми шестью.
// Названия, описания, порядок, веса и сроки настраиваются под проект.
export const DEFAULT_STAGES: {
  kind: 'zero' | 'main'
  title: string
  clientNote: string
  weight: number
}[] = [
  {
    kind: 'zero',
    title: 'Нулевой этап. Интервью и бриф',
    clientNote: 'Интервью, бриф и сбор исходных данных.',
    // §4.2: вес нулевого этапа настраивается так же, как у основного.
    weight: 10,
  },
  {
    kind: 'main',
    title: 'Этап 1. Концепция',
    clientNote: 'Интервью, концепция франшизы и ключевая модель.',
    weight: 18,
  },
  {
    kind: 'main',
    title: 'Этап 2. Смыслы и тексты',
    clientNote: 'Текстовая и смысловая упаковка.',
    weight: 18,
  },
  {
    kind: 'main',
    title: 'Этап 3. Презентация и визуал',
    clientNote: 'Презентационные и визуальные материалы.',
    weight: 18,
  },
  {
    kind: 'main',
    title: 'Этап 4. Документы и сборка',
    clientNote: 'Документы, публикация, сайт и сопутствующая сборка.',
    weight: 18,
  },
  {
    kind: 'main',
    title: 'Этап 5. Финальная передача',
    clientNote: 'Передача итогового комплекта и завершение проекта.',
    weight: 18,
  },
]

// §7: пазл собирается из пяти частей — по одной на основной этап.
export const PUZZLE_PARTS = 5

// ——— §5.2: статусы этапа ———

export type StageStatus =
  | 'locked'
  | 'planned'
  | 'in_progress'
  | 'ready'
  | 'review'
  | 'rework'
  | 'rereview'
  | 'approved'
  | 'paused'

export const STAGE_STATUS: Record<
  StageStatus,
  { label: string; hint: string; chip: string; dot: string }
> = {
  locked: {
    label: 'Заблокирован',
    hint: 'Предыдущая обязательная контрольная точка не завершена.',
    chip: 'bg-chip text-muted',
    dot: '#b6bac1',
  },
  planned: {
    label: 'Запланирован',
    hint: 'Этап настроен, но работа ещё не началась.',
    chip: 'bg-chip text-ink-2',
    dot: '#9498a1',
  },
  in_progress: {
    label: 'В работе',
    hint: 'FRANCHONE готовит материалы.',
    chip: 'bg-[#e8effd] text-[#2563eb]',
    dot: '#2563eb',
  },
  ready: {
    label: 'Готов к передаче',
    hint: 'Все обязательные элементы готовы; этап ещё не отправлен клиенту.',
    chip: 'bg-[#fff6e6] text-[#b7791f]',
    dot: '#d69e2e',
  },
  review: {
    label: 'На проверке',
    hint: 'Этап официально передан клиенту; запущен клиентский таймер.',
    chip: 'bg-[#eef0ff] text-[#5a4bd6]',
    dot: '#6b5ce7',
  },
  rework: {
    label: 'На доработке',
    hint: 'Клиент направил замечания; ответственность вернулась FRANCHONE.',
    chip: 'bg-[#fdefe4] text-[#c05621]',
    dot: '#c05621',
  },
  rereview: {
    label: 'Повторная проверка',
    hint: 'Доработанная версия передана клиенту.',
    chip: 'bg-[#eef0ff] text-[#5a4bd6]',
    dot: '#6b5ce7',
  },
  approved: {
    label: 'Утверждён',
    hint: 'Этап принят, вес добавлен в прогресс и KPI.',
    chip: 'bg-[#e2f2ef] text-green-d',
    dot: '#057269',
  },
  paused: {
    label: 'Приостановлен',
    hint: 'Таймеры остановлены с зафиксированной причиной.',
    chip: 'bg-chip text-muted',
    dot: '#9498a1',
  },
}

// Этап у клиента: пока он не передан, клиенту не нужны наши внутренние
// оттенки «в работе / готов к передаче» — для него это одно состояние.
export function clientStageStatus(s: StageStatus): StageStatus {
  return s === 'ready' ? 'in_progress' : s
}

// §5.3.8: утверждённый этап закрыт от обычного редактирования.
export const isStageClosed = (s: StageStatus) => s === 'approved'
// Этап ждёт клиента — у него идёт клиентский таймер (BR-06).
export const isAtClient = (s: StageStatus) => s === 'review' || s === 'rereview'

// ——— §11.1: статусы материала ———

export type MaterialStatus =
  | 'planned'
  | 'in_progress'
  | 'ready'
  | 'rework'
  | 'reworked'
  | 'approved'

// §5.2: ровно пять состояний. 'reworked' из первой версии остался в схеме
// ради уже записанных строк — новым материалам он не присваивается, и в
// списке выбора его нет; повторная загрузка сразу даёт «Готов к проверке».
export const MATERIAL_STATUS: Record<
  MaterialStatus,
  { label: string; hint: string; chip: string; by: 'packer' | 'client' }
> = {
  planned: {
    label: 'Не начат',
    hint: 'Материал предусмотрен этапом, работа ещё не начата.',
    chip: 'bg-chip text-muted',
    by: 'packer',
  },
  in_progress: {
    label: 'В работе',
    hint: 'Материал готовится.',
    chip: 'bg-[#e8effd] text-[#2563eb]',
    by: 'packer',
  },
  ready: {
    label: 'Готов к проверке',
    hint: 'Версия загружена и доступна заказчику.',
    chip: 'bg-[#fff6e6] text-[#b7791f]',
    by: 'packer',
  },
  rework: {
    label: 'На доработке',
    hint: 'Заказчик вернул материал; причина обсуждается вне ERP.',
    chip: 'bg-[#fdefe4] text-[#c05621]',
    by: 'client',
  },
  reworked: {
    label: 'Готов к проверке',
    hint: 'Загружена новая версия после доработки.',
    chip: 'bg-[#fff6e6] text-[#b7791f]',
    by: 'packer',
  },
  approved: {
    label: 'Принят',
    hint: 'Заказчик подтвердил результат.',
    chip: 'bg-[#e2f2ef] text-green-d',
    by: 'client',
  },
}

// Статусы, которые ставит упаковщик (§5.2, §9.2).
export const PACKER_MATERIAL_STATUSES: MaterialStatus[] = ['planned', 'in_progress', 'ready']

export const MATERIAL_KIND_LABEL: Record<string, string> = {
  file: 'Файл',
  link: 'Ссылка',
  doc: 'Документ',
  design: 'Макет',
  site: 'Сайт',
  other: 'Другое',
}

// Материал считается сделанным со стороны команды: его можно передавать.
export const isMaterialDone = (s: MaterialStatus) =>
  s === 'ready' || s === 'reworked' || s === 'approved'

// ——— §4.1: статус проекта ———

export type PackStatus = 'draft' | 'active' | 'paused' | 'done' | 'archived'

export const PACK_STATUS: Record<PackStatus, { label: string; chip: string }> = {
  draft: { label: 'Черновик', chip: 'bg-chip text-muted' },
  active: { label: 'Активен', chip: 'bg-[#e2f2ef] text-green-d' },
  paused: { label: 'Приостановлен', chip: 'bg-chip text-ink-2' },
  done: { label: 'Завершён', chip: 'bg-[#e8effd] text-[#2563eb]' },
  archived: { label: 'Архив', chip: 'bg-chip text-muted' },
}

// ——— §6.3: индикатор здоровья ———

export type Health = 'green' | 'yellow' | 'red' | 'blue' | 'purple' | 'grey'

export const HEALTH: Record<Health, { label: string; color: string; chip: string }> = {
  green: { label: 'В сроке', color: '#057269', chip: 'bg-[#e2f2ef] text-green-d' },
  yellow: { label: 'Риск срыва', color: '#d69e2e', chip: 'bg-[#fff6e6] text-[#b7791f]' },
  red: { label: 'Просрочено', color: '#c53030', chip: 'bg-[#fdeaea] text-[#c53030]' },
  blue: { label: 'Ждём клиента', color: '#2563eb', chip: 'bg-[#e8effd] text-[#2563eb]' },
  purple: { label: 'Ждём FRANCHONE', color: '#6b5ce7', chip: 'bg-[#eef0ff] text-[#5a4bd6]' },
  grey: { label: 'На паузе', color: '#9498a1', chip: 'bg-chip text-muted' },
}

export type Side = 'client' | 'franchone' | 'none'

export const SIDE_LABEL: Record<Side, string> = {
  client: 'Клиент',
  franchone: 'FRANCHONE',
  none: 'Действий не требуется',
}

// Человеческий срок: «1 день 8 часов», «2 дня», «3 часа», «15 минут».
export function humanDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 60000)) // в минутах
  const days = Math.floor(total / (60 * 24))
  const hours = Math.floor((total - days * 60 * 24) / 60)
  const minutes = total - days * 60 * 24 - hours * 60
  const parts: string[] = []
  if (days > 0) parts.push(`${days} ${plural(days, 'день', 'дня', 'дней')}`)
  if (hours > 0) parts.push(`${hours} ${plural(hours, 'час', 'часа', 'часов')}`)
  // Минуты показываем только когда крупных единиц нет — иначе строка шумит.
  if (parts.length === 0) parts.push(`${minutes} ${plural(minutes, 'минута', 'минуты', 'минут')}`)
  return parts.slice(0, 2).join(' ')
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

// Минимальный срез этапа, которого хватает для расчёта здоровья и прогресса.
export interface StageLike {
  kind: 'zero' | 'main'
  status: StageStatus
  weight: number
  dueAt?: number | null
  awaiting?: 'client' | 'franchone' | null
  endDate?: string | null
}

// ТЗ v1.1 §4.2, §10: прогресс и фактический KPI считаются по сумме весов
// ПРИНЯТЫХ этапов, включая нулевой. В первой версии нулевой этап был
// исключён — версия 1.1 это правило отменила: он «участвует в общем прогрессе
// и KPI с настраиваемым весом», но части пазла не открывает.
export function progressOf(stages: StageLike[]): number {
  return stages.filter((s) => s.status === 'approved').reduce((sum, s) => sum + s.weight, 0)
}

// §4.2: сумма весов ВСЕХ активных этапов, включая нулевой, должна быть 100%.
export function weightSum(stages: StageLike[]): number {
  return stages.reduce((sum, s) => sum + s.weight, 0)
}

// §7.1: финансовая модель проекта.
//   W = P × R / 100   полное вознаграждение упаковщика
//   K = сумма весов утверждённых этапов
//   A = W × K / 100   начисленное вознаграждение
export function packerReward(price: number, percent: number): number {
  return Math.round((price * percent) / 100)
}

export function accruedReward(price: number, percent: number, kpiPercent: number): number {
  return Math.round((packerReward(price, percent) * kpiPercent) / 100)
}

// От кого ждут действия прямо сейчас (§6.3, §8.2). Источник правды — поле
// awaiting самого этапа: оно ставится ровно там, где стартует таймер стороны,
// и снимается при утверждении. Выводить сторону из статуса было бы хрупко —
// у черновика статусы те же, а ждать там некого.
export function responsibleSide(stages: StageLike[]): Side {
  const live = stages.filter((s) => s.status !== 'approved')
  if (live.some((s) => s.awaiting === 'client')) return 'client'
  if (live.some((s) => s.awaiting === 'franchone')) return 'franchone'
  return 'none'
}

export interface HealthInput {
  status: PackStatus
  dueDate: string // общий срок проекта
  stages: StageLike[]
  now: number
  warnHours: number
}

export interface HealthResult {
  health: Health
  side: Side
  // §6.3: «помимо цвета система должна текстом показывать причину».
  reason: string
  // Ближайший активный дедлайн — для таблицы проектов (§8.2).
  nextDueAt: number | null
  overdueMs: number
}

const dueEnd = (iso: string) => Date.parse(`${iso}T23:59:59+05:00`)

export function packHealth(input: HealthInput): HealthResult {
  const { status, dueDate, stages, now, warnHours } = input
  const side = responsibleSide(stages)

  if (status === 'paused') {
    return { health: 'grey', side, reason: 'Проект приостановлен — таймеры остановлены.', nextDueAt: null, overdueMs: 0 }
  }
  if (status === 'draft') {
    return { health: 'grey', side, reason: 'Черновик — проект ещё не открыт клиенту.', nextDueAt: null, overdueMs: 0 }
  }
  if (status === 'done' || status === 'archived') {
    return { health: 'green', side: 'none', reason: 'Проект завершён.', nextDueAt: null, overdueMs: 0 }
  }

  // Активные таймеры этапов: только там, где мы кого-то ждём.
  const timers = stages
    .filter((s) => s.dueAt && s.awaiting && s.status !== 'approved')
    .map((s) => ({ at: s.dueAt as number, side: s.awaiting as 'client' | 'franchone', status: s.status }))
    .sort((a, b) => a.at - b.at)

  const overdue = timers.filter((t) => t.at < now)
  const projectOverdue = dueEnd(dueDate) < now

  if (overdue.length > 0) {
    const worst = overdue[0]
    const late = now - worst.at
    const who =
      worst.side === 'client'
        ? 'согласование просрочено клиентом'
        : 'доработка просрочена упаковщиком'
    return {
      health: 'red',
      side,
      reason: `${who} на ${humanDuration(late)}`,
      nextDueAt: worst.at,
      overdueMs: late,
    }
  }
  if (projectOverdue) {
    const late = now - dueEnd(dueDate)
    return {
      health: 'red',
      side,
      reason: `общий срок проекта просрочен на ${humanDuration(late)}`,
      nextDueAt: timers[0]?.at ?? null,
      overdueMs: late,
    }
  }

  const next = timers[0] ?? null
  const warnMs = warnHours * 3600 * 1000

  if (next && next.at - now <= warnMs) {
    const left = next.at - now
    const who = next.side === 'client' ? 'ожидается согласование клиента' : 'ожидается доработка FRANCHONE'
    return { health: 'yellow', side, reason: `${who} — осталось ${humanDuration(left)}`, nextDueAt: next.at, overdueMs: 0 }
  }
  // Риск срыва общего срока — тоже жёлтый: §6.3 прямо называет это условием.
  if (dueEnd(dueDate) - now <= warnMs) {
    return {
      health: 'yellow',
      side,
      reason: `до общего срока проекта осталось ${humanDuration(dueEnd(dueDate) - now)}`,
      nextDueAt: next?.at ?? null,
      overdueMs: 0,
    }
  }

  if (next) {
    const left = next.at - now
    if (next.side === 'client') {
      return {
        health: 'blue',
        side,
        reason: `ожидается согласование клиента — ${humanDuration(left)}`,
        nextDueAt: next.at,
        overdueMs: 0,
      }
    }
    return {
      health: 'purple',
      side,
      reason: `ожидается действие FRANCHONE — ${humanDuration(left)}`,
      nextDueAt: next.at,
      overdueMs: 0,
    }
  }

  return {
    health: 'green',
    side,
    reason: 'Все активные сроки соблюдаются, критичных рисков нет.',
    nextDueAt: null,
    overdueMs: 0,
  }
}

// §7.3, §11.3: внутренний статус персонального подарка. Заказчику видно
// только право на подарок — ни статус, ни описание ему не показываются.
export type GiftStatus = 'none' | 'chosen' | 'prepared' | 'sent'

export const GIFT_STATUS: Record<GiftStatus, { label: string; chip: string }> = {
  none: { label: 'Не выбран', chip: 'bg-chip text-muted' },
  chosen: { label: 'Выбран', chip: 'bg-[#fff6e6] text-[#b7791f]' },
  prepared: { label: 'Подготовлен', chip: 'bg-[#e8effd] text-[#2563eb]' },
  sent: { label: 'Отправлен', chip: 'bg-[#e2f2ef] text-green-d' },
}

// ——— §12: награды ———

export type RewardStatus = 'locked' | 'available' | 'earned' | 'granted' | 'missed' | 'restored'

export const REWARD_STATUS: Record<RewardStatus, { label: string; chip: string }> = {
  locked: { label: 'Заблокирована', chip: 'bg-chip text-muted' },
  available: { label: 'Доступна', chip: 'bg-[#fff6e6] text-[#b7791f]' },
  earned: { label: 'Заработана', chip: 'bg-[#e2f2ef] text-green-d' },
  granted: { label: 'Выдана', chip: 'bg-[#e2f2ef] text-green-d' },
  missed: { label: 'Не получена', chip: 'bg-[#fdeaea] text-[#c53030]' },
  restored: { label: 'Восстановлена', chip: 'bg-[#eef0ff] text-[#5a4bd6]' },
}

// §8: видео проигрывается ВНУТРИ ERP. Из ссылки YouTube достаём id ролика —
// поддерживаем обычную ссылку, короткую youtu.be, /embed/ и /shorts/.
export function youtubeId(url: string | null | undefined): string | null {
  if (!url) return null
  const m = url.match(
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/,
  )
  return m ? m[1] : null
}

// ——— §13.3: контент ———

// §8: три типа полезных материалов первой очереди — видео, статья и тест.
// Остальные остались от версии 1.0 и продолжают работать как простые карточки.
export const CONTENT_KINDS_V11 = ['video', 'article', 'test'] as const

export const CONTENT_KIND_LABEL: Record<string, string> = {
  article: 'Статья',
  video: 'Видео',
  test: 'Тест',
  guide: 'Инструкция',
  checklist: 'Чек-лист',
  template: 'Шаблон',
  offer: 'Предложение',
}

export const CONTENT_AVAILABILITY_LABEL: Record<string, string> = {
  always: 'Доступен сразу',
  after_stage: 'После этапа',
  post_project: 'После завершения проекта',
}

// ——— §13.2: постпроектные сценарии ———

// §6.1: платёжные и иные контрольные даты проекта.
export const MILESTONE_KIND_LABEL: Record<string, string> = {
  payment: 'Платёж',
  control: 'Контрольная точка',
}

export const SCENARIO_TRIGGER_LABEL: Record<string, string> = {
  days_after_finish: 'Через N дней после завершения',
  client_action: 'По действию клиента',
  no_activity: 'При отсутствии активности клиента',
  test_result: 'По результату теста',
  manual: 'Вручную',
}

export const SCENARIO_ACTION_LABEL: Record<string, string> = {
  notify: 'Отправить уведомление',
  material: 'Открыть материал',
  recommendation: 'Дать рекомендацию',
  test: 'Предложить тест',
  invite: 'Отправить приглашение',
  offer: 'Предложить услугу',
}

// ——— §14.2: типы событий журнала ———

export const EVENT_LABEL: Record<string, string> = {
  created: 'проект создан',
  launched: 'проект открыт клиенту',
  updated: 'изменены параметры проекта',
  finance: 'изменена экономика проекта',
  stage_added: 'добавлен этап',
  stage_removed: 'удалён этап',
  stage_updated: 'изменён этап',
  stage_weight: 'изменён вес этапа',
  stage_dates: 'перенесён срок этапа',
  stage_started: 'этап взят в работу',
  stage_handover: 'этап передан клиенту',
  stage_return: 'этап возвращён на доработку',
  stage_approved: 'этап утверждён',
  stage_reopened: 'этап переоткрыт',
  material_added: 'добавлен материал',
  material_status: 'изменён статус материала',
  material_version: 'загружена новая версия',
  material_removed: 'удалена версия материала',
  comment: 'добавлен комментарий',
  paused: 'проект приостановлен',
  resumed: 'проект возобновлён',
  packer_changed: 'изменён ответственный',
  kpi_accrued: 'начислен KPI упаковщика',
  payout: 'выплата вознаграждения',
  puzzle: 'часть пазла',
  gift: 'персональный подарок',
  milestone: 'контрольная дата',
  kpi_recalc: 'пересчитан KPI упаковщика',
  reward: 'награда',
  finished: 'проект завершён',
  hub: 'открыт итоговый хаб',
  archived: 'проект архивирован',
  reopened: 'проект повторно открыт',
  scenario: 'постпроектный сценарий',
}
