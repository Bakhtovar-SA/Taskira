# INT-06 — API-токены: миграция, проверка в requireAuth, сервисные записи в модели пользователей

**Трек:** [L](../tracks/TRACK-L-INTEGRATIONS.md) · **ADR:** 0029 · **Зависит от:** — · **Блокирует:** INT-07, INT-09

## Цель

Запрос с `Authorization: Bearer tsk_…` аутентифицируется как пользователь — владелец токена — с ограничениями
scope. Административные маршруты для токенов закрыты. Сервисная учётная запись существует в модели как
пользователь без входа.

## Файлы

Создать:
- `server/migrations/<YYYYMMDDTHHMM>_api_tokens.sql` — SQL из трека L §3.2. Первая строка комментария:
  `-- API-токены и сервисные учётные записи (auth_source = 'service').`
- `server/src/services/apiTokens.ts`.
- `server/test/apiTokens.auth.test.ts`.

Изменить:
- `server/src/middleware.ts` — ветка токена в `requireAuth`, `req.authToken`, запрет в `requireGlobalAdmin`, новый
  `requireSession`.
- `server/src/app.ts` — `keyGenerator` лимитера: для `tsk_`-токена ключ `token:<prefix>` без проверки JWT.
- `server/src/audit.ts` — `auditFromRequest(req, …)` или параметр, добавляющий `details.via = "token"`,
  `details.tokenId`. Подключить в маршрутах, где `audit()` вызывается с `req` под рукой. Минимум — все маршруты
  задач, комментариев, участников проекта.
- `server/src/contract.ts` — `SafeUser.authSource` += `"service"`; коды `TOKEN_NOT_ALLOWED`, `TOKEN_SCOPE` (ошибки).
- `server/src/routes/auth.ts` — тип `LoginAccount.auth_source` += `"service"`; `/auth/*` через `requireSession`.
- `server/src/routes/me.ts` и маршруты, меняющие сессию или пароль, — `requireSession`.
- `server/src/services/userProvisioning.ts` — если LDAP-вход нашёл пользователя с `auth_source = 'service'` и тем же
  логином → отказ во входе (не превращать сервисную запись в LDAP).
- `server/src/services/notify.ts` (`emit`), `services/dueReminders.ts` (`ELIGIBLE`), `services/mentions.ts`,
  `routes/users.ts` (`/users/pickable`) — исключить `auth_source = 'service'`. Для выбора участников проекта
  `pickable` принимает `?includeService=1` (только глобальному администратору).
- `src/store.tsx` `assignableUsers()` — исключить `authSource === "service"`.
- `src/i18n/ru.ts`, `en.ts` — `apiError.TOKEN_NOT_ALLOWED`, `apiError.TOKEN_SCOPE`.
- `scripts/support-bundle.sh` — вырезать `tsk_[a-z0-9]{8}_[A-Za-z0-9_-]+` и `whsec_[A-Za-z0-9_-]+`.
- `server/src/services/maintenance.ts` — удаление токенов через 90 дней после `revoked_at`/`expires_at` (пачками).

## Задание

1. **Формат.** `tsk_<prefix>_<secret>`:
   - `prefix` — 8 символов `[a-z0-9]` из `randomBytes`;
   - `secret` — 32 байта `randomBytes` в base64url;
   - хеш — `sha256(secret)` (Buffer 32).
   Экспорт:
   ```ts
   generateToken(): { token: string; prefix: string; hash: Buffer }
   parseToken(raw: string): { prefix: string; secret: string } | null
   verifyToken(raw: string): Promise<{ tokenId: string; userId: string; scope: "read" | "write" } | null>
   invalidateToken(prefix: string): void
   ```
2. **verifyToken.** Кэш по `prefix` на 30 с (как `freshUsers`, тот же `boundedSet`), хранит строку токена. Затем:
   - сравнение хеша `crypto.timingSafeEqual`;
   - `revoked_at IS NULL`, `expires_at > now()`;
   - `last_used_at`/`last_used_ip` обновляются `UPDATE … WHERE last_used_at IS NULL OR last_used_at < now() - interval '1 minute'`
     без ожидания результата (`void q(...)` с `catch`).
3. **requireAuth.** Если `Authorization: Bearer tsk_` → ветка токена:
   - `verifyToken` → `null` даёт 401 `UNAUTHORIZED` (общая причина);
   - `assertFreshUserNoSession(userId)` — та же проверка `is_active`, без `session_version` (выделить из
     `assertFreshUser`);
   - `req.user = { sub, globalRole: "member", name }` — **всегда `member`**, даже если в БД `global_role = 'admin'`
     (ADR-0029 §3). Это и закрывает власть администратора через токен: `resolveRole()` и все инлайн-проверки
     `req.user.globalRole === "admin"` (`routes/dashboards.ts` `isAdmin`, `roadmap.ts`, `reports.ts`, `search.ts`,
     `home.ts`, `projects.ts`, `departments.ts`) видят обычного участника. Не добавлять в эти места отдельную
     проверку токена: понижение роли — единственный механизм;
     `req.authToken = { id, scope }`;
   - ротация cookie не выполняется;
   - scope `read` и метод не `GET`/`HEAD` → 403 `TOKEN_SCOPE`, `audit("token.denied", { reason: "scope" })` не чаще
     раза в минуту на токен.
4. **requireGlobalAdmin**: `req.authToken` есть → 403 `TOKEN_NOT_ALLOWED` до проверки роли.
   **requireSession** = `requireAuth` + отказ токену 403 `TOKEN_NOT_ALLOWED`. Подключить: `/api/auth/*` (кроме
   `login`), `/api/me/*`, будущие `/api/me/tokens*` (INT-07).
   `/api/ws` токен и так не примет: `app.jwt.verify` на нём падает — проверить тестом.
5. **Деактивация** пользователя (`PATCH /users/:id isActive=false`) уже вызывает `revokeUserSessions`. Дополнительно
   сбросить кэш токенов этого пользователя (`invalidateUserTokens(userId)`).
6. Токен никогда не принимается из query или cookie. Логгер Fastify заголовки не пишет (проверить тестом: запрос с
   токеном и `logger` в режиме записи в буфер — в буфере нет `tsk_`).

## Тесты (`apiTokens.auth.test.ts`)

Токены создаются прямым вызовом `generateToken` + `INSERT` (маршрутов ещё нет).
- **Матрица** (сотрудник, токены `read`/`write`):

  | Запрос | `read` | `write` |
  |---|---|---|
  | `GET /api/projects/:id/issues` | 200 | 200 |
  | `PATCH` своей задачи | 403 `TOKEN_SCOPE` | 200 |
  | `PATCH` чужой задачи | 403 `TOKEN_SCOPE` | 403 `FORBIDDEN` (правило сотрудника) |
  | `GET /api/maintenance` | 403 `TOKEN_NOT_ALLOWED` | 403 `TOKEN_NOT_ALLOWED` |
  | `GET /api/admin/export` | 403 `TOKEN_NOT_ALLOWED` | 403 `TOKEN_NOT_ALLOWED` |
  | `POST /api/auth/logout` | 403 `TOKEN_NOT_ALLOWED` | 403 `TOKEN_NOT_ALLOWED` |
  | `POST /api/projects/:id/webhooks` (если INT-05 влит) | 403 `TOKEN_NOT_ALLOWED` | 403 `TOKEN_NOT_ALLOWED` |

- Токен **глобального администратора** (не участник проекта P, участник проекта Q ролью `employee`) со scope `write`:
  - `GET /api/maintenance` → 403 `TOKEN_NOT_ALLOWED`;
  - `GET /api/projects` возвращает Q и не возвращает P; `GET /api/projects/P/issues` → 403 или 404, как у чужого;
  - в Q `PATCH` чужой задачи → 403 (правило сотрудника), `PUT …/members` → 403 (`manageAccess`);
  - правка общего дашборда организации (`routes/dashboards.ts`) → 403;
  - `GET /api/roadmap`, `GET /api/reports/summary`, поиск → только видимые как участнику проекты (Q);
  - та же учётная запись сессией видит P и правит всё — понижение касается только токена.
- Поиск регрессий: тест обходит все маршруты из `app.printRoutes()` с токеном администратора, не состоящего ни в
  одном проекте, и проверяет, что ни один не-GET маршрут не отвечает 2xx. Исключения — явный список в тесте с
  причиной у каждого: личные данные самого пользователя вне проектов (уведомления, избранное, сохранённые виды,
  онбординг). Новый маршрут вне списка с 2xx роняет тест.
- Неверный секрет при верном префиксе, неизвестный префикс, истёкший, отозванный → 401, одинаковый ответ.
- Отзыв (`UPDATE revoked_at` + `invalidateToken`) → следующий запрос 401 без ожидания 30 с.
- Деактивация пользователя → 401.
- Logout сессии того же пользователя → токен продолжает работать.
- `last_used_at` пишется не чаще раза в минуту (два запроса подряд — одно обновление).
- Лимитер: 2 токена одного пользователя имеют разные ключи (`token:<prefix>`).
- Сервисная запись (`INSERT users … auth_source='service'`): `POST /api/auth/login` её логином → 401; CHECK
  запрещает `global_role='admin'` и пароль.
- Сервисная запись — исполнитель задачи → `emit()` не создаёт ей уведомление; `/users/pickable` её не возвращает,
  с `includeService=1` от админа — возвращает.
- WebSocket: `{type:"auth", token:"tsk_…"}` → сокет закрыт 1008.

## Критерии приёмки

- `cd server && npm run typecheck && npm test` — зелёно, включая `security.auth.test.ts`, `access.*`.
- `bash scripts/check-migrations.sh` — зелёно. Предыдущий образ на новой схеме: `scripts/test-upgrade-integration.sh`
  в CI зелёный.
- В корне `npm run typecheck && npm test && npm run docs:check`.

## Не входит

Маршруты создания и отзыва токенов, сервисных записей (INT-07); UI (INT-09); административные scope.

## Риски и откат

- Ошибка в ветке токена — обход аутентификации. Матрица тестов обязательна целиком.
- Если имя CHECK в базе клиента другое (ручные правки), миграция упадёт целиком и откатится. Перед `DROP CONSTRAINT`
  использовать `IF EXISTS` и затем `ADD` — тогда старое ограничение с другим именем останется и запретит `service`.
  В этом случае миграция обязана упасть явно: `DO $$ … RAISE EXCEPTION` при наличии другого CHECK на
  `auth_source` (запрос к `pg_constraint`).
- Откат — revert; токенов ещё никто не выдал (маршрутов нет).
