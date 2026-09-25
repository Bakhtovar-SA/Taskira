# Инвентаризация продукта (ТЗ 5.1)

Фактическая картина продукта до редизайна. Источник — только код и измерения; документация
(README, ARCHITECTURE, CLAUDE.md, DocsView) как источник не использовалась. Ничего не исправлено:
находки, требующие действий, собраны строками в [конце документа](#находки-требующие-действий).

**Что описано.** Коммит `7d500ad` (ветка `claude/peaceful-bell-nw8dby`: ТЗ 5.4, токены ADR-0012,
`src/styles/tokens.css`). Рабочее дерево этой инвентаризации было на `main` (`adb98ec`) и
fast-forward перемотано на `7d500ad`, потому что ТЗ требует описывать код с токен-рефакторингом.
Код, который обслуживают локально запущенные API (:8080) и Vite (:3000), совпадает с описанным:
`diff -rq` по `src`, `server/src`, `server/migrations`, `shared`, `scripts`, `public`, `index.html`,
`package.json`, `vite.config.js` между этим деревом и основным checkout не нашёл различий.

**Формат доказательств.** `путь:строка` — место в коде на `7d500ad`. «Вывод команды» — дословные
числа из прогонов, описанных в [приложении](#приложение-как-получены-числа). Все временные
скрипты лежали вне репозитория (scratchpad) и не закоммичены.

---

## 1. Функции сервера без интерфейса

### 1.1. Как получен список

Список маршрутов получен программно, а не чтением файлов: временный скрипт импортирует
`buildApp()` из `server/src/app.ts`, вешает хук `onRoute` до `app.ready()` и печатает
`app.printRoutes()`. Хук видит маршруты, зарегистрированные плагинами; четыре маршрута,
зарегистрированных прямо на корне до хука (`/health`, `/ready`, `/api/health`, `/metrics`,
`server/src/app.ts:162,207,209,211`), взяты из вывода `printRoutes()`.

```
onRoute: 94 пары «метод + путь» под /api (без HEAD/OPTIONS): GET 36, POST 26, DELETE 16, PATCH 11, PUT 5
printRoutes: + /health, /ready, /api/health, /metrics (GET)  →  всего 98
```

Затем каждый маршрут сопоставлен с методом в `src/api/index.ts`, а метод — с местом вызова
(поиск `xxxApi.method` по `src/` без тестов; для методов, обёрнутых в стор, — второй шаг: действие
стора → компонент).

**Итог по 98 маршрутам:**

| Категория | Кол-во | Маршруты |
|---|---:|---|
| Используются интерфейсом | 77 | см. 1.4 |
| Продуктовая функция есть на сервере, интерфейса нет | 11 | см. 1.2 |
| GET-дубли: данные приходят другим путём, метод клиента не вызывается или отсутствует | 6 | см. 1.3 |
| Эксплуатационные (UI не ожидается) | 4 | `/health`, `/ready`, `/api/health`, `/metrics` |

### 1.2. Серверные функции без интерфейса

| # | Функция | Маршрут / механизм | Клиент (`src/api/index.ts`) | Где в UI | Доказательство |
|---|---|---|---|---|---|
| 1 | **Статус лицензии** | HTTP-маршрута нет вообще. `getLicenseStatus()` вызывается только из `requiresPlan()` и фоновой проверки | нет | нигде | `server/src/services/license.ts:149`; маршрута нет в выводе `onRoute`/`printRoutes` |
| 2 | **`requiresPlan(feature)`** (гейт по плану лицензии) | подключён к **0** маршрутам | — | — | определение `server/src/middleware.ts:310`; `grep -rn requiresPlan server/src` не находит вызовов |
| 3 | Установка лицензии | только CLI `npm run license:install` | нет | нигде | `server/package.json` (`license:install` → `scripts/install-license.ts`) |
| 4 | **Статус фоновых задач обслуживания** | `GET /api/maintenance` | нет метода | нигде | `server/src/routes/maintenance.ts:14` |
| 5 | **Ручной запуск обслуживания** (dry-run/реальный) | `POST /api/maintenance/run?dryRun=` | нет метода | нигде | `server/src/routes/maintenance.ts:32` |
| 6 | **Предупреждения деградации** (`search_index_missing`) | поле `warnings` в `GET /api/health` / `/ready` | нет метода | нигде (`grep warnings src/` — пусто) | `server/src/app.ts:186-201`, `server/src/services/healthWarnings.ts:9,35` |
| 7 | **Экспорт журнала аудита** (JSONL/CSV) | `GET /api/admin/audit-log/export` | нет метода | нигде; просмотра аудита в UI тоже нет | `server/src/routes/auditExport.ts:28` |
| 8 | **Создание пользователя** (режим local) | `POST /api/admin/users` | `usersApi.create` есть, **не вызывается** | нигде | `server/src/routes/users.ts:49`; `src/api/index.ts:348` |
| 9 | **Глобальная роль и деактивация пользователя** | `PATCH /api/users/:id` (`globalRole`, `isActive`) | нет метода | нигде | `server/src/routes/users.ts:80`; `server/src/contract.ts:136-139` |
| 10 | Проверка связи с LDAP | `POST /api/ldap/ping` | `ldapApi.ping` есть, **не вызывается** | нигде | `server/src/routes/ldap.ts:10`; `src/api/index.ts:294` |
| 11 | **Подписка на задачу (watchers)** | `POST` / `DELETE /api/projects/:projectId/issues/:id/watchers/me` | нет метода | нигде (есть только общая настройка «подписывать на мои задачи») | `server/src/routes/issues.ts:728,739` |
| 12 | Редактирование шаблона задачи | `PATCH …/issue-templates/:templateId` | `issueTemplatesApi.update` → действие стора `updateIssueTemplateAction` | **ни один компонент не вызывает** — шаблон можно только создать и удалить | `server/src/routes/issueTemplates.ts:73`; `src/store/meta.ts:102`; `src/store.tsx:456` |
| 13 | Переименование кастомного поля | `PATCH …/custom-fields/:fieldId` (только `name`) | `customFieldsApi.rename` → `renameCustomField` | **ни один компонент не вызывает** | `server/src/routes/customFields.ts:47`; `server/src/contract.ts:392-394`; `src/store/meta.ts:159` |
| 14 | Изменение сохранённой вьюхи (переименование, «по умолчанию») | `PATCH …/saved-views/:viewId` | `savedViewsApi.update` есть, **не вызывается** | нигде | `server/src/routes/savedViews.ts:40`; `src/api/index.ts:662` |

Строки 1–3 не соответствуют маршрутам (у лицензии маршрута нет), поэтому в счётчик «11 маршрутов»
из 1.1 входят строки 4, 5 и 7–14 (строка 11 — два маршрута, остальные — по одному).

**Параметры существующих маршрутов, которых UI не выставляет** (маршрут используется, но часть его
возможностей недоступна из интерфейса):

| Параметр | Где на сервере | Что из этого следует для UI |
|---|---|---|
| `archived=1\|all` у `GET …/issues` | `server/src/contract.ts:493` | Архивные задачи недоступны из интерфейса иначе как по прямой ссылке: списки их не показывают, а глобальный поиск архив явно исключает (`server/src/routes/search.ts:55,59,63,67` — `archived_at IS NULL`). |
| `dueFrom` / `dueTo` у `GET …/issues` | `server/src/contract.ts:481-482` | Фильтра по диапазону сроков нет нигде. |
| `sprintId` в `IssueFilterQuery` и `SavedViewFilter` | `server/src/contract.ts:473,509` | Ни «Список задач», ни вьюхи не фильтруют по спринту. |
| `departmentId` у `GET /api/reports/summary` и `…/issues.csv` | `server/src/contract.ts:606` | В «Отчётах» есть только фильтр по проекту (`src/components/ReportsView.tsx:98`). |
| `limit` у CSV-выгрузки (до 10 000, по умолч. 5 000) | `server/src/contract.ts:615` | Не настраивается. |
| `description`, `departmentId` у `POST/PATCH /api/projects…` | `server/src/contract.ts:200,210`; `src/api/index.ts:307-318` | Описание проекта не вводится и не показывается нигде; перенести проект в другой отдел нельзя. |
| `parentId` у `PATCH …/issues/:id` | `server/src/contract.ts:255` | Подзадачу можно создать кнопкой «+ добавить подзадачу», но сменить или снять родителя у существующей задачи нельзя. |
| `isDefault` у сохранённой вьюхи | `server/src/contract.ts` (`SavedView*`) | UI всегда отправляет `isDefault: false` (`src/components/Backlog.tsx:251`). |

**Проверка кандидатов, названных в ТЗ:**

- *Статус лицензии и `requiresPlan` (ТЗ 4.3).* Подтверждено: UI нет, HTTP-маршрута нет, гейт подключён к 0 маршрутам (строки 1–3).
- *`GET/POST /api/maintenance` (MAINT-01).* Подтверждено: методов в клиенте нет (строки 4–5).
- *warnings в `/api/health`.* Подтверждено: клиент `/api/health` не вызывает вовсе (строка 6).
- *Сохранённые вьюхи вне «Списка задач».* Подтверждено: `savedViewsApi` вызывается только из `src/components/Backlog.tsx:217,253,261`. На «Доске» вьюх нет; комментарий в `src/router.ts:63-67` прямо говорит, что `Board.tsx` «не подключён в этом релизе».
- *Массовые операции вне «Списка задач».* Подтверждено: `issuesApi.bulk` вызывается только через `bulkApplyIssueAction` (`src/store/issueCrud.ts:334`), а его единственный потребитель — `src/components/Backlog.tsx:124,288-297`. На «Доске», в «Спринтах» и на «Таймлайне» выделения нет.
- *Настройки уведомлений.* Интерфейс частично есть: `PATCH /api/notifications/prefs` вызывается из блока в меню пользователя топбара (`src/components/Topbar.tsx:376-413`), доступны только `email: instant|daily` и `selfWatch`. Значение `off` сознательно не предлагается (`server/src/contract.ts:410-419`). Выбора типов уведомлений нет ни на сервере, ни в UI. Подписки на конкретную задачу нет в UI (строка 11). На главном экране и в одиночном режиме блока нет (см. раздел 4).

### 1.3. Дублирующие GET-маршруты (данные приходят другим путём)

| Маршрут | Клиент | Откуда UI берёт те же данные |
|---|---|---|
| `GET …/workflow` | метода нет | bootstrap `GET /api/projects/:projectId` (`server/src/contract.ts:894-902`) |
| `GET …/issue-templates` | метода нет | bootstrap |
| `GET …/custom-fields` | метода нет | bootstrap |
| `GET …/sprints` | метода нет | bootstrap |
| `GET …/issues/:id/collaborators` | `collaboratorsApi.list` — не вызывается (`src/api/index.ts:592`) | детальная задача `GET …/issues/:id` |
| `GET …/issues/:id/attachments` | `attachmentsApi.list` — не вызывается (`src/api/index.ts:601`) | детальная задача |

### 1.4. Маршруты, которые используются (сопоставление маршрут → метод → место в UI)

| Ресурс | Маршруты | Метод клиента | Где вызывается |
|---|---|---|---|
| Сессия | `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `GET /auth/config` | `authApi.*` | `LoginForm.tsx:22`; `store/session.ts:323,109,115` → «Выйти» в Topbar/HomeView/SoloView |
| Пользователи | `GET /users`, `GET /users/pickable`, `GET /users/:id/avatar`, `POST/DELETE /me/avatar` | `usersApi.list/pickable`, `getAvatarBlobUrl`, `avatarApi.upload/remove` | `AdminView.tsx:293`, `PermissionsView.tsx:38`, `ui.tsx:748` (UserSearchPicker), `ui.tsx:27`, `store/notifications.ts:93,107` → карточка пользователя |
| LDAP | `POST /ldap/resync` | `ldapApi.resync` | `store/org.ts:170` → «Пересинхронизировать LDAP» (`AdminView.tsx:336-344`, только `AUTH_MODE=ldap`) |
| Уведомления | `GET /notifications`, `GET /notifications/unread-count`, `POST /notifications/read`, `POST /notifications/dismiss`, `PATCH /notifications/prefs` | `notificationsApi.*` | `store/notifications.ts:15,26,38,53,67` → колокол и меню пользователя в Topbar |
| Отчёты | `GET /reports/summary`, `GET /reports/issues.csv` | `reportsApi.summary`, `downloadReportCsv` | `ReportsView.tsx:98,114` |
| Полный экспорт | `GET /admin/export` | метода нет — прямая ссылка `<a href>` | `AdminView.tsx:326-335` («Экспорт данных») |
| Кросс-проектные | `GET /issues/collaborating`, `/issues/assigned-to-me`, `/issues/search`, `/issues/resolve` | `issuesApi.*` | `store/session.ts:114,280`, `store/favoritesSearch.ts:46`, `useRouterSync.ts:73` |
| Отделы | `GET/POST /departments`, `PATCH/DELETE /departments/:id`, `GET /departments/:id/members`, `PUT/DELETE …/members/:userId` | `departmentsApi.*` | `store/org.ts:102-193`, `AdminView.tsx:181,229,244` |
| Проекты | `GET/POST /projects`, `GET/PATCH/DELETE /projects/:projectId`, `PUT/DELETE …/favorite` | `projectsApi.*` | `store/org.ts:205-254`, `store/session.ts:59,112`, `store/favoritesSearch.ts:26-27` |
| Участники | `PUT/DELETE …/members/:userId` | `membersApi.*` | `store/org.ts:18-87` → «Права доступа», «Департаменты» |
| Задачи | `GET/POST …/issues`, `GET …/issues/counts`, `…/epics`, `…/assignees`, `PATCH …/issues/bulk`, `GET/PATCH/DELETE …/issues/:id`, `GET …/activity`, `POST …/transition` | `issuesApi.*` | `issuePages.ts:129-432`, `Board.tsx:444`, `store/issueCrud.ts:44-337`, `store/session.ts:412-414` |
| Подресурсы задачи | вложения (POST/GET/DELETE `:attId`), связи, чек-лист, значения кастомных полей, комментарии, участники задачи (PUT/DELETE), `PATCH …/sprint` | `attachmentsApi`, `issuesApi.*Link/*Checklist*/setCustomFieldValue/setSprint`, `commentsApi`, `collaboratorsApi.add/remove` | `store/issueSub.ts:31-293`, `SoloView.tsx:66,102,179`, `store/sprints.ts:79` |
| Схема проекта | `POST/DELETE …/workflow/transitions`, `POST …/workflow/reset`, `POST/DELETE …/issue-templates`, `POST/DELETE …/custom-fields` | `workflowApi`, `issueTemplatesApi.create/remove`, `customFieldsApi.create/remove` | `store/meta.ts:22-195` → `WorkflowView.tsx` |
| Спринты | `POST …/sprints`, `POST …/sprints/:id/start`, `…/complete` | `sprintsApi.*` | `store/sprints.ts:17,33,49` → `SprintsView.tsx` |
| Вьюхи | `GET/POST …/saved-views`, `DELETE …/:viewId` | `savedViewsApi.list/create/remove` | `Backlog.tsx:217,253,261` |
| Реалтайм | `GET /api/ws` | `new WebSocket` | `store.tsx:334-351` (только сигнал `notify` → `refreshUnreadCount`) |

---

## 2. Интерфейс без функции

Кнопок-заглушек в прямом смысле (пустой `onClick`, `href="#"`, «скоро», «в разработке») в коде нет:
поиск по `TODO|FIXME|скоро|coming soon|not implemented|в разработке|href="#"|onClick={() => {}}`
в `src/**/*.tsx` ничего не нашёл. Есть элементы, которые показываются, но ничего полезного не
делают или ведут на экран-отказ:

| # | Элемент | Что происходит | Доказательство |
|---|---|---|---|
| 1 | Звёздочка «вьюха по умолчанию» в меню «Вьюхи» | Рисуется при `v.isDefault`, но UI всегда сохраняет `isDefault: false`, изменить флаг нечем (метод `update` не вызывается), а сам флаг при открытии списка нигде не применяется. Для вьюх, созданных из интерфейса, звёздочка не появится никогда. | `src/components/Backlog.tsx:251,457`; `grep isDefault src` — только эти две строки |
| 2 | Горячая клавиша **7** («Департаменты») у не-администратора | Открывает экран-отказ «Раздел доступен только администратору ресурса», хотя в сайдбаре пункт для него скрыт. `setView` ничего не проверяет. | `src/App.tsx:108-119`; `src/store.tsx:420`; `src/components/Sidebar.tsx:39,97`; `src/components/AdminView.tsx:299-307` |
| 3 | Горячая клавиша **9** («Мои подключения») без приглашений | Открывает пустой раздел, который в сайдбаре в этом случае скрыт. | `src/App.tsx:117`; `src/components/Sidebar.tsx:98` |
| 4 | Прямой URL `/p/KEY/sprints` в проекте с выключенным модулем | Экран «Модуль спринтов не подключён» вместо перехода: маршрут `sprints` принимается для любого проекта. У «Спринтов» нет горячей клавиши. | `src/router.ts:15-17`; `src/components/SprintsView.tsx:271-273`; `src/App.tsx:108-118` |
| 5 | Логотип в сайдбаре, когда проектов меньше двух | Это `<button>`: фокусируется с клавиатуры и озвучивается, но `onClick` равен `undefined`. | `src/components/Sidebar.tsx:66-74` |
| 6 | «Как это работает?» в «Рабочем процессе» | Единственное действие — тост с одной фиксированной подсказкой. | `src/components/WorkflowView.tsx:269-274`; `src/i18n/ru.ts:536` |
| 7 | Карта статусов в «Рабочем процессе» | Координаты заданы только для четырёх стандартных `sid`. Статус с другим `sid` не отрисуется: `if (!p) return null`. Сейчас это не проявляется, потому что добавить статус негде (см. раздел 4). | `src/components/WorkflowView.tsx:10-19,181-182` |
| 8 | Зона сброса у завершённого спринта | Выглядит как зона перетаскивания, но сброс молча игнорируется, без подсказки. | `src/components/SprintsView.tsx:226` |
| 9 | Подзаголовок «Документации»: «всегда актуален, так как генерируется из кода» | Утверждение ложно: раздел — рукописный JSX. Английская версия — отдельный, значительно более короткий текст. | `src/components/DocsView.tsx:43,91,100` |
| 10 | Кнопка «Создать» в топбаре для роли «Наблюдатель» | Отключена навсегда (по правам), с подсказкой. Легитимно, но это постоянный неактивный элемент в главной панели. | `src/components/Topbar.tsx:665-670` |
| 11 | Кнопки «Убрать» у LDAP-членства в отделе и корзина у отдела с проектами | Отключены, объяснение — в `title`. Легитимно (по данным). | `src/components/AdminView.tsx:227,393` |
| 12 | Строки словаря без экрана | `sidebar.tagline` («issue tracking»), `userCard.jobRole`, `userCard.phone` — ключи есть в словарях, в коде не используются. | `src/i18n/ru.ts:91,126,127`; поиск ключей по `src/` — 3 из 577 не найдены |

---

## 3. Карта экранов

### 3.1. Маршруты (`src/router.ts`)

Разбор путей — `parsePath()` (`src/router.ts:54-61`), синхронизация URL ↔ состояние —
`src/useRouterSync.ts`. Экран определяется сначала `bootStatus`, потом путём.

| Путь | Экран | Условия / откуда попадают | Доказательство |
|---|---|---|---|
| любой, нет сессии | `LoginForm` | `bootStatus = unauthenticated\|error`; путь сохраняется, после входа разбирается заново | `src/App.tsx:129-137` |
| любой, идёт загрузка | `BootSkeleton` | `bootStatus = idle\|loading` | `src/App.tsx:31-64,125-127` |
| `/` | `HomeView` (главный экран) | `bootStatus = home` (доступно ≥ 2 проектов, проект ещё не выбран); из лого сайдбара и крошки «Проекты» | `src/App.tsx:143`; `src/useRouterSync.ts:27,64-66` |
| `/` | `SoloView` (одиночный режим) | `bootStatus = solo` (приглашён к задачам, проектов нет) | `src/App.tsx:140` |
| `/reports` | `ReportsView` | единственный вид без проекта; сайдбар, клавиша 4 | `src/router.ts:31-32,55` |
| `/p/:projectKey/board` | `Board` | сайдбар, клавиша 1; вид по умолчанию | `src/App.tsx:163` |
| `/p/:projectKey/backlog` | `Backlog` («Список задач»); query: `status, assignee, type, priority, label, overdue, done` | сайдбар, клавиша 2 | `src/components/Backlog.tsx:133-154`; `src/router.ts:68-99` |
| `/p/:projectKey/sprints` | `SprintsView` | сайдбар, только при `sprintsEnabled`; клавиши нет | `src/components/Sidebar.tsx:29` |
| `/p/:projectKey/timeline` | `TimelineView` | сайдбар, клавиша 3 | |
| `/p/:projectKey/workflow` | `WorkflowView` («Рабочий процесс») | сайдбар, клавиша 5 | |
| `/p/:projectKey/access` | `PermissionsView` («Права доступа») | сайдбар, клавиша 6 | |
| `/p/:projectKey/admin` | `AdminView` («Департаменты») | сайдбар только для глобального admin; клавиша 7 — у всех (см. раздел 2) | |
| `/p/:projectKey/docs` | `DocsView` | сайдбар, клавиша 8 | |
| `/p/:projectKey/collaborating` | `CollaboratingView` («Мои подключения») | сайдбар при наличии приглашений; клавиша 9 — всегда | |
| `/p/:projectKey/issue/:issueKey` | `Board` + `IssueModal` поверх | прямая ссылка, «Скопировать ссылку» в карточке. Ключ резолвится через `GET /api/issues/resolve`. Ссылка на приглашённую задачу ведёт в «Мои подключения» **без выбора** этой задачи. | `src/router.ts:38-39,56-57`; `src/useRouterSync.ts:84-93` |
| `?q=…&scope=all` на любом пути | состояние выпадашки глобального поиска | восстанавливается при перезагрузке и из вставленной ссылки | `src/components/Topbar.tsx:36-61` |
| прочие пути | как `root` | при ≥ 2 проектах — главный экран, иначе текущий проект | `src/router.ts:60`; `src/useRouterSync.ts:64-66` |

Внутри экрана раздела: `ErrorBoundary` («Раздел не открылся», `src/App.tsx:156-174`,
`src/components/ErrorBoundary.tsx:60-66`). Мобильная навигация (< 768 px): нативный `<select>`
в топбаре (`src/components/Topbar.tsx:589-621`).

### 3.2. Модальные окна (`<Modal>`, `src/ui.tsx:360`) и системные диалоги

| Окно | Откуда вызывается | Доказательство |
|---|---|---|
| `IssueModal` (карточка задачи, 940 px) | клик/Enter по карточке «Доски»; строка и меню «…» в «Списке задач»; результаты поиска в топбаре; колокол уведомлений; полоса «Таймлайна»; строка в «Спринтах»; подзадачи, связи и родитель внутри самой карточки; прямая ссылка `/p/…/issue/…`; «Мои задачи» и «Недавняя активность» на главном экране (через `switchProject(…, issueId)`) | `src/App.tsx:180`; `src/components/Board.tsx:129,154`; `src/components/Backlog.tsx:48,105`; `src/components/Topbar.tsx:113,225,270`; `src/components/TimelineView.tsx:243`; `src/components/IssueModal.tsx:299,543,696`; `src/components/HomeView.tsx:124` |
| `IssueModal` — вариант «Задача недоступна» (420 px) | если нет профиля или статуса задачи | `src/components/IssueModal.tsx:620-637` |
| `CreateIssueModal` (620 px) | «Создать» в топбаре; клавиша C; «Создать задачу» в пустом состоянии главного экрана; «+ добавить подзадачу» в карточке (фиксированный родитель) | `src/components/Topbar.tsx:659`; `src/App.tsx:102-106`; `src/components/HomeView.tsx:78-82`; `src/components/IssueModal.tsx:319` |
| `ImportTrelloModal` (520 px) | «Импорт из Trello» в шапке «Списка задач» (право `create`) | `src/components/Backlog.tsx:321-328,667`; `src/components/ImportTrelloModal.tsx:109` |
| Подтверждение массового удаления (420 px) | «Удалить» на панели массовых действий «Списка задач» | `src/components/Backlog.tsx:572-590` |
| `CreateSprintModal` (440 px) | «+ Спринт» в «Спринтах» | `src/components/SprintsView.tsx:103,302,321` |
| `window.confirm` (нативный) | удаление отдела, удаление проекта (`AdminView`); завершение спринта | `src/components/AdminView.tsx:390,464`; `src/components/SprintsView.tsx:215` |
| Встроенное подтверждение «Удалить? да / нет» | корзина в шапке карточки задачи | `src/components/IssueModal.tsx:712-723` |

Drawer'ов (выезжающих панелей) в коде нет.

### 3.3. Поповеры, выпадающие меню, подсказки

| Поповер | Где | Доказательство |
|---|---|---|
| Переключатель проектов (поиск, избранное, группы по отделам, звезда избранного) | крошка в топбаре | `src/components/Topbar.tsx:504-584` |
| Панель уведомлений (прочитать всё, очистить, скрыть одно) | колокол в топбаре и на главном экране | `src/components/Topbar.tsx:255-373`; `src/components/HomeView.tsx:148` |
| Меню пользователя: карточка профиля с загрузкой аватара, «Оформление», «Уведомления по почте», версия, «Выйти» | аватар справа в топбаре | `src/components/Topbar.tsx:415-467` |
| Меню пользователя главного экрана: карточка, «Оформление», «Выйти» (без уведомлений) | шапка `HomeView` | `src/components/HomeView.tsx:150-185` |
| Результаты глобального поиска (переключатель «Во всех проектах») | поле поиска в топбаре; самописная панель, не `<Dropdown>` | `src/components/Topbar.tsx:152-239` |
| Карточка пользователя (`UserCardBody` в `<Dropdown>`) | любой `Avatar interactive`: низ сайдбара, аватары на карточках «Доски» и строках «Списка», комментарии и история, «Права доступа» | `src/ui.tsx:80-92,257-344` |
| Меню перехода статуса на карточке (самописное, клавиша m/ь) | иконка на карточке «Доски» | `src/components/Board.tsx:203-243` |
| Быстрое создание (встроенная форма в колонке) | «+» у первой колонки категории todo | `src/components/Board.tsx:248-294,602-616` |
| Меню строки «…» (открыть, удалить) | строка «Списка задач» | `src/components/Backlog.tsx:91-116` |
| Сортировка, «Вьюхи», массовые «Статус / Исполнитель / Приоритет» | «Список задач» | `src/components/Backlog.tsx:345-365,436-488,496-555` |
| Статус, исполнители, приоритет, сложность, направление (с `IssueSearchBox`), выбор связи, приглашение участника (`UserSearchPicker`) | правая панель карточки задачи | `src/components/IssueModal.tsx:892,952,1006,1058,1096,582,154` |
| Приоритет, исполнители, направление, сложность | `CreateIssueModal` | `src/components/CreateIssueModal.tsx:254-372` |
| Всплывающие подсказки `<Tip>` | «Создать» без права; `LockedField` в карточке | `src/ui.tsx:523-530,560-570` |
| Тосты | правый нижний угол, все экраны | `src/ui.tsx:684-708` |

---

## 4. Карта настроек

Путь кликов записан от экрана проекта. «Сайдбар → X» на узком экране означает `<select>` в топбаре.

| Сущность | Где настраивается сейчас | Путь кликов / механизм | Чего нет | Доказательство |
|---|---|---|---|---|
| **Workflow: переходы** | «Рабочий процесс» | Сайдбар → «Рабочий процесс» → блок «Новый переход»: «Из статуса», «В статус» → «Добавить переход». Удаление — корзина в «Разрешённые переходы». Только право `editWorkflow` (роль admin). | — | `src/components/WorkflowView.tsx:243-275,218-226` |
| Workflow: сброс схемы | там же | кнопка «Сбросить схему» в шапке; **подтверждения нет** | — | `src/components/WorkflowView.tsx:139-143`; `src/store/meta.ts:62-66` |
| **Workflow: статусы** (набор, названия, категории, порядок) | **не настраивается нигде** | маршрутов для статусов на сервере нет (см. 1.1). Названия стандартных статусов локализуются словарём | — | `src/i18n/ru.ts:516-519` |
| **Кастомные поля** | «Рабочий процесс» | Сайдбар → «Рабочий процесс» → блок «Новое поле»: название, тип (текст/число/список/чекбокс/дата), варианты через запятую → «Добавить поле». Удаление — корзина. Значения — в правой панели карточки задачи. | **Переименование** — только API (раздел 1, строка 13). **Варианты списка после создания не настраиваются нигде** (PATCH принимает только `name`). При создании задачи значения не задаются. | `src/components/WorkflowView.tsx:396-473`; `src/components/IssueModal.tsx:405-489`; `server/src/contract.ts:392-394` |
| **Шаблоны задач** | «Рабочий процесс» | Сайдбар → «Рабочий процесс» → блок «Новый шаблон» → «Добавить шаблон». Удаление — корзина. Применение: `CreateIssueModal` → «Шаблон». | **Редактирование** — только API (раздел 1, строка 12) | `src/components/WorkflowView.tsx:282-393`; `src/components/CreateIssueModal.tsx:132-145` |
| **Участники проекта и их роли** | **в двух местах** | (а) Сайдбар → «Права доступа» → список участников: `<select>` роли, «Убрать»; «Добавить участника»: плоский `<select>` всех пользователей + роль + кнопка «Создать». (б) Сайдбар → «Департаменты» → отдел → строка проекта → «Состав» → роль, «Убрать», поиск сотрудника + «Добавить». Оба — право `manageAccess` (admin). | — | `src/components/PermissionsView.tsx:121-180`; `src/components/AdminView.tsx:54-163,448-454` |
| Глобальная роль пользователя (admin/member), деактивация | **не настраивается нигде в UI** | только `PATCH /api/users/:id`; в режиме LDAP роль приходит из группы `LDAP_ADMIN_GROUP_DN` | — | раздел 1, строка 9 |
| Создание пользователя (режим local) | **не настраивается нигде в UI** | только `POST /api/admin/users`; в LDAP — автоматически при первом входе | — | раздел 1, строка 8 |
| Имя, должность, телефон, цвет и инициалы пользователя | **не настраивается нигде в UI** | задаются при создании (API) или синхронизацией LDAP | — | `server/src/contract.ts:120-128` |
| Участники отдельной задачи (приглашённые) | карточка задачи | карточка → «Участники задачи» → «+ пригласить» → поиск → «Пригласить»; «×» убирает. Право `manageCollaborators` (admin, manager). | — | `src/components/IssueModal.tsx:91-163` |
| **Отделы** | «Департаменты» (только глобальный admin) | Сайдбар → «Департаменты» → поле «Название нового отдела» → «+ Отдел». Переименование — клик по названию (сохраняется по blur/Enter). Удаление — корзина (только без проектов, `window.confirm`). Состав — «Состав» → поиск + «Добавить», «Убрать» (не для LDAP-строк). | — | `src/components/AdminView.tsx:347-401,169-252` |
| **Проекты** (как сущность) | «Департаменты» | в отделе: «КЛЮЧ» + «Название проекта» → «+ Проект»; переименование по клику; чекбокс «общий»; корзина (`window.confirm`) | Описание проекта и перенос в другой отдел — **не настраиваются нигде**. Ключ после создания не меняется. | `src/components/AdminView.tsx:421-503` |
| **LDAP** | в основном **env** | Подключение (`AUTH_MODE`, `LDAP_*`) — только `server/.env`. В UI: поле «LDAP-группа» у отдела (только при `AUTH_MODE=ldap`) и кнопка «Пересинхронизировать LDAP». Периодичность ресинка — env `LDAP_RESYNC_*`. | Проверка связи — только API (раздел 1, строка 10). Статус подключения не показывается нигде. | `src/components/AdminView.tsx:336-344,403-419`; `server/.env.example` (блок LDAP) |
| **Модуль спринтов** | «Департаменты» | Сайдбар → «Департаменты» → строка проекта → чекбокс «спринты». Сами спринты: Сайдбар → «Спринты» → «+ Спринт» (модалка), «Начать», «Завершить» (`window.confirm`). | Редактирование и удаление спринта **не настраиваются нигде** (маршрутов нет) | `src/components/AdminView.tsx:437-447`; `src/components/SprintsView.tsx:171-235,299-307,321` |
| **Уведомления** | меню пользователя в топбаре проекта | Аватар справа в топбаре → «Уведомления по почте»: «Сразу» / «Дайджест»; флажок «Подписывать меня на мои задачи» | Выключить почту нельзя (сознательно, миграция 028). Выбор типов уведомлений — не настраивается нигде. Подписка на конкретную задачу — не настраивается нигде в UI (раздел 1, строка 11). На главном экране и в одиночном режиме блока нет. Серверная часть (SMTP, окно дайджеста, включение воркера) — только env. | `src/components/Topbar.tsx:376-413,451`; `src/components/HomeView.tsx:174`; `server/src/contract.ts:410-424` |
| **Аватар** | карточка пользователя (свой профиль) | Аватар справа в топбаре (или свой аватар в сайдбаре, в «Правах доступа», в комментариях) → «Загрузить фото» / «Сменить фото», корзина. Картинка обрезается и масштабируется на клиенте. Лимит размера — env `AVATAR_MAX_BYTES`. | Установить аватар другому пользователю нельзя (сознательно). В одиночном режиме — нет. | `src/ui.tsx:257-344` |
| **Тема и фон** | меню пользователя → «Оформление» | Аватар справа в топбаре (или меню главного экрана) → «Оформление»: «Системная / Светлая / Тёмная», 5 пресетов атмосферы, переключатель «Текстура фона». Хранится только в `localStorage`. | На экране входа и в одиночном режиме — не настраивается | `src/ui.tsx:606-660`; `src/theme.ts:21-50` |
| **Язык** | меню пользователя → «Оформление» | там же: «Язык: Русский / English» (`localStorage`) | На экране входа и в одиночном режиме — не настраивается. Серверные тексты всегда на русском. | `src/ui.tsx:656-657` |
| **Лицензия** | **не настраивается нигде в UI** | только CLI `npm run license:install`; статус не показывается нигде (раздел 1, строки 1–3) | — | `server/package.json` |
| **Экспорт** | в трёх местах | (а) полный экспорт инсталляции: «Департаменты» → «Экспорт данных» (NDJSON, глобальный admin); (б) CSV отчёта: Сайдбар → «Отчёты» → «Что выгружать» → «Скачать CSV»; (в) импорт: «Список задач» → «Импорт из Trello» | Экспорт аудита — только API. Лимит строк CSV — не настраивается. | `src/components/AdminView.tsx:326-335`; `src/components/ReportsView.tsx:217-240`; раздел 1, строка 7 |
| **Обслуживание** (архивирование, чистка аудита, уборка хранилища) | **не настраивается нигде в UI** | только env: `ARCHIVE_AFTER_DAYS`, `MAINTENANCE_*`, `STORAGE_SWEEP_*`. Статус и ручной запуск — только API (раздел 1, строки 4–5). | — | `server/.env.example`; `server/src/routes/maintenance.ts:14-35` |
| **Аудит** | **не настраивается нигде в UI** | срок хранения — env `AUDIT_RETENTION_DAYS`; просмотра нет; экспорт — только API | — | раздел 1, строка 7 |
| Сохранённые вьюхи | «Список задач» | «Вьюхи» → «Сохранить как вьюху» → имя → «Сохранить»; применение — клик; удаление — корзина при наведении. Сохраняются `status, assignee, type, priority, label, q`, но **не** «Просроченные» и «Показывать закрытые». | Переименование и «по умолчанию» — не настраиваются нигде | `src/components/Backlog.tsx:225-263,436-488` |
| Избранные проекты | переключатель проектов | крошка проекта → звезда у строки проекта | — | `src/components/Topbar.tsx:487-499` |

---

## 5. Визуальный аудит

Метод: временный скрипт обходит `src/**/*.{ts,tsx,css}` без тестов, вырезает комментарии и считает
вхождения регулярными выражениями. Где указано «рантайм», значения — это `getComputedStyle` всех
видимых элементов на «Доске» в production-сборке (Chromium, 1440×900, светлая тема).

### 5.1. Захардкоженные цвета

| Что | Вхождений | Различных | Где | Доказательство |
|---|---:|---:|---|---|
| hex вне `tokens.css` (в `src`) | **8** | 8 | все — палитра направлений `DIRECTION_COLORS` | `src/components/IssueModal.tsx:20` |
| `oklch(…)` вне `tokens.css` | **30** | 27 | `src/theme.ts` 20 (градиенты пресетов фона, строки 21-50), `src/icons.tsx` 7, `src/ui.tsx` 2 (`:72`, `:640`, arbitrary-классы), `src/components/IssueModal.tsx` 1 (`:898`) | вывод скрипта `1b` |
| `rgb()` / `hsl()` вне `tokens.css` | 0 | 0 | — | |
| Классы палитры Tailwind (`bg-white`, `text-red-500`, …) | 0 | 0 | — | |
| Цветовые литералы в `tokens.css` (легитимный источник) | 191 | 179 | примитивы OKLCH и семантический слой | вывод скрипта `1e` |
| Вне `src`: `index.html` (meta theme-color) | 2 | 2 | `#f3f2f9`, `#121019` | `index.html` |
| Вне `src`: `public/favicon.svg` | 4 | — | | |
| Вне `src`: HTML-письма | 9 | 7 | бренд писем `#0B5FD9` (синий), в приложении бренд — фиолетовый, оттенок 288 | `server/src/services/emailTemplates.ts:55` |

Проверка в CI (`npm run colors:check`) проходит («no raw colours outside tokens»), потому что
(а) ищет только hex/rgb/hsl и не видит `oklch()` (`scripts/check-raw-colors.mjs:21-25`);
(б) исключает `IssueModal.tsx` **целиком**, а не одну константу (`scripts/check-raw-colors.mjs:15-19`).

### 5.2. Произвольные значения Tailwind (`…-[…]`)

| Срез | Вхождений | Различных |
|---|---:|---:|
| Все arbitrary-значения | **719** | **131** |
| Из них в px (`…-[Npx]`) | **640** | **87** |
| — размер шрифта `text-[Npx]` | 539 | 21 |
| — `max-w-[…]` | 33 | 15 |
| — `w-[…]` | 22 | 16 |
| — брейкпоинты `min-[1536px]:`, `min-[1920px]:` | 17 | 2 |
| — `h-[…]` | 10 | 8 |
| — `min-w-[…]` | 9 | 7 |
| — отступы и позиция (`mt-[5px]`, `left-[11px]`, `translate-x-[14px]`, `translate-x-[2px]`) | 4 | 4 |
| — прочее (`leading-[16px]` ×2, `ring-[3px]`, `max-h-[220px]`, `min-h-[44px]`, `backdrop-blur-[3px]`) | 6 | 5 |

Больше всего в файлах: `IssueModal.tsx` 76, `WorkflowView.tsx` 58, `Topbar.tsx` 48, `AdminView.tsx` 47,
`PermissionsView.tsx` 38, `ui.tsx` 38, `Backlog.tsx` 37, `CreateIssueModal.tsx` 36.
Произвольных отступов (margin/padding) почти нет: шаг отступов идёт по шкале Tailwind, а
«произвольность» сосредоточена в размерах шрифта и ширинах.

### 5.3. Радиусы

| Срез | Значение |
|---|---|
| Классы `rounded-*` в коде | **374** вхождения, **12** вариантов: `rounded-md` 137, `rounded-lg` 89, `rounded-xl` 52, `rounded-full` 42, `rounded` 41, `rounded-sm` 7, по одному `rounded-2xl`, `rounded-t`, `rounded-tl-sm`, `rounded-b-xl`, `rounded-br-xl`, `rounded-bl-none` |
| Их реальные значения в собранном CSS | `rounded` = `.25rem` (4px) и `rounded-sm` = 4px — **два класса на одно значение**; `md` 6px; `lg` 10px; **`xl` = 20px и `2xl` = 20px** — два класса на одно значение; `full` |
| CSS `border-radius` | 2 (`10px`, `6px`) — `src/index.css:221,423` |
| SVG `rx` | 23 вхождения, 12 значений (`icons.tsx` 20, `WorkflowView.tsx` 2, `ui.tsx` 1) |
| **Две параллельные шкалы токенов** | `tokens.css:147-151` — `--radius-xs/s/m/l/xl` = 4/6/10/14/20; `index.css:46-50` (`@theme`) — `--radius-sm/md/lg/xl/2xl` = 4/6/10/14/20. Токен `--radius-xl` определён в обеих с **разными** значениями (14 и 20). В рантайме `getComputedStyle(:root)` даёт `--radius-xl: 20px`, `.rounded-xl` рисуется 20px, так что значение 14px из `@theme` не используется нигде. Шкала `-s/-m/-l` из `tokens.css` не используется ни одним классом (`grep "var(--radius" src` — 0) |
| **Рантайм, «Доска»** | **5** различных радиусов: 6px ×59, full ×47, 10px ×26, 4px ×9, 20px ×5 (с открытой карточкой: те же 5) |

### 5.4. Тени

| Срез | Значение |
|---|---|
| Классы `shadow-*` | **83** вхождения, **9** вариантов: `shadow-focus` 47, `shadow-e1` 22, `shadow-e3` 5, `shadow-e2` 1, плюс 5 arbitrary (`shadow-[var(--highlight-top),var(--elev-2)]` ×2, `…elev-4` ×2, `shadow-[inset_0_-1px_0_var(--border-default)]` ×2, `shadow-[0_0_0_3px_var(--accent-subtle)]`, `shadow-[inset_0_0_0_1px_oklch(1_0_0/0.12)]`) |
| CSS `box-shadow` | 12 объявлений, 11 различных (`src/index.css`) |
| Inline `boxShadow` | 2 (`src/ui.tsx:698`, `src/components/IssueModal.tsx:1156`) |
| Токены высоты | `--elev-0…4`, `--elev-accent`, `--shadow-tint` (`tokens.css`); `shadow-e4` в коде не используется |
| **Рантайм, «Доска»** | **14** различных вычисленных `box-shadow`; **16** с открытой карточкой |

### 5.5. Размеры шрифта

| Срез | Значение |
|---|---|
| `text-[Npx]` | **539** вхождений, **21** размер: 12 ×111, 13 ×104, 11.5 ×92, 12.5 ×75, 11 ×67, 10.5 ×33, 20 ×12, 14 ×12, 10 ×10, 13.5 ×9, 16 ×3, 9.5 ×2, по одному 9, 7.5, 15, 17, 19, 22, 24, 26, 28 |
| Полупиксельные | 6 из 21 (7.5, 9.5, 10.5, 11.5, 12.5, 13.5) |
| Шкала Tailwind (`text-xs…`) | 1 (`text-xl`, `src/ui.tsx:294`) |
| Вне классов | SVG `fontSize="14.5"` / `"11.5"` и `fontWeight="700"` (`src/components/WorkflowView.tsx:188-189`); размер инициалов аватара как `size × 0.36` или `size × 0.42` (`src/ui.tsx:63,73,126`); `font-size: 14px` в `src/index.css` |
| Начертания | в классах только `font-medium` (167) и `font-semibold` (150); плюс SVG 700 |
| Межбуквенные | `tracking-[…]`: 20 вхождений, 4 значения (−0.02em ×17, −0.005, −0.025, −0.03em) |
| Шрифт вне системы | карта статусов в «Рабочем процессе» задана `fontFamily="Golos Text"`, который не подключён (подключены Onest и JetBrains Mono, `src/index.css:8-30`) — рисуется системным шрифтом |
| **Рантайм, «Доска»** | **15** различных вычисленных размеров (16 с карточкой), включая **7.2px** (инициалы аватара 20px, ×13), 8.4, 9.36, 10.08, 10.92px |

### 5.6. Иконки

| Срез | Значение |
|---|---|
| Размеры (`size={N}` у `Ic*`, `TypeIcon`, `PriorityIcon`, `Logo`) | **165** вхождений, **13** размеров: 12 ×45, 13 ×41, 14 ×25, 11 ×16, 15 ×10, 10 ×7, 16 ×6, 22 ×5, 24 ×3, 18 ×2, 26 ×2, 28 ×2, 44 ×1 (+ `icon({size:16})` в сайдбаре) |
| Толщина штриха | базовый `strokeWidth = 1.55` в `viewBox` 16 (`src/icons.tsx:15`) масштабируется вместе с размером, поэтому **13 размеров дают 13 разных видимых толщин**: от 0.97px (size 10) до 2.71px (size 28) и 4.3px (Logo 44 — не штриховой). Отдельно заданы 1.1, 1.6, 1.8 (внутренние линии `TypeIcon`, `src/icons.tsx:66,73,81`) и 1.7 (замок `LockedField`, `src/ui.tsx:564`) |
| Иконки вне `icons.tsx` | 3 inline `<svg>`: щит в `RoleBadge` (`src/ui.tsx:552`), замок `LockedField` (`src/ui.tsx:564`), граф в `WorkflowView.tsx:153` |
| Набор | 35 экспортированных `Ic*` в `src/icons.tsx` |

### 5.7. Подписи капсом

| Срез | Значение |
|---|---|
| Класс `uppercase` | **1**: поле ключа нового проекта (`src/components/AdminView.tsx:483`) с плейсхолдером «КЛЮЧ» (`src/i18n/ru.ts:601`) |
| `text-transform: uppercase` в CSS | 0 |
| Остаток прежних капс-подписей | `normal-case` в `src/components/PermissionsView.tsx:103` (нечего отменять) |
| Слова капсом в словаре | 2: «КЛЮЧ», «СНГ» (аббревиатура в примере, `ru.ts:558`) |

### 5.8. Правила `taskira-dyn-*` (рантайм)

Механизм: собственный JSX-рантайм (`tsconfig.json:7`, `vite.config.js:6`) превращает каждый
`style={{…}}` в класс `taskira-dyn-N` и вставляет правило в `<link id="taskira-dynamic-styles">`
(`src/secure-jsx/jsx-runtime.ts:9-15`, `src/secure-jsx/dynamicStyle.ts:37-58`). Кэш — по тексту
CSS; правила **никогда не удаляются** (`dynamicStyle.ts:3-4,23-32`). В исходниках 76 мест
`style={…}` (больше всего: `DocsView` 15, `ui.tsx` 13, `IssueModal` 10, `TimelineView` 10).

**Как измерено.** Production-сборка (`npm run build`), `vite preview` на :4173, Chromium 141
headless, вход под admin, холодный контекст на каждый прогон, `/p/CORP/board`, ожидание первой
карточки и тишины в сети 800 мс, затем в странице:
`document.getElementById("taskira-dynamic-styles").sheet.cssRules.length`.

| Момент | Правил `taskira-dyn-*` | Прогонов |
|---|---:|---|
| Холодная загрузка «Доски» (15 задач, 4 колонки) | **28** | 12 из 12 (7 без замедления CPU + 5 с ×4) |
| Элементов с классом `taskira-dyn-*` в DOM сразу после загрузки | 42 | 12 из 12 |
| Различных `taskira-dyn-*` в DOM сразу после загрузки | 20 | 1 (разведочный прогон) |
| После сессии: открыть карточку → Esc → ввести символ в фильтр → «Список задач» → «Доска» | **41** | 12 из 12 |

Разница 28 − 20 — правила, созданные для уже исчезнувших элементов (скелет загрузки, прежние
ширины прогресс-бара и т. п.): они остаются в таблице стилей.

---

## 6. Тексты

Метод: чтение `src/i18n/ru.ts` (577 ключей) целиком плюс скрипт, который извлекает кириллические
строковые литералы и JSX-текст из 142 файлов `src/**` и `server/src/**` (без тестов и комментариев)
и классифицирует их. Регулярные выражения — с Unicode-границами слов.

### 6.1. Одно действие или понятие под разными названиями

| # | Действие / понятие | Варианты в интерфейсе | Доказательство |
|---|---|---|---|
| 1 | Добавить человека в проект | «**Создать**» (кнопка в «Правах доступа») / «Добавить» («Департаменты» → «Состав») / «Пригласить» (к задаче) | `src/components/PermissionsView.tsx:177` (`common.create`); `src/components/AdminView.tsx:153`; `src/i18n/ru.ts:191` |
| 2 | Прикрепить файл | «+ файл» (пустое состояние) и «+ прикрепить файл» (то же поле с файлами) | `src/i18n/ru.ts:196,199`; `src/components/IssueModal.tsx:203,248` |
| 3 | Создать задачу | «Создать» (топбар) / «Создать задачу» (кнопка формы, главный экран) / «Добавить» (быстрое создание на «Доске») | `src/i18n/ru.ts:139,174,295,65` |
| 4 | Убрать связь или элемент | «Убрать» (участник проекта), «Убрать из отдела», «Убрать связь», «Отключить от задачи» (участник задачи), «Удалить пункт», «Удалить вложение», «Удалить переход», «Удалить вьюху», «Скрыть» и «Очистить» (уведомления) | `src/i18n/ru.ts:475,576,214,192,206,198,528,316,121,118` |
| 5 | Повторить после ошибки | «Повторить» (два одинаковых ключа: `common.retry`, `reports.retry`) / «Попробовать снова» / «…— повторить» внутри текста ошибки | `src/i18n/ru.ts:13,430,457,47,48,331` |
| 6 | Сбросить ввод | «Сбросить» (фильтры) / «Очистить» (поле поиска, выделение, уведомления) | `src/i18n/ru.ts:12,14,118`; `src/components/Backlog.tsx:338,566` |
| 7 | Подтверждение удаления | «Удалить? да / нет» (карточка) / модалка «Удалить задачи? … Отмена / Удалить» (массовое) / нативный `window.confirm` (отдел, проект, спринт) / **без подтверждения** («Удалить» в меню строки «Списка задач», «Сбросить схему») | `src/components/IssueModal.tsx:712-723`; `src/components/Backlog.tsx:109,572-590`; `src/components/AdminView.tsx:390,464`; `src/components/WorkflowView.tsx:140` |
| 8 | «Список задач» vs «Бэклог» | пункт меню «Список задач», но в «Спринтах»: «Бэклог пуст», «Перетащите задачи из бэклога», «вернутся в бэклог»; подсказка в «Департаментах»: «бэклог и спринты»; описание права: «между бэклогом и спринтом». Заголовок колонки в «Спринтах» берёт ключ `sidebar.nav.backlog` («Список задач») | `src/i18n/ru.ts:82,398,399,403,596,507`; `src/components/SprintsView.tsx:279` |
| 9 | «Департамент» vs «Отдел» | пункт меню «Департаменты», заголовок «Департаменты и проекты»; всё остальное — «Отдел» («+ Отдел», «Название нового отдела», «Удалить отдел», счётчики «Отделы») | `src/i18n/ru.ts:88,579,587,586,592,166-168` |
| 10 | «Направление» vs «эпик» vs «группа» vs «родитель» | в UI — «Направление»; в истории задачи — «изменил(а) группу (эпик)»; ошибка сервера — «Задача-группа (epicId) не найдена»; пустой «Таймлайн» советует «выберите **родителя** в поле „Направление“», хотя «родитель» в UI — это родитель подзадачи | `server/src/routes/issues.ts:552,410,509`; `src/i18n/ru.ts:371,228` |
| 11 | Участник задачи | «Участники задачи» (для `collaborators`, при этом «Участники проекта» — `members`) / «Мои подключения» / «Приглашены к задаче» / «подключил(а) вас к задаче» / право «Подключение к задаче» | `src/i18n/ru.ts:187,471,90,359,156,504` |
| 12 | Тип задачи `bug` | «Баг» в интерфейсе; «**Ошибка**» в отчётах и CSV (сервер) | `src/i18n/ru.ts:98`; `server/src/routes/reports.ts:22` |
| 13 | Администратор | «Администратор», «админ ресурса», «Администратор ресурса», «глобальный администратор ресурса», «администратору проекта» (такой роли нет: роль admin глобальная) | `src/i18n/ru.ts:460,474,479,469,50` |
| 14 | Рабочий процесс | «Рабочий процесс» (меню) / «схема», «Сбросить схему» / «workflow» латиницей (см. 6.4) | `src/i18n/ru.ts:86,522,59` |
| 15 | Исполнитель | «Исполнитель» (форма создания и массовое действие) vs «Исполнители» (карточка) при одном и том же множественном поле | `src/i18n/ru.ts:271,249` |
| 16 | Описания ролей и прав — два источника с разным текстом | UI берёт словарь, `docs/PERMISSIONS.md` — матрицу: например, менеджер «Управляет всеми задачами: создание, редактирование, перемещение и удаление» vs «Управляет задачами: создание, редактирование и удаление» | `src/i18n/ru.ts:463,491` vs `src/permissions.matrix.ts:34,43` |
| 17 | Сохранённый фильтр | жаргон «Вьюхи», «Сохранить как вьюху», «Вьюха не найдена» (сервер) | `src/i18n/ru.ts:312-316`; сервер `notFound("Вьюха не найдена")` |

### 6.2. Расплывчатые ошибки

| # | Текст | Проблема | Доказательство |
|---|---|---|---|
| 1 | «Ошибка сервера (N)», «Ошибка загрузки файла (N)», «Не удалось скачать файл (N)» | Код статуса без смысла; показывается, если у ответа нет JSON-тела | `src/api/index.ts:138,173,194` |
| 2 | «Нет связи с сервером — **проверьте, что API запущен**» | Инструкция разработчика показывается конечному пользователю | `src/api/index.ts:120,159` |
| 3 | «Внутренняя ошибка сервера» | Любой непредусмотренный 500 | `server/src/app.ts:154` |
| 4 | «Ошибка запроса» | Запасной текст `handleApiError` | `src/store.tsx:206` |
| 5 | Английский интерфейс: любая ошибка, кроме 6 кодов (`NETWORK`, `RATE_LIMITED`, `INTERNAL`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`), превращается в общий запасной текст. Причины `VALIDATION`/`CONFLICT` (например «Проект с таким ключом уже есть») по-английски не видны вовсе. | | `src/store.tsx:214-222` |
| 6 | «Не удалось войти» (EN) | Одинаково для неверного пароля, блокировки, лимита и сетевой ошибки | `src/components/LoginForm.tsx:27` |
| 7 | ≈ 50 вариантов «Не удалось X» без причины в сторе | Используются как запасной текст, когда у ошибки нет `reason` | вывод скрипта; например `src/store/org.ts:22-254`, `src/store/issueSub.ts:81-295` |
| 8 | Молчаливые ошибки | Добавление и удаление участника отдела вызывают API напрямую, ошибка проглатывается `op.catch(() => {})`. Загрузка вьюх — `.catch(() => undefined)`. Загрузка состава — «Не удалось загрузить состав.» без причины. | `src/components/AdminView.tsx:189,229,244,78,200`; `src/components/Backlog.tsx:219` |
| 9 | «Ошибка» | Заголовок тоста (только для скринридера) | `src/i18n/ru.ts:615` |
| 10 | Серверные причины с внутренними идентификаторами | «Задача-группа (**epicId**) не найдена», «Задача-ориентир (**beforeId**)», «Ожидается **multipart/form-data** с полем **file**», «Роль LDAP-пользователя управляется группой (**LDAP_ADMIN_GROUP_DN**)», «Ресинк доступен только при **AUTH_MODE=ldap**» | `server/src/routes/issues.ts:410`; `server/src/routes/attachments.ts:46`; `server/src/routes/users.ts:99`; `server/src/routes/ldap.ts:28` |

### 6.3. Смешение «вы» / «ты»

Форм на «ты» **не найдено** ни в клиенте, ни в сервере: 0 совпадений по «ты, тебя, твой, …» и
повелительным формам «Выбери, Нажми, Попробуй, Проверь, Укажи, Обнови, Добавь, Перетащи, …»
в строковых литералах 142 файлов. «Вы» используется последовательно: 27 строк с «вы/вас/ваш»
и 46 строк с повелительными формами на «-ите/-йте».

Смешение есть в другом — **в лице говорящего и в описании одного и того же правила**:

- Интерфейс говорит то от «мы» («Загружаем следующие задачи…», «Загружаем задачи проекта…»,
  «Готовим…»), то от «я» («**Импортирую…**»): `src/i18n/ru.ts:330,402,428,343`.
- Одно и то же правило роли описано в третьем лице в интерфейсе («где **он** исполнитель или автор»,
  `src/i18n/ru.ts:465,508`) и во втором лице в сообщении об отказе («где **вы** исполнитель или
  автор», `src/permissions.ts:87`, `server/src/permissions.ts:91`).

### 6.4. Английские строки в русском интерфейсе

| Строка | Где |
|---|---|
| «workflow» латиницей — 8 строк словаря: «Переход запрещён workflow», «Изменение workflow», «Workflow поверх прав», «в пределах workflow», «схема workflow», «Не меняет workflow и роли», … | `src/i18n/ru.ts:59,461,463,495,500,508,513,514`; также `src/permissions.matrix.ts:33-48` |
| «Taskira **dev**» — строка версии в меню пользователя, если не задан `VITE_APP_VERSION` | `src/components/Topbar.tsx:453` |
| Вся «Документация» на русском написана прямо в JSX (не через словарь) с английскими терминами «workflow», «drag&drop», «cookie», «Department», «Issue», «User» | `src/components/DocsView.tsx:100,130,198,408-421,444-448` |
| «Файл не похож на экспорт доски Trello — нет полей **lists/cards**» | `src/i18n/ru.ts:348` |
| Обратная проблема — русское в английском интерфейсе: названия пресетов фона «Фиалка», «Сумерки», «Рассвет», «Сияние», «Графит» заданы в `theme.ts` мимо словаря и в EN-режиме идут в `title` и `aria-label`; ключи `scope.Проект` и др. кириллические; история задачи хранится по-русски и переводится регулярными выражениями | `src/theme.ts:24-48`; `src/i18n/ru.ts:484-487`; `src/components/IssueModal.tsx:24-58` |
| Ошибки сервера всегда на русском; в EN они либо скрыты (6.2, п. 5), либо показываются как есть (`sub={set.error}` в пустом состоянии «Списка задач») | `src/components/Backlog.tsx:609` |

---

## 7. Базовые метрики

Эталонный стенд владельца `taskira_perf` в этой среде недоступен. Всё ниже измерено локально, и
у каждого числа указано, как и где. Окружение: Linux-контейнер, 4 vCPU, 16 ГБ RAM; Chromium
141.0.7390.37 headless через `playwright-core` 1.63; окно 1440×900; светлая тема; язык ru;
API на :8080 (`tsx src/index.ts`, та же БД) с сидом: проект CORP — 15 задач, 4 колонки, 6
пользователей, 3 проекта. Сеть — loopback, без эмуляции задержек.

### 7.1. Бандл (gzip по чанкам)

Команда: `npm run build` (Vite 8.3.0, «✓ built in 700ms»). Размеры — дословно из вывода Vite.
Состав чанков — из отдельной сборки с `--sourcemap` в scratchpad; оценка в символах JS
несжатого кода по карте исходников.

| Чанк | raw, kB | gzip, kB | Что внутри (доля в символах) | Грузится на «Доске» |
|---|---:|---:|---|:---:|
| `index-9OkKISKF.js` | 264.69 | **81.85** | react-dom 202.1K, Topbar 15.7K, Board 14.9K, App 4.5K, Sidebar 4.5K, scheduler 3.5K, ErrorBoundary 2.6K, LoginForm 2.4K | да |
| `ui-PhXyst11.js` | 164.48 | **48.17** | **словари ru.ts 26.8K + en.ts 26.3K** (оба языка всегда), ui.tsx 16.7K, api 8.1K, icons 7.9K, react 7.6K, store.tsx 6.2K, store/session 6.0K | да |
| `DocsView-*.js` | 39.02 | 11.44 | DocsView 28.5K, seed 0.6K | нет |
| `IssueModal-*.js` | 33.37 | 8.69 | | при открытии карточки |
| `Backlog-*.js` | 21.35 | 6.52 | Backlog 15.1K + ImportTrelloModal 4.0K + парсер Trello 1.3K | нет |
| `WorkflowView-*.js` | 16.00 | 3.71 | | нет |
| `AdminView-*.js` | 14.15 | 3.61 | | нет |
| `CreateIssueModal-*.js` | 11.12 | 3.14 | | нет |
| `HomeView-*.js` | 9.71 | 3.27 | | нет |
| `PermissionsView-*.js` | 8.90 | 2.59 | | нет |
| `SprintsView-*.js` | 8.78 | 2.74 | | нет |
| `SoloView-*.js` | 8.58 | 3.06 | | нет |
| `ReportsView-*.js` | 8.40 | 2.70 | | нет |
| `TimelineView-*.js` | 7.58 | 2.74 | | нет |
| `issuePages-*.js` | 5.40 | 1.92 | | да |
| `IssueSearchBox-*.js` | 2.81 | 1.30 | | нет |
| `CollaboratingView-*.js` | 2.26 | 0.98 | | нет |
| `types-*.js` | 0.12 | 0.11 | | — |
| **Итого JS** | **626.72** | **188.54** | | |
| `index-CgLhL3QK.css` | 71.28 | **13.83** | | да |
| `index.html` | 0.97 | 0.51 | | да |
| Шрифты (woff2): Onest cyrillic 15.86, Onest latin 33.76, JetBrains Mono latin **40.40** | 90.02 | — | | да (все три) |
| `grain-*.png` (текстура) | 25.09 | — | | да |

**Критический путь «Доски»** (Resource Timing, production-сборка): JS 81.85 + 48.17 + 1.92 =
**131.94 kB gzip**, CSS 13.83 kB; передано всего **281 KB** за загрузку, включая шрифты, текстуру
и 17 API-ответов (медиана, 12 прогонов). Запрос `GET /api/projects/:id/issues/counts` без фильтров
уходит **дважды** за одну загрузку (сайдбар и «Доска» запрашивают один и тот же набор); список
уведомлений `GET /api/notifications?limit=20` грузится при старте, даже если колокол не открывали.

### 7.2. LCP и INP открытия «Доски»

**Как измерено.** Production-сборка на `vite preview` :4173 (прокси `/api` → :8080, как в nginx).
Для каждого прогона — новый контекст браузера с сохранённой сессией (холодный HTTP-кэш, прогретый
сервер), `page.goto('/p/CORP/board')`. До загрузки страницы подключаются буферизованные
`PerformanceObserver`: `largest-contentful-paint`, `paint`, `layout-shift`, `event`
(`durationThreshold: 16`). INP — максимум длительности Event Timing по `interactionId` за
скриптованную сессию (при < 50 взаимодействиях INP = максимум). Длительности Event Timing
округляются браузером до 8 мс. Ввод — синтетический, через CDP (`page.click`, `keyboard`).
Замедление CPU — `Emulation.setCPUThrottlingRate`.

| Метрика, мс | CPU ×1: медиана | мин–макс | CPU ×4: медиана | мин–макс |
|---|---:|---|---:|---|
| TTFB (`responseStart`) | 4 | 3–5 | 4 | 3–7 |
| FCP | 172 | 140–200 | 280 | 264–300 |
| **LCP** | **440** | 264–532 | **1088** | 892–1120 |
| Первая карточка в DOM (MutationObserver)* | 378 | 287–407 | 1011 | 824–1051 |
| Последний API-ответ загрузки | 303 | 271–405 | 835 | 711–889 |
| DOMContentLoaded | 76 | 66–91 | 197 | 175–231 |
| CLS | 0.0019–0.0186 | | 0.0004–0.0186 | |
| **INP сессии** | **96** | 72–136 | **128** | 120–152 |
| Прогонов | 7 | | 5 | |

LCP-элемент во всех прогонах — заголовок карточки `h4.line-clamp-2` («Собрать требования отдела
продаж…»). \*Время срабатывания колбэка MutationObserver; в 3 из 7 прогонов оно позже LCP, поэтому
это вспомогательная, а не основная метрика.

Разбивка по взаимодействиям (максимум по `interactionId`, мс):

| Взаимодействие | Событие-максимум | CPU ×1 медиана (мин–макс) | CPU ×4 медиана (мин–макс) |
|---|---|---|---|
| Открыть карточку (клик) | pointerdown | 40 (32–72) | 88 (72–144) |
| **Закрыть карточку (Esc)** | keydown | **96 (48–136)** | **120 (112–136)** |
| Клик в «Фильтр по доске» | pointerdown | 32 (24–40) | 48 (40–56) |
| Ввод символа «а» в фильтр | — | **< 16** (ни одной записи выше порога ни в одном прогоне) | **< 16** |
| Клик «Список задач» | pointerdown | 40 (24–56) | 104 (48–152) |
| Клик «Доска» (повторное открытие «Доски») | pointerdown | 56 (48–72) | 120 (104–128) |

Самое медленное взаимодействие сессии — **закрытие карточки**, а не открытие.

### 7.3. React Profiler: перерисовки и время коммита

**Как измерено.** Отдельная временная profiling-сборка, в репозиторий не попала: конфиг Vite в
scratchpad, `react-dom/client` подменён на `react-dom/profiling`, `<App/>` обёрнут в
`<Profiler id="app">` через преобразование `main.tsx` в памяти, `minify: false` ради имён
компонентов. Сборка отдавалась через `vite preview` на :4174. Число перерисованных компонентов
считает хук в форме `__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot`: на каждый коммит обходит
дерево и считает композитные файберы (function/class/forwardRef/memo), которые смонтированы или
несут флаг `PerformedWork`; поддеревья с неизменным `child` пропускаются, как в React DevTools.
«Commit ms» — сумма `actualDuration` из `Profiler.onRender`. Окно замера — от действия до
«тишины»: нет запросов в полёте и нет новых коммитов 500–700 мс. Каждый сценарий — 5 повторов,
перед каждым холодная загрузка `/p/CORP/board`. CPU без замедления.

Для масштаба: на загруженной «Доске» смонтировано **223** композитных компонента (678 DOM-узлов;
у 112 компонентов есть подписка на контекст); на карточку задачи приходится 13–14 компонентов.

| Сценарий (медиана из 5, в скобках мин–макс) | Коммитов | Перерисовок компонентов (всего) | Макс. за коммит | Смонтировано | Commit ms (сумма) | Commit ms (макс.) |
|---|---:|---:|---:|---:|---:|---:|
| Первичная загрузка «Доски» (1 прогон) | 9 | 640 | — | — | 74.5 | — |
| **Открытие карточки** (клик → модалка с комментариями и историей) | 7 (6–7) | **743** (743–743) | 228 (228–283) | 56 | 28.4 (23.8–32.4) | 10.8 (8.1–12.5) |
| Закрытие карточки (Esc) | 2 | 455 | 228 | 0 | 9.3 (7.1–9.6) | 4.7 (3.7–5.5) |
| **Перетаскивание карточки** «К выполнению → В работе» | 12 (10–12) | **1424** (1331–1475) | 228 | 7 | 32.9 (29.4–38.5) | 5.7 (5.4–10.1) |
| **Ввод символа в «Фильтр по доске»** (debounce 250 мс + серверный рефетч колонок) | 7 (6–9) | **600** (540–646) | 174 | 151 | 19.6 (18.6–25.7) | 5.4 (5.4–9.4) |
| — из них в первые 100 мс после нажатия | 2 | 174 | | | | |
| Ввод символа в глобальный поиск топбара | 5 | **28** | 19 | 16 | 2.7 (2.5–5.6) | 1.1 (1.0–3.9) |
| **Приход WS-уведомления** (`{type:"notify"}` → `GET unread-count`) | 1 | **228** | 228 | 0 | 5.4 (5.0–6.9) | 5.4 (5.0–6.9) |

Что видно из чисел (наблюдения, не предложения):

- Одно новое уведомление перерисовывает **всё дерево «Доски»**: 228 компонентов при 223 + 5
  (карточка-проба) смонтированных, включая все 16 мемоизированных `Card` (`memo`,
  `src/components/Board.tsx:57`). Самые частые в этом коммите: базовая иконка `S` ×42,
  `Avatar` ×25, `Dropdown` ×17, `Card` ×16, `TypeIcon` ×16, `PriorityIcon` ×16, `AvatarStack` ×16.
  Бейдж при этом корректно растёт (1…5 за 5 повторов).
- Закрытие карточки — тоже полная перерисовка «Доски» (2 коммита по 228), что согласуется с тем,
  что Esc — самое медленное взаимодействие в 7.2.
- Глобальный поиск топбара локален (28 перерисовок) — это же подтверждает, что счётчик не завышает
  результат на изолированных обновлениях.

Технические условия, влияющие на интерпретацию: сценарий перетаскивания использует временную
задачу-пробу «[perf-probe] drag» (создана через API перед замером, удалена после; во всех 5
повторах перетаскивание действительно сменило статус). Сценарий WS использует настоящее
WS-соединение с сервером через `page.routeWebSocket(…).connectToServer()` и одну внедрённую
серверную рамку `{type:"notify"}`. Чтобы счётчик непрочитанных действительно изменился, в
таблицу `notifications` перед каждым повтором вставлялась строка для admin; все 5 строк удалены
после замера.

### 7.4. Не измерено и почему

| Что | Почему не измерено |
|---|---|
| Любые числа на эталонном стенде `taskira_perf` | Стенд в этой среде недоступен. Все числа выше — локальные и с эталонными не сравниваются напрямую. |
| «Доска» на реалистичном объёме (сотни карточек, десятки пользователей) | В БД сид на 15 задач. Сид-скрипты производительности (`server/scripts/performance-seed*.mjs`) изменили бы общую локальную БД, которой пользуется основной checkout. Числа 7.2–7.3 получены на 15–16 карточках. |
| Сетевые условия (задержка, пропускная способность) | Замеры по loopback (TTFB 3–7 мс), эмуляция сети не применялась. LCP при реальной сети будет определяться 17 последовательными и параллельными API-запросами. |
| Полевой (RUM) INP | Только лабораторный, синтетический ввод через CDP. |
| INP перетаскивания | При HTML5 drag-and-drop после `dragstart` браузер не выдаёт `pointerup`/`click` с `interactionId`, поэтому перетаскивание в Event Timing как взаимодействие не попадает. Для него есть только числа Profiler (7.3). |
| Точное значение INP для ввода символа | Все записи ниже порога Event Timing (16 мс); доступна только оценка «< 16 мс». |
| Задержка WS-уведомления «событие на сервере → бейдж» | Серверное событие не порождалось (для этого нужен второй пользователь с известным паролем). Измерена только клиентская реакция на рамку `notify`. |
| Время коммита в production-сборке | Profiler-тайминги доступны только в profiling-сборке. Она не минифицирована и немного медленнее production. `actualDuration` — время фазы рендера под `<Profiler>`, без layout и paint. |
| Long tasks / TBT, память, GC | Не входили в сценарий. |
| Firefox, Safari, мобильные устройства | Доступен только Chromium. |
| Brotli, сжатие на nginx | Размеры — gzip из отчёта Vite; конфигурация сжатия в `nginx.conf` не проверялась. |

---

## Находки, требующие действий

Только перечень, без реализации и без дизайн-предложений.

1. Статус лицензии не виден никому: нет маршрута и нет UI; `requiresPlan` подключён к 0 маршрутам (1.2, строки 1–3).
2. Обслуживание (статус, ручной и пробный запуск), предупреждения здоровья (`search_index_missing`) и экспорт аудита есть только в API (1.2, строки 4–7).
3. Управление пользователями (создание, глобальная роль, деактивация) недоступно из интерфейса (1.2, строки 8–9).
4. Подписка на конкретную задачу (watchers) есть на сервере, в UI нет (1.2, строка 11).
5. Редактирование шаблона, переименование кастомного поля и изменение вьюхи реализованы в API и (для первых двух) в сторе, но ни один компонент их не вызывает (1.2, строки 12–14).
6. Архивные задачи недоступны из интерфейса иначе как по прямой ссылке: списки не выставляют `archived`, глобальный поиск архив исключает (1.2, параметры).
7. Нельзя сменить или снять родителя подзадачи, задать описание проекта, перенести проект в другой отдел, отфильтровать отчёт по отделу (1.2, параметры).
8. Сохранённые вьюхи и массовые операции есть только в «Списке задач» (1.2).
9. Звёздочка вьюхи «по умолчанию» недостижима из UI (2, п. 1).
10. Горячие клавиши 7 и 9 и прямой URL `/sprints` ведут на экраны-отказы и пустые экраны (2, пп. 2–4).
11. Логотип-кнопка без действия при < 2 проектах (2, п. 5).
12. Подзаголовок «Документации» утверждает, что она генерируется из кода; это не так (2, п. 9).
13. Участники проекта управляются из двух экранов с разными элементами управления; в «Правах доступа» кнопка добавления подписана «Создать» и работает через плоский список всех пользователей (4; 6.1, п. 1).
14. «Сбросить схему» и «Удалить» в меню строки «Списка задач» срабатывают без подтверждения, хотя другие удаления подтверждаются (6.1, п. 7).
15. Статусы workflow, варианты поля-списка, спринты (правка и удаление), лицензия, обслуживание и аудит не настраиваются нигде в UI (раздел 4).
16. Блок настроек уведомлений есть только в меню топбара проекта, его нет на главном экране и в одиночном режиме; тема и язык недоступны на экране входа и в одиночном режиме (раздел 4).
17. Проверка `colors:check` не видит `oklch()` (30 литералов вне токенов) и исключает `IssueModal.tsx` целиком (5.1).
18. Бренд-цвет писем `#0B5FD9` не совпадает с брендом приложения (5.1).
19. Две шкалы радиусов с конфликтующим `--radius-xl` (14 vs 20): `rounded-xl` и `rounded-2xl` рисуются одинаково, `rounded` и `rounded-sm` — тоже (5.3).
20. 21 размер шрифта в `text-[Npx]` (из них 6 полупиксельных); на «Доске» в рантайме есть текст 7.2px (5.5).
21. Карта статусов рисуется неподключённым шрифтом «Golos Text» (5.5).
22. 13 размеров иконок дают 13 разных видимых толщин штриха (5.6).
23. Правила `taskira-dyn-*` только копятся: 28 на холодной «Доске», 41 после короткой сессии, не удаляются никогда (5.8).
24. Терминология расходится: Список задач / Бэклог, Департамент / Отдел, Направление / эпик / группа / родитель, Баг / Ошибка, «Вьюха», варианты «администратора», «workflow» латиницей (6.1, 6.4).
25. Расплывчатые и молчаливые ошибки: «Ошибка сервера (N)», «проверьте, что API запущен», в EN-режиме — общий текст вместо причины; ошибки состава отдела проглатываются (6.2).
26. Интерфейс говорит то от «мы», то от «я»; правило роли описано в третьем лице в UI и во втором — в сообщении об отказе (6.3).
27. Русские названия пресетов фона и русские ошибки сервера попадают в английский интерфейс (6.4).
28. Оба словаря (RU и EN, ~53K символов) всегда грузятся в общем чанке `ui` на критическом пути (7.1).
29. Одна загрузка «Доски» дважды запрашивает `issues/counts` без фильтров и сразу грузит список уведомлений (7.1).
30. Приход WS-уведомления и закрытие карточки перерисовывают всё дерево «Доски» (228 компонентов, включая мемоизированные карточки); закрытие карточки — самое медленное взаимодействие сессии (7.2, 7.3).
31. Ввод одного символа в фильтр «Доски» порождает 600 перерисовок и перемонтирует 151 компонент (7.3).
32. Шрифт JetBrains Mono (40 kB, только латиница) грузится на каждой «Доске» ради ключей задач (7.1).

---

## Приложение: как получены числа

Все скрипты временные, лежали в scratchpad сессии и в репозиторий не добавлены. Исходники
репозитория не изменялись. Единственный добавленный файл — этот документ.

| Раздел | Команда / скрипт | Суть |
|---|---|---|
| 1 | `tsx routes.mts` (в `server/`, фиктивные `JWT_SECRET`/`ADMIN_*`, `NODE_ENV=test`) | `buildApp()` + `addHook("onRoute")` + `app.ready()` + `app.printRoutes({commonPrefix:false})` |
| 1 | shell: для каждого метода из `export const xxxApi = {…}` → `grep -rnE "\bxxxApi\.method\b" src` (без тестов); для каждого `useCallback`-действия стора → `grep -rlw` по компонентам | сопоставление маршрут → метод → компонент |
| 5 | `node visual.mjs` | счётчики по регулярным выражениям (выводы `1a…8a`, цитируются в 5.x) |
| 5 | `node computed.mjs` (Playwright, :4173) | вычисленные `border-radius`, `box-shadow`, `font-size` и значения `--radius-*` на «Доске» |
| 6 | `node texts.mjs` + чтение `src/i18n/ru.ts` | «ты»/«вы»/«мы», расплывчатые ошибки, латиница в кириллических строках; поиск неиспользуемых ключей словаря |
| 7.1 | `npm run build`; `vite build --sourcemap --outDir <scratch>`; `node chunkmap.mjs`; `node resources.mjs` | размеры чанков, состав по sourcemap, ресурсы загрузки «Доски» |
| 7.2 | `vite preview --port 4173`; `node vitals.mjs 7 1` и `node vitals.mjs 5 4` | LCP/FCP/CLS/Event Timing, `taskira-dyn-*` |
| 7.3 | `vite build --config vite.profiling.config.mjs` → `vite preview` :4174; `node profile.mjs 5`; `node treesize.mjs` | коммиты, перерисовки и `actualDuration` по сценариям; размер дерева |
