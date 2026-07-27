// Общая модель прав (§9). Импортируется и сервером (convex), и фронтом (src),
// как kpiMath — чистый TS без серверных зависимостей.
//
// Курируемая матрица: у каждого раздела только осмысленные действия. Просмотр
// двухрежимный: «Только свои» (view) и «Все» (viewAll) — взаимоисключающие.
// Владелец всегда имеет всё и в матрице не хранится; настраиваются head и
// employee. Жёсткие инварианты вне матрицы (только владелец): назначение ролей,
// смена окладов, редактирование самой матрицы, Настройки. Скоуп: владелец —
// вся команда, «view» — руководитель свой отдел / сотрудник только своё,
// «viewAll» — вся команда.

export type PermRole = 'head' | 'employee'
export type PermAction = 'view' | 'viewAll' | 'create' | 'edit' | 'delete' | 'assign'

export const PERM_SECTIONS: { key: string; label: string; actions: PermAction[] }[] = [
  { key: 'tasks', label: 'Задачи', actions: ['view', 'viewAll', 'create', 'edit', 'delete', 'assign'] },
  { key: 'reports', label: 'Отчёты', actions: ['view', 'viewAll', 'edit', 'delete'] },
  { key: 'kpi', label: 'KPI', actions: ['view', 'viewAll', 'edit'] },
  { key: 'team', label: 'Команда', actions: ['view', 'viewAll', 'create', 'edit', 'delete'] },
  { key: 'activity', label: 'Активность', actions: ['view', 'viewAll'] },
]

export const ACTION_LABEL: Record<PermAction, string> = {
  view: 'Только свои',
  viewAll: 'Все',
  create: 'Создание',
  edit: 'Редактирование',
  delete: 'Удаление',
  assign: 'Назначение',
}

// Взаимоисключающие режимы просмотра — включение одного снимает другой.
export const VIEW_MODES: PermAction[] = ['view', 'viewAll']

export const permKey = (section: string, action: string) => `${section}:${action}`

export const ALL_PERM_KEYS: string[] = PERM_SECTIONS.flatMap((s) =>
  s.actions.map((a) => permKey(s.key, a)),
)

// Дефолты. Руководитель — всё в рамках отдела (просмотр «свои» = свой отдел).
// Сотрудник — по задачам всё, кроме удаления, и свой KPI; просмотр «только свои».
export const DEFAULT_PERMS: Record<PermRole, string[]> = {
  head: [
    'tasks:view', 'tasks:create', 'tasks:edit', 'tasks:delete', 'tasks:assign',
    'reports:view', 'reports:edit', 'reports:delete',
    'kpi:view', 'kpi:edit',
    'team:view', 'team:create', 'team:edit', 'team:delete',
    'activity:view',
  ],
  employee: [
    'tasks:view', 'tasks:create', 'tasks:edit', 'tasks:assign',
    'kpi:view',
  ],
}
