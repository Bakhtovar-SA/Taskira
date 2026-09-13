# ARCHITECTURE — Taskira

## Текущее состояние (по репозиторию на данный момент)

Работает клиент-серверная связка: React 18 + TypeScript + Vite SPA (`src/`)
общается с Fastify 5 + PostgreSQL + JWT API (`server/`). `localStorage` больше не
хранилище данных — в нём только JWT (`taskira.token`); проект, состав, задачи и
workflow приходят через `src/api/` + `src/store.tsx` (`bootstrap()`).

Уже реализовано и работает:
- **Backend** (`server/`): Fastify, миграции PostgreSQL (`server/migrations/`,
  001–017), JWT-аутентификация по паролю (bcrypt) или через LDAP/AD, проверка
  прав на каждом запросе (`middleware.ts` `requirePerm`/`requireIssuePerm`),
  отзыв токенов при выходе (`users.tokens_valid_from`, миграция 017),
  аудит-лог, интеграционные тесты (vitest, `server/test/`).
- **Клиентские тесты**: vitest + jsdom + Testing Library (`src/*.test.ts`) —
  права, валидация, хелперы стора; `npm test` в client-job CI рядом с
  `typecheck`/`build`. Раньше единственной проверкой клиента была компиляция
  типов.
- **Жизненный цикл задачи** (миграция 016): `done_at` при входе в статус
  категории `done` (сбрасывается при возврате в работу), `archived_at` —
  фоновым воркером (`services/maintenance.ts`) для задач, закрытых дольше
  `ARCHIVE_AFTER_DAYS`. Архивирование не удаляет строку — задача доступна по
  прямой ссылке, находится через `?archived=`, считается в отчётах.
- **Отчёты** (`ReportsView.tsx`, `services/reports.ts`): без привязки к
  проекту, `GET /api/reports/summary` (закрыто/создано/открыто/просрочено,
  среднее и медианное время в работе, разбивка, недельный тренд) и
  `GET /api/reports/issues.csv` (построчная выгрузка); область видимости —
  `listVisibleProjects()`, не дублируется отдельным правилом.
- **Скрытие уведомлений из ленты** (миграция 015, `dismissed_at`): мягкое
  скрытие своих уведомлений без удаления строки и без влияния на
  email-рассылку; `applyNotificationAction` без `ids` действует на все
  уведомления пользователя на сервере, поэтому счётчик непрочитанных
  обнуляется целиком, а не по загруженной странице.
- **Адаптивная вёрстка**: карточка задачи ниже 768px в одну колонку, сайдбар
  на узком экране заменяется нативным `<select>` в шапке с теми же правилами
  видимости разделов, боковые отступы вью — 16px вместо 24.
- **Ролевая модель, привязанная к проекту** (миграции 004/006, см.
  `ROLE_MIGRATION.md`): глобальная роль `users.global_role` (`admin | member`)
  + `project_members.role` (`manager | employee | viewer`); эффективная роль =
  `resolveRole(globalRole, projectRole)`. `src/permissions.ts` ↔
  `server/src/permissions.ts` (`MATRIX`, `can()`, `denialReason()`) — зеркальные
  копии, сервер авторитетен; каждая мутация в `src/store.tsx` идёт через
  `requirePerm()`.
- **Управление составом проекта**: `PUT`/`DELETE /api/project/members/:userId`
  (только глобальный admin), UI в `PermissionsView.tsx`.
- Доска (канбан) с drag&drop и валидацией переходов по схеме workflow.
- «Список задач» (`Backlog.tsx`) — плоский список с фильтрами и сортировкой;
  спринты удалены (миграция 012, [UI_RESTRUCTURE.md](UI_RESTRUCTURE.md)).
- Главный экран (`HomeView.tsx`) при входе с ≥ 2 доступными проектами:
  «Мои задачи» (`GET /api/issues/assigned-to-me`) + «Недавние проекты».
- Настраиваемый workflow — граф статусов/переходов в БД
  (`workflow_statuses` / `workflow_transitions`), редактор `WorkflowView.tsx`.
  `src/seed.ts` оставлен только как `DEFAULT_WORKFLOW` для `DocsView.tsx`.
- Карточка задачи: поля, история изменений (`activity`), комментарии, подписка
  (`issue_watchers`), связанные задачи (`issue_links`, миграция 014 —
  `relates` / `blocks`, `POST`/`DELETE …/issues/:id/links`).
- **4 уровня приоритета** (миграция 013): `low | medium | high | critical`
  (было 5).
- **Сложность вместо story points** (миграция 018): `issues.points` (числовая
  оценка, дублировавшая Scrum-сленг и без единого места в UI, где её можно
  было бы задать) заменена на `complexity` — простую трёхзначную шкалу
  (`simple | medium | hard`), редактируемую в карточке и при создании задачи.
- **Сборщик осиротевших объектов хранилища** (`services/storageSweeper.ts`):
  отдельный (более редкий, раз в сутки по умолчанию) луп воркера обслуживания
  листит `Storage`, сравнивает со `storage_key` в `attachments` и удаляет
  объекты без строки — с грейс-периодом против гонки с загрузкой (`put()` в
  Storage происходит раньше `INSERT INTO attachments`).
- **Фоновый ресинк LDAP-членства по расписанию**: третий независимый таймер
  в `services/maintenance.ts` (по умолчанию раз в 6 часов, только при
  `AUTH_MODE=ldap` + сервис-аккаунте) переиспользует ту же логику, что и
  ручной `POST /api/ldap/resync` (`resyncAllLdapUsers()` в
  `services/departmentSync.ts`) — до этого членство обновлялось только JIT
  при логине и вручную, уволенный/переведённый сотрудник держал старый
  доступ до следующего входа.
- **Оформление**: светлая/тёмная/системная тема + 6 фоновых пресетов
  (`src/theme.ts`, токены `--c-*` на `:root`, выбор в `localStorage`).
- **Департаменты** (миграция 007, `DEPT_MIGRATION.md`): таблица `departments`
  (+ `ldap_group_dn`), `projects.department_id`/`is_shared`, ресурсы под
  `/api/projects/:projectId/...`, multi-project с выбором проекта на клиенте.
- **LDAP/AD-аутентификация** (миграция 009, `LDAP_MIGRATION.md` / `LDAP_SETUP.md`):
  `AUTH_MODE=ldap` — вход против LDAP/AD (`ldapts`, сервис-bind + поиск + re-bind),
  JIT-provisioning (`users.auth_source`/`ldap_dn`/`email`), break-glass локальный
  admin, `global_role` из `LDAP_ADMIN_GROUP_DN`, членство в департаменте
  (`department_members`) по `departments.ldap_group_dn` → неявный `viewer` на
  проектах департамента. Sync — JIT при логине + `POST /api/ldap/resync`.
- **Вложения к задачам** (миграция 010, `FILES_MIGRATION.md` / `STORAGE_SETUP.md`):
  загрузка/скачивание/удаление файлов на карточке задачи (`@fastify/multipart`,
  стрим + `sha256` + guard по расширению и magic-байтам — блок исполняемых),
  видимость наследуется от задачи (все эндпоинты через `requireIssuePerm`),
  скачивание — прокси-стрим + `Content-Disposition: attachment`. Хранилище за
  абстракцией `Storage`: `STORAGE_DRIVER=local` (диск) | `s3` (S3-совместимое,
  `@aws-sdk`, для нескольких серверов).
- **Уведомления + фоновый воркер** (миграция 011, `NOTIFICATIONS_MIGRATION.md` /
  `NOTIFICATIONS_SETUP.md`): in-app-лента (колокол, polling) на событие
  (назначение, комментарий по подписке, `@`-упоминание, смена статуса,
  подключение к задаче, добавление в проект); email опционально
  (`NOTIFY_EMAIL_ENABLED` + `SMTP_*`, `nodemailer`) фоновым воркером
  (`services/notifier.ts`, `instant`/`daily`-дайджест, ретрай) — **письмо несёт
  только тип события + ключ задачи + ссылку, без содержимого** (D9). Скелет
  воркера — общий для будущих LDAP-resync и storage-sweeper.

Чего ещё нет (детальнее — раздел «Порядок разработки»):
- **WebSocket-пуш уведомлений** — сейчас polling; `WsMessage` объявлен типом,
  `/ws` не смонтирован (Этап 3c).
- **Нейтральная терминология в UI** доведена почти полностью
  ([UI_RESTRUCTURE.md](UI_RESTRUCTURE.md)): спринты убраны, «Бэклог» → «Список
  задач», «Эпик» → «Направление» (в подписях), «Оценка (очки)» заменена на
  «Сложность» (миграция 018). Остаются термин «Таймлайн» и внутренние
  идентификаторы (`epicId`, `ViewId` `backlog`).

## Целевая архитектура

Три больших изменения относительно исходного (localStorage-only) кода:
1. ✅ Настоящий backend + БД вместо localStorage браузера — **сделано**
   (Fastify + PostgreSQL + JWT, `server/`).
2. ✅ Роли с глобальных на **привязанные к проекту** — **сделано**
   (`global_role` + `project_members`, см. `ROLE_MIGRATION.md`).
3. ✅ Сущность «департамент» над проектами, с LDAP-синхронизацией членства —
   **сделано** (миграции 007/009, `DEPT_MIGRATION.md` + `LDAP_MIGRATION.md`).

### Компоненты

- **Клиент** — существующий React SPA, дорабатывается под работу с реальным API вместо localStorage
- **Reverse proxy** — nginx с TLS, точка входа в корпоративной сети
- **Backend API** — новый сервис (папка `server/`): бизнес-логика, авторизация, LDAP-клиент
- **PostgreSQL** — департаменты, проекты, задачи, пользователи, права, история изменений
- **LDAP/AD** — внешняя корпоративная система, backend только сверяет логин/пароль и
  membership в группах; сам не хранит пароли
- **Файловое хранилище** — вложения к задачам (S3-совместимое, например MinIO, для on-prem)
- **Фоновый воркер** — уведомления (email, in-app), синхронизация членства в LDAP-группах по расписанию

### Модель данных (целевая, расширяет текущую `src/types.ts`)

```
Department  { id, name, ldapGroupDn }
Project     { id, key, name, departmentId, isShared (кросс-департаментный: bool) }
ProjectMember { projectId, userId, role }          -- роль теперь тут, не глобально на User
User        { id, name, ldapDn, email }             -- accessRole убирается отсюда
Issue       { key, projectId, typeId, statusId, priorityId, complexity,
              assigneeId, reporterId, directionId (было epicId), labels[], comments[], activity[] }
Direction   { id, projectId, name }                  -- замена Epic, без жёсткой иерархии/сроков
Workflow    { projectId, statuses[], transitions[] } -- одна схема на проект
```

Ключевое отличие от текущего кода: `accessRole` переезжает из `User` в `ProjectMember` —
это и есть переход от глобальных прав к правам на уровне проекта.

### Что переносится почти без изменений

- `src/permissions.ts` — логика `can()`/`requirePerm()` остаётся, только источник роли
  меняется с `user.accessRole` на `projectMember.role` для конкретного проекта
- Граф статусов/переходов (`WorkflowView.tsx`) — концепция остаётся, просто на уровне проекта,
  а не глобально на всё приложение
- UI-компоненты доски, карточки задачи, фильтров — переиспользуются, меняется только
  источник данных (API вместо localStorage)

### Что убирается / упрощается из текущей реализации

- ✅ `Backlog.tsx` со спринтами — заменён на плоский «Список задач» с фильтрами и
  сортировкой, без понятий "активный/будущий спринт" (миграция 012,
  [UI_RESTRUCTURE.md](UI_RESTRUCTURE.md))
- ✅ Story points — заменены на «Сложность» (`simple | medium | hard`),
  редактируемую в карточке и при создании задачи (миграция 018).
- ✅ `TimelineView.tsx` — вопрос закрыт в пользу сохранения: получил pan по
  холсту и физику перетаскивания (`Timeline.tsx`, PR «overdrive»); удаление
  не рассматривается.

## Порядок разработки

1. ✅ Backend: авторизация через LDAP + базовая модель (Department → Project → Issue)
   — сделано: модель Department → Project → Issue (миграция 007), multi-project,
   LDAP/AD-аутентификация с JIT-provisioning и sync членства (миграция 009,
   `LDAP_MIGRATION.md` / `LDAP_SETUP.md`). Фоновый ресинк по расписанию — сделан
   (см. п. 5).
2. ✅ Миграция ролевой модели с глобальной на привязанную к проекту
   — сделано (миграции 004/006, `ROLE_MIGRATION.md`).
3. ✅ Перевод фронтенда с localStorage на реальный API — сделано.
4. ✅ Файловое хранилище для вложений — сделано (миграция 010, абстракция
   `Storage`: `local`|`s3`, `FILES_MIGRATION.md` / `STORAGE_SETUP.md`).
5. ✅ Уведомления + фоновый воркер — сделано (миграция 011, in-app-лента +
   email-воркер `nodemailer`, `NOTIFICATIONS_MIGRATION.md` /
   `NOTIFICATIONS_SETUP.md`). Скелет воркера — общий; сборщик осиротевших
   объектов хранилища и фоновый ресинк LDAP-членства навешены на него
   отдельными джобами (`storageSweeper.ts`, `departmentSync.ts` `resyncAllLdapUsers`).
6. 🟡 Переименование сущностей в UI под нейтральную терминологию (см. SCOPE.md)
   — сделано в [UI_RESTRUCTURE.md](UI_RESTRUCTURE.md): спринты удалены целиком
   (миграция 012, право `manageSprints` из `MATRIX`), «Бэклог» → «Список задач»
   (плоский список с фильтрами и сортировкой), «Эпик» → «Направление» в подписях,
   «+» на доске только у первого `todo`-столбца, добавлен главный экран
   (`HomeView` + `GET /api/issues/assigned-to-me`). «Таймлайн» остаётся и
   развивается (pan, физика перетаскивания). Story points → «Сложность»
   сделано (миграция 018). Осталось: переименование внутренних `epicId`/`ViewId`.
