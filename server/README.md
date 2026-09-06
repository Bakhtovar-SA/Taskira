# Taskira Server — дизайн, статус и запуск

Внутренний корпоративный task-tracker. Клиент — React SPA (корень репозитория),
сервер — Node.js + Fastify + TypeScript, база — PostgreSQL.

**Принцип: права проверяются только на сервере.** Клиентский `src/permissions.ts` —
только UX. Любая мутация без JWT и права → `403 { error: { code, reason } }`
с причиной на русском.

## Роли и матрица прав (зафиксировано миграцией 002)

| Разрешение | admin | manager | employee | viewer |
|---|:-:|:-:|:-:|:-:|
| browse — просмотр проекта | ✓ | ✓ | ✓ | ✓ |
| create — создание задач | ✓ | ✓ | ✓ | — |
| edit — редактирование задач | ✓ | ✓ | ✓* | — |
| transition — смена статуса | ✓ | ✓ | ✓ | — |
| comment — комментарии | ✓ | ✓ | ✓ | — |
| delete — удаление задач | ✓ | ✓ | — | — |
| manageSprints — спринты | ✓ | ✓ | — | — |
| editWorkflow — схема переходов | ✓ | — | — | — |
| manageAccess — пользователи и роли | ✓ | — | — | — |

\* **employee — только свои задачи** (исполнитель или автор). Правило — в `can()`/`canEditIssue()`.

Дополнительно: `users.is_active` — деактивированный аккаунт не входит (403 при логине),
его токены отклоняются `requireAuth` (401 «Аккаунт деактивирован администратором»).

## Статус этапов

| # | Коммит | Статус |
|---|---|---|
| 1 | Харденинг клиента: UUID, валидация/санитизация | ✅ |
| 2 | `001_init.sql` + zod-контракт API | ✅ |
| 3a | Скелет сервера (Fastify, JWT, middleware, auth, seed) | ✅ |
| 3a-fix | Транзакции в migrate(), кэш конфига, refresh роли из БД, rate-limit логина, /health 503, .gitignore | ✅ |
| 3b-model | `002_corporate.sql`: employee, task/bug/request, due_date, issue_watchers | ✅ |
| roles-1 | `004_project_roles.sql`: `users.global_role` + `project_members` (схема, бэкфилл) — план в [`../ROLE_MIGRATION.md`](../ROLE_MIGRATION.md) | ✅ схема |
| roles-2 | Ядро прав переведено на project-scoped: `resolveRole()`, `req.projectRole`/`req.membership`, `requirePerm`/`requireIssuePerm` резолвят роль по `project_members`; JWT несёт `globalRole` | ✅ сервер |
| roles-3 | Роуты + контракт: bootstrap отдаёт `members`; `PUT`/`DELETE /api/project/members/:userId`; `CreateUserBody`/`ChangeRoleBody` на `globalRole`; `SafeUser.globalRole` | ✅ сервер |
| roles-4 | Клиент: `store`/`api`/`permissions` на `globalRole` + `members`; `me` считает эффективную роль; экшены `setMemberRole`/`removeMember`; мёртвый `src/seed.ts` вырезан | ✅ клиент |
| roles-5 | Клиент UI: `PermissionsView` — управление составом (роль/добавить/убрать) для админа ресурса, счётчики по `data.members`; `DocsView` тексты; CORS-фикс (`app.ts` methods) | ✅ клиент |
| roles-7 | `006_drop_access_role.sql`: `DROP COLUMN users.access_role` + constraint; чистка `UserRow`/`SafeUser`/`safeUser`/`seedAdmin` и `SafeUser` на клиенте | ✅ |
| 3b-routes | CRUD issues/sprints/workflow/comments/users | ⏳ следующий |
| 3c | WebSocket-рассылка | ⏳ |
| 4 | Фронтенд поверх API + синхронизация ролей клиента (employee) | ⏳ |
| 5 | docker-compose + runbook + бэкап | ⏳ |

## Breaking changes (002)

1. **Роль `developer` упразднена → `employee`.** Все существующие пользователи
   перенесены `UPDATE`. JWT со старой ролью в payload безопасны: `requireAuth`
   берёт актуальную роль из БД (кэш 30 с).
2. **Типы задач: только `task | bug | request`.** `story → task` (история — задача),
   `epic → task` (эпик упразднён как тип; группировка осталась в `issues.epic_id`,
   таймлайн-поля `t_start/t_span` сохранены). Решение необратимо и задокументировано
   в шапке `002_corporate.sql`.
3. **Клиентская демо-модель пока со старыми ролями/типами** (developer, story, epic) —
   это сознательно: клиент синхронизируется с контрактом в Этапе 4. Серверный контракт
   (`contract.ts`) — уже источник правды.
4. `GET /api/issues` возвращает `{ items, total }` (пагинация limit/offset ≤ 200).
5. `ChangeRoleBody` / `CreateUserBody` принимают опциональный `isActive`.

## Breaking changes (роли project-scoped, миграция 004 + roles-2/3)

Подробности и порядок — [`../ROLE_MIGRATION.md`](../ROLE_MIGRATION.md).

6. **`CreateUserBody` / `ChangeRoleBody` принимают `globalRole`** (`admin | member`),
   а не `accessRole`. Тело со старым полем — `400`.
7. **`GET /api/project`** дополнен полем `members: [{ userId, role }]`; в `users[]`
   и `GET /api/users` каждый DTO — с `globalRole`. Поля `accessRole` в DTO больше
   нет (миграция 006 удалила и колонку `users.access_role`).
8. **Права проверяются по `project_members`**, не по `users.access_role`.
   Пользователь без членства (и не глобальный `admin`) получает `403` на любом
   роуте проекта. Глобальный `admin` доступ имеет всегда, строки в
   `project_members` для него нет.
9. Новые роуты состава: `PUT` / `DELETE /api/project/members/:userId`
   (право `manageAccess` — только глобальный `admin`).
10. JWT-payload: поле `role` → `globalRole`. Старые токены рабочие — payload для
    авторизации не используется, роль берётся из БД в `requireAuth`.

## Этап 3b — роуты API

Все мутации проверяют JWT и право **на сервере**; отказы — `403 {error:{code:"FORBIDDEN",reason}}` на русском.

| Метод и путь | Тело / query | Права | Назначение |
| --- | --- | --- | --- |
| `GET /api/project` | — | browse | bootstrap: проект, **активные** пользователи (с `globalRole`, без `password_hash`), `members: [{userId, role}]`, workflow, спринты |
| `GET /api/issues` | `IssueQuery`: status, sprint, assignee, type, q, dueFrom, dueTo, overdue, limit(≤200), offset | browse | `{items, total}`, сортировка по rank |
| `POST /api/issues` | `IssueCreateBody` | create | num — атомарный счётчик (миграция 003); статус по умолчанию — первый `todo`; rank — в конец колонки |
| `GET /api/issues/:id` | — | browse | задача |
| `PATCH /api/issues/:id` | `IssuePatchBody` | edit (employee — **только свои**); смена `sprintId` дополнительно требует **manageSprints** | правка полей + activity |
| `DELETE /api/issues/:id` | — | delete | каскады: комментарии/activity/watchers; `epic_id` дочерних обнуляется FK |
| `POST /api/issues/:id/transition` | `{to, beforeId?}` | transition + **схема workflow** (нарушение — `409 CONFLICT`) | смена статуса + rank |
| `PATCH /api/issues/:id/sprint` | `{sprintId}` | manageSprints | перенос спринт ⇄ бэклог |
| `POST/DELETE /api/issues/:id/watchers/me` | — | browse | подписка/отписка; ответ `{watching, watchers}` |
| `GET /api/issues/:id/comments` · `POST …/comments` | `{body ≤2000}` | browse · comment | комментарии с профилем автора |
| `GET /api/sprints` | — | browse | все спринты проекта |
| `POST /api/sprints/start` | — | manageSprints | активировать future (даты сегодня/ +14) или создать active |
| `POST /api/sprints/:id/complete` | — | manageSprints | `completed`; недозакрытые → бэклог; создаётся следующий future |
| `GET /api/workflow` | — | browse | статусы, переходы, `issueCounts` по статусам |
| `POST /api/workflow/transitions` | `{from,to}` | **admin**; дубликат — `409`, петля — `400` | добавить переход |
| `DELETE /api/workflow/transitions/:id` | — | **admin** | удалить переход |
| `POST /api/workflow/reset` | — | **admin** | дефолтные 8 переходов; статусы не удаляются никогда |
| `GET /api/users` | — | **admin** | все, включая деактивированных; DTO с `globalRole` |
| `POST /api/admin/users` | `CreateUserBody` (bcrypt, `globalRole`) | **admin**; занятый username — `409` | создать пользователя; членство в проекте — отдельно |
| `PATCH /api/users/:id` | `{globalRole, isActive?}` | **admin**; защита последнего активного админа — `409` | смена **глобальной** роли; `invalidateUserCache` — действует сразу |
| `PUT /api/project/members/:userId` | `SetMemberBody` `{role}` | **admin** (`manageAccess`) | добавить участника / сменить проектную роль; upsert; `invalidateMembership` |
| `DELETE /api/project/members/:userId` | — | **admin** (`manageAccess`) | убрать из проекта; `404` если не участник; `409` — последний активный менеджер |

**Seed проекта** (`seedProject`, идемпотентно): при пустой `projects` создаёт `CORP «Корпоративные задачи»`
(или `PROJECT_KEY/PROJECT_NAME` из env), статусы `todo / inprogress / review / done`
(категории `todo | inprogress | inprogress | done`), 8 переходов дефолтного графа
(`todo→inprogress, todo→done, inprogress→{todo,review,done}, review→{inprogress,done}, done→inprogress`)
и один future-спринт. Повторный запуск ничего не дублирует.

### Примеры curl

```bash
BASE=http://localhost:8080/api
TOKEN=$(curl -s -X POST $BASE/auth/login -H 'content-type: application/json' \
  -d '{"username":"admin","password":"…"}' | jq -r .token)
AUTH="authorization: Bearer $TOKEN"

# bootstrap: статусы и их uuid
curl -s $BASE/project -H "$AUTH" | jq '.workflow.statuses[] | {sid, name, id}'
TODO_ID=…; INPROG_ID=…; REVIEW_ID=…

# создать задачу (num и key выдаст сервер: CORP-1)
ID=$(curl -s -X POST $BASE/issues -H "$AUTH" -H 'content-type: application/json' -d '{
  "title":"Настроить ночные бэкапы БД","typeId":"task","priorityId":"high",
  "assigneeId":null,"epicId":null,"labels":["инфра"],"points":3,
  "sprintId":null,"dueDate":"2026-03-01"
}' | jq -r .id)

# переход по схеме (todo→inprogress); вне схемы (todo→review) вернёт 409
curl -s -X POST $BASE/issues/$ID/transition -H "$AUTH" -H 'content-type: application/json' \
  -d "{\"to\":\"$INPROG_ID\"}"

# комментарий
curl -s -X POST $BASE/issues/$ID/comments -H "$AUTH" -H 'content-type: application/json' \
  -d '{"body":"Взял в работу"}'

# подписаться на задачу
curl -s -X POST $BASE/issues/$ID/watchers/me -H "$AUTH"

# смена роли пользователя (admin); сработает без перевыпуска его токена
curl -s -X PATCH $BASE/users/$USER_ID -H "$AUTH" -H 'content-type: application/json' \
  -d '{"accessRole":"employee"}'
```

## Как прогнать локально

```bash
cd server
npm i
cp .env.example .env
# Заполните: DATABASE_URL, JWT_SECRET (>=32 симв.), ADMIN_USERNAME/ADMIN_PASSWORD
# JWT_SECRET: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

npm run dev        # tsx watch: миграции → seed админа → listen :8080
```

Миграции и seed по отдельности:

```bash
npm run seed                     # прогоняет migrate() + создание первого админа
psql "$DATABASE_URL" -c "select name from schema_migrations"   # 001..004, 006
```

Health, логин, me:

```bash
curl -s localhost:8080/api/health
# {"ok":true,"db":true,…}          (503 + ok:false, если БД легла)

curl -s -X POST localhost:8080/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"username":"admin","password":"…из .env…"}'
# {"token":"…","user":{"username":"admin","accessRole":"admin","isActive":true,…}}

TOKEN=…; curl -s localhost:8080/api/auth/me -H "authorization: Bearer $TOKEN"
```

Rate-limit логина (in-memory, 10 попыток / IP / 5 минут):

```bash
for i in $(seq 1 11); do curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST localhost:8080/api/auth/login -H 'content-type: application/json' \
  -d '{"username":"admin","password":"bad"}'; done
# 401 ×10, затем 429
```

## Чеклист ручной проверки

- [ ] `npm run typecheck` — без ошибок; `npm run dev` стартует, все миграции в `schema_migrations`
- [ ] Остановка PostgreSQL → `/api/health` отвечает **503** `{ok:false,db:false}`; восстановление → 200
- [ ] Логин: неверный пароль — 401 с единым reason; 11-я попытка за 5 минут — **429 RATE_LIMITED**
- [ ] `is_active=false` в БД → логин 403 «Аккаунт деактивирован…», `/me` с живым токеном — 401 (в пределах 30 с)
- [ ] Смена `global_role` в БД админом → `/me` и проверки прав видят новую роль **без** перевыпуска токена (≤30 с)
- [ ] В `issues` нет типов `story`/`epic` (`select distinct type_id from issues;`)
- [ ] `access_role` в `users` больше нет (миграция 006): `select column_name from information_schema.columns where table_name='users' and column_name='access_role'` — пусто; `users_global_role_check` и `issues_type_id_check` — на месте
- [ ] `git check-ignore server/.env server/dist .env` — всё игнорируется

### Миграция 004 (схема project-scoped ролей)

- [ ] `04` в `schema_migrations`; `\d project_members` показывает PK `(project_id, user_id)`, CHECK на `role`, индекс `idx_project_members_user`
- [ ] `select distinct global_role from users` → `admin` и/или `member`; у бывших `access_role='admin'` теперь `global_role='admin'`
- [ ] На БД с данными: `select count(*) from project_members` = число активных не-admin пользователей; строк для admin нет
- [ ] На чистой БД: `migrate()` до сида не падает (users/projects пусты), затем `seedAdmin` пишет `global_role='admin'` без строки в `project_members`

### Ядро прав project-scoped (roles-2)

- [ ] Логин: JWT-payload несёт `globalRole` (не `role`); `/api/auth/me` — 200
- [ ] Токен, выданный до перехода (payload с `role`), продолжает работать — роль берётся из БД в `requireAuth`
- [ ] Глоб. `admin` без строки в `project_members` — полный доступ ко всем роутам проекта
- [ ] `global_role='member'` без членства → любой роут проекта отдаёт **403** «Нет доступа к проекту»
- [ ] `member` + `project_members.role='viewer'` → `GET /api/project`, `GET /api/issues` — 200; `POST /api/issues` — 403 «Создание задач»; `GET /api/users` — 403 «Управление доступом»; `POST /api/workflow/transitions` — 403 «Изменение workflow»
- [ ] Вставка/удаление строки `project_members` вступает в силу ≤ 30 с (TTL кэша) или после рестарта
- [ ] `PATCH /api/issues/:id` со сменой `sprintId` от роли без `manageSprints` → 403

### Роуты + контракт (roles-3)

- [ ] `GET /api/project` — есть `members: [{userId, role}]`; каждый `users[i]` и `GET /api/users` — с `globalRole`
- [ ] `POST /api/admin/users` с `{globalRole}` (без `accessRole`) — 201; старое тело с `accessRole` — 400
- [ ] `PATCH /api/users/:id {globalRole:'admin'}` — повышение действует сразу (`invalidateUserCache`); `{globalRole:'member'}` на единственном активном админе — 409
- [ ] `PUT /api/project/members/:userId {role}` от глоб. `admin` — 200 (upsert: и добавление, и смена роли); от `manager` проекта — 403 «Управление доступом»
- [ ] `DELETE /api/project/members/:userId` — 204; повторно / не участник — 404
- [ ] Гард последнего менеджера: `DELETE` или `PUT`-понижение единственного активного `manager` — **409**; после назначения второго — операция проходит
- [ ] После `PUT`/`DELETE` состава роль в правах пользователя меняется без релогина (`invalidateMembership`)

### Этап 3b

- [ ] `npm run seed` дважды — проект и workflow не дублируются (`select count(*) from projects` → 1, переходов → 8)
- [ ] `POST /api/issues` → 201 с `key=CORP-1`, следующий — `CORP-2`; 10 параллельных POST дают уникальные номера
- [ ] Переход `todo→inprogress` — 200; `todo→review` — **409 CONFLICT** с русским reason
- [ ] Ранги: вторая задача в колонку с `beforeId` первой встаёт **перед** ней; 60 вставок «между» подряд — без дубликатов rank
- [ ] employee: `PATCH` чужой задачи — 403 «…только задачи, где вы исполнитель или автор»; своей — 200
- [ ] viewer: `GET /api/issues` — 200; `POST /api/issues` и transition — 403
- [ ] employee меняет `sprintId` через PATCH — 403 (manageSprints); manager — 200
- [ ] `POST /api/workflow/transitions` не-админом — 403; админом — 201; дубликат — 409; `reset` возвращает 8 переходов
- [ ] `PATCH /api/users/:id` с понижением последнего активного админа — 409; при двух админах — 200, права меняются ≤30 с без перевыпуска токена
- [ ] Спринты: `start` → active; `complete` → недозакрытые получают `sprint_id NULL`, создаётся следующий future
- [ ] Watchers: POST → `{watching:true,watchers:1}`, DELETE → `{watching:false,watchers:0}`
- [ ] `audit_log` содержит `issue.create`, `issue.transition`, `access.denied`, `user.role.change`

## Зависимости

```
fastify @fastify/jwt @fastify/cors @fastify/websocket pg zod bcryptjs
```

### Чистка корневого package.json (сделать вручную)

```bash
npm uninstall @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities \
  @supabase/supabase-js canvas-confetti @types/canvas-confetti date-fns \
  framer-motion lucide-react react-router-dom recharts uuid @types/uuid
```

## Секреты

Только через env: `JWT_SECRET` (≥ 32 символов), `DATABASE_URL`, `ADMIN_PASSWORD`.
`.env`, `server/.env`, `server/dist`, `server/node_modules` — в `.gitignore`.
