# Трек L — интеграции: вебхуки, API-токены, повторяющиеся задачи, состояние системы

Постановка — [TZ-ARCHITECTURE-BRIEF.md](TZ-ARCHITECTURE-BRIEF.md). Решения — ADR
[0028](../adr/0028-integration-events-webhooks.md) (события и вебхуки), [0029](../adr/0029-api-tokens-service-accounts.md)
(API-токены), [0030](../adr/0030-recurring-issues.md) (повторяющиеся задачи), [0031](../adr/0031-ops-status-restore-drill.md)
(экран состояния и репетиция восстановления). Тикеты — `docs/tickets/INT-01` … `INT-16`.

## 0. Резюме

1. **События берутся из истории задач.** Триггер на `activity` и `comments` пишет outbox `integration_events` в той же
   транзакции, что и изменение. Событие не теряется при падении: оно либо закоммичено вместе с изменением, либо его
   нет. События одной транзакции по задаче склеиваются в одно.
2. **Доставка — фоновое задание в том же процессе** (ADR-0024), at-least-once с ключом идемпотентности, HMAC-подписью,
   8 попытками с backoff, журналом и автоотключением подписки. Очередей и Redis нет: хватает PostgreSQL.
3. **SSRF закрыт списком оператора**: вебхуки выключены по умолчанию, цели — только из `WEBHOOK_ALLOWED_TARGETS` в
   env. Запрет частных сетей здесь не работает: цели и есть внутренние системы.
4. **Тело события тонкое**, без названий, описаний и комментариев, как в письмах. Подробности получатель читает
   API-токеном.
5. **API-токен всегда действует от имени пользователя.** Сервисная учётная запись — пользователь без входа. Отдельной
   модели прав нет; scope только `read`/`write`; роль глобального администратора токен не несёт (`globalRole`
   запроса с токеном всегда `member`), административные маршруты для токенов закрыты.
6. **Повторяющиеся задачи** — правило над шаблоном задачи. Расписание структурное (день/неделя/месяц), не cron. После
   простоя создаётся одна догоняющая задача. Дубли исключены уникальностью `(rule, scheduled_for)` в одной транзакции.
7. **Экран состояния** — существующий раздел «Состояние системы», расширенный. Бэкап и новая репетиция
   восстановления выполняются на хосте и пишут итог в `ops_runs`.
8. Новое право одно — `manageRecurring`. Вебхуки и сервисные записи — только глобальный администратор.
9. Автоматизации только спроектированы (§11): шесть готовых правил, второй потребитель того же outbox.

## 1. Что изменено относительно ТЗ и почему

| ТЗ | Решение | Почему |
|---|---|---|
| Защита от SSRF (подразумевался запрет внутренних адресов) | Функция выключена по умолчанию, цели — только из allowlist оператора, поверх неотключаемый запрет loopback/link-local/metadata/подсети compose | Цели — внутренние системы. `SECURITY_OVERVIEW.md` обещает исходящие соединения только к адресам, которые задал администратор |
| Подписки на уровне проекта (кто управляет — не сказано) | Только глобальный администратор, без нового `PermId` | Вебхук вывозит данные проекта. Роль `admin` в проекте и так только у глобального администратора |
| Состав тела события не задан | Тонкое событие без текстов задач | Политика писем; меньше последствий утечки секрета |
| Источник событий не задан | Триггер на истории, а не вызовы в маршрутах | Любой путь записи покрыт автоматически (прецедент EPIC-01) |
| «Не потерять и не задублировать» | Не потерять — транзакционный outbox. Не задублировать — гарантия на стороне получателя по `X-Taskira-Event-Id` | Ровно один раз по HTTP недостижимо; честно названо |
| Персональные и сервисные токены с областью действия | Сервисная запись — пользователь; scope только `read`/`write` | Вторая модель прав рядом с матрицей — источник эскалаций |
| Репетиция восстановления «запускается по расписанию» | Скрипт на хосте по таймеру; API только показывает итог | Бэкап останавливает API; восстановлению нужны Docker и место |
| Единый экран состояния | Расширение существующего раздела `/admin/health` | Новый экран дублировал бы старый |
| Повторяющиеся задачи: «формат расписания» | Закрытый union, не cron | Форма один к одному; без парсера и зависимостей |
| Тикеты «в формате `docs/tickets/`» | Структура тикета задана в §12. Существующие файлы `docs/tickets/` — отчёты об инцидентах, а не постановки | Нужна самодостаточная постановка для исполнителя |
| — (урезано) | Нет: тонких scope, административного scope, писем администратору об отказах, событий удаления задачи, входящих вебхуков | Вынесено в «Решения владельца» (§13) |

## 2. Правила для исполнителя (общие для всех тикетов)

- Перед работой прочитать `CLAUDE.md` целиком, `server/README.md`, `docs/MIGRATIONS.md`, ADR 0028–0031 и этот файл.
- Один тикет — один PR, ветка от свежего `main`. После каждого `git pull`: `npm ci` в корне и в `server/`.
- **Миграции.** Имя — `YYYYMMDDTHHMM_имя.sql` по UTC-времени создания файла, **после** всех миграций на `main`
  (`scripts/check-migrations.sh`). Только expand: новые таблицы, колонки, индексы, расширенные CHECK. Без
  `BEGIN/COMMIT` внутри файла. Первая содержательная строка комментария попадает в `docs/MIGRATION-LIST.md`.
- **Контракт.** Новые схемы запросов и ответов — в `server/src/contract.ts`. Лимиты — в `LIMITS` там же и зеркально
  в `src/validation.ts` (`server/test/permissions-sync.test.ts` сверяет). Клиент импортирует типы через `import type`.
- **Права.** Только через `shared/permissions.matrix.json` → `npm run permissions:generate`. Сгенерированные файлы
  руками не править.
- **Ошибки.** Каждый новый `code` в `ApiHttpError` получает ключ `apiError.<CODE>` в `src/i18n/ru.ts` и `en.ts`
  (`src/i18n/apiErrors.test.ts` сканирует сервер). Тексты причин на сервере — по-русски, как везде.
- **История.** Новое событие или поле истории — член/поле `ActivityEvent` + `activityText()` + ключи `activity.*` +
  случай в `activityLine()` клиента. Свободный текст в `logActivity` запрещён.
- **Клиент.** Тексты только через словарь (`ru.ts` + `en.ts`, блок `// трек L` в конце). Цвета только токенами
  (`npm run colors:check`). Без `style=""` (CSP). Попапы — `ds` `Menu`/`Popover`. Окна — `ds` `Dialog`/`SidePanel`.
  Модули из entry-чанка импортируют `ds` по файлам. Новые экраны — ленивые чанки.
- **Секреты** (URL вебхука, секрет подписи, секрет токена) не попадают в `console.*`, `audit_log.details`, экспорт,
  support bundle и ответы API, кроме одного ответа при создании или смене.
- **Документация, порождаемая из кода**: `npm run docs:generate` и `npm run permissions:generate`, результат коммитится.
- **Полная проверка** перед PR, если в тикете не сказано иное:
  `npm run typecheck && npm test && npm run build && npm run docs:check && npm run permissions:check`
  в корне, `npm run typecheck && npm test` в `server/`.

## 3. Модель данных

Все миграции трека — **expand**: новые таблицы, расширение CHECK, новые индексы. Contract-фаз нет: ничего не
удаляется и не переименовывается. Предыдущий образ на расширенной схеме работает: новые таблицы он не читает,
триггер ничего не пишет без подписок (их создаёт только новый образ). Сервисные записи старым образом не
создаются, и войти по ним нельзя: вход ищет `auth_source = 'local'`.

### 3.1. События и вебхуки (INT-02)

`<ts>_integration_events.sql`:

```sql
CREATE TABLE webhooks (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name              text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  url_enc           text NOT NULL,            -- secretBox(URL) — URL может нести токен получателя в query
  url_display       text NOT NULL,            -- scheme://host[:port]/path, без userinfo и query
  secret_enc        text NOT NULL,            -- secretBox(whsec_…)
  prev_secret_enc   text,
  prev_secret_until timestamptz,
  events            text[] NOT NULL CHECK (cardinality(events) BETWEEN 1 AND 6),
  state             text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'paused', 'disabled')),
  disabled_reason   text CHECK (disabled_reason IN ('failing', 'gone', 'secret_unavailable')),
  failure_streak    integer NOT NULL DEFAULT 0,
  failing_since     timestamptz,
  last_success_at   timestamptz,
  last_failure_at   timestamptz,
  created_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK ((state = 'disabled') = (disabled_reason IS NOT NULL))
);
CREATE INDEX idx_webhooks_project_active ON webhooks (project_id) WHERE state = 'active';

CREATE TABLE integration_events (
  id            bigserial PRIMARY KEY,         -- "sequence" в теле
  event_id      uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  type          text NOT NULL CHECK (type IN ('issue.created', 'issue.updated', 'issue.statusChanged',
                  'issue.assigned', 'issue.commented', 'issue.due', 'ping')),
  project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  issue_id      uuid,                          -- без FK: событие переживает удаление задачи
  issue_key     text,
  actor_id      uuid,                          -- без FK, как activity.actor_id по смыслу «снимок»
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  dedupe_key    text NOT NULL UNIQUE,
  changes       jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{kind, …payload истории}]
  data          jsonb NOT NULL DEFAULT '{}'::jsonb,  -- commentId / dueDate / ping
  payload       jsonb,                         -- итоговое тело v1, пишется при раскладке
  dispatched_at timestamptz
);
CREATE INDEX idx_integration_events_undispatched ON integration_events (id) WHERE dispatched_at IS NULL;
CREATE INDEX idx_integration_events_occurred ON integration_events (occurred_at);

CREATE TABLE webhook_deliveries (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id       uuid NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event_id         bigint NOT NULL REFERENCES integration_events(id) ON DELETE CASCADE,
  manual           boolean NOT NULL DEFAULT false,
  state            text NOT NULL DEFAULT 'pending'
                     CHECK (state IN ('pending', 'sending', 'succeeded', 'failed', 'cancelled')),
  attempts         smallint NOT NULL DEFAULT 0,
  next_attempt_at  timestamptz NOT NULL DEFAULT now(),
  locked_until     timestamptz,
  last_status      smallint,
  last_error       text CHECK (last_error IN ('timeout', 'dns', 'connect', 'tls', 'target_blocked',
                     'redirect', 'http_status', 'secret_unavailable', 'too_large', 'internal')),
  last_duration_ms integer,
  response_excerpt text CHECK (octet_length(response_excerpt) <= 512),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_webhook_deliveries_due ON webhook_deliveries (next_attempt_at) WHERE state IN ('pending', 'sending');
CREATE INDEX idx_webhook_deliveries_hook ON webhook_deliveries (webhook_id, created_at DESC);
CREATE UNIQUE INDEX uq_webhook_deliveries_auto ON webhook_deliveries (webhook_id, event_id) WHERE NOT manual;
```

Триггеры (та же миграция):

```sql
CREATE FUNCTION integration_event_type(kind text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE kind WHEN 'created' THEN 'issue.created' WHEN 'status' THEN 'issue.statusChanged'
    WHEN 'assigneeAdded' THEN 'issue.assigned' WHEN 'assigneeRemoved' THEN 'issue.assigned'
    WHEN 'assigneeBulk' THEN 'issue.assigned' ELSE 'issue.updated' END $$;

CREATE FUNCTION trg_activity_integration_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p uuid; k text; t text;
BEGIN
  IF NEW.kind IS NULL THEN RETURN NULL; END IF;
  SELECT i.project_id, i.key INTO p, k FROM issues i WHERE i.id = NEW.issue_id;
  IF p IS NULL OR NOT EXISTS (SELECT 1 FROM webhooks w WHERE w.project_id = p AND w.state = 'active') THEN
    RETURN NULL;
  END IF;
  t := integration_event_type(NEW.kind);
  INSERT INTO integration_events (type, project_id, issue_id, issue_key, actor_id, dedupe_key, changes)
  VALUES (t, p, NEW.issue_id, k, NEW.actor_id,
          'tx:' || pg_current_xact_id()::text || ':' || NEW.issue_id || ':' || t,
          jsonb_build_array(jsonb_build_object('kind', NEW.kind) || COALESCE(NEW.payload, '{}'::jsonb)))
  ON CONFLICT (dedupe_key) DO UPDATE SET changes = integration_events.changes || EXCLUDED.changes;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_activity_integration_event AFTER INSERT ON activity
  FOR EACH ROW EXECUTE FUNCTION trg_activity_integration_event();
-- trg_comments_integration_event: то же для comments, type 'issue.commented',
-- dedupe_key 'comment:' || NEW.id, data = {"commentId": NEW.id}, actor = NEW.author_id, без склейки (DO NOTHING).
```

Хранение: `integration_events` и `webhook_deliveries` — `WEBHOOK_LOG_RETENTION_DAYS` (30) по `occurred_at`. Доставки
уходят каскадом. Чистит задание `maintenance` пачками, как `audit_log`. Удаление события с доставкой
`pending/sending` моложе срока невозможно по построению: срок хранения больше полного цикла повторов (~45 ч).

### 3.2. API-токены и сервисные записи (INT-06)

`<ts>_api_tokens.sql`:

```sql
-- имя ограничения проверить: \d users (ожидается users_auth_source_check из 009_ldap.sql)
ALTER TABLE users DROP CONSTRAINT users_auth_source_check;
ALTER TABLE users ADD CONSTRAINT users_auth_source_check CHECK (auth_source IN ('local', 'ldap', 'service'));
ALTER TABLE users ADD CONSTRAINT users_service_shape
  CHECK (auth_source <> 'service' OR (global_role = 'member' AND password_hash IS NULL AND ldap_dn IS NULL));

CREATE TABLE api_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  prefix       text NOT NULL UNIQUE CHECK (prefix ~ '^[a-z0-9]{8}$'),
  secret_hash  bytea NOT NULL CHECK (octet_length(secret_hash) = 32),   -- sha256(secret)
  scope        text NOT NULL CHECK (scope IN ('read', 'write')),
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  last_used_at timestamptz,
  last_used_ip inet,
  revoked_at   timestamptz,
  revoked_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '366 days')
);
CREATE INDEX idx_api_tokens_user_active ON api_tokens (user_id) WHERE revoked_at IS NULL;
```

Хранение: отозванные и истёкшие токены удаляются заданием `maintenance` через 90 дней после `revoked_at` или
`expires_at`. Аудит их создания и отзыва остаётся по `AUDIT_RETENTION_DAYS`.

### 3.3. Повторяющиеся задачи (INT-10)

`<ts>_recurring_rules.sql`:

```sql
CREATE TABLE recurring_rules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  template_id   uuid NOT NULL REFERENCES issue_templates(id) ON DELETE RESTRICT,
  name          text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  title         text,                          -- NULL — название шаблона; поддерживает {date}
  schedule      jsonb NOT NULL,                -- RecurrenceSchedule (zod), проверяется сервером
  time_of_day   time NOT NULL,
  time_zone     text NOT NULL,
  start_date    date NOT NULL,
  due_in_days   smallint CHECK (due_in_days BETWEEN 0 AND 365),
  skip_if_open  boolean NOT NULL DEFAULT false,
  owner_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  state         text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'paused')),
  paused_reason text CHECK (paused_reason IN ('manual', 'owner_lost_access')),
  next_run_at   timestamptz,
  last_run_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK ((state = 'paused') = (paused_reason IS NOT NULL)),
  CHECK (state = 'paused' OR next_run_at IS NOT NULL)
);
CREATE UNIQUE INDEX recurring_rules_name_uk ON recurring_rules (project_id, lower(name));
CREATE INDEX idx_recurring_rules_due ON recurring_rules (next_run_at) WHERE state = 'active';

CREATE TABLE recurring_rule_assignees (
  rule_id uuid NOT NULL REFERENCES recurring_rules(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (rule_id, user_id)
);

CREATE TABLE recurring_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id       uuid NOT NULL REFERENCES recurring_rules(id) ON DELETE CASCADE,
  scheduled_for timestamptz NOT NULL,
  ran_at        timestamptz NOT NULL DEFAULT now(),
  result        text NOT NULL CHECK (result IN ('created', 'skipped_open', 'failed')),
  manual        boolean NOT NULL DEFAULT false,
  missed_count  integer NOT NULL DEFAULT 0,
  issue_id      uuid REFERENCES issues(id) ON DELETE SET NULL,
  error_code    text,
  details       jsonb NOT NULL DEFAULT '{}'::jsonb,   -- droppedAssignees и т. п., без текста задач
  UNIQUE (rule_id, scheduled_for)
);
CREATE INDEX idx_recurring_runs_rule ON recurring_runs (rule_id, scheduled_for DESC);
```

Хранение: `recurring_runs` — 365 дней и не больше 200 строк на правило (задание `maintenance`).

### 3.4. Отчёты операций (INT-13)

`<ts>_ops_runs.sql`:

```sql
CREATE TABLE ops_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text NOT NULL CHECK (kind IN ('backup', 'restore_drill')),
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  result      text NOT NULL DEFAULT 'running' CHECK (result IN ('running', 'success', 'failure')),
  host        text,
  archive     text,                 -- только имя файла, без каталога
  app_version text,
  details     jsonb NOT NULL DEFAULT '{}'::jsonb,
  error       text CHECK (char_length(error) <= 2000)
);
CREATE INDEX idx_ops_runs_kind ON ops_runs (kind, started_at DESC);
```

Строка `running` старше 6 часов считается прерванной (`failure` на экране). Хранение — 200 последних строк.

### 3.5. Экспорт, бэкап, демо

| Таблица | Экспорт (`/api/admin/export`) | Почему |
|---|---|---|
| `webhooks` | нет | конфигурация с зашифрованными секретами |
| `integration_events`, `webhook_deliveries` | нет | технический журнал с ограниченным сроком |
| `api_tokens` | нет | учётные данные |
| `users` с `auth_source = 'service'` | да, как пользователи (без секретов) | авторы задач и истории |
| `recurring_rules`, `recurring_rule_assignees`, `recurring_runs` | да | рабочая конфигурация и её история, как `issue_templates` |
| `ops_runs` | нет | служебные данные инсталляции |

Таблицу в `SECURITY_OVERVIEW.md` («Полнота экспорта») дополнить (INT-16). Бэкап содержит всю БД: зашифрованные
секреты бесполезны без `WEBHOOK_SECRET_KEY`, хеши токенов перебору не поддаются. Демо-проект
(`services/demoProject.ts`) вебхуков и правил не создаёт; `onboarding.test.ts` сверяет число строк всех таблиц
и должен проходить без правок.

## 4. API

Общее: ошибки — `{ error: { code, reason } }`. Все тела проверяются `zbody`/`zquery`. Пути относительно `/api`.

### 4.1. Вебхуки (INT-05) — глобальный администратор (`requireGlobalAdmin`), токены запрещены

| Метод и путь | Тело / query | Ответ | Ошибки |
|---|---|---|---|
| `GET /integrations/config` | — | `{ webhooksEnabled, allowHttp, allowedTargets: string[] }` | — |
| `GET /projects/:projectId/webhooks` | — | `WebhookDto[]` | 404 |
| `POST /projects/:projectId/webhooks` | `WebhookCreateBody { name, url, events[] }` | 201 `{ webhook: WebhookDto, secret }` | `WEBHOOKS_DISABLED` 409, `WEBHOOK_TARGET_NOT_ALLOWED` 400, `WEBHOOK_LIMIT` 409, `VALIDATION` 400 |
| `PATCH /projects/:projectId/webhooks/:id` | `{ name?, url?, events?, state?: "active" \| "paused" }` | `WebhookDto` | те же; `active` из `disabled` сбрасывает счётчики |
| `DELETE /projects/:projectId/webhooks/:id` | — | 204 | 404 |
| `POST …/webhooks/:id/rotate-secret` | — | `{ secret, previousValidUntil }` | 404 |
| `POST …/webhooks/:id/ping` | — | 202 `{ deliveryId }` | `WEBHOOKS_DISABLED`, `WEBHOOK_NOT_ACTIVE` 409 |
| `GET …/webhooks/:id/deliveries` | `?state=&cursor=&limit≤100` | `{ items: WebhookDeliveryDto[], nextCursor }` | 404 |
| `GET …/webhooks/:id/deliveries/:deliveryId` | — | `WebhookDeliveryDetailDto` (тело запроса, заголовки без подписи, выдержка ответа) | 404 |
| `POST …/webhooks/:id/deliveries/:deliveryId/redeliver` | — | 202 `{ deliveryId }` | `WEBHOOK_NOT_ACTIVE` 409 |
| `POST …/webhooks/:id/redeliver-failed` | `{ since?: ISO }` (не раньше 7 суток; без поля — 24 ч по часам БД) | 202 `{ count }` (≤ 1000) | `WEBHOOK_NOT_ACTIVE` 409 |

```ts
WebhookDto = { id, projectId, name, urlDisplay, events: WebhookEventType[], state: "active"|"paused"|"disabled",
  disabledReason: "failing"|"gone"|"secret_unavailable"|null, failureStreak, lastSuccessAt, lastFailureAt,
  secretRotatedUntil: string|null, createdAt, updatedAt }
WebhookDeliveryDto = { id, eventId, eventType, issueKey, state, attempts, nextAttemptAt, lastStatus, lastError,
  lastDurationMs, manual, createdAt, updatedAt }
```

`LIMITS.webhook = { name: 80, url: 2048, perProject: 10, total: 100 }` — зеркало в `src/validation.ts`.

### 4.2. API-токены и сервисные записи (INT-07)

| Метод и путь | Кто | Тело | Ответ | Ошибки |
|---|---|---|---|---|
| `GET /me/tokens` | сессия | — | `ApiTokenDto[]` | `TOKEN_NOT_ALLOWED` 403 при токене |
| `POST /me/tokens` | сессия; не сервисная запись | `{ name, scope, expiresInDays: 1–365 }` | 201 `{ token: ApiTokenDto, secret }` | `TOKEN_LIMIT` 409 |
| `DELETE /me/tokens/:id` | сессия, владелец | — | 204 | 404 |
| `GET /admin/service-accounts` | глоб. админ | — | `ServiceAccountDto[]` | — |
| `POST /admin/service-accounts` | глоб. админ | `{ username, name }` | 201 `ServiceAccountDto` | `CONFLICT` 409 (логин занят) |
| `PATCH /admin/service-accounts/:id` | глоб. админ | `{ name?, isActive? }` | `ServiceAccountDto` | 404 |
| `GET/POST /admin/service-accounts/:id/tokens`, `DELETE …/tokens/:tokenId` | глоб. админ | как у `/me/tokens` | | `TOKEN_LIMIT` |
| `GET /admin/tokens` | глоб. админ | `?userId=&active=1` | `ApiTokenAdminDto[]` (с владельцем) | — |
| `DELETE /admin/tokens/:id` | глоб. админ | — | 204 | 404 |

```ts
ApiTokenDto = { id, name, prefix, scope: "read"|"write", createdAt, expiresAt, lastUsedAt, revokedAt }
ServiceAccountDto = { id, username, name, isActive, createdAt, projects: { projectId, role }[], activeTokens: number }
```

Проверка в `requireAuth`: `401 UNAUTHORIZED` на любой неверный, истёкший или отозванный токен, без уточнения
причины (уточнение — только в метрике и аудите). `LIMITS.apiToken = { name: 80, perUser: 10, perService: 5, maxDays: 365 }`.

### 4.3. Повторяющиеся задачи (INT-11)

| Метод и путь | Право | Тело | Ответ | Ошибки |
|---|---|---|---|---|
| `GET /recurring/config` | любой вошедший | — | `{ enabled, defaultTimeZone }` (`DUE_REMINDER_TZ`) | |
| `GET /projects/:projectId/recurring` | `browse` | — | `RecurringRuleDto[]` | |
| `POST /projects/:projectId/recurring` | `manageRecurring` | `RecurringRuleBody` | 201 `RecurringRuleDto` | `RECURRING_LIMIT` 409, `VALIDATION`, `CONFLICT` (имя) |
| `PATCH …/recurring/:id` | `manageRecurring` | частичное `RecurringRuleBody` | `RecurringRuleDto` (владелец := вызывающий) | |
| `DELETE …/recurring/:id` | `manageRecurring` | — | 204 | |
| `POST …/recurring/:id/pause` / `resume` | `manageRecurring` | — | `RecurringRuleDto` | |
| `POST …/recurring/:id/run-now` | `manageRecurring` | — | 201 `RecurringRunDto` | `RECURRING_ALREADY_RAN` 409 (в эту минуту уже был запуск) |
| `POST …/recurring/preview` | `browse` | `{ schedule, timeOfDay, timeZone, startDate }` | `{ next: string[] }` (5 ISO) | `VALIDATION` |
| `GET …/recurring/:id/runs` | `browse` | `?limit≤100` | `RecurringRunDto[]` | |
| `DELETE …/issue-templates/:id` (изменение) | `editWorkflow` | — | 204 | **новый** `TEMPLATE_IN_USE` 409 |

```ts
RecurrenceSchedule = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("daily"), every: z.number().int().min(1).max(30) }),
  z.object({ kind: z.literal("weekly"), every: z.number().int().min(1).max(12),
             weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7) }),   // 1 = понедельник
  z.object({ kind: z.literal("monthly"), every: z.number().int().min(1).max(12),
             day: z.union([z.number().int().min(1).max(31), z.literal("last")]) }),
]);
RecurringRuleBody = { name, templateId, title?: string|null, schedule, timeOfDay: "HH:MM", timeZone: IANA,
  startDate: "YYYY-MM-DD", assigneeIds: string[] (≤ 10), dueInDays: number|null, skipIfOpen: boolean }
RecurringRuleDto = RecurringRuleBody & { id, projectId, ownerId, state, pausedReason, nextRunAt, lastRunAt,
  lastResult: "created"|"skipped_open"|"failed"|null, createdAt, updatedAt }
RecurringRunDto = { id, scheduledFor, ranAt, result, manual, missedCount, issueId, issueKey, errorCode }
```

`LIMITS.recurring = { name: 80, perProject: 50, assignees: 10 }`.

### 4.4. Состояние системы (INT-14) — глобальный администратор, токены запрещены

`GET /admin/status` → `SystemStatusDto`:

```ts
StatusState = z.enum(["ok", "warn", "fail", "off", "unknown"]);
SystemCheck = z.discriminatedUnion("id", [
  z.object({ id: z.literal("database"), state, facts: z.object({ latencyMs: z.number().nullable(), pendingMigrations: z.array(z.string()) }) }),
  z.object({ id: z.literal("storage"), state, facts: z.object({ driver: z.enum(["local", "s3"]), freeBytes: z.number().nullable(), totalBytes: z.number().nullable() }) }),
  z.object({ id: z.literal("mail"), state, facts: z.object({ enabled: z.boolean(), pending: z.number(), oldestPendingSec: z.number().nullable(), failed24h: z.number() }) }),
  z.object({ id: z.literal("ldap"), state, facts: z.object({ mode: z.enum(["local", "ldap"]), lastSuccessAt: z.string().nullable(), lastError: z.string().nullable() }) }),
  z.object({ id: z.literal("jobs"), state, facts: z.object({ jobs: z.array(z.object({ name: z.string(), lastSuccessAt: z.string().nullable(), lastResult: z.string().nullable(), intervalMs: z.number() })) }) }),
  z.object({ id: z.literal("license"), state, facts: z.object({ status: z.string(), expiresAt: z.string().nullable(), seatsUsed: z.number().nullable(), seatsLimit: z.number().nullable() }) }),
  z.object({ id: z.literal("search"), state, facts: z.object({ missingIndexes: z.array(z.string()) }) }),
  z.object({ id: z.literal("backup"), state, facts: OpsFacts }),
  z.object({ id: z.literal("restoreDrill"), state, facts: OpsFacts }),
  z.object({ id: z.literal("webhooks"), state, facts: z.object({ enabled: z.boolean(), active: z.number(), disabled: z.number(), pending: z.number(), oldestPendingSec: z.number().nullable(), failed24h: z.number() }) }),
  z.object({ id: z.literal("recurring"), state, facts: z.object({ active: z.number(), paused: z.number(), ownerLostAccess: z.number(), failed24h: z.number() }) }),
]);
OpsFacts = z.object({ lastSuccessAt: z.string().nullable(), lastRunAt: z.string().nullable(),
  lastResult: z.enum(["running", "success", "failure", "interrupted"]).nullable(), archive: z.string().nullable() });
SystemStatusDto = { version, checkedAt, checks: SystemCheck[] }   // порядок как в union
```

Правила состояний — в INT-14. `GET /admin/ops-runs?kind=&limit≤50` → `OpsRunDto[]`.

### 4.5. Новые коды ошибок

`WEBHOOKS_DISABLED`, `WEBHOOK_TARGET_NOT_ALLOWED`, `WEBHOOK_LIMIT`, `WEBHOOK_NOT_ACTIVE`, `TOKEN_NOT_ALLOWED`,
`TOKEN_SCOPE`, `TOKEN_LIMIT`, `RECURRING_LIMIT`, `RECURRING_ALREADY_RAN`, `TEMPLATE_IN_USE`. Каждый — ключ
`apiError.*` в обоих словарях в том же тикете, где код появляется на сервере.

## 5. Схема доставки событий

```
 маршрут (PATCH / transition / comment / bulk / recurring)
   └─ BEGIN … INSERT activity|comments ──trigger──▶ integration_events (склейка по tx) … COMMIT
                                                          │  (ничего, если в проекте нет активных подписок)
 задание webhook-dispatch, тик раз в WEBHOOK_POLL_MS (2 с), advisory-лок тика
   1. раскладка: SELECT … WHERE dispatched_at IS NULL ORDER BY id LIMIT 500 FOR UPDATE SKIP LOCKED
        → payload v1 → INSERT webhook_deliveries (подписки проекта, state='active', type ∈ events)
          ON CONFLICT (webhook_id, event_id) WHERE NOT manual DO NOTHING → dispatched_at = now()   [одна транзакция]
   2. отправка: UPDATE … SET state='sending', locked_until=now()+60s, attempts=attempts+1
          WHERE id IN (SELECT … WHERE (state='pending' OR (state='sending' AND locked_until < now()))
                       AND next_attempt_at <= now() ORDER BY next_attempt_at LIMIT 16 FOR UPDATE SKIP LOCKED)
        → HTTP вне транзакции (≤ 4 одновременно на подписку, ≤ 16 всего)
        → succeeded | pending (+backoff) | failed | cancelled; счётчики подписки
   3. повторять 1–2, пока есть работа и прошло < 10 с; затем ждать следующего тика
 задание due-events (раз в 10 мин): issue.due для открытых неархивных задач со сроком «сегодня»
   в DUE_REMINDER_TZ, только в проектах с подпиской на issue.due; dedupe_key 'due:<issue>:<date>'
```

**Гарантии.**
- *Не потерять.* Событие коммитится вместе с изменением. Раскладка помечает событие только в той же транзакции, где
  вставлены доставки. Отправка завершается записью результата. Если процесс упал в любой точке, после аренды
  (`locked_until`) или при следующем тике работа подбирается снова.
- *Не задублировать.* Раскладка повторно не создаёт доставку (уникальный индекс). Отправка может повториться
  только при падении между HTTP-ответом и записью результата. Для этого в каждом запросе есть
  `X-Taskira-Event-Id` (стабилен для события) и `X-Taskira-Delivery` (стабилен для доставки, меняется при ручном
  повторе). Получатель хранит обработанные `event_id` хотя бы 48 часов.
- *Порядок* не гарантируется: повторы и параллельные отправки переставляют события. Для упорядочивания есть
  `sequence` (порядок вставки, не порядок коммита) и `occurredAt`.
- Подписка, созданная после события, его не получает. Подписка на паузе или отключённая при раскладке — тоже не
  получает: ручного «догнать» для таких событий нет.

**Тело (версия 1)** — `Content-Type: application/json; charset=utf-8`:

```json
{
  "version": 1,
  "id": "1b5c2f0e-…",
  "sequence": 18342,
  "type": "issue.statusChanged",
  "occurredAt": "2026-10-04T09:15:02.123Z",
  "instance": { "name": "Taskira", "url": "https://taskira.example" },
  "project": { "id": "…", "key": "CORP" },
  "issue": { "id": "…", "key": "CORP-42", "url": "https://taskira.example/p/CORP/issue/CORP-42" },
  "actor": { "id": "…", "username": "ivanov", "kind": "user" },
  "changes": [ { "field": "status", "from": { "id": "…", "name": "В работе" }, "to": { "id": "…", "name": "Готово" } } ],
  "data": {}
}
```

Изменения строит `buildChanges()` по белому списку для каждого `kind` истории. Тексты задач не попадают в тело
никогда:

| kind истории | элемент `changes` |
|---|---|
| `created` | — (пустой список) |
| `renamed`, `description`, `labels`, `direction` | `{ field: "title" \| "description" \| "labels" \| "epicId" }` без значений |
| `priority`, `complexity`, `due` | `{ field: "priority" \| "complexity" \| "dueDate", from, to }` |
| `parent` | `{ field: "parentId", set }` |
| `status` | `{ field: "status", from: { id, name }, to: { id, name } }` (`id` — из `fromId`/`toId`, INT-01) |
| `assigneeAdded` / `assigneeRemoved` | `{ field: "assignees", added: [userId] }` / `{ removed: [userId] }` |
| `assigneeBulk` | `{ field: "assignees", cleared, userId }` |
| `checklistAdded`, `checklistRemoved` | `{ field: "checklist" }` без текста пункта |
| `link` | `{ field: "links", type, key }` |

`bulk: true` из истории переносится в элемент. `actor` — `null` у системных событий (`issue.due`), `kind: "service"`
у сервисной записи. `instance.url` и `issue.url` — из `APP_BASE_URL`; если не задан, то `null`. `data` для
`issue.commented` — `{ commentId }`, для `issue.due` — `{ dueDate }`, для `ping` — `{}`.

**Заголовки**: `User-Agent: Taskira-Webhooks/<version>`, `X-Taskira-Event: <type>`, `X-Taskira-Event-Id`,
`X-Taskira-Delivery`, `X-Taskira-Webhook-Version: 1`, `X-Taskira-Signature: t=<unix>,v1=<hex>[,v1=<hex прежнего секрета>]`.
Подпись — `HMAC_SHA256(secret, t + "." + rawBody)`. Проверка у получателя (в справке и `server/README.md`):

```js
const [t, ...sigs] = header.split(",");                 // t=…, v1=…
const ts = Number(t.slice(2));
if (Math.abs(Date.now() / 1000 - ts) > 300) reject();
const expected = crypto.createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex");
if (!sigs.some((s) => crypto.timingSafeEqual(Buffer.from(s.slice(3), "hex"), Buffer.from(expected, "hex")))) reject();
```

**Версионирование**: добавление полей и новых `field` в `changes` — без смены версии; получатель обязан
игнорировать незнакомое. Удаление или смена смысла поля — `version: 2` и выбор версии в подписке, отдельным ADR.

## 6. Безопасность — модель угроз

| Угроза | Мера | Проверка (тест) |
|---|---|---|
| SSRF: адрес на loopback, metadata (169.254.169.254), служебную сеть compose, БД | Allowlist оператора + неотключаемый denylist; проверка всех адресов DNS-ответа; IPv4-mapped IPv6, десятичные/восьмеричные записи IP нормализуются через `net.isIP`/WHATWG URL | INT-03: таблица случаев `checkTarget()` |
| DNS rebinding (проверили один адрес — подключились к другому) | Повторная проверка перед каждой попыткой; соединение на проверенный адрес через свой `lookup`; `Host`/SNI — исходное имя | INT-04: резолвер возвращает разные адреса на 1-й и 2-й вызов → `target_blocked` |
| Редирект на внутренний адрес | Редиректы не выполняются, 3xx = `redirect` (повтора нет) | INT-04 |
| Медленный или огромный ответ держит воркер | Таймаут соединения 5 с, общий 10 с; чтение ответа ≤ 64 КБ, затем обрыв; ≤ 4 одновременно на подписку | INT-04 |
| Прокси из окружения отправляет запрос мимо проверки | `HTTP(S)_PROXY` не используется (свой `http.Agent`, не глобальный fetch) | INT-04 |
| Утечка секрета подписи | Секрет показывается один раз; хранится зашифрованным; смена с окном 24 ч; в журнале доставок заголовок подписи не хранится | INT-05 |
| Утечка URL с токеном получателя в query | URL зашифрован; наружу только `urlDisplay` без query и userinfo; аудит пишет `urlDisplay` | INT-05: grep по `audit_log.details` и логам |
| Повтор перехваченного запроса | Подпись включает время; получатель отвергает старше 5 минут; `X-Taskira-Event-Id` для дедупликации | документация + INT-04 (формат подписи) |
| Утечка содержимого задач во внешнюю систему | Тонкое тело, белый список полей; управление — только глобальный администратор | INT-04: снимок тела на все `kind` |
| Перебор API-токена | 256 бит секрета; поиск по префиксу, сравнение хеша постоянного времени; лимитер даёт ключ `token:<prefix>` только проверенному токену из кэша, иначе IP — случайные префиксы не обходят IP-лимит; метрика `invalid` | INT-06 |
| Кража токена из логов | Fastify-логгер редактирует `authorization`; `support-bundle.sh` вырезает Bearer (уже есть) — дополнить шаблоном `tsk_` | INT-06, INT-16 |
| Эскалация прав токеном | Токен = права пользователя **как участника**: `globalRole` запроса с токеном всегда `member` (иначе `resolveRole` и инлайн-проверки дали бы токену администратора власть `admin` во всех проектах); `requireGlobalAdmin` отвергает любой токен; `read` — только `GET/HEAD`; маршруты токенов и WS — только сессия; сервисная запись не может быть `admin` (CHECK) | INT-06: матрица «метод × scope × маршрут» |
| Токен уволенного сотрудника | Деактивация → `is_active=false` → токен отвергается (кэш ≤ 30 с, при отзыве — сразу) | INT-06 |
| Повторяющаяся задача от имени потерявшего доступ | Проверка `create` владельца перед каждым запуском; иначе пауза | INT-11 |
| Восстановленная копия рассылает письма и вебхуки | Репетиция: все исходящие функции выключены, сеть `internal: true` | INT-13 |
| Подмена отчёта бэкапа | `ops_runs` пишет только тот, у кого есть доступ к БД (хост); API таблицу только читает | — |

Что **не** защищается: получатель, который не проверяет подпись; компрометация хоста с `.env`
(`WEBHOOK_SECRET_KEY`, `JWT_SECRET`) — это граница доверия всей инсталляции.

## 7. Клиент

| Экран | Где в IA (`docs/design/IA.md` §3) | Адрес | Кто видит |
|---|---|---|---|
| Интеграции проекта (вебхуки, журнал доставок) | Проект → «Интеграции» (`integrations`), рядом с «Модули» | `/p/:key/settings/integrations` | глобальный администратор (`ADMIN_ONLY_PROJECT`) |
| Повторяющиеся задачи | Проект → «Повторяющиеся» (`recurring`), после «Шаблоны задач» | `/p/:key/settings/recurring` | все участники; правка — `manageRecurring` |
| API-токены | Личные → «API-токены» (`tokens`) | `/settings/tokens` | все, кроме сервисных записей |
| Сервисные учётные записи | Организация → «Сервисные записи» (`service-accounts`) | `/admin/service-accounts` | глобальный администратор |
| Состояние системы | Организация → «Состояние системы» (`health`, существующий) | `/admin/health` | глобальный администратор |

Общие требования ко всем экранам:
- **Загрузка** — `Loading` из `parts.tsx` (как в `OrgSettings`). **Ошибка** — `Failed` с «Повторить». **Пусто** —
  одна строка-объяснение и основное действие («Добавить вебхук», «Создать правило»). Если функция выключена в env
  (`WEBHOOKS_ENABLED=false`), экран интеграций показывает объяснение, тег `env` и имя переменной, без формы.
- **Секрет один раз**: после создания вебхука или токена — `Dialog` с полем только для чтения, кнопкой «Копировать»
  и текстом «Больше не покажем». Закрытие требует подтверждения галочкой «Я сохранил(а)».
- **Журнал доставок** — `SidePanel` со списком (состояние тегом с текстом, а не только цветом; код ответа; время;
  попытки). Детали доставки — тело запроса в моноширинном блоке (`--font-code`), выдержка ответа. Кнопки «Повторить»
  и «Повторить неудачные за 24 ч».
- **Форма правила**: шаблон (нативный `<select>`, как в `WorkflowView.tsx`), название с подсказкой `{date}`; расписание — сегменты «Ежедневно / Еженедельно /
  Ежемесячно» (`Tabs`), «каждые N», дни недели (группа переключателей с `aria-pressed`), число месяца или
  «последний день»; время, часовой пояс (`Combobox` по `Intl.supportedValuesOf("timeZone")`, по умолчанию пояс
  инсталляции из `GET /recurring/config`), дата начала (`DatePicker`); исполнители (`Combobox` над
  `usersApi.pickable`); «срок через N дней»; «не создавать, если предыдущая открыта». Ниже — «Ближайшие запуски»
  из `POST …/recurring/preview` (debounce 300 мс) и «История запусков».
- **Состояние системы**: карточка на каждую проверку — название, тег состояния текстом («В порядке» / «Внимание» /
  «Сбой» / «Выключено» / «Нет данных»), 1–3 факта, ссылка в раздел, где это чинится (Обслуживание, Лицензия,
  Интеграции проекта, документация по таймеру бэкапа). Сначала `fail`, затем `warn`. Автообновления нет — кнопка
  «Обновить».
- **Доступность**: формы с `label`; состояние не только цветом; фокус после закрытия `Dialog` возвращается на
  кнопку; журнал — таблица с заголовками колонок; кнопки-иконки с `aria-label`.
- **i18n**: ключи в блоке `// трек L`: `settings.section.integrations`, `settings.section.recurring`,
  `settings.section.tokens`, `settings.section.serviceAccounts`, `integrations.*`, `webhook.event.*` (6 типов),
  `webhook.state.*`, `webhook.error.*` (коды `last_error`), `tokens.*`, `serviceAccounts.*`, `recurring.*`,
  `recurring.schedule.*`, `recurring.result.*`, `status.check.*` (11 проверок), `status.state.*`, `status.fact.*`,
  `activity.createdByRule`, `apiError.*` (§4.5). Плюралы — через `tn`.

## 8. Наблюдаемость

**Метрики** (`server/src/metrics.ts`, без меток проекта и подписки — ограниченная кардинальность):

| Метрика | Тип | Метки |
|---|---|---|
| `taskira_integration_events_total` | counter | `type` |
| `taskira_webhook_deliveries_total` | counter | `result` = `succeeded` / `retry` / `failed` / `cancelled` |
| `taskira_webhook_delivery_duration_seconds` | histogram | — |
| `taskira_webhook_queue_size`, `taskira_webhook_queue_oldest_age_seconds` | gauge (при scrape) | — |
| `taskira_integration_outbox_undispatched` | gauge (при scrape) | — |
| `taskira_webhooks` | gauge (при scrape) | `state` |
| `taskira_webhook_target_blocked_total` | counter | `reason` = `not_allowed` / `denied_range` / `dns` |
| `taskira_api_token_auth_total` | counter | `result` = `success` / `invalid` / `expired` / `revoked` / `scope_denied` / `route_denied` |
| `taskira_recurring_runs_total` | counter | `result` |
| `taskira_recurring_lag_seconds` | histogram | — |
| `taskira_ops_last_success_timestamp_seconds` | gauge (при scrape) | `kind` = `backup` / `restore_drill` |
| `taskira_ops_last_run_success` | gauge 0/1 (при scrape) | `kind` |

Задания `webhook-dispatch`, `due-events`, `recurring` пишут `recordBackgroundJob()` и видны в `GET /api/maintenance`.
Примеры правил оповещения (в `docs/OPERATIONS.md`): очередь вебхуков старше 15 минут; нет успешного бэкапа 26 ч; нет
успешной репетиции 8 суток.

**Аудит** (`audit_log`, без секретов и полного URL):
`webhook.create|update|delete|rotate_secret|ping|redeliver|disabled` (у `disabled` нет актора, `details.reason`),
`token.create|revoke` (`details: { tokenId, prefix, scope, ownerId }`), `token.denied` (`scope` / `route`, не чаще
раза в минуту на токен), `service_account.create|update`, `recurring.create|update|delete|pause|resume|run_now`,
`recurring.auto_pause` (без актора). Любое действие, выполненное токеном, получает `details.via = "token"` и
`details.tokenId` (общий хелпер в `audit.ts`, читает `req.authToken`).

**Что видит администратор**: экран состояния (сводка) → раздел-источник (журнал доставок, правило с историей
запусков, обслуживание). История задачи показывает «создал(а) задачу по расписанию «…»».

## 9. Производительность

**Оценка нагрузки** (крупная инсталляция из `docs/PERFORMANCE.md`: ~2 000 пользователей, 100 проектов, 50 000
активных задач):
- Строк истории — порядка 100 000 в сутки, в среднем ~1,2/с. Пик рабочего часа ×10 — ~12/с. Массовая операция —
  всплеск до 1 000 строк за запрос.
- Подписок — до 100 на инсталляцию, обычно 1–3 на проект и только в части проектов. Доставок в пике — ~12–40/с.
  Пропускная способность одной подписки при ответе получателя 200 мс — ~20/с (4 одновременно).
- Массовая операция на 1 000 задач по проекту с одной подпиской — 1 000 доставок. При 200 мс на ответ это ~50 с
  до опустошения очереди.
- Токены: проверка — один индексный поиск по `prefix`; результат кешируется на 30 с, как свежесть пользователя.
  `last_used_at` пишется не чаще раза в минуту.
- Повторяющиеся задачи: до 50 × 100 = 5 000 правил, запуск не чаще раза в сутки — пренебрежимо.

**Горячие пути.** `PATCH issue`, `transition`, комментарий: триггер на каждую строку истории делает поиск задачи
по PK и `EXISTS` по частичному индексу `idx_webhooks_project_active`. При подписке добавляется вставка или склейка
в `integration_events`. Бюджет: **p50 +≤ 1 мс, p99 +≤ 3 мс** на `PATCH` и `transition` относительно `main`.

**Что измерять (INT-02 и INT-04, результаты в `docs/PERFORMANCE.md`, раздел «Интеграции»):**
1. `server/scripts/performance-load.mjs` на стенде 50 000 задач, сценарий `PATCH` + `transition`: `main` /
   ветка без подписок / ветка с 3 подписками в проекте. p50/p95/p99.
2. Массовая операция на 1 000 задач с подпиской: время запроса до и после, число строк `integration_events`.
3. Опустошение очереди 10 000 доставок локальным приёмником с задержкой 50 мс: время, CPU процесса, p99 API во время
   опустошения.
4. `EXPLAIN (ANALYZE, BUFFERS)` запросов раскладки и захвата при 100 000 строк в журнале: только индексы.

## 10. Документация

| Файл | Что | Тикет |
|---|---|---|
| `server/README.md` | маршруты §4, формат тела и подписи, env-переменные | в тикете маршрутов (INT-05, 07, 11, 14) + сводка INT-16 |
| `server/.env.example` | `WEBHOOKS_ENABLED`, `WEBHOOK_ALLOWED_TARGETS`, `WEBHOOK_DENY_CIDRS`, `WEBHOOK_ALLOW_HTTP`, `WEBHOOK_SECRET_KEY`, `WEBHOOK_POLL_MS`, `WEBHOOK_LOG_RETENTION_DAYS`, `RECURRING_ENABLED` | INT-03, INT-11 |
| `docker-compose.yml`, `scripts/render-compose.sh` | проброс новых переменных; `WEBHOOK_DENY_CIDRS` по умолчанию = `TASKIRA_NETWORK_CIDR` | INT-03 |
| `CLAUDE.md` | раздел «Integrations» (outbox-триггер, правило «событие = строка истории», токены, правила, `ops_runs`) | INT-16 |
| `docs/OPERATIONS.md` | вебхуки (allowlist, ключ, ротация), таймер репетиции, правила оповещения, экран состояния | INT-13, INT-16 |
| `docs/SECURITY_OVERVIEW.md` | «Сеть» (вебхуки), «Аутентификация» (токены), таблица экспорта | INT-16 |
| `docs/PERMISSIONS.md` | генерируется (`manageRecurring`) | INT-11 |
| `docs/MIGRATION-LIST.md`, `docs/API-SCHEMAS.md` | генерируются | каждый тикет с миграцией или контрактом |
| `src/components/DocsView.tsx` (справка RU/EN) | разделы «Повторяющиеся задачи», «API-токены», «Интеграции» | INT-16 |
| `docs/design/IA.md` | новые разделы настроек в таблицах §3 | INT-16 |

## 11. Автоматизации по правилам — только проект (реализации в треке нет)

**Как ложатся на события.** Автоматизация — второй потребитель `integration_events` после вебхуков. Тик
`webhook-dispatch` раскладывает событие и в доставки, и в выполнения правил. Чтобы события писались и в проектах без
вебхуков, условие триггера расширяется до «есть активная подписка **или** активное правило автоматизации».

```sql
automation_rules (id, project_id, kind, params jsonb, owner_id, state, created_at, updated_at)
automation_runs  (id, rule_id, event_id, result, error_code, created_at, UNIQUE (rule_id, event_id))
```

- **Закрытый список правил** — zod-union `AutomationRule` в `contract.ts`, как виджеты дашбордов (ADR-0022).
  Параметры — идентификаторы статусов, людей и меток проекта. Условий «и/или», выражений и скриптов нет.
- **Действия** выполняются теми же сервисами, что и маршруты (`transitionIssue`, `setAssignees`, `emit`), от имени
  владельца правила. Права владельца проверяются перед каждым выполнением, как у повторяющихся задач.
- **Защита от петель**: изменение, сделанное автоматизацией, пишет историю с `origin: "automation"` (новое
  необязательное поле `ActivityEvent`). Потребитель автоматизаций такие события пропускает: глубина 1. Вебхуки
  получают их как обычно.
- **Идемпотентность**: `UNIQUE (rule_id, event_id)` — правило не сработает дважды на одно событие.
- **Право**: переиспользовать `manageRecurring` (admin, manager) — та же возможность «задачи меняются без человека
  от имени менеджера». Подпись права в матрице тогда станет «Правила и расписания». Отдельный `manageAutomations` —
  только если владелец захочет разделить эти возможности.

**Минимальный набор готовых правил:**

| # | Когда | Что сделать | Событие |
|---|---|---|---|
| A1 | Все подзадачи закрыты | Перевести родителя в статус X (если переход разрешён схемой; иначе запись `skipped`) | `issue.statusChanged` подзадачи |
| A2 | Задача перешла в статус X | Назначить исполнителя Y и/или добавить наблюдателя | `issue.statusChanged` |
| A3 | Создана задача типа T или с меткой L | Назначить ответственного и/или выставить приоритет | `issue.created` |
| A4 | Закрыта задача, которая блокирует другие | Уведомить исполнителей заблокированных задач | `issue.statusChanged` + `issue_links` |
| A5 | Наступил срок, задача открыта | Поднять приоритет до «высокий» и/или уведомить менеджеров проекта | `issue.due` |
| A6 | Задача стоит в статусе X дольше N дней | Уведомить исполнителей | новое плановое событие `issue.stale` (отдельное задание) |

Для A4–A6 нужны новые типы уведомлений: CHECK `notifications_type_check`, шаблоны писем и `MAIL_STRINGS`.

## 12. Тикеты и порядок

Каждый тикет `docs/tickets/INT-NN-*.md` содержит: цель, файлы, зависимости, задание, тесты, критерии приёмки
командами, что не входит, риски и откат. Порядок: миграции и ядро → API → клиент → документация.

| # | Тикет | Зависит от | Слой |
|---|---|---|---|
| INT-01 | [ActivityEvent: идентификаторы в событиях статуса и исполнителей](../tickets/INT-01-activity-event-ids.md) | — | ядро |
| INT-02 | [Миграция: outbox событий, вебхуки, доставки, триггеры](../tickets/INT-02-integration-outbox-migration.md) | INT-01 | миграция |
| INT-03 | [Конфигурация, шифрование секретов, проверка целей (SSRF)](../tickets/INT-03-egress-guard-secret-box.md) | — | ядро |
| INT-04 | [Раскладка и доставка вебхуков, подпись, повторы, автоотключение, issue.due](../tickets/INT-04-webhook-dispatcher.md) | INT-02, INT-03 | ядро |
| INT-05 | [API вебхуков](../tickets/INT-05-webhooks-api.md) | INT-04 | API |
| INT-06 | [Миграция и проверка API-токенов, сервисные записи](../tickets/INT-06-api-tokens-core.md) | — | миграция + ядро |
| INT-07 | [API токенов и сервисных записей](../tickets/INT-07-api-tokens-routes.md) | INT-06 | API |
| INT-08 | [Клиент: интеграции проекта](../tickets/INT-08-client-integrations.md) | INT-05 | клиент |
| INT-09 | [Клиент: API-токены и сервисные записи](../tickets/INT-09-client-tokens.md) | INT-07 | клиент |
| INT-10 | [Миграция правил, расчёт расписания, выделение createIssueTx](../tickets/INT-10-recurring-core.md) | — | миграция + ядро |
| INT-11 | [Задание и API повторяющихся задач, право manageRecurring](../tickets/INT-11-recurring-api.md) | INT-10 | API |
| INT-12 | [Клиент: повторяющиеся задачи](../tickets/INT-12-client-recurring.md) | INT-11 | клиент |
| INT-13 | [ops_runs, отчёт бэкапа, restore-drill.sh](../tickets/INT-13-ops-runs-restore-drill.md) | — | миграция + скрипты |
| INT-14 | [GET /api/admin/status и метрики операций](../tickets/INT-14-status-api.md) | INT-13 (INT-04, INT-11 — если влиты; иначе проверка `off`) | API |
| INT-15 | [Клиент: экран состояния](../tickets/INT-15-client-status.md) | INT-14 | клиент |
| INT-16 | [Документация трека](../tickets/INT-16-docs.md) | все | документация |

Три независимые цепочки: вебхуки (01→02→03→04→05→08), токены (06→07→09), правила (10→11→12) и операции
(13→14→15). Их можно вести параллельно. INT-03 и INT-06 не зависят ни от чего.
**Выпуск**: всё за выключенными по умолчанию функциями (`WEBHOOKS_ENABLED=false`, `RECURRING_ENABLED=true`, но
правил нет). Каждый тикет можно влить отдельно; откат — revert PR, миграции остаются (expand), таблицы пустеют
сами по сроку хранения.

## 13. Решения владельца продукта

Все рекомендации приняты владельцем 2026-10-04. Ниже — решения, обязательные для исполнителя; открытых вопросов в
треке нет. Пересмотр любого пункта — новым решением владельца, не по ходу реализации.

| # | Вопрос | Решение |
|---|---|---|
| 1 | Нужны ли в теле вебхука название задачи и текст комментария (режим «полное тело» на подписку)? | Нет. Тело тонкое (§5). Флаг `includeContent` — только новым решением владельца с записью в `SECURITY_OVERVIEW` |
| 2 | Должны ли менеджеры проекта управлять вебхуками сами? | Нет: управляет только глобальный администратор |
| 3 | Административный scope токена (выгрузка аудита в SIEM без сессии)? | Не в треке L. Следующим треком — scope `audit:read` только для сервисной записи |
| 4 | Считать ли сервисные записи местами лицензии? | Нет: сервисные записи не входят в систему и в `countActiveSeats` не попадают |
| 5 | Письмо администраторам при отключении вебхука, паузе правила, провале репетиции? | Нет: сигнал — экран состояния, метрики и код возврата скриптов |
| 6 | Политика догоняния: одна задача или выбор на правиле («все» / «одна» / «ни одной»)? | Одна догоняющая задача, без выбора на правиле |
| 7 | События удаления задачи, вложений, наблюдателей? | Не в треке L. По запросу интеграторов — каждое новым членом `ActivityEvent` |
| 8 | Входит ли трек в лицензионный план (`requiresPlan("integrations")`)? | Не гейтить: `requiresPlan` к маршрутам трека не подключать |
| 9 | Разрешить HTTP (без TLS) к внутренним системам? | Только при `WEBHOOK_ALLOW_HTTP=true` у оператора; по умолчанию выключено |

## 14. Что исполнителю проверить вручную

1. Вебхук на локальный приёмник (`nc -l` или `scripts/` из INT-04): создать, получить `ping`, подвигать задачу на
   доске, оставить комментарий. Проверить подпись по примеру из §5 и склейку PATCH нескольких полей в одно событие.
2. Остановить приёмник на 2 минуты: доставки уходят в повтор; приёмник вернулся — очередь опустела.
   Адрес вне allowlist → форма показывает понятную ошибку на RU и EN.
3. Сменить секрет: в течение окна приходят две подписи.
4. Персональный токен `read`: `curl -H "Authorization: Bearer tsk_…" /api/projects` → 200; `POST` → 403
   `TOKEN_SCOPE`; `/api/admin/export` → 403 `TOKEN_NOT_ALLOWED`; отзыв → 401 сразу.
5. Сервисная запись: добавить в проект ролью «сотрудник», создать токен `write`, создать задачу через API. Автор в
   истории — сервисная запись с меткой; в выборе исполнителей её нет.
6. Правило «еженедельно, пн, 09:00» с `{date}` в названии. «Запустить сейчас» → задача создана, в истории «по
   расписанию». Остановить сервер, сдвинуть `next_run_at` в прошлое на 3 наступления, запустить — создана одна
   задача, «пропущено 2».
7. Перевод часов: правило на 02:30 в `Europe/Berlin` на дату перехода на летнее время — предпросмотр показывает 03:00.
8. `backup.sh` → карточка «Резервная копия» зелёная; `restore-drill.sh` → «Репетиция» зелёная. Во время прогона
   нет писем и запросов наружу (приёмник вебхука молчит).
9. Экран состояния RU/EN в светлой и тёмной теме, с клавиатуры, axe без нарушений.
