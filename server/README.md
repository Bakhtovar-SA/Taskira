# Taskira Server — дизайн и план (Этапы 2–5)

Внутренний корпоративный task-tracker. Клиент — React SPA (корень репозитория),
сервер — Node.js + Fastify + TypeScript, база — PostgreSQL.

## Архитектура

```
Браузер (nginx, dist/)
   │  REST JSON, Authorization: Bearer <JWT>
   ▼
Fastify (server/)                 ┌──────────────┐
   ├─ @fastify/jwt   (auth)       │  PostgreSQL  │
   ├─ zod (валидация contract.ts) │  (docker)    │
   ├─ requireAuth / requirePerm   │              │
   ├─ routes + audit_log          └──────────────┘
   └─ @fastify/websocket → пуш изменений всем клиентам
```

**Принцип: права проверяются только на сервере.** Клиентский `src/permissions.ts`
остаётся исключительно для UX (скрыть/заблокировать кнопки). Любая мутация без
валидного JWT и соответствующего права возвращает `403 { error: { code, reason } }`
с человекочитаемой причиной на русском — клиент показывает её тостом.

### Перенос логики прав на сервер (Этап 3)

`src/permissions.ts` переезжает в `server/src/permissions.ts` без изменений модели:

```ts
// server/src/middleware.ts (схема)
const requireAuth = async (req) => { req.user = await req.jwtVerify(); };
const requirePerm = (perm: PermId) => async (req, reply) => {
  const ok = can(req.user, perm, req.issue /* для edit */);
  if (!ok) {
    await audit(req.user.id, "access.denied", perm, {});
    reply.code(403).send({ error: { code: "FORBIDDEN", reason: denialReason(req.user, perm, req.issue) } });
  }
};
```

Правило уровня задачи (developer редактирует только свои) живёт в `can()` —
та же функция, что сейчас на клиенте. Дополнительно — запись в `audit_log`
на каждый отказ и на админ-действия.

## Схема БД

Полный DDL: [`migrations/001_init.sql`](./migrations/001_init.sql).

`users` · `projects` · `workflow_statuses` · `workflow_transitions` · `sprints` ·
`issues` (с `rank float8` для порядка в колонке) · `comments` · `activity` · `audit_log`.

Ключевые ограничения: `UNIQUE(project_id, num)`, `UNIQUE(project_id, from, to)` для
переходов, `CHECK(from <> to)`, длины полей (250/5000/2000/200) — те же лимиты,
что в `src/validation.ts` и `server/src/contract.ts`.

## API

Карта эндпоинтов с телами запросов и требуемыми правами — в шапке
[`src/contract.ts`](./src/contract.ts). Единый формат ошибки:

```json
{ "error": { "code": "FORBIDDEN", "reason": "Роль «Наблюдатель» — только чтение…" } }
```

Realtime: `WS /api/ws?token=<JWT>` → `issue:upsert | issue:delete | sprint:changed |
workflow:changed | presence`, каждое сообщение содержит `actorId` (клиент гасит своё эхо).

## План коммитов

| # | Коммит | Статус |
|---|---|---|
| 1 | `chore(security): client hardening` — UUID, валидация/санитизация, аудит requirePerm | ✅ |
| 2 | `feat(db): migration 001 + API contract (zod) + design doc` | ✅ |
| 3a | `feat(server): skeleton` — Fastify, env-конфиг, PG-пул, JWT+bcrypt, middleware прав, перенос permissions | ⏳ |
| 3b | `feat(server): routes` — issues/sprints/workflow/comments/users + audit_log | ⏳ |
| 3c | `feat(server): ws` — realtime-рассылка | ⏳ |
| 4 | `feat(web): api-client` — store поверх API, 403→reason, loading/offline, WS-синхронизация | ⏳ |
| 5 | `infra: docker-compose` — nginx + backend + postgres, `.env.example`, seed первого админа | ⏳ |
| 5b | `docs: runbook` — развёртывание в корпоративной сети, бэкап | ⏳ |
| 6+ | Фичи: связи задач, чек-листы, burndown, WIP-лимиты, swimlanes, тёмная тема | ⏳ |

## Зависимости (Этап 3)

Сервер — отдельный npm-пакет (`server/package.json` появится в 3a):

```
fastify @fastify/jwt @fastify/cors @fastify/websocket pg zod bcrypt
```

### Чистка корневого package.json

В корневом `package.json` накопились неиспользуемые пакеты (DnD реализован на
нативном HTML5, графики и роутер не используются). Удалить вручную:

```bash
npm uninstall @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities \
  @supabase/supabase-js canvas-confetti @types/canvas-confetti date-fns \
  framer-motion lucide-react react-router-dom recharts uuid @types/uuid
```

## Развёртывание (появится в Этапе 5)

```yaml
# docker-compose.yml (план)
services:
  db:       postgres:16-alpine, volume pgdata, секреты из .env
  backend:  build ./server, env: DATABASE_URL, JWT_SECRET, ADMIN_USERNAME, ADMIN_PASSWORD
  web:      nginx:alpine, dist/ + проксирование /api и /api/ws на backend
```

Первый админ создаётся seed-скриптом из `ADMIN_USERNAME/ADMIN_PASSWORD` при старте,
если таблица `users` пуста. Регистрация закрыта — пользователей создаёт админ
(`POST /api/admin/users`).

Бэкап: `pg_dump "$DATABASE_URL" -Fc > backup-$(date +%F).dump` по cron +
восстановление `pg_restore`. Подробная инструкция — в runbook (Этап 5b).

## Секреты

Только через env: `JWT_SECRET` (≥ 32 байт), `DATABASE_URL`, `ADMIN_PASSWORD`.
Никаких секретов в коде и в репозитории; `.env` — в `.gitignore`.
