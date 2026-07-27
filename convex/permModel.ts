// Общая модель прав (§9). Импортируется и сервером (convex), и фронтом (src),
// как kpiMath — чистый TS без серверных зависимостей.
//
// Курируемая матрица: у каждого раздела только осмысленные действия. Владелец
// всегда имеет всё и в матрице не хранится. Настраиваются роли head и employee.
// Жёсткие инварианты вне матрицы (только владелец): назначение ролей, смена
// окладов, редактирование самой матрицы, Настройки. Скоуп применяется отдельно:
// владелец — вся команда, руководитель — свой отдел, сотрудник — только своё.

export type PermRole = 'head' | 'employee'
export type PermAction = 'view' | 'create' | 'edit' | 'delete' | 'assign'

export const PERM_SECTIONS: { key: string; label: string; actions: PermAction[] }[] = [
  { key: 'tasks', label: 'Задачи', actions: ['view', 'create', 'edit', 'delete', 'assign'] },
  { key: 'reports', label: 'Отчёты', actions: ['view', 'edit', 'delete'] },
  { key: 'kpi', label: 'KPI', actions: ['view', 'edit'] },
  { key: 'team', label: 'Команда', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'activity', label: 'Активность', actions: ['view'] },
]

export const ACTION_LABEL: Record<PermAction, string> = {
  view: 'Просмотр',
  create: 'Создание',
  edit: 'Редактирование',
  delete: 'Удаление',
  assign: 'Назначение',
}

export const permKey = (section: string, action: string) => `${section}:${action}`

export const ALL_PERM_KEYS: string[] = PERM_SECTIONS.flatMap((s) =>
  s.actions.map((a) => permKey(s.key, a)),
)

// Дефолты. Руководитель — почти всё (в рамках своего отдела, скоуп применяется
// отдельно). Сотрудник — только просмотр своих задач и своего KPI.
export const DEFAULT_PERMS: Record<PermRole, string[]> = {
  head: [
    'tasks:view', 'tasks:create', 'tasks:edit', 'tasks:delete', 'tasks:assign',
    'reports:view', 'reports:edit', 'reports:delete',
    'kpi:view', 'kpi:edit',
    'team:view', 'team:create', 'team:edit', 'team:delete',
    'activity:view',
  ],
  employee: ['tasks:view', 'tasks:create', 'kpi:view'],
}
