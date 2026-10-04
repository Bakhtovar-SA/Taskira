# INT-07 — API токенов и сервисных учётных записей

**Трек:** [L](../tracks/TRACK-L-INTEGRATIONS.md) · **ADR:** 0029 · **Зависит от:** INT-06 · **Блокирует:** INT-09

## Цель

Пользователь выпускает и отзывает свои токены. Глобальный администратор управляет сервисными записями, их
токенами и может отозвать любой токен.

## Файлы

Создать:
- `server/src/routes/apiTokens.ts` (`/me/tokens*`, `/admin/tokens*`);
- `server/src/routes/serviceAccounts.ts`;
- `server/test/apiTokens.routes.test.ts`.

Изменить:
- `server/src/app.ts` — регистрация.
- `server/src/contract.ts` — `ApiTokenCreateBody`, `ApiTokenDto`, `ApiTokenCreatedDto`, `ApiTokenAdminDto`,
  `ServiceAccountCreateBody`, `ServiceAccountPatchBody`, `ServiceAccountDto`, `LIMITS.apiToken`.
- `src/validation.ts` — зеркало `LIMITS.apiToken`.
- `src/i18n/ru.ts`, `en.ts` — `apiError.TOKEN_LIMIT`.
- `server/src/routes/members.ts` — проверить, что участником проекта можно сделать сервисную запись (роль любая,
  кроме того, что глобальной роли `admin` у неё нет по CHECK). Тест.
- `server/README.md` — раздел «API-токены»: формат, scope, запреты, пример `curl`.

## Задание

1. Маршруты и тела — трек L §4.2. `/me/tokens*` — `requireSession`. Сервисная запись сама токены не выпускает: она
   не входит в систему. `/admin/*` — `requireGlobalAdmin` (токены там уже запрещены INT-06).
2. Создание: `expiresAt = now() + expiresInDays`; лимит активных (не отозванных и не истёкших) → 409
   `TOKEN_LIMIT`. Ответ 201 `{ token: ApiTokenDto, secret }`, где `secret` — **полная строка** `tsk_…`, только в
   этом ответе.
3. Отзыв: `revoked_at = now()`, `revoked_by`, `invalidateToken(prefix)`. Повторный отзыв — 204 (идемпотентно).
   Чужой токен через `/me` — 404.
4. Сервисная запись:
   - `POST` создаёт `users` (`auth_source='service'`, `global_role='member'`, `password_hash NULL`,
     `job_role = 'Сервисная учётная запись'`, инициалы из имени, цвет как у локального пользователя);
   - логин уникален — `CONFLICT` 409, как при создании пользователя;
   - `PATCH isActive=false` → `revokeUserSessions` + `invalidateUserTokens`;
   - в `ServiceAccountDto.projects` — членства из `project_members`.
5. Аудит: `token.create`, `token.revoke` (`details: { tokenId, prefix, scope, ownerId }`),
   `service_account.create`, `service_account.update`. Никогда — секрет.

## Тесты

- Создание персонального токена: в ответе `secret` вида `tsk_[a-z0-9]{8}_…`; в `GET /me/tokens` секрета нет; в
  `api_tokens` нет секрета открытым текстом (поиск по подстроке).
- Созданный токен работает (`GET /api/projects` → 200); после `DELETE` → 401.
- 11-й активный токен → 409 `TOKEN_LIMIT`; отозванный и истёкший в лимит не считаются.
- `expiresInDays`: 0 и 366 → 400.
- Запросы к `/me/tokens` с токеном → 403 `TOKEN_NOT_ALLOWED`.
- Не администратор → 403 на `/admin/service-accounts*` и `/admin/tokens*`.
- Сервисная запись: создать → добавить в проект ролью `employee` (`PUT …/members`) → выпустить токен `write` →
  создать задачу токеном → `reporterId` = сервисная запись, `audit_log` содержит `via: "token"`.
- Деактивация сервисной записи → её токены 401.
- Администратор отзывает чужой персональный токен через `/admin/tokens/:id` → 401 у владельца.

## Критерии приёмки

- `cd server && npm run typecheck && npm test` — зелёно.
- В корне `npm run typecheck && npm test && npm run docs:check` (`docs:generate` для `API-SCHEMAS.md`).

## Не входит

UI (INT-09); scope сверх `read`/`write`; токены без срока.

## Риски и откат

Ошибка в проверке владельца при отзыве — отзыв чужих токенов; тест обязателен. Откат — revert: выданные токены
продолжат работать до срока (проверка в INT-06), отзывать их можно SQL-ом
`UPDATE api_tokens SET revoked_at = now() WHERE …` + рестарт (кэш 30 с).
