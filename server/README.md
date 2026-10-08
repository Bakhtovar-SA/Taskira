# Taskira Server — дизайн, статус и запуск

## Интеграции — обзор трека L

- [Токены и сервисные записи](#api-токены-и-сервисные-записи-int-0607): scope, срок, отзыв, членство.
- [Вебхуки](#настройки-вебхуков-трек-l): outbox, allowlist, шифрование, HMAC и журнал доставок.
- [Повторяющиеся задачи](#ядро-повторяющихся-задач-int-10): календарь, владение, догоняющий запуск.
- [Состояние системы](#состояние-инсталляции-int-14-adr-0031): 11 проверок, кэш, пороги, операции хоста.

Source/release Compose передают env из [таблицы интеграций](../DOCKER_SETUP.md#переменные-интеграций-и-расписаний).
Процедуры бэкапа, изолированной репетиции, отключения и Prometheus — [OPERATIONS](../docs/OPERATIONS.md).

`SafeUser.givenName` — необязательная nullable-строка с именем из LDAP-атрибута `givenName`.
Сервер отдаёт её в ответах профиля и списках пользователей; `name` остаётся полным отображаемым именем.
Атрибут читается без учёта регистра ключа и синхронизируется при каждом LDAP-входе и фоновом ресинке (`resyncAllLdapUsers`)
в `users.given_name` (миграция `20261002T1100_users_given_name.sql`). Если атрибут отсутствует,
приветствие использует полное имя. Для локальных учёток приветствие остаётся прежним.
Экспорт установки включает именованное JSON-поле `givenName`; список SQL-колонок
не является позиционным форматом импорта. Резервное восстановление использует PostgreSQL dump.

Трек J: фильтр задач `dueEmpty=1` выбирает `due_date IS NULL` и сочетается с обычными фильтрами.
Вместе с `dueFrom`, `dueTo` или `overdue=1/true` даёт `400 VALIDATION` для списка и счётчиков;
в сохранённые представления параметр не входит. Видимость, архив и право `edit` на изменение срока прежние.

Каталог дашбордов дополнен `projects` (таблица, `limit` 5–50), `projectHealth` (кольцо состояний)
и `milestones` (прошедшие и ближайшие вехи, `periodDays` 7–180). Все ограничены видимыми проектами,
а на Обзоре — одним проектом. Состояние считает `services/projectHealth.ts` по всем задачам, включая архив,
на `CURRENT_DATE`; правила и отличие от локальной даты календаря описаны в ADR-0025.

Внутренний корпоративный task-tracker. Клиент — React SPA (корень репозитория),
сервер — Node.js + Fastify + TypeScript, база — PostgreSQL.

**Принцип: права проверяются только на сервере.** Клиентский `src/permissions.ts` —
только UX. Без авторизации — 401; при недостатке прав — `403 { error: { code, reason } }`
с причиной на русском.

## API-токены и сервисные записи (INT-06/07)

`Authorization: Bearer tsk_<prefix>_<secret>`: префикс — 8 символов `[a-z0-9]`, секрет — 32 случайных байта
в base64url. В `api_tokens` сохраняется SHA-256 секрета; сравнение постоянного времени. Положительный кеш ограничен
10 000 строками и 30 секундами, абсолютный срок проверяется при каждом использовании. Отзыв сбрасывает кеш;
деактивация сбрасывает также токены пользователя. Logout меняет только версию JWT-сессии и API-токены не отзывает.
Токен не принимается из query, cookie или WebSocket и не вызывает ротацию сессионной cookie.

Токен всегда получает `globalRole: "member"`, даже если владелец — глобальный администратор. `read` допускает только
GET/HEAD (`403 TOKEN_SCOPE` на остальные методы); `write` действует по обычной матрице прав и членству владельца.
`requireGlobalAdmin`, `/api/auth/*` кроме login и `/api/me/*` требуют сессию (`403 TOKEN_NOT_ALLOWED` для токена).
Проверки прав задач, видимости проектов, отчётов и дашбордов используют эту пониженную роль. В аудит добавляются
`details.via="token"` и `tokenId`, автор остаётся пользователем. Scope-отказ пишется не чаще раза в минуту на токен.

Лимитер использует отдельную корзину `token:<prefix>` только после проверки хеша по положительному кешу;
холодный или неверный токен остаётся в `ip:<address>`. Проверенный контекст передаётся обработчику без второго хеша,
но повторно проверяется после чтения тела, если истёк срок/кеш или произошла инвалидация. Использование токена
обновляет `last_used_at`/`last_used_ip` не чаще раза в минуту. Отозванные/истёкшие токены очищаются maintenance
через 90 дней после соответствующей даты, ограниченными пачками.

`users.auth_source="service"` означает пользователя без входа: только `global_role="member"`, без пароля и LDAP DN.
Такие записи не получают уведомления/напоминания, не упоминаются, не предлагаются как исполнители и не учитываются
в лицензии. `/api/users/pickable?includeService=1` доступен только сессии глобального администратора для выбора
участников проекта; возвращаемый `authSource` позволяет отметить сервисную запись.

Интерфейс: `/settings/tokens` — личные токены, `/admin/service-accounts` — сервисные записи и все токены
для глобального администратора. Секрет и пример curl показываются один раз после создания; закрытие требует
подтверждения сохранения. Отзыв требует подтверждения, убирает строку сразу и возвращает её при ошибке сервера.
В карточке сервисной записи есть токены и ссылки на существующий раздел «Доступ» её проектов; поиск участников
добавляет `includeService=1` только для глобального администратора. В карточке пользователя, комментариях и истории
сервисные авторы отмечены меткой; профили авторов комментариев и истории содержат необязательное поле `authSource`,
чтобы метка сохранялась после выхода автора из проекта.

Персональные маршруты требуют сессию пользователя; административные — сессию глобального администратора.
API-токены обоих scope получают `403 TOKEN_NOT_ALLOWED` на любом из этих маршрутов.

| Метод и путь (префикс `/api`) | Назначение |
|---|---|
| `GET /me/tokens` | свои токены, включая отозванные/истёкшие до очистки; без секрета |
| `POST /me/tokens` | `{ name, scope: "read"\|"write", expiresInDays: 1–365 }` → 201 `{ token, secret }` |
| `DELETE /me/tokens/:id` | отзыв своего токена → 204; повторный отзыв → 204; чужой/отсутствующий → 404 |
| `GET /admin/tokens?userId=&active=1` | токены с безопасными сведениями о владельце; оба фильтра необязательны |
| `DELETE /admin/tokens/:id` | отзыв любого токена → 204; отсутствующий → 404 |
| `GET/POST /admin/service-accounts` | список / создание `{ username, name }` → 201 |
| `PATCH /admin/service-accounts/:id` | `{ name?, isActive? }` → запись с членствами и числом активных токенов |
| `GET/POST /admin/service-accounts/:id/tokens` | список / выдача токена сервисной записи |
| `DELETE /admin/service-accounts/:id/tokens/:tokenId` | отзыв токена именно этой сервисной записи |

Название токена — 1–80 символов после нормализации; срок по умолчанию 90 дней. Одновременно допустимы
10 персональных или 5 сервисных токенов, которые не отозваны и не истекли; лимит проверяется внутри транзакции
с блокировкой владельца и даёт `409 TOKEN_LIMIT`. Выдача деактивированной записи — `409 CONFLICT`.
`secret` — полная строка `tsk_…`, доступна только в ответе создания с `Cache-Control: no-store`.
Список и аудит не содержат секрет/хеш. В аудите `token.create`/`token.revoke` — идентификатор токена,
префикс, scope и владелец; повторный отзыв новую запись не добавляет.

Сервисные записи можно создавать и в режиме LDAP. Они получают доступ через обычное членство в проекте;
занятый логин даёт `409 CONFLICT`. Деактивация немедленно сбрасывает кеши доступа. Она блокирует токены через
`is_active`, сохраняя их строки: после повторной активации неотозванные токены снова работают до истечения срока.

Пример с выданным токеном (подставить свою строку и адрес установки):

```bash
curl -H "Authorization: Bearer <ваш-токен>" https://taskira.example/api/projects
```

## Владение API и остановка

Поддерживается один serving API-процесс на БД ([ADR-0024](../docs/adr/0024-single-serving-api.md)).
Обновление выполняется stop-first: сначала остановить прежний API, затем запустить новый.
Первый сбой heartbeat либо error/end соединения запускает штатное завершение
HTTP/WS/пула с ограничением 10 с и ненулевым кодом выхода; повторные запросы не ставятся в очередь.
До миграций и HTTP-start он получает session advisory lock через отдельное подключение PostgreSQL.
Это **ещё одно соединение сверх `PG_POOL_MAX`**. Используйте прямой PostgreSQL; PgBouncer в режиме
transaction pooling несовместим с session lock.

Heartbeat выполняется каждые 10 с с таймаутом запроса 5 с. `idle_session_timeout` и сетевые idle-timeout
для этого соединения должны превышать интервал heartbeat с запасом. Потеря соединения/владения
завершает процесс: повторный захват при продолжающемся обслуживании не гарантирует отзыв WS-сессий.
Supervisor (`restart: unless-stopped` в Compose) может запустить новый процесс, который снова проверит владение.

При SIGTERM/SIGINT HTTP/WS, пул и соединение владения закрываются за срок до 10 с.
Если закрытие зависло, процесс завершается с кодом 1 и ОС освобождает соединение/лок.
Владение удерживается до завершения обслуживания запросов; преждевременное освобождение допускает два API.
При обновлении сначала остановите старый процесс, затем запускайте новый. Это относится и к `tsx watch`.

## Роли и матрица прав

Эффективная роль: `resolveRole(globalRole, projectRole)` — глобальный `admin` → `admin`,
иначе роль участника проекта (`project_members.role`), иначе нет доступа. `MATRIX` —
источник в `src/permissions.ts` (сервер) ↔ `../src/permissions.ts` (клиент, только для UX).

Таблица «разрешение × роль» — [`../docs/PERMISSIONS.md`](../docs/PERMISSIONS.md): генерируется из единственного
источника `../shared/permissions.matrix.json` (`npm run permissions:generate` в корне), руками не правится. Матрица
попадает в `src/permissions.matrix.ts` (сервер) и `../src/permissions.matrix.ts` (клиент, только для UX) генератором.

**employee — только свои задачи** (исполнитель или автор). Правило — `isOwnIssue()` в
`roleCan()` (сервер) / `canEditIssue()` (клиент).

`manageSprints` удалялось вместе со спринтами миграцией 012 и восстановлено миграцией 023
как право опционального модуля (см. [`../SPRINTS_MIGRATION.md`](../SPRINTS_MIGRATION.md)) —
действует только в проектах с `sprints_enabled=true`, вне их все роуты `/sprints*` и
`PATCH …/issues/:id/sprint` отвечают 404 независимо от роли. Отдельного права на
вложения и на связи задач нет: вложение своё = `comment`, чужое = `delete`; связать
задачи может тот, у кого `edit` на исходную.

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
| attachments | Вложения к задачам — [`../FILES_MIGRATION.md`](../FILES_MIGRATION.md) + [`../STORAGE_SETUP.md`](../STORAGE_SETUP.md). Ф1: `010_attachments.sql`, `config.storage` (`STORAGE_DRIVER` local\|s3, `ATTACH_*`), `services/storage.ts` (`Storage` + `LocalDiskStorage`), `docker-compose.storage.yml` ✅. Ф2: `@fastify/multipart`, `services/fileGuard.ts` (magic-байты), `services/attachments.ts` (стрим + `sha256` + guard до записи), `routes/attachments.ts` (4 эндпоинта, всё через `requireIssuePerm`), `getIssueDto.attachments` ✅. Ф3: клиент — `attachmentsApi`/`apiUpload`/`downloadBlob`, экшены store, `<AttachmentField>` в `IssueModal` + `SoloIssueCard` ✅. Ф4: `S3Storage` (`@aws-sdk`), `storage.s3.test.ts` (специфика S3: multipart-ETag, `NoSuchKey`) + CI job `storage-s3` vs MinIO, `STORAGE_SETUP.md` ✅. Ф5: `access.attachments.test.ts` (17) + чек-лист ниже + живой прогон ✅ | ✅ |
| notifications | Уведомления (in-app + email) + фоновый воркер — [`../NOTIFICATIONS_MIGRATION.md`](../NOTIFICATIONS_MIGRATION.md) + [`../NOTIFICATIONS_SETUP.md`](../NOTIFICATIONS_SETUP.md). Ф1: `011_notifications.sql` (`notifications` + `users.notify_prefs`), `config.notify` (`NOTIFY_*`/`SMTP_*`), Mailpit compose ✅. Ф2: `services/notify.ts` `emit()` в 5 роутах, `services/mentions.ts`, `routes/notifications.ts` (лента/счётчик/read/prefs) ✅. Ф3: `services/notifier.ts` (воркер, дайджест, ретрай) + `emailTemplates.ts` (D9 — письмо только со ссылкой), `nodemailer`, CI job `mail` vs Mailpit ✅. Ф4: клиент — `notificationsApi`, `Bell()` переписан, polling, `<NotifySettings>`, `<MentionText>` ✅. Ф5: `notifications.test.ts` (12) + `notifier.test.ts` (6) + чек-лист ниже + живые прогоны ✅ | ✅ |
| ui-restructure | Функциональная реструктуризация UI — [`../UI_RESTRUCTURE.md`](../UI_RESTRUCTURE.md). Ф0: клиентский CI-job + `label().min(1)` + чистка корневых зависимостей (PR #20) ✅. Ф1: миграция `012_drop_sprints.sql` (`DROP TABLE sprints`, `issues.sprint_id`), удалены `routes/sprints.ts`/`services/sprints.ts`, право `manageSprints` из `MATRIX` ×2, `SPRINT_STATUSES`/`MoveToSprintBody`/`IssueQuery.sprint`/`WsMessage.sprint:changed` из контракта; клиент — `Sprint`/`sprintsApi`/`setSprint`, поле «Спринт», фильтр доски по спринту ✅. Ф5: `Backlog.tsx` → «Список задач» (плоский список + фильтры + сортировка) ✅. Ф2: «Эпик» → «Направление» (только UI-термин, `epicId` в API не тронут) ✅. Ф3: «+» на доске только у первого `todo`-столбца ✅. Ф4: `GET /api/issues/assigned-to-me` + `test/home.test.ts` (6); `<HomeView>` («Мои задачи» + «Недавние проекты») при ≥ 2 проектах, `bootStatus="home"` ✅. Ф6: чек-лист ниже + `ARCHITECTURE`/`SCOPE` ✅ | ✅ |
| priorities-4 | `013_priority_four_levels.sql`: 5 уровней приоритета → 4 (`low`/`medium`/`high`/`critical`), `highest`→`critical`, `lowest`→`low`, обновлён CHECK; контракт `PRIORITIES` ×2, `PriorityIcon`, `PRIORITY_ORDER` | ✅ |
| issue-links | Связи между задачами. `014_issue_links.sql` (`issue_links`: `issue_id`/`linked_issue_id`/`link_type` `relates`\|`blocks`, CASCADE, UNIQUE); `services/issueLinks.ts`, `POST`/`DELETE /api/projects/:id/issues/:id/links` (`requireIssuePerm("edit")` на исходной, обе задачи в проекте иначе 404, `blocked_by` разворачивается в `blocks` сервером), `getIssueDto.links`; клиент — `issuesApi.addLink`/`removeLink`, секция «Связи» в `IssueModal`; `test/issue-links.test.ts` (9) | ✅ |
| 3c | WebSocket-пуш уведомлений (не полная real-time доска — `issue:upsert`/`presence` из `WsMessage` остаются объявленными, но нереализованными). `GET /api/ws` (`@fastify/websocket`, уже был зарегистрирован плагином); аутентификация первым сообщением `{type:"auth",token}` после открытия (браузерный `WebSocket` не шлёт свои заголовки на хендшейке, а токен в query-строке утёк бы в access-логи) — переиспользует `assertFreshUser()`, вынесенную из `requireAuth`. `services/wsHub.ts` — реестр сокетов по пользователю, `pushToUser()` вызывается из единой точки создания уведомлений (`services/notify.ts` `emit()`). Клиент — доп. эффект в `store.tsx` рядом с 30-секундным polling (не замена: polling остаётся страховкой при недоступном сокете), реконнект с экспоненциальным бэкоффом. `test/ws.test.ts` (5, `app.injectWS()`) + живой прогон в браузере (реальный `WebSocket` из React-эффекта, подтверждён хендшейк) | ✅ |
| 5 | docker-compose (полный стек) + runbook — [`../DOCKER_SETUP.md`](../DOCKER_SETUP.md), бэкап отдельно ([`BACKUP.md`](BACKUP.md)) | ✅ |
| checklist | Чек-лист задачи — по образцу issue-links (014). `019_checklist_items.sql` (`checklist_items`: `issue_id`/`text`/`done`/`position`, CASCADE; `position` — `COALESCE(MAX+1, 0)` при вставке, без reorder в v1); `services/checklist.ts`, `POST`/`PATCH`/`DELETE /api/projects/:id/issues/:id/checklist[/:itemId]` (`requireIssuePerm("edit")`, тот же, что у полей задачи), `getIssueDto.checklist`; клиент — `issuesApi.addChecklistItem`/`patchChecklistItem`/`removeChecklistItem`, `<ChecklistField>` в `IssueModal`; `test/checklist.test.ts` (12) | ✅ |
| subtasks | Подзадачи — `issues.parent_id`, независимо от `epicId`. `021_subtasks.sql` (`ALTER TABLE issues ADD COLUMN parent_id`, `ON DELETE SET NULL`, `CHECK parent_id <> id`, частичный индекс `idx_issues_parent`); строго два уровня — `assignParentLocked()`/`validateParentAssignmentTx()` в `services/issues.ts` (транзакция + `pg_advisory_xact_lock`, по образцу `rank.ts` — закрывает гонку из двух конкурентных `PATCH`, найденную в ревью) на назначение нового родителя, `withIssueParentLock()` на снятие (свой лок на тот же issueId, чтобы не разъезжаться с конкурентным назначением); `precheckParentAssignment()` — быстрый незалоченный пречек до `nextIssueNum()` в `POST /issues`, чтобы неверный `parentId` не сжигал номер `CORP-N`. Нет отдельного list-эндпоинта — клиент фильтрует уже загруженный `data.issues` по `parentId` локально (как `TimelineView` для `epicId`); но `getIssueDto.subtasksSummary` (`{total, done}`, отдельный агрегатный запрос по ВСЕМ детям, включая заархивированных) едет вместе с детальным `GET /issues/:id` — без него бейдж «Подзадачи · N/M» в `IssueModal` регрессировал бы сам собой, когда закрытая подзадача уходит в архив по возрасту (ревью PR #46). Клиент — `<SubtasksField>` в `IssueModal`, `openCreateSubtask()`/`ui.createParentId` в `store.tsx`; `test/subtasks.test.ts` (11, включая гонку из двух конкурентных `PATCH` и тест на `nextIssueNum()`) | ✅ |
| sprints | Спринты — **опциональный, выключенный по умолчанию модуль** (не базовый workflow), см. [`../SPRINTS_MIGRATION.md`](../SPRINTS_MIGRATION.md) — точечное, осознанное исключение из миграции 012 (которая удалила спринты целиком; то решение остаётся в силе для проектов без флага). `023_sprints.sql` (`projects.sprints_enabled boolean DEFAULT false`; таблица `sprints`: `name`/`goal`/`status future\|active\|completed`/`start_date`/`end_date`; `issues.sprint_id uuid ON DELETE SET NULL`; частичный уникальный индекс `uq_sprints_one_active_per_project` — не более одного активного спринта на проект гарантирует БД, не только роут). `services/sprints.ts` (`activateSprint()` future→active; `completeSprint()` active→completed + перенос незакрытых задач спринта в бэклог, `sprint_id=NULL`, одной транзакцией). `routes/sprints.ts` (`GET`/`POST /sprints`, `POST /:id/start`, `POST /:id/complete`) и `routes/issues.ts` `PATCH /:id/sprint` (отдельный под-роут, не ветка общего `PATCH /:id`, как было до миграции 012) — все под `manageSprints`, кроме `GET` (`browse`); **все отвечают 404, если `sprints_enabled=false`**, независимо от роли. Клиент — `<SprintsView>` (бэклог + список спринтов, drag&drop той же техникой, что `Board.tsx`), вкладка в `Sidebar.tsx` видна только при `project.sprintsEnabled`, чекбокс «спринты» в `AdminView.tsx`; `test/sprints.test.ts` (15) | ✅ |

**roles-1…7** — ролевая миграция (project-scoped) влита в `main` одним PR (#10);
детальный план и порядок фаз — [`../ROLE_MIGRATION.md`](../ROLE_MIGRATION.md).

Дорожная карта (`../ARCHITECTURE.md`, «Порядок разработки») пройдена: backend + БД,
project-scoped роли, департаменты, LDAP/AD, вложения, уведомления + email-воркер,
UI-реструктуризация (спринты убраны, «Список задач», «Направление», главный экран).
`story points` → «сложность» (миграция 018, поле `complexity`), сборщик
осиротевших объектов хранилища (`services/storageSweeper.ts`), фоновый ресинк
LDAP-членства по расписанию (`services/departmentSync.ts` `resyncAllLdapUsers`),
WebSocket-пуш уведомлений (`services/wsHub.ts`, §3c ниже) и деплой через
`docker-compose.yml` ([`../DOCKER_SETUP.md`](../DOCKER_SETUP.md)) — сделаны.
Полная real-time доска (`issue:upsert`/`presence` из `WsMessage`) остаётся
нереализованной — отдельный, значительно больший объём работы.

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

Все мутации проверяют авторизацию и право **на сервере**; недостаток права — `403 {error:{code:"FORBIDDEN",reason}}` на русском.

> Спринты были удалены целиком миграцией 012 и с тех пор вернулись как
> **опциональный, выключенный по умолчанию модуль** (миграция 023, право
> `manageSprints` восстановлено) — см. [`../SPRINTS_MIGRATION.md`](../SPRINTS_MIGRATION.md)
> и строку `sprints` в таблице фич ниже. `IssueQuery.sprint` (фильтр списка
> задач по спринту) по-прежнему не существует — клиент фильтрует уже
> загруженный список локально по `sprintId`, тем же способом, что `parentId`/`epicId`.
> Актуальные роуты вложений / приглашённых к задаче / уведомлений / связей задач —
> в соответствующих `../*_MIGRATION.md` и разделах ниже.

| Метод и путь | Тело / query | Права | Назначение |
| --- | --- | --- | --- |
| `GET /api/projects/:projectId` | — | browse | bootstrap: проект, **активные** пользователи (с `globalRole`, без `password_hash`), `members: [{userId, role}]`, workflow |
| `GET …/issues` | `IssueQuery`: status, parentId, epicId (дети одной задачи), assignee (uuid или `none`; `none` — по `issues.has_assignee`, ведёт триггер), type, q, dueFrom, dueTo, cf + cfValue/cfFrom/cfTo/cfEmpty (своё поле проекта, смысл по типу поля — `CUSTOM_FIELD_FILTER` в contract.ts; поле не из проекта или условие не по типу поля — пустой набор, не 400), overdue, closed (`hide`/`recent`/`older`) + closedDays (14), archived, sort (`rank`/`priority`/`due`/`updated`/`key`) + dir, limit(≤200), cursor, includeTotal | browse | `{items, hasMore, nextCursor, total?}`. Фильтры, сортировка и поиск — серверные; курсор привязан к sort/dir (иначе 400). Тай-брейк везде — номер задачи |
| `GET …/issues/counts` | те же фильтры (`IssueCountsQuery`), без sort/limit/cursor | browse | `{total, byStatus:{statusId:n}}` — считает тот же набор, что и список; архивные не учитываются |
| `GET …/issues/assignees` | `limit` (1–50, по умолчанию 24) | browse | `{items:[{userId,count}]}` — исполнители активных задач проекта по убыванию нагрузки (полоска фильтров доски) |
| `GET …/issues/epics` | `limit` (1–500, по умолчанию 200) | browse | `{items:[{id,key,title,color,tStart,tSpan,childTotal,childDone}], truncated}` — активные «направления» (на них ссылается чей-то `epic_id`) с агрегатом по активным детям; `childDone` — по категории статуса `done` |
| `POST …/issues` | `IssueCreateBody` | create | num — атомарный счётчик (миграция 003); статус по умолчанию — первый `todo`; rank — в конец колонки |
| `GET …/issues/:id` | — | browse | задача + `comments`/`participants`/`collaborators`/`attachments`/`links`/`checklist`/`customFieldValues`/`subtasksSummary` (`{total, done}` по всем детям, включая архив) |
| `PATCH …/issues/:id` | `IssuePatchBody` | edit (employee — **только свои**) | правка полей + activity |
| `DELETE …/issues/:id` | — | delete | каскады: комментарии/activity/watchers/attachments/links; `epic_id`/`parent_id` дочерних обнуляется FK (`ON DELETE SET NULL`) |
| `POST …/issues/:id/transition` | `{to, beforeId?}` | transition + **схема workflow** (нарушение — `409 CONFLICT`) | смена статуса + rank |
| `POST`/`DELETE …/issues/:id/links[/:linkId]` | `{linkedIssueId, type}` (`relates`\|`blocks`\|`blocked_by`) | edit (на исходной) | связать/разорвать связь; обе задачи в проекте иначе `404`; ответ — обновлённый список связей |
| `POST`/`PATCH`/`DELETE …/issues/:id/checklist[/:itemId]` | `{text}` · `{text?, done?}` | edit | добавить/обновить/удалить пункт чек-листа; ответ — `{item?, checklist}` (обновлённый список) |
| `POST/DELETE …/issues/:id/watchers/me` | — | browse | подписка/отписка; ответ `{watching, watchers}` |
| `GET …/issues/:id/comments` · `POST …/comments` | `{body ≤2000}` | browse · comment | комментарии с профилем автора; выдача — последние 200 |
| `GET …/issues/:id/activity` | — | browse | история задачи («кто, что, когда»), последние 100, с профилем автора |
| `GET /api/issues/assigned-to-me` | — | requireAuth | открытые задачи на мне по всем видимым проектам; ответ `{items, truncated, limit}` — выдача ограничена 100 |
| `GET /api/reports/summary` | query `ReportQuery` | requireAuth; scope = **видимые проекты** | закрыто/создано за период, открыто/просрочено сейчас, ср. и медианное время в работе, разбивка (`groupBy`), недельный тренд |
| `GET /api/reports/issues.csv` | query `ReportExportQuery` | requireAuth; scope = **видимые проекты** | построчная выгрузка (`scope`: `closed`\|`created`\|`open`); CSV с `;` и BOM для русского Excel; пишется в `audit_log` |
| `GET /api/admin/audit-log/export` | `format=jsonl\|csv`, `from?`, `to?`, `limit<=100000` | global admin | SIEM-выгрузка: одна запись на строку, стабильные `timestamp/actor/action/object/result/details` |
| `GET /api/admin/license` | — | global admin | статус офлайн-лицензии (`getLicenseStatus`): `unset` / `invalid` (причина) / `active` / `expired` с `claims` и занятыми местами; сам токен не отдаётся. Только чтение — установка по-прежнему CLI |
| `GET /api/admin/status` | — | global admin, сессия | `SystemStatusDto`: 11 независимых проверок инсталляции; кэш 15 с, общий дедлайн 5 с |
| `GET /api/admin/ops-runs` | `kind=backup\|restore_drill`, `limit=1…50` (по умолчанию 5) | global admin, сессия | `OpsRunDto[]`: новейшие отчёты хоста; имена архивов без пути; `running` старше 6 ч представлен как `interrupted` |
| `GET /api/project-templates` | — | global admin | шаблоны проектов (ТЗ 5.10): 5 встроенных (`id = builtin:<id>`, `server/src/templates/builtin.json`) + шаблоны организации (`project_templates`) |
| `POST /api/projects/:projectId/save-as-template` | `{name ≤80, description ≤300}` | `saveProjectTemplate` (роль admin в проекте = глобальный admin); занятое имя — `409`; конфигурация не проходит `ProjectTemplateSpec` — `400` | снимок статусов, переходов, полей, шаблонов задач, меток и представления по умолчанию |
| `DELETE /api/project-templates/:templateId` | — | global admin | удалить шаблон организации; встроенные не удаляются |
| `PUT /api/me/lang` | `MeLangBody` `{lang: "ru" \| "en"}` | requireAuth | `204`; язык писем и сводок (трек E, `users.lang`); клиент сообщает его при каждом входе и при переключении — побеждает последний вход: при телефоне на EN и компьютере на RU письма идут на языке того устройства, где человек входил последним; `GET /api/auth/me` отдаёт `lang` |
| `GET /api/me/onboarding` | — | requireAuth | прогресс «Начала работы» `{done, hidden, hints}` (ТЗ 5.11, ADR-0019); шаги отмечает сервер от действий |
| `POST /api/me/onboarding/steps` | `{step: "theme"}` | requireAuth | единственный шаг, о котором сообщает клиент; остальные — `400` |
| `POST /api/me/onboarding/hide` | — | requireAuth | скрыть карточку навсегда |
| `POST /api/me/hints/:hintId/dismiss` | — | requireAuth | закрыть подсказку навсегда (id `^[a-z][a-z0-9.-]{0,39}$`, хранится не больше 100) |
| `GET/PATCH /api/admin/setup`, `POST /api/admin/setup/complete` | `{instanceName}` | global admin | первичная настройка: статус, название инсталляции, «завершить» |
| `GET /api/maintenance` | — | global admin (сессия) | состояние фоновых заданий этого процесса и действующие настройки обслуживания |
| `POST /api/maintenance/run?dryRun=true\|false` | обязательный query `dryRun` | global admin (сессия) | `{archived, auditPurged, opsRunsPurged, capped, dryRun}`: задачи в архив, удалённые записи аудита и отчёты операций; `true` считает без изменений, `false` выполняет проход; `409 maintenance_busy`, если проход уже идёт |
| `POST/DELETE /api/admin/demo-project` | — | global admin | демо-проект (один; `409`, если уже есть); удаление не оставляет строк в БД, в т.ч. в `audit_log` |
| `PATCH /api/projects/:projectId/appearance` | `ProjectAppearanceBody` `{icon?, color?, background?}` | `editAppearance` (admin, manager) | внешний вид проекта (ТЗ 5.14 п.7); `audit_log: project.appearance` |
| `POST/DELETE /api/projects/:projectId/background-photo`, `GET …/background-photo/:size` | multipart `full`, `small` (WebP) + `luma` | `editAppearance` · `browse` | своё фото фона проекта (ТЗ 5.14 п.2): сервер проверяет WebP и габариты, `size = full\|small` |
| `GET /api/instance/brand`, `GET /api/instance/brand/logo` | — | **публично** (нужно экрану входа) | брендирование (ТЗ 5.14 п.5): `{name, hue, logoUpdatedAt}`; `null` — по умолчанию |
| `PATCH /api/admin/brand`, `POST/DELETE /api/admin/brand/logo` | `{name?, hue? 255–320}` · multipart PNG/WebP ≤ 200 КБ, 32–1024 px | global admin | диапазон оттенка целиком проверяет `npm run contrast:check`; `audit_log: instance.brand` |
| `GET /api/roadmap` | — | requireAuth; scope = **видимые проекты** | роадмап (ТЗ 5.15): проекты с датами, прогрессом (`done/total` по всем задачам, включая архив), вехами и `canEdit`; зависимости — только между видимыми |
| `PATCH /api/projects/:projectId/roadmap` | `{startDate?, targetDate?}` (ГГГГ-ММ-ДД или `null`) | `editRoadmap` (admin, manager); цель раньше начала — `400` | даты проекта; `audit_log: project.roadmap` |
| `POST …/milestones`, `PATCH/DELETE …/milestones/:milestoneId` | `{name ≤80, date}` | `editRoadmap`; не больше 30 у проекта — `409` | вехи; `audit_log: project.milestone.*` |
| `POST …/dependencies`, `DELETE …/dependencies/:sourceProjectId` | `{sourceProjectId}` | `editRoadmap` в **зависимом** проекте; источник должен быть виден (иначе `404`); цикл — `409 DEPENDENCY_CYCLE` | «проект ждёт другой»; проверка цикла и вставка — в одной транзакции под advisory-блокировкой; `audit_log: project.dependency.*` |
| `GET /api/dashboards` | — | requireAuth | дашборды организации (ADR-0022): общие (`kind: org`) и свои личные (`personal`), с `canEdit` |
| `POST /api/dashboards` | `DashboardCreateBody` `{name ≤80, shared?, widgets?}` | requireAuth; `shared: true` — только global admin (`403`); больше 20 личных — `409 LIMIT` | новый дашборд; `audit_log: dashboard.create` |
| `GET/PATCH/DELETE /api/dashboards/:dashboardId` | `DashboardPatchBody` `{name?, shared?, widgets?}` | личный — только владелец (для остальных `404`); общий — правит и удаляет global admin, остальным `403`; `shared` меняет только автор-администратор | `audit_log: dashboard.update/delete` |
| `POST /api/dashboards/data` | `DashboardDataBody` `{widgets ≤24, projectId?}` | requireAuth; scope = **видимые проекты** смотрящего; `projectId` невидим — `404` | данные набора виджетов (сохранённых или нет) одним запросом: `{results: {widgetId: WidgetDataDto}}`. С `projectId` (обзор) область всех виджетов — этот проект; виджет с невидимым проектом — пустые данные; сбой одного виджета — `{type: "error"}` только у него |
| `GET /api/projects/:projectId/overview` | — | browse | «Обзор» проекта: `{dashboard \| null, canEdit}`; `null` — клиент показывает встроенный набор |
| `PUT/DELETE /api/projects/:projectId/overview` | `ProjectOverviewBody` `{widgets}` | `manageDashboards` (admin, manager) | сохранить обзор (одна строка на проект) / вернуть встроенный; `audit_log: project.overview.update/reset` |
| `GET …/workflow` | — | browse | статусы, переходы, `issueCounts` по статусам |
| `POST …/workflow/transitions` | `{from,to}` | **admin**; дубликат — `409`, петля — `400` | добавить переход |
| `DELETE …/workflow/transitions/:id` | — | **admin** | удалить переход |
| `POST …/workflow/reset` | — | **admin** | дефолтные 8 переходов; статусы не удаляются никогда |
| `POST /api/auth/logout` | — | requireAuth | завершает сессию: `users.tokens_valid_from = now()`, все ранее выданные токены становятся недействительными (миграция 017) |
| `GET /api/users` | — | **admin** | все, включая деактивированных; DTO с `globalRole` |
| `GET /api/users/pickable?q=` | — | requireAuth | **поиск** по имени/должности: минимум 2 символа, до 20 совпадений. Справочник целиком не отдаётся |
| `POST /api/projects` | `ProjectCreateBody` (+ `templateId?`, `members?[{userId, role}]`, `icon?`, `color?`, `background?` — ADR-0018) | global admin | создать проект; шаблон и участники применяются в той же транзакции — при сбое проекта нет |
| `POST /api/admin/users` | `CreateUserBody` (bcrypt, `globalRole`) | **admin**; занятый username — `409` | создать пользователя; членство в проекте — отдельно |
| `PATCH /api/users/:id` | `{globalRole, isActive?}` | **admin**; защита последнего активного админа — `409` | смена **глобальной** роли; `invalidateUserCache` — действует сразу |
| `PUT /api/project/members/:userId` | `SetMemberBody` `{role}` | **admin** (`manageAccess`) | добавить участника / сменить проектную роль; upsert; `invalidateMembership` |
| `DELETE /api/project/members/:userId` | — | **admin** (`manageAccess`) | убрать из проекта; `404` если не участник; `409` — последний активный менеджер |

В ответе ручного обслуживания три счётчика — целые числа: при `dryRun=true` это количество подходящих строк,
при `false` — обработанных за проход. `opsRunsPurged` относится к истории операций хоста: сохраняются последние
200 отчётов каждого вида. `capped=true` означает, что достигнут лимит прохода (в предварительном подсчёте —
что подходящих строк больше лимита); последующие проходы продолжат обработку.

**Seed проекта** (`seedProject`, идемпотентно): при пустой `projects` создаёт `CORP «Корпоративные задачи»`
(или `PROJECT_KEY/PROJECT_NAME` из env) в отделе `DEFAULT_DEPARTMENT`, статусы `todo / inprogress / review / done`
(категории `todo | inprogress | inprogress | done`) и 8 переходов дефолтного графа
(`todo→inprogress, todo→done, inprogress→{todo,review,done}, review→{inprogress,done}, done→inprogress`).
Повторный запуск ничего не дублирует.

### Жизненный цикл задачи (миграция 016)

У задачи две даты сверх `created_at`/`updated_at`:

- **`done_at`** — момент перехода в статус категории `done`. Ставится в
  `POST …/issues/:id/transition`, **снимается** при возврате в работу (переоткрытая
  и снова закрытая задача получает новую дату). Перенос между двумя закрывающими
  статусами дату не трогает — задача не «перезакрылась».
- **`archived_at`** — момент ухода из активного набора проекта. Ставит фоновый
  воркер (`services/maintenance.ts`) задачам с `done_at` старше `ARCHIVE_AFTER_DAYS`
  (по умолчанию 30).

**Архив — не удаление.** Строка остаётся в БД, задача открывается по прямой ссылке,
входит в отчёты и находится через `?archived=`. Она лишь перестаёт грузиться вместе
с активным набором, чтобы доска и «Список задач» не росли бесконечно. Возврат
задачи в работу выводит её из архива автоматически.

`GET …/issues` по умолчанию отдаёт **только активные**; `?archived=1` — только
архивные, `?archived=all` — вместе.

Воркер обслуживания живёт отдельно от email-воркера (тот стартует только при
`NOTIFY_EMAIL_ENABLED`, а архив нужен всегда) и вторым проходом чистит `audit_log`
старше `AUDIT_RETENTION_DAYS`. Первый проход — через `MAINTENANCE_START_DELAY_MS` (по умолчанию 5 минут)
после старта, а не сразу: рестарт в час пик ничего не запускает. Работа идёт пачками
(`MAINTENANCE_BATCH_SIZE`, пауза `MAINTENANCE_BATCH_PAUSE_MS`, потолок `MAINTENANCE_MAX_PER_RUN` за проход), так что
блокировка строк держится на время пачки; строка, которую в этот момент правит пользователь, пропускается и
забирается следующим проходом. Advisory-лок `pg_try_advisory_lock` предотвращает пересечение тика с ручным
запуском. Serving API остаётся единственным процессом на БД (ADR-0024); несколько реплик не поддерживаются.

### Сборщик осиротевших объектов хранилища

Удаление задачи (или проекта → issues) каскадом снимает строки `attachments`
(миграция 010), но не сами файлы в `Storage` — синхронная чистка тысяч объектов
заблокировала бы запрос. `services/storageSweeper.ts` — отдельный (более редкий,
`STORAGE_SWEEP_INTERVAL_MS`, по умолчанию раз в сутки) луп фонового воркера:
листит всё хранилище (`Storage.list()`), сравнивает со `storage_key` в `attachments`
для текущего `storage_driver` и удаляет объекты без строки — БД остаётся
источником истины.

Гонка с загрузкой: `routes/attachments.ts` пишет объект в `Storage` (`put()`)
**до** `INSERT INTO attachments`, поэтому объект младше `STORAGE_SWEEP_GRACE_MS`
(по умолчанию 24 часа) сборщик не трогает — он мог просто ещё не долиться до
строки в БД. Каждое удаление пишется в лог и в `audit_log` (`storage.sweep`).
Тот же принцип «включать на одном инстансе», что и у остального воркера
(`STORAGE_SWEEP_ENABLED=false` на остальных).

### Признак возврата из review на Главной

`GET /api/issues/assigned-to-me` возвращает `returnedForRework` как признак
последнего перехода статуса: `fromSid = review`, `toSid` совпадает с текущим
sid и отличается от `review`. Это эвристика перехода, а не подтверждение причины
или намерения автора: административный перенос из review также даёт true.
Последующие комментарии и другие события, не меняющие статус, его не сбрасывают.
История без `fromSid`/`toSid` даёт false. Группа UI «Вернули на доработку» использует
этот признак либо пользовательский sid `rework`; разрешения от него не зависят.

### Отчёты

`GET /api/reports/summary` и `GET /api/reports/issues.csv` — сводка и выгрузка
за период. Видимость: ручки **не** используют `requirePerm`, вместо этого
`resolveReportScope()` резолвит список видимых проектов тем же
`listVisibleProjects()`, что и остальной интерфейс, и все запросы ограничены
`project_id = ANY($ids)`. Расхождение предикатов невозможно by design; запрос
чужого `projectId` даёт пустой отчёт, а не `403` (существование проекта
не подтверждаем).

Фильтры `departmentId`, `projectId` и `projectIds` (до 150 UUID через запятую)
пересекаются между собой и с видимостью пользователя, одинаково для JSON и CSV.
`projectIds` передаётся в query строкой до 5550 символов; `ReportFilter` и
`z.input<typeof ReportQuery>` используют эту форму. После zod transform
`z.infer<typeof ReportQuery>` содержит массив UUID.
Отсутствие `projectIds` означает все видимые проекты без ограничения их числа.
Лимит выборки оставляет URL с percent-encoded запятыми и остальными фильтрами
короче стандартной строки запроса nginx 8 КиБ и заголовков Node 16 КиБ.
Обе ручки до запросов БД проверяют `from <= to` и разницу границ не более
732 дней; недельная серия содержит не более 106 точек.
Границы периода включительны. `trend` содержит `created` и `closed` для каждой
недели, включая нулевые; `rows` дополняется текущим `overdue`. Открытые и
просроченные задачи — снимок **на текущую дату**, а не на конец выбранного периода.
В UI карточка просрочки подписана «На текущую дату» / «As of today»; это значение
не сравнивается с предыдущим периодом. `rows` включает группу, если в ней есть
закрытые или созданные за период задачи либо открытые сейчас. По сравнению с
прежним условием включения закрытые группы с созданием в периоде теперь тоже
возвращаются; потребители таблицы и дашбордов должны учитывать такие строки.
Построчный CSV не использует `rows`: его набор определяется отдельным `scope`.
Сравнение на клиенте запрашивает непосредственно предшествующий период той же длины.
Календарный день и начало недели (понедельник) определяются часовым поясом
сессии PostgreSQL, одинаково для границ, событий и подписей серии. Это пояс БД,
а не браузера или Node; изменение `TimeZone` меняет календарные границы отчётов.

CSV — разделитель `;` и UTF-8 BOM: с запятой русский Excel складывает строку
в одну ячейку, без BOM читает файл как cp1251. Значения, начинающиеся с
`= + - @`, префиксуются апострофом (защита от инъекции формул).

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
  "assigneeId":null,"epicId":null,"labels":["инфра"],"complexity":null,
  "dueDate":"2026-03-01"
}' | jq -r .id)

# переход по схеме (todo→inprogress); вне схемы (todo→review) вернёт 409
curl -s -X POST $BASE/issues/$ID/transition -H "$AUTH" -H 'content-type: application/json' \
  -d "{\"to\":\"$INPROG_ID\"}"

# комментарий
curl -s -X POST $BASE/issues/$ID/comments -H "$AUTH" -H 'content-type: application/json' \
  -d '{"body":"Взял в работу"}'

# подписаться на задачу
curl -s -X POST $BASE/issues/$ID/watchers/me -H "$AUTH"

# смена ГЛОБАЛЬНОЙ роли пользователя (admin); действует ≤30 с без перевыпуска токена.
# Тело — {globalRole: admin|member, isActive?}; проектная роль правится через
# PUT /api/projects/:projectId/members/:userId. Старое поле accessRole → 400.
curl -s -X PATCH $BASE/users/$USER_ID -H "$AUTH" -H 'content-type: application/json' \
  -d '{"globalRole":"member"}'
```

## Как прогнать локально

```bash
cd server
npm i
cp .env.example .env
# Заполните: DATABASE_URL, JWT_SECRET (>=32 симв.), ADMIN_USERNAME/ADMIN_PASSWORD
# (пароль: >=14 символов, минимум 3 из 4 групп, без имени пользователя)
# JWT_SECRET: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

npm run dev        # tsx watch (chokidar polling): миграции → seed админа → listen :8080
```

**За reverse-proxy (nginx/LB)** обязательно задайте `TRUST_PROXY` (`true` — если до
приложения дотягивается только прокси; либо список IP/CIDR). Иначе `req.ip` = адрес
прокси: rate-limit логина (`routes/auth.ts` + `services/loginRateLimit.ts`, 10 попыток/IP/5 мин) считает всех
пользователей как один IP, и в `audit_log` пишется адрес прокси, а не клиента.
Значение прокидывается в опцию Fastify `trustProxy` (`app.ts`).

`npm run dev` форсит поллинг chokidar (`CHOKIDAR_USEPOLLING=1`, интервал 250 мс) —
на Windows рекурсивный `fs.watch` пропускает правки от атомарного сохранения
редактора и от инструментов, и сервер не перезапускается. Поллинг это чинит ценой
небольшого CPU. Нативные события: `npm run dev:native`. Если после крупной
многофайловой правки перезапуск всё же выглядит подвисшим — перезапустите dev.

Миграции и seed по отдельности:

```bash
npm run seed                     # прогоняет migrate() + создание первого админа
psql "$DATABASE_URL" -c "select name from schema_migrations"   # 001..004, 006..014
```

Health, логин, me:

```bash
curl -s localhost:8080/api/health
# {"ok":true,"db":true,…}          (503 + ok:false, если БД легла)

curl -s -X POST localhost:8080/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"username":"admin","password":"…из .env…"}'
# {"token":"…","user":{"username":"admin","globalRole":"admin","isActive":true,"authSource":"local",…}}

TOKEN=…; curl -s localhost:8080/api/auth/me -H "authorization: Bearer $TOKEN"
```

Rate-limit логина (состояние в БД, таблица `login_attempts`; 10 попыток / IP / 5 минут; общий для всех процессов):

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

Прогоняются в **отдельной БД `taskira_test`** (TEST-01): расширения (`pg_trgm`) принадлежат базе, и сброс
схемы внутри рабочей БД раньше молча удалял триграммные индексы всех остальных схем. Ролю тестов нужно один
раз наделить правом создавать БД (`ALTER ROLE taskira CREATEDB;` от суперпользователя) либо создать
`taskira_test` вручную; в CI её создаёт docker-сервис. `test/global-setup.ts` создаёт БД при отсутствии,
пересоздаёт в ней схему `public` и гоняет миграции один раз; `test/helpers.ts` — `getApp` / `seedFixture`
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
- [ ] За прокси: с `TRUST_PROXY` (`true`/CIDR) `req.ip` берётся из `X-Forwarded-For` — два разных клиентских IP считаются rate-limit'ом раздельно; без `TRUST_PROXY` заголовок игнорируется
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
- [ ] `member` + `project_members.role='viewer'` → `GET /api/project`, `GET /api/issues` — 200; `POST /api/issues` — 403 «Создание задач»; `GET /api/users` — 403 «Управление доступом»; `POST /api/workflow/transitions` — 403 «Изменение рабочего процесса»
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

### Вложения к задачам (attachments) — [`../FILES_MIGRATION.md`](../FILES_MIGRATION.md) / [`../STORAGE_SETUP.md`](../STORAGE_SETUP.md)

Автотесты: `test/access.attachments.test.ts` (17, `npm test` → **55 зелёных**);
`test/storage.s3.test.ts` (5) — только при `STORAGE_DRIVER=s3` + `STORAGE_S3_*`
(`npm run test:storage`), в CI это job `storage-s3` против настоящего MinIO.

**Схема / конфиг (миграция 010):**

- [ ] `010_attachments.sql` в `schema_migrations`; `\d attachments` — FK `issue_id`
  `ON DELETE CASCADE`, `uploaded_by` `ON DELETE SET NULL`, `CHECK (byte_size > 0)`,
  `UNIQUE (storage_driver, storage_key)`, индекс `idx_attachments_issue`
- [ ] `STORAGE_DRIVER` не задан → `local`, каталог `server/var/attachments` (git-ignored);
  `STORAGE_DRIVER=s3` без `STORAGE_S3_ENDPOINT/BUCKET/ACCESS_KEY/SECRET_KEY` → сервер
  падает на старте (`[config]`); нечисловой `ATTACH_MAX_BYTES` → тоже `fail`

**Загрузка / guard (D3):**

- [ ] `POST …/issues/:id/attachments` (multipart, поле `file`) — `viewer` → `403`;
  `employee`/`manager`/`admin` и приглашённый collaborator → `201` + DTO
  (`filename` санитизирован, `contentType` нормализован, `sha256` заполнен)
- [ ] `.exe` (или другое из `ATTACH_BLOCK_EXT`) → `400` «расширение … нельзя»
- [ ] Файл с байтами `MZ`/`\x7fELF`/`#!` под именем `*.jpg` → `400` «распознан как
  исполняемый» (по сигнатуре, **не** по расширению — настоящий JPEG `*.jpg` проходит)
- [ ] `*.png` с содержимым PDF/ZIP → `400` «не соответствует расширению»
- [ ] Файл > `ATTACH_MAX_BYTES` → `413`; 0 байт → `400 ATTACHMENT_EMPTY`;
  сверх `ATTACH_MAX_PER_ISSUE` → `409`. Во всех трёх объект в хранилище не остаётся
- [ ] `.svg`/`.html` загрузить можно, но при скачивании отдаётся как
  `application/octet-stream` + `Content-Disposition: attachment` + `X-Content-Type-Options: nosniff`

**Видимость / IDOR (D4/D5):**

- [ ] Не-участник не-shared проекта → `403` на списке и загрузке
- [ ] `GET …/attachments/:attId`, где вложение принадлежит другой задаче → `404`;
  `/projects/A/issues/<задача из B>/attachments` → `404`
- [ ] Участник (в т.ч. `viewer`) скачивает → `200`, байты совпадают
- [ ] Удаление вложения: свой файл — автор всегда; чужой — только `manager`/`admin`
  (`employee` → `403`); повтор → `404`
- [ ] Удаление задачи каскадит строки `attachments` и чистит объекты в хранилище
  (`deleteStorageObjects`); удаление **проекта** объекты пока НЕ чистит (сироты —
  Фаза 6, сборщик)
- [ ] `GET /api/departments`-стиль не при чём; `getIssueDto` (детальный `GET
  /issues/:id`) содержит `attachments[]`, список задач — нет
- [ ] `audit_log`: `attachment.add` / `attachment.remove` с `{projectId, attId,
  filename, byteSize, viaCollaborator?}`

**Драйвер S3 (`STORAGE_DRIVER=s3`, job `storage-s3`):**

- [ ] `docker compose -f docker-compose.storage.yml up -d` + `wait createbucket` →
  бакет `taskira-attachments` (приватный)
- [ ] `npm run test:storage` зелёный: `access.attachments.test.ts` против MinIO +
  `storage.s3.test.ts` — ETag однокусочного PUT = hex-MD5 тела; объект > 5 MiB →
  multipart, ETag `<md5>-<N>`; `Content-Type` round-trip; `GET` отсутствующего →
  `NoSuchKey`
- [ ] `mc ls --recursive local/taskira-attachments` — объекты под ключами `<issueId>/<uuid>`

**Клиент:**

- [ ] `IssueModal` → «Вложения»: список со «Скачать», «×» видно если свой файл или
  роль `delete`; при роли `comment` — кнопка «＋ прикрепить файл»; секция скрыта,
  если грузить нельзя и вложений нет
- [ ] `SoloView`/`CollaboratingView` (`SoloIssueCard`) — блок «Вложения» со скачиванием
  и загрузкой (приглашённый имеет `comment`)
- [ ] Загрузка `.exe` / файла больше лимита → тост без раунд-трипа (сервер бы всё
  равно отверг); удачная загрузка → чип/строка появляется сразу

### Уведомления (notifications) — [`../NOTIFICATIONS_MIGRATION.md`](../NOTIFICATIONS_MIGRATION.md) / [`../NOTIFICATIONS_SETUP.md`](../NOTIFICATIONS_SETUP.md)

Автотесты: `test/notifications.test.ts` (13); `npm test` даёт **78 зелёных**
(вместе с `contract.labels.test.ts` и `home.test.ts` из ui-restructure);
`test/notifier.test.ts` (6) — только при `NOTIFY_EMAIL_ENABLED=true` + `SMTP_HOST`
(`npm run test:mail`), в CI это job `mail` против Mailpit.

**Схема / конфиг (миграция 011):**

- [ ] `011_notifications.sql` в `schema_migrations`; `\d notifications` — FK
  `user_id` `ON DELETE CASCADE`, `actor_id` `ON DELETE SET NULL`, `project_id`/
  `issue_id` `ON DELETE CASCADE`, `type` CHECK на 6 значений, `email_state` CHECK
  `pending|sent|skipped|failed`, partial-индекс `WHERE email_state='pending'`
- [ ] `users.notify_prefs jsonb NOT NULL DEFAULT '{}'`
- [ ] `NOTIFY_EMAIL_ENABLED` не задан → сервер стартует без воркера, in-app
  работает; `=true` без `SMTP_HOST`/`SMTP_PORT`/`SMTP_FROM`/`APP_BASE_URL` →
  падение на старте (`[config]`)

**In-app (событийный слой, D2/D8):**

- [ ] Назначение исполнителя → строка `issue.assigned` **новому** исполнителю, не актору
- [ ] Комментарий → строки `issue.comment` для watchers ∪ assignee ∪ reporter ∪
  collaborators; автору — нет; assignee=reporter → одна строка (дедуп)
- [ ] Смена статуса → `issue.status` для watchers ∪ assignee ∪ reporter (collaborators
  **не** включаются); payload несёт `from`/`to` (имена статусов) — для in-app
- [ ] `@login` в комментарии/описании → `issue.mention` только тем, кто видит
  задачу (участник проекта ∪ collaborator ∪ глоб. admin); `@` постороннего /
  несуществующего / `user@host` — игнор
- [ ] Подключение collaborator → `issue.collaborator`; добавление в проект →
  `project.member` (`issue_id=null`)
- [ ] **Деактивированный** получатель (`is_active=false`) → строка не создаётся
- [ ] Автор комментария/смены статуса → авто-watcher, если `notify_prefs.selfWatch != false`
- [ ] `email_state`: `pending` только при `NOTIFY_EMAIL_ENABLED` + есть `users.email`
  + `notify_prefs.email != 'off'`; иначе `skipped`

**In-app API:**

- [ ] `GET /api/notifications` — своя лента, курсор по `created_at`, `{ items,
  nextCursor, unread }`; чужие не видны
- [ ] `GET /api/notifications/unread-count` → `{ count }`
- [ ] `POST /api/notifications/read` — `{ ids }` или пустое тело = все; `204`;
  `GET /me` возвращает `notifyPrefs` (только себе)
- [ ] `PATCH /api/notifications/prefs` `{ email?, selfWatch? }` → мерж в `notify_prefs`

**Email-воркер (`NOTIFY_EMAIL_ENABLED=true`, job `mail`):**

- [ ] `docker compose -f docker-compose.mail.yml up -d` → Mailpit (SMTP :1025, UI :8025)
- [ ] `npm run test:mail` зелёный: **D9** — заголовок задачи и текст комментария
  из фикстуры **отсутствуют** в письме (subject/text/html/raw); есть ключ и ссылка
  `APP_BASE_URL/#/issue/<pid>/<iid>`; `email='off'` / нет email → `skipped`,
  письма нет; дайджест (`daily`) — до окна `deferred`, после — одно письмо-сводка
  без контента; SMTP недоступен → `email_tries++`, после `NOTIFY_EMAIL_MAX_TRIES`
  → `failed`
- [ ] Тема письма: `Taskira · <тип события> · <ключ>`; тело — тип + ссылка + строка
  «письмо не содержит текста задачи»

**Клиент:**

- [ ] Колокол в топбаре: бейдж = число непрочитанных (`99+` при переполнении);
  открытие → подтягивает свежую ленту
- [ ] Строка: аватар актора + «Кто-то <глагол по типу> <ключ>»; непрочитанные —
  синий фон + точка; «Прочитать всё» → бейдж и подсветка сняты
- [ ] Клик по строке → отметка прочитанной + открытие задачи (тот же проект) или
  `#/issue/<pid>/<iid>` (чужой)
- [ ] Polling `unread-count`: раз в 30 c + на `focus`/`visibilitychange`
- [ ] Меню пользователя → «Уведомления по почте»: Сразу / Дайджест / Выкл +
  «Подписывать меня на мои задачи» → `PATCH prefs` + тост
- [ ] `@login` в описании и комментариях рендерится чипом (`<MentionText>`)

### UI-реструктуризация (ui-restructure) — [`../UI_RESTRUCTURE.md`](../UI_RESTRUCTURE.md)

Автотесты: `test/home.test.ts` (6) + `test/contract.labels.test.ts` (4) —
входят в **78 зелёных** `npm test`.

**Спринты убраны (Ф1, D1):**

- [ ] `012_drop_sprints.sql` в `schema_migrations`; `\d issues` — колонки
  `sprint_id` нет, индекса `idx_issues_sprint` нет; `\dt sprints` — таблицы нет
- [ ] На инсталляции с реальным планированием в спринтах — `pg_dump -t sprints`
  снят **до** применения 012 (миграция необратима); на dev — только seed-спринт,
  дамп не нужен
- [ ] `GET/POST /api/projects/:id/sprints*` → 404 (роут не зарегистрирован)
- [ ] `PATCH /api/projects/:id/issues/:id` с телом `{ "sprintId": ... }` → 400
  (`sprintId` не в контракте), а не тихо игнорируется
- [ ] `GET /api/projects/:id` (bootstrap) не содержит поля `sprints`
- [ ] Матрица прав (`PermissionsView` / `server/src/permissions.ts` `MATRIX`) —
  строки/ключа `manageSprints` нет; таблица рендерится
- [ ] Новый проект (`npm run seed`) создаётся без будущего спринта
- [ ] `audit_log` — исторические строки `entity='sprint'` на месте (не чистим)

**«Список задач» (Ф5, D5):**

- [ ] Сайдбар и хлебная крошка — «Список задач» (не «Бэклог»); `kbd` 2 работает
- [ ] Плоский список всех задач проекта, без секций спринтов и drag&drop
- [ ] Фильтры (статус / исполнитель / тип / текст / просроченные) и сортировка
  (приоритет — по умолчанию / срок / обновление / ключ, тумблер asc-desc) —
  клиентские, применяются к уже загруженным задачам (лимит 200)
- [ ] Меню строки: «Открыть задачу», «Удалить» (при праве `delete`); пунктов про
  спринт нет

**«Направление» (Ф2, D2):**

- [ ] «Эпик» → «Направление» в карточке задачи, окне создания, `TimelineView`,
  `DocsView`; поле `epicId`/`epic_id` в API и типах **не** переименовано

**Создание задачи (Ф3, D3):**

- [ ] На доске кнопка «+» (быстрое создание) только у первого столбца категории
  `todo` по позиции; у остальных столбцов её нет; «+ Создать» в шапке — на месте

**Главный экран (Ф4, D4):**

- [ ] `GET /api/issues/assigned-to-me` (без `:projectId`, `requireAuth`): открытые
  (`ws.category <> 'done'`) задачи, где `assignee_id = me`, по всем видимым
  проектам (участник ∪ департамент ∪ `is_shared` ∪ глоб. admin — как
  `listVisibleProjects`); сортировка приоритет → `updated_at`
- [ ] Задача, назначенная мне в проекте, который мне не виден, в выдачу **не**
  попадает; закрытая — не попадает
- [ ] Вход при **≥ 2** доступных проектах → `<HomeView>` («Мои задачи» +
  «Недавние проекты» по департаментам), в проект не входим
- [ ] Вход при **1** проекте → сразу в проект (как раньше); при **0** →
  solo / пустой экран
- [ ] Прямая ссылка `#/issue/<pid>/<iid>` при входе → в нужный проект + открытая
  задача, **минуя** `<HomeView>`, при любом числе проектов; если задача — из
  проекта, где пользователь только приглашённый (collaborator), при ≥ 2 проектах
  открывается «Мои подключения», а не `<HomeView>`
- [ ] Первый в жизни показ `<HomeView>` → одноразовый тост-пояснение; повторно
  не показывается (флаг `localStorage taskira.homeIntro`)
- [ ] Клик по задаче в «Мои задачи» → вход в её проект + открытие карточки; клик
  по проекту → вход в проект; хлебная крошка «Проекты» → назад на `<HomeView>`
  (проект не выгружается)

### Этап 3b

- [ ] `npm run seed` дважды — проект и workflow не дублируются (`select count(*) from projects` → 1, переходов → 8)
- [ ] `POST /api/issues` → 201 с `key=CORP-1`, следующий — `CORP-2`; 10 параллельных POST дают уникальные номера
- [ ] Переход `todo→inprogress` — 200; `todo→review` — **409 CONFLICT** с русским reason
- [ ] Ранги: вторая задача в колонку с `beforeId` первой встаёт **перед** ней; 60 вставок «между» подряд — без дубликатов rank
- [ ] employee: `PATCH` чужой задачи — 403 «…только задачи, где вы исполнитель или автор»; своей — 200
- [ ] viewer: `GET …/issues` — 200; `POST …/issues` и transition — 403
- [ ] `POST …/workflow/transitions` не-админом — 403; админом — 201; дубликат — 409; `reset` возвращает 8 переходов
- [ ] `PATCH /api/users/:id` с понижением последнего активного админа — 409; при двух админах — 200, права меняются ≤30 с без перевыпуска токена
- [ ] Связи: `POST …/issues/:id/links` с задачей из другого проекта — 404; `blocked_by` → у исходной `dir:"blocked_by"`, у второй `dir:"blocks"`; дубль (в любую сторону для `relates`) — 400
- [ ] Watchers: POST → `{watching:true,watchers:1}`, DELETE → `{watching:false,watchers:0}`
- [ ] `audit_log` содержит `issue.create`, `issue.transition`, `access.denied`, `user.role.change`

## Зависимости

```
fastify @fastify/jwt @fastify/cors @fastify/websocket @fastify/multipart
pg zod bcryptjs ldapts nodemailer
@aws-sdk/client-s3 @aws-sdk/lib-storage   # только для STORAGE_DRIVER=s3
```

`@fastify/multipart` — приём вложений; `nodemailer` — отправка email-уведомлений
(воркер `services/notifier.ts`, только при `NOTIFY_EMAIL_ENABLED=true`); `@aws-sdk/*` —
драйвер S3-хранилища (при `STORAGE_DRIVER=local` не используется, но ставится). См.
[`../FILES_MIGRATION.md`](../FILES_MIGRATION.md), [`../STORAGE_SETUP.md`](../STORAGE_SETUP.md).

### Чистка корневого package.json

Сделано (PR chore/client-ci-hygiene): из корня удалены неиспользуемые
`@dnd-kit/*`, `@supabase/supabase-js`, `canvas-confetti`, `date-fns`,
`framer-motion`, `lucide-react`, `react-router-dom`, `recharts`, `uuid` и их
`@types/*`. Остались только `react` / `react-dom` (+ dev-тулинг: vite, tailwind,
typescript, playwright). Корневой `package.json` теперь `"name": "taskira"`.

## Секреты

Только через env: `JWT_SECRET` (≥ 32 символов), `DATABASE_URL`, `ADMIN_PASSWORD`
(≥14 символов, 3 из 4 групп, без логина и известных дефолтов).
`.env`, `server/.env`, `server/dist`, `server/node_modules` — в `.gitignore`.

## Напоминания о сроках

Независимый от SMTP воркер проверяет задачи раз в минуту. `DUE_REMINDER_ENABLED=true`, `DUE_REMINDER_TIMEZONE=Asia/Dushanbe`, `DUE_REMINDER_HOUR=9` — значения по умолчанию. Личные интервалы: 7/3/1/0 дней, по умолчанию 1/0. Дедупликация и запись уведомлений транзакционные; отложенная почта повторно проверяет актуальность. Содержание email ограничено типом события, ключом, ссылкой и датой срока для напоминаний. См. [NOTIFICATIONS_SETUP](../NOTIFICATIONS_SETUP.md).

## Настройки вебхуков (трек L)

INT-03/04/05 добавляют конфигурацию, проверку целей, шифрование, доставку и API подписок.
`WEBHOOKS_ENABLED=false` по умолчанию. `WEBHOOK_ALLOWED_TARGETS` — список точных имён, суффиксов `*.corp.local`
или IP/CIDR через запятую; пустой список запрещает все цели. Правило имени разрешает все его DNS-адреса,
включая внутренние, кроме обязательных запретов и `WEBHOOK_DENY_CIDRS`. Разрешение действует на все порты:
оператор должен контролировать DNS разрешённых имён и ограничивать исходящий трафик своей сетевой политикой.
Compose всегда добавляет свою сеть в запрет. `WEBHOOK_ALLOW_HTTP=false` требует HTTPS.
CIDR разрешает также имя, не совпавшее с правилами имён, если все DNS-адреса этого имени входят в разрешённые
CIDR. Частные и CGNAT-сети не запрещаются целиком; специфичные служебные диапазоны оператор добавляет в `WEBHOOK_DENY_CIDRS`.

`WEBHOOK_SECRET_KEY` — отдельные 32 случайных байта в hex (64 символа) или canonical base64; обязателен при
включении. AES-256-GCM поддерживает AAD-контекст подписки и назначения поля. Смена ключа требует сброса секретов
подписок. `WEBHOOK_POLL_MS=2000` (500–60000), `WEBHOOK_LOG_RETENTION_DAYS=30` (3–365). Все настройки проверяются
при старте, включая выключенную функцию; ошибочные значения останавливают запуск, поэтому неиспользуемые
переменные оставляют пустыми. Примеры — `server/.env.example` для разработки и корневой `.env.example` для Compose.

Диспетчер сохраняет тело версии 1 при раскладке outbox и доставляет его at-least-once: получателю нужно
дедуплицировать `X-Taskira-Event-Id`. ID события и доставки сохраняются при повторе, время подписи обновляется.
`X-Taskira-Signature: t=<unix>,v1=<hex>` содержит HMAC-SHA256 от `t + "." + rawBody`; во время ротации есть две
подписи `v1` (старый секрет действует 24 часа). Получатель проверяет подпись и отклоняет время старше 5 минут.
Тело содержит только идентификаторы и изменения разрешённых полей, без содержимого задач и комментариев.

Каждая попытка заново проверяет DNS и соединяется с проверенным IP, сохраняя Host/SNI и проверку сертификата
для исходного имени. Прокси окружения и редиректы не используются. Лимиты: 16 отправок одновременно, 4 на
подписку; соединение 5 с, вся попытка 10 с, ответ 64 КБ, очищенный фрагмент журнала 512 байт.
Сетевые ошибки, 408, 429 и 5xx повторяются до 8 попыток; 429 учитывает Retry-After в пределах 1 мин–1 ч.
Нулевой или прошедший Retry-After не расходует попытки в одном тике. 410 или недоступный
секрет выключают подписку сразу; 20 неудач на протяжении суток выключают её с причиной `failing`.
Ответ больше 64 КБ завершает доставку с `too_large`, включая 2xx. Подписки получают слоты по очереди:
большая очередь одной подписки не вытесняет остальные. Блокируются только выбранные доставки (не более 16).
До четырёх результатов одной подписки записываются атомарно: при ошибке БД откатывается вся группа,
и после истечения аренды возможен повтор всех её отправок. Получатель дедуплицирует события по ID события.

Задания требуют `MAINTENANCE_ENABLED=true`: доставка начинает работу через `MAINTENANCE_START_DELAY_MS + 20 с`,
проверка сроков — через задержку + 25 с и затем каждые 10 минут в часовом поясе напоминаний. Обычная очистка
maintenance удаляет просроченные события и доставки пачками даже при выключенных вебхуках.
API подписок доступен только глобальному администратору. Все пути начинаются с `/api`:

| Метод и путь | Тело / ответ |
|---|---|
| `GET /integrations/config` | `{ webhooksEnabled, allowHttp, allowedTargets }` — правила оператора |
| `GET /projects/:projectId/webhooks` | `WebhookDto[]`, URL только в виде `urlDisplay` |
| `POST /projects/:projectId/webhooks` | `{ name, url, events }` → 201 `{ webhook, secret }` |
| `PATCH …/webhooks/:id` | `{ name?, url?, events?, state?: "active" \| "paused" }` → `WebhookDto` |
| `DELETE …/webhooks/:id` | 204; доставки подписки удаляются каскадом |
| `POST …/webhooks/:id/rotate-secret` | `{ secret, previousValidUntil }`, предыдущий секрет действует 24 ч |
| `POST …/webhooks/:id/ping` | 202 `{ deliveryId }`, событие только для этой активной подписки |
| `GET …/webhooks/:id/deliveries` | `?state=&cursor=&limit=` → `{ items, nextCursor }`, limit 1–100, по умолчанию 50 |
| `GET …/webhooks/:id/deliveries/:deliveryId` | метаданные, `payload`, заголовки без подписи, `responseExcerpt` |
| `POST …/webhooks/:id/deliveries/:deliveryId/redeliver` | 202 `{ deliveryId }`, новая ручная доставка того же события |
| `POST …/webhooks/:id/redeliver-failed` | `{ since?: ISO }` → 202 `{ count }`, до 1000 разных событий с failed/cancelled; без `since` — последние 24 ч по часам БД, явно заданный срок не раньше 7 суток. Пропускает события с ручной pending/sending/succeeded доставкой, повторный/параллельный запрос не дублирует очередь |

События: `issue.created`, `issue.updated`, `issue.statusChanged`, `issue.assigned`, `issue.commented`, `issue.due`.
Название — до 80 символов, URL — до 2048; до 10 подписок проекта и 100 на инсталляцию, включая paused/disabled.
Секрет `whsec_…` возвращается один раз при создании и при ротации (`Cache-Control: no-store`); в списках,
журнале и аудите его нет. Полный URL зашифрован, `urlDisplay` исключает query и userinfo. Новая цель проверяется
через DNS перед сохранением и повторно перед каждой отправкой. Ошибки цели не раскрывают разрешённые IP.

`active` сбрасывает причину отключения и счётчик ошибок. Пауза отменяет ожидающие доставки; уже отправленный
сетевой запрос может завершиться. Ручной повтор создаёт новый ID доставки, сохраняя ID события и тело.
Список доставок идёт по `(created_at, id)` по убыванию; `nextCursor` передаётся без изменений, без offset.
При выключенных вебхуках список, журнал и удаление доступны; создание, изменение, ротация и отправка — 409
`WEBHOOKS_DISABLED`. Неактивная подписка — 409 `WEBHOOK_NOT_ACTIVE`, лимит — 409 `WEBHOOK_LIMIT`,
запрещённая цель — 400 `WEBHOOK_TARGET_NOT_ALLOWED`, чужой проект/подписка/доставка — 404.

Получатель проверяет исходные байты тела, без повторной сериализации JSON. Пример на Node.js:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

function verifyWebhook(rawBody: Buffer, header: string, secret: string): boolean {
  const [time, ...signatures] = header.split(",");
  if (!/^t=\d+$/.test(time)) return false;
  const timestamp = Number(time.slice(2));
  if (!Number.isSafeInteger(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300) return false;
  const expected = createHmac("sha256", secret).update(time.slice(2) + ".").update(rawBody).digest();
  return signatures.some(value => /^v1=[0-9a-f]{64}$/.test(value)
    && timingSafeEqual(expected, Buffer.from(value.slice(3), "hex")));
}
```

Секрет используется целиком как UTF-8 строка, включая `whsec_`. После проверки подписи получатель
дедуплицирует `X-Taskira-Event-Id`. Заголовки: `Content-Type`, `User-Agent: Taskira-Webhooks/<version>`,
`X-Taskira-Event`, `X-Taskira-Event-Id`, `X-Taskira-Delivery`, `X-Taskira-Webhook-Version: 1`, `X-Taskira-Signature`.
Детали журнала восстанавливают служебные заголовки с текущей версией сервера; подпись в БД не сохраняется.

## Ядро повторяющихся задач (INT-10)

Миграция `20261006T0503_recurring_rules.sql` добавляет правила над шаблонами задач, исполнителей правил и журнал
запусков с уникальностью `(rule_id, scheduled_for)`. Используемый шаблон нельзя удалить: API возвращает
`409 TEMPLATE_IN_USE` с именами правил. Удаление проекта удаляет правила и журнал каскадом.

`services/recurrence.ts` считает наступления через `Intl`: день короткого месяца ограничивается последним днём,
разрыв местного времени переносится на первую существующую минуту, повтор часа выбирает первый момент.
`assertValidTiming` проверяет расписание, пояс, время и окно даты старта; каждый путь сохранения правила в INT-11
обязан вызвать эту проверку. Ошибка расчёта одного сохранённого правила должна обрабатываться отдельно от других
правил в тике; таблицы не дублируют проверку IANA-поясов и структуры расписания.

`createIssueInTx(client, project, input, actorId)` выполняет все запросы, включая счётчик номера, клиентом
вызывающей транзакции. HTTP-маршрут отдельно готовит проверки и резервирует номер до транзакции, сохраняя прежнее
поведение при гонке назначения родителя; передаёт подготовку необязательным пятым аргументом. Проверенный
`parentId` передаётся только этим контекстом под `assignParentLocked` и записывается сразу в `INSERT`, сохраняя
поведение триггеров вставки. Задание и API правил добавляются в INT-11.

Путь сохранения INT-11 должен проверять, что шаблон относится к тому же проекту, а исполнители — активные
участники этого проекта. Владельцем становится авторизованный пользователь с правом `manageRecurring`;
перед каждым запуском его активность и право `create` проверяются заново через матрицу и членство (глобальный
администратор может иметь право без членства). Связи в БД не заменяют эти проверки. Потерявшие членство
исполнители исключаются при запуске и записываются в `details.droppedAssignees`, потеря доступа владельца
останавливает правило. Каждое правило запускается в отдельной короткой транзакции: счётчик номера держит
блокировку до коммита, поэтому нельзя объединять пакет правил в одну транзакцию. Внешние побочные эффекты
выполняются после коммита.

## Повторяющиеся задачи (INT-11)

Правила создают задачи из шаблона проекта. Чтение и предпросмотр требуют `browse`, управление —
`manageRecurring` (manager/admin). До 50 правил на проект, включая остановленные; имя уникально без учёта
регистра. Владелец — создавший или последний изменивший/возобновивший правило пользователь.

Все пути ниже начинаются с `/api`; `…` означает `/projects/:projectId/recurring`.

| Метод и путь | Тело / ответ |
|---|---|
| `GET /recurring/config` | Вход обязателен; `{ enabled, defaultTimeZone }` из конфигурации сервера |
| `GET …` | `RecurringRuleDto[]`, время в `HH:mm`, даты запусков в UTC ISO |
| `POST …` | `RecurringRuleBody` → 201 `RecurringRuleDto` |
| `PATCH …/:id` | Непустой частичный `RecurringRuleBody` → обновлённое правило |
| `DELETE …/:id` | 204; журнал удаляется вместе с правилом |
| `POST …/:id/pause` | Остановка с причиной `manual`; `nextRunAt = null` |
| `POST …/:id/resume` | Возобновление от текущего времени, без догоняния периода паузы |
| `POST …/:id/run-now` | 201 `RecurringRunDto`; повтор в ту же минуту — 409 `RECURRING_ALREADY_RAN` |
| `POST …/preview` | Расписание, время, пояс и дата старта → `{ next: string[] }`, пять наступлений |
| `GET …/:id/runs` | `RecurringRunDto[]`, `?limit=1..100` (по умолчанию 20), новые наступления первыми |

Расписание: `daily { every: 1..30 }`, `weekly { every: 1..12, weekdays: [1..7] }` (понедельник = 1),
`monthly { every: 1..12, day: 1..31 | "last" }`. Обязательные поля — `name`, `templateId`, `schedule`,
`timeOfDay`, `timeZone` (IANA) и `startDate` (`YYYY-MM-DD`, от года назад до пяти лет вперёд при создании или
изменении даты). Неизменённая дата старого правила продолжает действовать. Частичный PATCH проверяет
участников и принадлежность шаблона при изменении соответствующего поля; выпавшие исполнители не мешают переименованию.
Предпросмотр проверяет структуру и календарную дату, включая даты старых правил; окно применяется к новой дате при записи.
`title` заменяет заголовок шаблона; `{date}` подставляет местную дату наступления. По умолчанию `title` и
`dueInDays` равны `null`, `assigneeIds=[]`, `skipIfOpen=false`. До 10 активных исполнителей проекта; сервисные
учётные записи исключены. `dueInDays=0..365` задаёт местную календарную дату срока.

Задание требует `MAINTENANCE_ENABLED=true` и `RECURRING_ENABLED=true` (по умолчанию включено). Первый тик —
через `MAINTENANCE_START_DELAY_MS + 25 с`, следующие — каждые `RECURRING_POLL_MS` (60 000 по умолчанию,
допустимо 1000–86400000). Advisory-лок исключает параллельные тики нескольких процессов; до 20 правил на тик,
каждое в отдельной транзакции. После простоя создаётся одна задача за последнее наступление, число предыдущих
фиксируется в `missedCount`; длинный расчёт уступает event loop короткими порциями. Уникальность запуска и
блокировка правила защищают также от гонки с ручным запуском. Ручной запуск сохраняет `nextRunAt` и доступен
при выключенном автоматическом задании.

Перед запуском заново проверяются активность и право `create` владельца. Потеря доступа останавливает правило
с `owner_lost_access`; возобновление передаёт владение вызывающему. Выпавшие исполнители сохраняются в
`details.droppedAssignees`. `skipIfOpen` пропускает запуск, если задача последнего успешного создания открыта
и не архивирована. Ошибка создания откатывает задачу и номер, записывает `failed` и сдвигает расписание;
повреждённое расписание останавливается с `pausedReason=invalid_timing`, причина находится также в аудите. Остальные правила
продолжают выполняться. Созданная задача сохраняет обычные историю, уведомления и событие `issue.created`.
Длина заголовка проверяется после подстановки даты при сохранении названия/шаблона и при запуске:
если шаблон впоследствии изменился, слишком длинный заголовок даёт `failed/VALIDATION` без создания задачи.
Неожиданная ошибка отдельного правила откатывает его транзакцию и останавливает с `run_failed`; остальные
правила продолжают тик. При сбое соединения/БД, который мешает записать паузу, тик возвращает ошибку.
Параллельно изменённое правило после отката не останавливается. Аудит обновления хранит прежнего и нового владельца.
Аддитивная миграция `20261006T0646_recurring_pause_reasons.sql` расширяет причины паузы, сохраняя прежние значения.

Аудит: `recurring.create|update|delete|pause|resume|run_now`, `recurring.auto_pause`, `recurring.run_failed`;
`issue.create` после коммита содержит `via=recurring`. Обычная очистка maintenance удаляет запуски старше
365 дней и сверх 200 последних на правило, в том числе при выключенном задании. Метрики:
`taskira_recurring_runs_total{result="created|skipped_open|failed"}` — результаты этого процесса;
`taskira_recurring_lag_seconds` — задержка самого старого ожидающего активного правила.

Аварийная остановка автоматического создания: `RECURRING_ENABLED=false` и рестарт. Созданные задачи остаются
обычными задачами. Удаление используемого шаблона возвращает 409 `TEMPLATE_IN_USE`, превышение числа правил —
409 `RECURRING_LIMIT`, повтор имени — 409 `CONFLICT`, правило другого проекта — 404.

## Состояние инсталляции (INT-14, ADR-0031)

`GET /api/admin/status` доступен сессии глобального администратора; API-токены получают 403
`TOKEN_NOT_ALLOWED`. Контракт — `SystemStatusDto` в `src/contract.ts`: `version`, `checkedAt`, проверки в порядке
`database`, `storage`, `mail`, `ldap`, `jobs`, `license`, `search`, `backup`, `restoreDrill`, `webhooks`, `recurring`.
Каждый источник проверяется независимо и параллельно. Общий дедлайн — 5 секунд, кэш на процесс — 15 секунд;
одновременные запросы делят один расчёт. Исключение или опоздавшая проверка дают `unknown` с пустыми фактами,
остальные результаты сохраняются. В журнале — только идентификатор проверки. `/ready` и `/api/health`
переиспользуют проверки БД, миграций и хранилища; формат и коды их ответов сохраняются.

| Проверка | Условия деградации |
|---|---|
| БД | `SELECT 1` >200 мс → `warn`; недоступность или неприменённые миграции → `fail` |
| Хранилище | Недоступно → `fail`. Local: свободно <10% или <2 ГиБ → `warn`; <2% или <500 МиБ → `fail`. S3: объём диска неизвестен |
| Почта | Выключена → `off`; включена без SMTP → `fail`; старейшее ожидание >30 минут или окончательный отказ за сутки → `warn` |
| LDAP | Local или нет bind DN → `off`; последний ресинк с ошибкой/не найден пользователь, нет успеха или он старше трёх интервалов → `warn` |
| Задания | Последний результат `error` или успех старше трёх интервалов → `warn`; без первого успеха предупреждение начинается после `startDelayMs + intervalMs` процесса |
| Лицензия | Неверная подпись/формат → `fail`; нет лицензии, grace, ≤30 дней до истечения или превышены места → `warn` |
| Поиск | Отсутствует любой триграммный индекс из `searchIndexStatus()` → `warn` |
| Бэкап | Успех моложе 26 ч → `ok`, 26–50 ч → `warn`, старше 50 ч → `fail` |
| Репетиция | Успех моложе 8 суток → `ok`, 8–15 суток → `warn`, старше 15 суток → `fail` |
| Вебхуки | Выключены и нет подписок → `off`; `disabled`, очередь старше 15 минут или окончательный отказ за сутки → `warn` |
| Повторы | Выключены или нет правил → `off`; `owner_lost_access` или ошибка за сутки → `warn` |

Для операций хоста последняя `failure` всегда даёт `fail`; `running` старше 6 часов представлен как
`interrupted` и тоже даёт `fail`. Пустая история или отсутствие успешной операции → `unknown`.
Факты не содержат имён пользователей, DN, SMTP/S3-параметров или текстов задач; архив — только basename,
ошибка LDAP — безопасный код `resync_failed`. Состояние заданий относится к этому процессу (ADR-0024).
Успех задания хранится отдельно от последнего запуска: ошибка или пропуск не перезаписывают время успеха.

Аддитивная миграция `20261006T1057_status_failure_times.sql` добавляет `notifications.email_failed_at`.
Воркер записывает его при исчерпании ретраев, поэтому `mail.failed24h` считает время отказа, а не создания
уведомления. Исторические отказы с неизвестным временем остаются NULL и в суточный показатель не входят.
Частичные индексы ускоряют суточные агрегаты отказов почты, вебхуков и повторов; миграция строит их
транзакционно, поэтому на больших журналах её следует применять в окно обслуживания.

`GET /api/admin/ops-runs?kind=backup|restore_drill&limit=5` возвращает новейшие `OpsRunDto[]`, максимум 50.
`error` — уже очищенный от секретов отчёт INT-13. Записи не изменяются при вычислении `interrupted`.
При каждом scrape `/metrics` читает БД и обновляет
`taskira_ops_last_success_timestamp_seconds{kind="backup|restore_drill"}` и
`taskira_ops_last_run_success{kind="backup|restore_drill"}`. Второй показатель относится к последней
завершённой операции (1 — успех, 0 — отказ); зависший более 6 ч запуск даёт 0, текущий запуск сохраняет
предыдущий завершённый результат. Без соответствующей истории или при ошибке чтения серия отсутствует;
ошибка чтения увеличивает `taskira_metrics_collection_errors_total`. Кэш административного экрана
не влияет на scrape. Вебхуки по-прежнему обновляют размер/возраст очереди и подписки при scrape.

Локальный воспроизводимый замер на 50 000 задач: `PERF_CONFIRM=system-status`,
`PERF_ADMIN_DATABASE_URL=postgresql://…@localhost/postgres`, затем
`node --import tsx server/scripts/performance-status.mjs` из корня. Скрипт создаёт отдельную БД,
делает 30 запросов без кэша после пяти прогревочных и удаляет собственную БД в `finally`;
результат — `server/var/perf-status/report.json` (или `PERF_OUTPUT_DIR`).
