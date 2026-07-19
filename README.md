# FRANCHONE ERP — Админ-панель

Веб-панель для контроля работы команды FRANCHONE по модели **план → факт → KPI → выплата**,
с задачником (Kanban) и управлением командой. Дизайн скопирован с `docs/demo_design.html`
(зелёная палитра, шрифт Inter), интерфейс на русском.

## Стек
React 18 · TypeScript · Vite · Tailwind CSS · React Router · lucide-react · **Convex** (бэкенд)

## Запуск
```bash
npm install
npm run dev      # http://localhost:5173
```
Сборка: `npm run build` · Превью сборки: `npm run preview`

## Разделы (сайдбар)
- **Дашборд** — KPI по сотрудникам, выплаты к начислению, реклама (расход/заявки/CPL,
  FRANCHONE vs Партнёр), задачи и просрочки.
- **Задачи** — Kanban: Бэклог / В работе / На проверке / Готово (приоритеты, дедлайны,
  чек-листы, метки, исполнители).
- **KPI** — хаб с вкладками **Планы / Факт / Выплаты**. Движки SMM и Таргетолога.
- **Команда** — список сотрудников, роли, оклады, KPI, действия.
- **Настройки** — веса KPI, оклады, справочники, роли.

Роль переключается в топбаре («Просмотр как») — меняется видимость разделов и срез данных.

## Формулы KPI
Воспроизведены дословно из Excel (`docs/KPI_SMM.xlsx`, `docs/KPI_TARGETOLOG.xlsx`),
код в `src/lib/kpi.ts`. Базовое правило: **Выплата = Оклад × Итоговый KPI** (KPI ≤ 100%).
Сверено на данных: SMM оклад 600 000 ₸ × KPI 0.2908 = 174 500 ₸.

## Структура
```
src/
  components/       Layout, Sidebar, Topbar, PageHeader, ui/*
  pages/            Dashboard, Tasks, Kpi, Team, Settings
  lib/              kpi.ts (формулы), selectors.ts, format.ts
  data/mock.ts      демо-данные FRANCHONE
  store.tsx         роль/пользователь (демо доступа)
  types.ts
docs/               ТЗ, KPI-таблицы, презентация, demo_design.html
```

## Бэкенд — Convex

Бэкенд (база данных + серверные функции) — на [Convex](https://convex.dev). Код в папке `convex/`:
- `schema.ts` — модель данных (employees, smmMetrics, campaigns, tasks, settings).
- `employees.ts` · `tasks.ts` · `campaigns.ts` · `smm.ts` · `settings.ts` — queries и mutations (CRUD).
- `seed.ts` — наполнение базы демо-данными.

**Первый запуск (нужен вход в аккаунт Convex — делается один раз):**
```bash
npx convex dev        # войти/создать проект → создаст .env.local и convex/_generated/
npx convex run seed:run   # наполнить базу демо-данными
```
`npx convex dev` держите запущенным в отдельном терминале рядом с `npm run dev`.
Пока `VITE_CONVEX_URL` не задан, приложение работает на демо-данных из `src/data/mock.ts`.

## Статус
UI-полный прототип. Бэкенд Convex подключён и описан (схема + функции + сид). Дальше:
после `npx convex dev` — связать экраны с базой (`useQuery`/`useMutation`), оживить CRUD
(drag-and-drop канбана, формы создания/редактирования, команда).
