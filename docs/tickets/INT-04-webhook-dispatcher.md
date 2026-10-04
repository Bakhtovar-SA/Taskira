# INT-04 — Раскладка и доставка вебхуков, подпись, повторы, автоотключение, событие срока

**Трек:** [L](../tracks/TRACK-L-INTEGRATIONS.md) · **ADR:** 0028 · **Зависит от:** INT-02, INT-03 · **Блокирует:** INT-05, INT-14

## Цель

События из outbox доходят до подписчиков: at-least-once, с подписью, повторами, журналом и автоотключением.
Задание не мешает API.

## Файлы

Создать:
- `server/src/services/webhookPayload.ts` — `buildChanges()`, `buildPayload()` (чистые функции).
- `server/src/services/webhookHttp.ts` — одна подписанная отправка.
- `server/src/services/webhookDispatch.ts` — раскладка, захват, запись результата, тик.
- `server/src/services/dueEvents.ts` — событие `issue.due`.
- `server/test/webhookPayload.test.ts`, `server/test/webhookDispatch.test.ts`, `server/test/helpers/webhookReceiver.ts`.

Изменить:
- `server/src/services/maintenance.ts` — регистрация заданий `webhook-dispatch` (интервал `cfg.webhooks.pollMs`,
  старт через `startDelayMs` + 20 с) и `due-events` (10 мин). Очистка журнала по сроку хранения пачками, как
  `audit_log`.
- `server/src/index.ts` / `services/shutdown.ts` — остановка заданий при завершении, как у остальных.
- `server/src/metrics.ts` — метрики из трека L §8 (вебхуки, outbox).
- `docs/PERFORMANCE.md` — замер опустошения очереди.

## Задание

### 1. Тело (`webhookPayload.ts`)

- `buildChanges(changes: unknown[])` — по таблице трека L §5. Неизвестный `kind` пропускается, а не роняет
  событие. На вход приходят сырые элементы `integration_events.changes`; каждый проверяется
  `ActivityEvent.safeParse`.
- `buildPayload(row, ctx)` → объект версии 1 из трека L §5. В `ctx` — имя инсталляции (`getBrand()`),
  `APP_BASE_URL`, ключ проекта, `username` и `auth_source` актора. Порядок ключей фиксированный, вывод
  детерминирован (снимок в тесте).

### 2. Раскладка (`fanOut`, одна транзакция)

```sql
SELECT e.* FROM integration_events e WHERE e.dispatched_at IS NULL ORDER BY e.id LIMIT 500 FOR UPDATE SKIP LOCKED
```

Для пачки: собрать `payload` (`UPDATE integration_events SET payload = $2::jsonb` по одному или через `unnest`), затем

```sql
INSERT INTO webhook_deliveries (webhook_id, event_id)
SELECT w.id, e.id FROM integration_events e JOIN webhooks w ON w.project_id = e.project_id
 WHERE e.id = ANY($1) AND w.state = 'active' AND e.type = ANY(w.events)
ON CONFLICT (webhook_id, event_id) WHERE NOT manual DO NOTHING;
UPDATE integration_events SET dispatched_at = now() WHERE id = ANY($1);
```

Событие `ping` раскладывается только в подписку из `data.webhookId`.

### 3. Захват и отправка

- Захват — запрос из трека L §5. Лимиты: 16 на тик, не больше 4 одновременно на подписку (отсекать в коде после
  выборки; лишние вернуть в `pending` без увеличения `attempts`).
- Перед отправкой: `resolveTarget()` (INT-03) **на каждую попытку**, `secretBox.open()` для `url_enc`,
  `secret_enc`, `prev_secret_enc` (если `prev_secret_until > now()`).
- `webhookHttp.send({ url, address, family, body, headers, timeoutMs: 10_000, connectTimeoutMs: 5_000 })`:
  - `node:https`/`node:http` `request` со своим `Agent({ keepAlive: false })` и опцией
    `lookup: (_h, _o, cb) => cb(null, address, family)` — соединение идёт на проверенный адрес;
  - `servername` — исходное имя (SNI), заголовок `Host` — исходный;
  - `HTTP(S)_PROXY` не читается;
  - ответ читается до 64 КБ, дальше `destroy()` и `too_large`;
  - редирект не выполняется (`3xx` → `redirect`);
  - возвращает `{ status, durationMs, excerpt (первые 512 байт как UTF-8 с заменой управляющих символов), error }`.
- Заголовки и подпись — трек L §5. `t` — время текущей попытки (новое при каждом повторе).

### 4. Результат попытки (одна транзакция на доставку)

| Исход | Доставка | Подписка |
|---|---|---|
| 2xx | `succeeded` | `failure_streak = 0`, `failing_since = NULL`, `last_success_at = now()` |
| сеть / таймаут / `dns` / `connect` / `tls` / 408 / 429 / 5xx, `attempts < 8` | `pending`, `next_attempt_at` по расписанию 1 мин, 5 мин, 30 мин, 2 ч, 6 ч, 12 ч, 24 ч (индекс = `attempts`) ±20 %; 429 с `Retry-After` — `min(Retry-After, 1 ч)` | `failure_streak += 1`, `failing_since = COALESCE(failing_since, now())`, `last_failure_at` |
| то же, `attempts = 8` | `failed` | как выше |
| прочие 4xx, `redirect`, `too_large`, `target_blocked` | `failed` сразу | как выше |
| 410 | `failed` | `state = 'disabled'`, `disabled_reason = 'gone'` |
| `secret_unavailable` | `failed` | `disabled`, `secret_unavailable` |

Автоотключение: после записи `failure_streak >= 20 AND failing_since <= now() - interval '24 hours'` →
`state = 'disabled'`, `disabled_reason = 'failing'`. Все `pending`/`sending` доставки подписки → `cancelled`.
`audit(null, "webhook.disabled", "webhook", id, { reason, projectId, urlDisplay })`.

### 5. Тик

`runWebhookDispatchOnce()`: повторять «раскладка → захват/отправка», пока есть работа и прошло < 10 с. Тик
выполняется под `withAdvisoryLock("taskira:job:webhook-dispatch", { wait: false })`, как `runNotifierTick`. При
`!cfg.webhooks.enabled` тик ничего не делает (`skipped`).

### 6. Событие срока (`dueEvents.ts`)

Раз в 10 минут, при `cfg.webhooks.enabled`. Дата — `reminderClock(now, cfg.reminders.timeZone).date`.

```sql
INSERT INTO integration_events (type, project_id, issue_id, issue_key, dedupe_key, data)
SELECT 'issue.due', i.project_id, i.id, i.key, 'due:' || i.id || ':' || $1, jsonb_build_object('dueDate', $1)
  FROM issues i JOIN workflow_statuses s ON s.id = i.status_id
 WHERE i.due_date = $1::date AND i.archived_at IS NULL AND s.category <> 'done'
   AND EXISTS (SELECT 1 FROM webhooks w WHERE w.project_id = i.project_id AND w.state = 'active'
               AND 'issue.due' = ANY(w.events))
 LIMIT 1000
ON CONFLICT (dedupe_key) DO NOTHING
```

Повторять, пока вставлено 1 000.

### 7. Очистка

В `maintenance` (пачками `MAINTENANCE_BATCH_SIZE`):

```sql
DELETE FROM integration_events WHERE occurred_at < now() - make_interval(days => $1)
```

Доставки удаляются каскадом.

## Тесты

`webhookPayload.test.ts`:
- снимок тела для каждого `kind` истории;
- в теле нет `title`, `description`, `text`, `body` ни на одном уровне (рекурсивный обход ключей);
- неизвестный `kind` пропущен;
- `actor = null` для `issue.due`.

`webhookDispatch.test.ts`. Приёмник — `webhookReceiver.ts`: HTTP-сервер на `127.0.0.1:0` с программируемыми
ответами, задержкой и записью запросов; `_allowLoopbackForTests(true)`.
1. Создание задачи → 1 запрос: `X-Taskira-Event: issue.created`, подпись проверяется кодом из трека L §5.
2. Тип не подписан → 0 запросов. Подписка `paused` при раскладке → доставки нет.
3. 500 → `pending`, `attempts = 1`, `next_attempt_at` в окне 48–72 с. Повторный тик с подменой «сейчас» (сдвинуть
   `next_attempt_at` SQL-ом) → `succeeded`.
4. 8 неудач → `failed`. 400 → `failed` сразу. 410 → подписка `disabled/gone`.
5. **Автоотключение**: `failure_streak = 19`, `failing_since = now() - 25h`, ещё одна неудача → `disabled/failing`,
   остальные доставки `cancelled`, строка аудита без URL с query.
6. **Не потерять**: захват (`sending`), затем «падение» (не записывать результат) → после `locked_until` следующий
   тик отправляет снова; у второго запроса тот же `X-Taskira-Event-Id` и тот же `X-Taskira-Delivery`.
7. **Не задублировать при раскладке**: два параллельных `fanOut()` по одной пачке → одна доставка на подписку
   (`SKIP LOCKED` и уникальный индекс).
8. **Гонка тиков**: два `runWebhookDispatchOnce()` одновременно → каждый запрос один раз (второй тик `skipped`).
9. **SSRF во время доставки**: подмена `lookup`, которая на 1-м вызове возвращает разрешённый адрес, на 2-м —
   `127.0.0.1`, при выключенном `_allowLoopbackForTests` → `failed/target_blocked`, приёмник запросов не получил.
10. Редирект 302 на приёмник → `failed/redirect`, второго запроса нет.
11. Ответ 1 МБ → `failed/too_large`; ответ дольше таймаута → `timeout`.
12. Смена секрета (`prev_secret_until` в будущем) → в заголовке две `v1=`, обе проверяются.
13. `issue.due`: задача со сроком «сегодня» → одно событие; повторный проход → то же одно; закрытая задача → нет.
14. Метрики после успешной и неудачной доставки видны в `/metrics`.

## Замер (`docs/PERFORMANCE.md`)

10 000 доставок на локальный приёмник с задержкой 50 мс: время опустошения, CPU процесса, p99 `PATCH` под
параллельной нагрузкой `performance-load.mjs`. `EXPLAIN (ANALYZE, BUFFERS)` запросов раскладки и захвата на
100 000 строк журнала — без Seq Scan по журналу.

## Критерии приёмки

- `cd server && npm run typecheck && npm test` — зелёно (при `WEBHOOKS_ENABLED=false` по умолчанию остальные тесты
  не меняются).
- Замер записан. p99 `PATCH` во время опустошения очереди — в пределах бюджета трека L §9 + 5 мс.

## Не входит

Маршруты и UI; создание подписок кодом (в тестах — SQL с `secretBox.seal`).

## Риски и откат

- Бесконечный цикл тика при постоянной работе — ограничен 10 с. Зависший получатель — таймауты и лимит на подписку.
- Выключение без релиза: `WEBHOOKS_ENABLED=false` и рестарт. События продолжат копиться (триггер env не видит) и
  уйдут по сроку хранения.
- Откат — revert PR. Таблицы остаются; несоставленные события удалит очистка.
