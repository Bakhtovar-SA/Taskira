# ARCHITECTURE — Taskira

## Текущее состояние (по репозиторию на данный момент)

Работает клиент-серверная связка: React 18 + TypeScript + Vite SPA (`src/`)
общается с Fastify 5 + PostgreSQL + JWT API (`server/`). `localStorage` больше не
хранилище данных — в нём только JWT (`taskira.token`); проект, состав, задачи и
workflow приходят через `src/api/` + `src/store.tsx` (`bootstrap()`).

Уже реализовано и работает:
- **Backend** (`server/`): Fastify, миграции PostgreSQL (`server/migrations/`,
  001–006), JWT-аутентификация по паролю (bcrypt), проверка прав на каждой
  мутации (`middleware.ts` `requirePerm`/`requireIssuePerm`), аудит-лог.
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
- Список задач (`Backlog.tsx`) с фильтрами; спринт-модуль пока присутствует.
- Настраиваемый workflow — граф статусов/переходов в БД
  (`workflow_statuses` / `workflow_transitions`), редактор `WorkflowView.tsx`.
  `src/seed.ts` оставлен только как `DEFAULT_WORKFLOW` для `DocsView.tsx`.
- Карточка задачи: поля, история изменений (`activity`), комментарии, подписка
  (`issue_watchers`).
- Один проект (`currentProject()`, захардкожен), **департаментов нет**.

Чего ещё нет (детальнее — раздел «Порядок разработки»):
- **LDAP/AD** — аутентификация пока по локальному паролю, синхронизации групп нет.
- **Департаменты** — ни таблицы, ни `projects.department_id`; проект один,
  поэтому membership тоже пока в рамках одного проекта.
- **Вложения** — файлового хранилища (S3/MinIO, multipart) нет.
- **Уведомления и фоновый воркер** — нет; WebSocket-рассылка объявлена типом
  (`WsMessage` в `contract.ts`), но не реализована.
- **Нейтральная терминология в UI** не доведена: остаются «Бэклог», «Таймлайн»,
  спринты, story points, `epicId` вместо «Направления».

## Целевая архитектура

Три больших изменения относительно исходного (localStorage-only) кода:
1. ✅ Настоящий backend + БД вместо localStorage браузера — **сделано**
   (Fastify + PostgreSQL + JWT, `server/`).
2. ✅ Роли с глобальных на **привязанные к проекту** — **сделано**
   (`global_role` + `project_members`, см. `ROLE_MIGRATION.md`).
3. ⬜ Сущность «департамент» над проектами, с LDAP-синхронизацией членства —
   **не начато**.

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

- `Backlog.tsx` со спринтами — заменяется на плоский список задач с фильтрами, без
  понятий "активный/будущий спринт"
- Story points (числовая оценка) — заменяется на поле "сложность" с 3 значениями
- `TimelineView.tsx` (таймлайн эпиков на 8-недельной шкале) — либо убирается, либо
  упрощается до списка направлений без привязки к датам

## Порядок разработки

1. 🟡 Backend: авторизация через LDAP + базовая модель (Department → Project → Issue)
   — backend и модель Project → Issue готовы; **LDAP и Department не начаты**
   (аутентификация по локальному паролю, один захардкоженный проект).
2. ✅ Миграция ролевой модели с глобальной на привязанную к проекту
   — сделано (миграции 004/006, `ROLE_MIGRATION.md`).
3. ✅ Перевод фронтенда с localStorage на реальный API — сделано.
4. ⬜ Файловое хранилище для вложений — не начато.
5. ⬜ Уведомления + фоновый воркер — не начато (есть только `issue_watchers`).
6. 🟡 Переименование сущностей в UI под нейтральную терминологию (см. SCOPE.md)
   — «Доска»/«Задача»/«Рабочий процесс» уже нейтральны; «Бэклог», «Таймлайн»,
   спринты, story points, «Направление» вместо `epicId` — ещё нет.
