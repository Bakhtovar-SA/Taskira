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
| 3b-routes | CRUD issues/sprints/workflow/comments/users — все роуты реализованы, права на сервере | ✅ |
| 4 | Фронтенд поверх API (localStorage → `src/api/` + `store.tsx`); клиент тянет всё через `bootstrap()` | ✅ |
| roles-1 | `004_project_roles.sql`: `users.global_role` + `project_members` (схема, бэкфилл) | ✅ |
| roles-2 | Ядро прав project-scoped: `resolveRole()`, `req.projectRole`/`req.membership`; `requirePerm`/`requireIssuePerm` резолвят роль по `project_members`; JWT несёт `globalRole` | ✅ |
| roles-3 | Роуты + контракт: bootstrap отдаёт `members`; `PUT`/`DELETE /api/project/members/:userId`; `CreateUserBody`/`ChangeRoleBody` на `globalRole` | ✅ |
| roles-4 | Клиент: `store`/`api`/`permissions` на `globalRole` + `members`; `me` считает эффективную роль; экшены `setMemberRole`/`removeMember`; мёртвый `src/seed.ts` вырезан | ✅ |
| roles-5 | Клиент UI: `PermissionsView` — управление составом (роль/добавить/убрать) для админа ресурса; `DocsView` тексты; CORS-фикс (`app.ts` methods) | ✅ |
| roles-7 | `006_drop_access_role.sql`: `DROP COLUMN users.access_role` + constraint; чистка `UserRow`/`SafeUser`/`safeUser`/`seedAdmin`, `SafeUser` на клиенте | ✅ |
| dept-1 | `007_departments.sql`: таблица `departments` (+ `ldap_group_dn`), `projects.department_id`/`is_shared`, бэкфилл «Общий отдел» — план в [`../DEPT_MIGRATION.md`](../DEPT_MIGRATION.md) | ✅ схема |
| dept-2 | Сервер multi-project: ресурсы под `/api/projects/:projectId/...`; `GET`/`POST /api/projects`, `/api/departments` CRUD; `requireGlobalAdmin`; assignee ∈ `project_members`; видимость §3.5 | ✅ сервер |
| dept-3 | Клиент: `src/api/` + `store.tsx` на `:projectId`; `bootstrap` = `GET /api/projects` → выбор (`localStorage`) → `GET /api/projects/:id`; экшен `switchProject`; `projectsApi`/`departmentsApi` | ✅ клиент |
| dept-4 | Клиент UI: `AdminView` — CRUD департаментов/проектов + тумблер `is_shared` (глоб. admin); экшены в store; `PermissionsView` add-member через `GET /api/users` | ✅ клиент |
| ops-backup | `server/scripts/backup.sh` + `backup.ps1` (pg_dump `-Fc` + проверка `pg_restore --list` + ротация); runbook [`BACKUP.md`](BACKUP.md) — часть Этапа 5 | ✅ |
| ops-tests | vitest + `app.inject()`; схема `taskira_test`; `test/helpers.ts` + `access.roles.test.ts` + `access.multiproject.test.ts` + `access.collaborators.test.ts` — права/гарды/IDOR/collaborators (31 тест) | ✅ |
| ops-ci | `.github/workflows/test.yml` — сервис `postgres:16`, `npm ci` → `typecheck` → `npm test` (on push main + PR) | ✅ |
| collab-A | `AdminView`: состав любого проекта из экрана отдела (ленивый `projectsApi.get`, роли/добавить/убрать); store `setProjectMember`/`removeProjectMember` — план в [`../COLLAB_MIGRATION.md`](../COLLAB_MIGRATION.md) D8. Сервер без изменений (global admin уже правит состав любого проекта) | ✅ клиент |
| collab-B | Issue collaborators — [`../COLLAB_MIGRATION.md`](../COLLAB_MIGRATION.md). Ф1: `008_issue_collaborators.sql` ✅. Ф2: `manageCollaborators` (MATRIX ×2), fallback приглашённого в `requireIssuePerm` (browse/comment), `routes/collaborators.ts`, `getIssueDto.collaborators`, `GET /api/users/pickable` ✅. Ф3: клиент — `collaboratorsApi`, экшены store, секция «Участники задачи» в `IssueModal` ✅. Ф6: `GET /api/issues/collaborating`, `getIssueDto.participants`, одиночный режим `SoloView` (`bootStatus="solo"`) + раздел «Мои подключения» в обычном интерфейсе, ссылка `#/issue/<pid>/<id>` ✅. Ф5: `access.collaborators.test.ts` (11) + живой прогон + ручной чек-лист ниже ✅ | ✅ |
| ldap-auth | LDAP/AD-аутентификация — [`../LDAP_MIGRATION.md`](../LDAP_MIGRATION.md) + [`../LDAP_SETUP.md`](../LDAP_SETUP.md). Ф1: `009_ldap.sql` (`users.auth_source`/`ldap_dn`/`email`, `department_members`, `ldap_group_dn UNIQUE`), `config.ts` `LDAP_*`, тестовый OpenLDAP (compose/LDIF) ✅. Ф2: `services/ldap.ts` (`ldapts`), `userProvisioning.ts`, `departmentSync.ts`, `POST /login` ldap-путь + break-glass, `routes/ldap.ts` `ping` ✅. Ф3: видимость проекта по департаменту → неявный `viewer` в `middleware.ts` (закрыт DEPT §3.5) ✅. Ф4: AdminView `ldap_group_dn`, `POST /api/ldap/resync`, ldap-режим гарды ✅. Ф5: `access.ldap.test.ts` (9) vs реальный slapd + CI job `ldap` ✅. Ф6: `LDAP_SETUP.md` + чек-лист ниже ✅. Харденинг: last-admin гард в JIT, гонка первого логина (23505), RFC 4514 escDn, break-glass 409 не течёт в ответ | ✅ |
| 3c | WebSocket-рассылка (`WsMessage` в `contract.ts` объявлен, реализации нет) | ⏳ |
| 5 | docker-compose + runbook + бэкап | ⏳ |

**roles-1…7** — ролевая миграция (project-scoped) влита в `main` одним PR (#10);
детальный план и порядок фаз — [`../ROLE_MIGRATION.md`](../ROLE_MIGRATION.md).

Дальше по дорожной карте (`../ARCHITECTURE.md`, «Порядок разработки») — **не начато**:
файловое хранилище вложений, уведомления + фоновый воркер (в т.ч. ресинк
LDAP-членства по расписанию), нейтральная терминология в UI
(Бэклог/Таймлайн/спринты/story points/эпики).

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
11. **Понижение админа ресурса (`PATCH /api/users/:id` → `globalRole: "member"`)
    отбирает доступ к проекту.** Админ не имеет строки в `project_members`
    (§3.3), поэтому после понижения `resolveRole` возвращает `null` и бывший
    админ получает `403` на всех роутах проекта, пока другой админ явно не
    добавит его через `PUT /api/project/members/:userId`. Это отличие от старой
    модели, где понижение `access_role` оставляло реальный доступ на новой роли.
    Гард «последнего активного админа» при этом не даёт понизить единственного.

## Этап 3b — роуты API

> **dept-2 (multi-project):** ресурсы проекта переехали под `/api/projects/:projectId/...`
> — таблица ниже с путями вида `/api/issues` **устарела**, читайте как
> `/api/projects/:projectId/issues` и т.д. Bootstrap `GET /api/project` →
> `GET /api/projects/:projectId`. Добавлены `GET`/`POST /api/projects`,
> `PATCH`/`DELETE /api/projects/:projectId`, `GET`/`POST`/`PATCH`/`DELETE /api/departments[/:id]`,
> `PUT`/`DELETE /api/projects/:projectId/members/:userId`. Актуальный список —
> в [`../DEPT_MIGRATION.md`](../DEPT_MIGRATION.md) §Фаза 2.

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

npm run dev        # tsx watch (chokidar polling): миграции → seed админа → listen :8080
```

`npm run dev` форсит поллинг chokidar (`CHOKIDAR_USEPOLLING=1`, интервал 250 мс) —
на Windows рекурсивный `fs.watch` пропускает правки от атомарного сохранения
редактора и от инструментов, и сервер не перезапускается. Поллинг это чинит ценой
небольшого CPU. Нативные события: `npm run dev:native`. Если после крупной
многофайловой правки перезапуск всё же выглядит подвисшим — перезапустите dev.

Миграции и seed по отдельности:

```bash
npm run seed                     # прогоняет migrate() + создание первого админа
psql "$DATABASE_URL" -c "select name from schema_migrations"   # 001..004, 006, 007
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

## Тесты

Интеграционные тесты прав доступа (vitest + `app.inject()`):

```bash
npm test            # vitest run
npm run test:watch
```

Прогоняются по **схеме `taskira_test`** внутри dev-БД
(`options=-csearch_path=taskira_test,public`) — отдельная БД и права CREATEDB не
нужны, dev-схема `public` не затрагивается. `test/global-setup.ts` пересоздаёт
схему и гоняет миграции один раз; `test/helpers.ts` — `getApp` / `seedFixture`
(admin + 2 проекта в 2 отделах + участники всех ролей + outsider) / `login`.

Покрыто (`test/access.roles.test.ts`, `test/access.multiproject.test.ts`):
глоб. admin без членства — полный доступ; `member` без членства — 403 + пустой
`/api/projects`; матрица ролей (viewer/employee); employee правит только свои;
гард последнего admin и последнего менеджера проекта; `requireGlobalAdmin`;
видимость проектов (`is_shared`); **IDOR — задача из чужого проекта → 404**;
assignee не из проекта → 400; `DELETE` отдела с проектами → 409; независимая
нумерация задач по проектам.

## Чеклист ручной проверки

- [ ] `npm run typecheck` — без ошибок; `npm test` — зелёный; `npm run dev` стартует, все миграции в `schema_migrations`
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

### Миграция 007 (департаменты, dept-1)

- [ ] `007_departments.sql` в `schema_migrations`; `\d departments` — `name UNIQUE`, `ldap_group_dn` nullable
- [ ] `projects.department_id` — `NOT NULL`, FK → `departments`; `projects.is_shared` — `NOT NULL DEFAULT false`
- [ ] На БД с данными: существующие проекты привязаны к «Общий отдел» и помечены `is_shared = true`; `ldap_group_dn` пуст
- [ ] На чистой БД: `migrate()` создаёт «Общий отдел» (пустой), `seedProject` его переиспользует и вешает проект туда; `is_shared` фреш-проекта = `false`
- [ ] `npm run seed` дважды — департамент и проект не дублируются

### Сервер multi-project (dept-2)

- [ ] `GET /api/departments` — список с `projectCount`; `POST`/`PATCH`/`DELETE` от не-admin → 403; `DELETE` отдела с проектами → 409, пустого → 204
- [ ] `GET /api/projects` — глоб. admin видит все; обычный юзер — только где он в `project_members` или `is_shared`
- [ ] `POST /api/projects` (admin) — создаёт проект + дефолтный workflow (4 статуса, 8 переходов); дублирующий ключ → 409; `POST` от не-admin → 403
- [ ] `GET /api/projects/:projectId` — bootstrap `{project, users, members, workflow, sprints}`; не-участник не-shared проекта → 403; несуществующий / кривой uuid → 404
- [ ] `GET /api/projects/:A/issues/<issue-из-B>` → 404 (path-confusion)
- [ ] `POST`/`PATCH` задачи с `assigneeId` не из `project_members` проекта → 400 «Исполнитель не входит в проект» (глоб. admin как исполнитель — можно)
- [ ] `PUT`/`DELETE /api/projects/:projectId/members/:userId` — только глоб. admin (manager проекта → 403); гард последнего менеджера как в roles-3
- [ ] `DELETE /api/projects/:projectId` — каскад issues/members/workflow/sprints; `key` `CORP-1` и `SEC-1` независимы

### Issue collaborators (collab-B) — [`../COLLAB_MIGRATION.md`](../COLLAB_MIGRATION.md)

Автотесты: `test/access.collaborators.test.ts` (11) — `npm test` даёт 31 зелёный.

**Сервер:**

- [ ] `008_issue_collaborators.sql` в `schema_migrations`; `\d issue_collaborators` — PK `(issue_id, user_id)`, FK `issue_id`/`user_id` `ON DELETE CASCADE`, `added_by` `ON DELETE SET NULL`, индекс `idx_issue_collaborators_user`
- [ ] `MATRIX.manageCollaborators = ['admin','manager']` в **обеих** копиях `permissions.ts`; в матрице `PermissionsView` появилась строка «Подключение к задаче»
- [ ] `PUT /api/projects/:projectId/issues/:id/collaborators/:userId` от manager/admin проекта → 200; от employee/viewer → 403; неизвестный юзер → 404; деактивированный → 400
- [ ] `DELETE .../collaborators/:userId` — 204; повторно → 404
- [ ] Приглашённый (не участник проекта): `GET .../issues/:id`, `GET/POST .../issues/:id/comments`, `POST/DELETE .../issues/:id/watchers/me` → 200/201; `GET .../issues` (список), `GET /api/projects/:id` (bootstrap), `PATCH`/`DELETE`/`transition` задачи → **403**
- [ ] Grant привязан к ОДНОЙ задаче — другая задача того же проекта приглашённому → 403; приглашённый не появляется в `GET /api/projects` и в переключателе
- [ ] Приглашённый в `assigneeId` при create/patch → 400 (проверка не ослаблена)
- [ ] `GET /api/projects/:A/issues/<из B>/collaborators` → 404 (path-confusion через `requireIssuePerm`); кривой uuid `:id` → 404 (не 500)
- [ ] `GET .../issues/:id` содержит `collaborators[]` и `participants[]` (reporter ∪ assignee ∪ авторы комментариев ∪ приглашённые)
- [ ] `GET /api/users/pickable` — любой аутентифицированный; только активные; без `globalRole`/`username`
- [ ] `GET /api/issues/collaborating` — только свои подключения, с `projectName`/`statusName`; чужие не видны
- [ ] Удаление задачи / проекта каскадит `issue_collaborators`
- [ ] `audit_log`: `issue.collaborator.add` / `issue.collaborator.remove` с `{userId, projectId}`

**Клиент:**

- [ ] `IssueModal` → секция «Участники задачи»: manager/admin видят пикер (`/users/pickable` минус участники проекта, админы ресурса, уже приглашённые, себя) + «×» на чипе; employee/viewer без приглашённых секцию не видят
- [ ] Пригласил → чип появился; отключил → исчез; ошибка/`409` сервера → тост
- [ ] Пользователь с 0 видимых проектов + ≥1 приглашение → `bootStatus="solo"`, `SoloView`: список «Мои подключения», карточка read-only + форма комментария (Ctrl+Enter), имена из `participants`
- [ ] Пользователь БЕЗ проектов и БЕЗ приглашений → прежний пустой экран «обратитесь к администратору» (не solo)
- [ ] Пользователь С проектами + приглашение в чужой проект → в сайдбаре пункт «Мои подключения» (kbd 8) с бейджем-счётчиком; открывает `CollaboratingView` (та же карточка)
- [ ] Прямая ссылка `#/issue/<projectId>/<issueId>`: без проектов → solo с этой задачей; с проектами → раздел «Мои подключения» с предвыбором; `copyLink` в `IssueModal` даёт uuid-форму
- [ ] Приглашение отозвано, пока раздел открыт → после `refreshCollaborations` (на маунте) пункт/бейдж исчезают, карточка показывает «доступ отозван»

### LDAP-аутентификация (ldap-auth) — [`../LDAP_MIGRATION.md`](../LDAP_MIGRATION.md) / [`../LDAP_SETUP.md`](../LDAP_SETUP.md)

Автотесты: `test/access.ldap.test.ts` (9) — гоняются только при `AUTH_MODE=ldap` +
`LDAP_URL` (`npm run test:ldap`), в CI это job `ldap` против настоящего `slapd`.
Основной `npm test` в `AUTH_MODE=local` даёт 38 зелёных (путь входа не меняется).
Живой прогон — поднять `server/test/ldap` (Docker или `mock-ldap.mjs`) и инстанс с
env из [`../LDAP_SETUP.md`](../LDAP_SETUP.md) §2.

**Схема (миграция 009):**

- [ ] `009_ldap.sql` в `schema_migrations`; `\d users` — `auth_source` (`NOT NULL DEFAULT 'local'`, CHECK `local|ldap`), `ldap_dn`, `email` (оба nullable), `password_hash` **nullable**
- [ ] CHECK `users_local_has_password` (`auth_source<>'local' OR password_hash IS NOT NULL`); индексы `users_ldap_dn_uk` (`lower(ldap_dn)`, partial) и `departments_ldap_group_dn_uk` (`lower(ldap_group_dn)`, partial)
- [ ] `\d department_members` — PK `(department_id, user_id)`, FK обе `ON DELETE CASCADE`, `source` CHECK `ldap|manual`, индекс `idx_department_members_user`
- [ ] На БД с данными: все строки `auth_source='local'`, `password_hash` на месте; обратима

**`AUTH_MODE=local` (регрессия):**

- [ ] Вход/`/me`/права — как раньше; `GET /api/auth/config` → `{authMode:"local"}`; `SafeUser` несёт `authSource`
- [ ] `POST /api/ldap/ping` (глоб. admin) → `{authMode:"local", ok:false, error:"AUTH_MODE != ldap …"}`

**`AUTH_MODE=ldap` — вход:**

- [ ] `POST /api/ldap/ping` → `{authMode:"ldap", url, bind:"service-account"|"direct", ok:true, baseDn}`; при погашенном LDAP → `ok:false` + `error`
- [ ] Логин реального LDAP-пользователя → `200` `{token, user}`; JWT payload `{sub:<локальный uuid>, globalRole, name}`
- [ ] Новый пользователь → JIT-создан (`auth_source='ldap'`, `ldap_dn` заполнен); был `local` с тем же `username` → **усыновлён** (`id`, `global_role`, `project_members`, авторство сохранены; `password_hash=NULL`)
- [ ] Член `LDAP_ADMIN_GROUP_DN` → `global_role='admin'`; вне группы → `member`; повторный вход не сбрасывает `is_active`, выставленный админом
- [ ] `department_members` (`source='ldap'`) собраны по группам ↔ `departments.ldap_group_dn`; строки `source='manual'` не тронуты; неявный `viewer` на проектах департамента (browse — 200, мутации — 403)
- [ ] Неверный пароль → `401` (единый reason, LDAP result 49); `audit_log.auth.login.denied` c `actor_id` = `users.id` (если такой username есть)
- [ ] LDAP недоступен → обычный пользователь `401`; **break-glass** `ADMIN_USERNAME` входит по локальному паролю и при живом, и при погашенном LDAP
- [ ] `LDAP_GROUP_MEMBERSHIP=search`: обратный поиск групп выполняется сервис-аккаунтом (re-bind), не забиндленным пользователем
- [ ] `{username}` с метасимволами (`*`, `(`, `\`, для прямого bind — `,`/`+`/`"`) не ломает фильтр/DN и не даёт инъекции — `401`, не `500`
- [ ] `LDAP_USER_FILTER` с двумя `{username}` (AD: `(|(sAMAccountName={username})(userPrincipalName={username}))`) — подставляются **оба** вхождения (`replaceAll`), вход проходит

**`AUTH_MODE=ldap` — гарды и админ-операции:**

- [ ] `POST /api/admin/users` → `409` «заводятся автоматически при первом входе»
- [ ] `PATCH /api/users/:id` со сменой `global_role` для `auth_source='ldap'` → `409`; `{isActive}` → `200`
- [ ] JIT не снимает роль у **последнего** активного админа (группа потеряна в LDAP → роль остаётся `admin`, вход не падает)
- [ ] `PATCH /api/departments/:id {ldapGroupDn}` — сохраняется; та же группа (в любом регистре) на другом отделе → `409`; `null` — очищает
- [ ] `GET /api/departments` — `ldapGroupDn` виден только глоб. admin; у обычного юзера в DTO `null` (не раскрываем DN AD-групп)
- [ ] `LDAP_TIMEOUT_MS` с нечисловым значением → сервер падает на старте (`fail`), не тихий `NaN`
- [ ] `POST /api/ldap/resync` (глоб. admin, нужен `LDAP_BIND_DN`) → `{total, synced, notFound[], errors[]}`; `department_members` пересобраны; `audit_log.ldap.resync`
- [ ] Гонка: два параллельных первых логина одного `username` → одна строка `users` (23505 → повторное чтение → adopt/update), не `500`

**Клиент (`authMode==='ldap'`, из `bootstrap`):**

- [ ] AdminView: на каждом департаменте строка «LDAP-группа» (инлайн-DN, `blur`→PATCH); кнопка «Пересинхронизировать LDAP» в шапке; тост на `409`
- [ ] `LoginForm` — обычный вход по логину/паролю (тот же), просто JWT теперь от LDAP-пути

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
