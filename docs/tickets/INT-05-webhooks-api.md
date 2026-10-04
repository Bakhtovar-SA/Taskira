# INT-05 — API вебхуков

**Трек:** [L](../tracks/TRACK-L-INTEGRATIONS.md) · **ADR:** 0028 · **Зависит от:** INT-04 · **Блокирует:** INT-08

## Цель

Глобальный администратор создаёт, меняет, проверяет и удаляет подписки проекта, смотрит журнал доставок и повторяет
доставки.

## Файлы

Создать:
- `server/src/routes/webhooks.ts`;
- `server/src/services/webhooks.ts` — DTO-маппер, создание, проверка лимитов;
- `server/test/webhooks.routes.test.ts`.

Изменить:
- `server/src/app.ts` — регистрация под `/api`.
- `server/src/contract.ts` — `WebhookEventType`, `WebhookCreateBody`, `WebhookPatchBody`, `WebhookDto`,
  `WebhookDeliveryDto`, `WebhookDeliveryDetailDto`, `IntegrationsConfigDto`, `LIMITS.webhook`.
- `src/validation.ts` — зеркало `LIMITS.webhook`.
- `src/i18n/ru.ts`, `src/i18n/en.ts` — `apiError.WEBHOOKS_DISABLED`, `WEBHOOK_TARGET_NOT_ALLOWED`, `WEBHOOK_LIMIT`,
  `WEBHOOK_NOT_ACTIVE`.
- `server/README.md` — раздел «Вебхуки»: маршруты, тело, подпись (код проверки), заголовки, повторы.
- `docs/API-SCHEMAS.md` — `npm run docs:generate`.

## Задание

1. Маршруты и ответы — трек L §4.1. Все через `preHandler: requireGlobalAdmin`, тела через `zbody`. Проект
   проверяется по `:projectId` (404, если нет).
2. **Создание**:
   - `cfg.webhooks.enabled` ложно → 409 `WEBHOOKS_DISABLED`;
   - `checkUrlShape` + `resolveTarget` (INT-03) — при `TargetBlockedError` 400 `WEBHOOK_TARGET_NOT_ALLOWED`; причина
     в `reason` по-русски, без адреса, разрешённого DNS;
   - лимиты `perProject`/`total` → 409 `WEBHOOK_LIMIT`;
   - секрет `whsec_` + 32 байта `randomBytes` в base64url;
   - сохранить `url_enc`, `url_display = redactUrl(url)`, `secret_enc`;
   - ответ 201 `{ webhook, secret }` — секрет только здесь.
3. **PATCH**: смена `url` — та же проверка. `state: "active"` из `disabled` или `paused` →
   `failure_streak = 0`, `failing_since = NULL`, `disabled_reason = NULL`. `disabled` вручную не ставится.
4. **rotate-secret**: `prev_secret_enc = secret_enc`, `prev_secret_until = now() + 24h`, новый `secret_enc`; ответ
   `{ secret, previousValidUntil }`.
5. **ping**: подписка не `active` → 409 `WEBHOOK_NOT_ACTIVE`. Вставить событие `ping`
   (`dedupe_key = 'ping:' || gen_random_uuid()`, `data = { webhookId }`) — раскладка из INT-04 отдаст его только этой
   подписке. Ответ 202 `{ deliveryId }` после немедленного вызова `fanOut()` для этого события.
6. **Журнал**: курсор по `(created_at, id)` по убыванию, `limit` ≤ 100, фильтр `state`. Детали — `payload` события,
   заголовки без `X-Taskira-Signature`, `response_excerpt`.
7. **redeliver**: новая строка `webhook_deliveries` с `manual = true` тем же `event_id`. **redeliver-failed**:
   `since` не раньше `now() - 7 days` (иначе 400), доставки `failed`/`cancelled` подписки, не больше 1 000.
8. **Аудит** — трек L §8. В `details` только `urlDisplay`, `events`, `name`; никогда секрет и полный URL.
9. `GET /integrations/config` — `{ webhooksEnabled, allowHttp, allowedTargets }` (правила строками, как в env).

## Тесты (`webhooks.routes.test.ts`)

- **Права**: менеджер проекта, сотрудник, наблюдатель → 403 на каждый маршрут; глобальный администратор → 2xx.
  Запрет токенам проверяется в INT-06.
- `WEBHOOKS_ENABLED=false` → 409 `WEBHOOKS_DISABLED` на создание и ping; список работает.
- Адрес вне allowlist, `http:` без разрешения, `user:pw@` → 400 `WEBHOOK_TARGET_NOT_ALLOWED`.
- 11-я подписка в проекте → 409 `WEBHOOK_LIMIT`.
- Секрет есть в ответе на создание и rotate, его нет в `GET` и в `audit_log` (поиск подстроки `whsec_` и query из
  URL по всем `details`).
- URL `https://hooks.corp.local/x?token=abc` → `urlDisplay` без `?token`; `abc` не встречается ни в одном ответе
  `GET`, ни в аудите.
- ping → приёмник (из INT-04) получил `ping` с верной подписью; журнал показывает `succeeded`.
- redeliver → вторая доставка с тем же `X-Taskira-Event-Id`, другим `X-Taskira-Delivery`.
- redeliver-failed: `since` 8 суток назад → 400; 1 500 неудачных → `count = 1000`.
- Включение `disabled`-подписки сбрасывает счётчики.

## Критерии приёмки

- `cd server && npm run typecheck && npm test` — зелёно.
- В корне `npm run typecheck && npm test && npm run docs:check` — зелёно; `apiErrors.test.ts` видит новые коды.

## Не входит

UI (INT-08); вебхуки уровня организации; фильтры событий по статусу или типу задачи.

## Риски и откат

Ошибка прав — вывоз данных. Тест прав обязателен на каждый маршрут. Откат — revert; подписки в БД остаются, но без
маршрутов не меняются; `WEBHOOKS_ENABLED=false` останавливает отправку.
