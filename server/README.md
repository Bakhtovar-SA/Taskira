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

## Как прогнать локально

```bash
cd server
npm i
cp .env.example .env
# Заполните: DATABASE_URL, JWT_SECRET (>=32 симв.), ADMIN_USERNAME/ADMIN_PASSWORD
# JWT_SECRET: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

npm run dev        # tsx watch: миграции 001+002 → seed админа → listen :8080
```

Миграции и seed по отдельности:

```bash
npm run seed                     # прогоняет migrate() + создание первого админа
psql "$DATABASE_URL" -c "select name from schema_migrations"   # 001, 002
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

- [ ] `npm run typecheck` — без ошибок; `npm run dev` стартует, миграции 001+002 в `schema_migrations`
- [ ] Остановка PostgreSQL → `/api/health` отвечает **503** `{ok:false,db:false}`; восстановление → 200
- [ ] Логин: неверный пароль — 401 с единым reason; 11-я попытка за 5 минут — **429 RATE_LIMITED**
- [ ] `is_active=false` в БД → логин 403 «Аккаунт деактивирован…», `/me` с живым токеном — 401 (в пределах 30 с)
- [ ] Смена `access_role` в БД админом → `/me` и проверки прав видят новую роль **без** перевыпуска токена (≤30 с)
- [ ] В `users` нет роли `developer`; в `issues` нет типов `story`/`epic`
  (`select distinct access_role from users; select distinct type_id from issues;`)
- [ ] `select conname from pg_constraint where conname in ('users_access_role_check','issues_type_id_check')` — обе на месте
- [ ] `git check-ignore server/.env server/dist .env` — всё игнорируется

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
