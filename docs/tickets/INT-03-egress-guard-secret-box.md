# INT-03 — Конфигурация вебхуков, шифрование секретов, проверка целей (SSRF)

**Трек:** [L](../tracks/TRACK-L-INTEGRATIONS.md) · **ADR:** 0028 · **Зависит от:** — · **Блокирует:** INT-04, INT-05

## Цель

Чистые, полностью покрытые тестами модули: какие адреса вебхуков разрешены, как шифруются секреты, как
настраивается функция.

## Файлы

Создать:
- `server/src/services/egress.ts` — правила целей и проверка адреса.
- `server/src/services/secretBox.ts` — AES-256-GCM.
- `server/test/egress.test.ts`, `server/test/secretBox.test.ts`, `server/test/config.webhooks.test.ts`.

Изменить:
- `server/src/config.ts` — блок `webhooks`.
- `server/.env.example` — переменные с комментариями.
- `docker-compose.yml` и `scripts/render-compose.sh` — проброс переменных в `server` (посмотреть, как
  пробрасывается `DUE_REMINDER_TZ`, и сделать так же).

## Задание

### Конфигурация (`config.ts`)

```ts
webhooks: {
  enabled: boolean;                 // WEBHOOKS_ENABLED, по умолчанию false
  allowedTargets: TargetRule[];     // WEBHOOK_ALLOWED_TARGETS, через запятую; пусто — ни одной цели
  denyCidrs: string[];              // WEBHOOK_DENY_CIDRS, через запятую; compose подставляет TASKIRA_NETWORK_CIDR
  allowHttp: boolean;               // WEBHOOK_ALLOW_HTTP, по умолчанию false
  secretKey: Buffer | null;         // WEBHOOK_SECRET_KEY: 32 байта в hex (64 символа) или base64
  pollMs: number;                   // WEBHOOK_POLL_MS, 2000, диапазон 500–60000
  logRetentionDays: number;         // WEBHOOK_LOG_RETENTION_DAYS, 30, диапазон 3–365
}
```

Сразу при старте падать (`throw` в `loadConfig`, как для `JWT_SECRET`) при:
- `enabled` без `secretKey` или с ключом не 32 байта;
- неразбираемом правиле в `WEBHOOK_ALLOWED_TARGETS` или CIDR в `WEBHOOK_DENY_CIDRS`.

Тексты ошибок называют переменную, но не значение.

### Правила целей (`egress.ts`)

```ts
export type TargetRule =
  | { kind: "host"; host: string }            // hooks.corp.local (точное совпадение, нижний регистр)
  | { kind: "suffix"; suffix: string }        // *.corp.local — только поддомены, не сам corp.local
  | { kind: "cidr"; net: string; prefix: number; family: 4 | 6 };   // 10.20.0.0/16, 10.20.30.40 (= /32), fd00::/8
export function parseTargetRules(raw: string): TargetRule[];        // бросает с номером позиции
export function redactUrl(url: string): string;                     // scheme://host[:port]/path
export function checkUrlShape(url: string, cfg): URL;               // бросает TargetBlockedError("shape" | "scheme")
export async function resolveTarget(url: URL, cfg, lookup = dns.promises.lookup):
  Promise<{ address: string; family: 4 | 6; hostname: string; port: number; protocol: "https:" | "http:" }>;
export class TargetBlockedError extends Error { reason: "shape" | "scheme" | "not_allowed" | "denied_range" | "dns" }
```

`checkUrlShape`:
- разбор WHATWG `URL`; длина ≤ 2048;
- протокол `https:`, или `http:` только при `allowHttp`;
- без `username`/`password`; непустой `hostname`;
- фрагмент отбрасывается.

`resolveTarget`:
1. Хост — IP-литерал (`net.isIP` после снятия `[]`): адрес должен попасть в CIDR-правило.
2. Иначе хост совпал с правилом `host`/`suffix` → `lookup(host, { all: true, verbatim: true })`. **Каждый** адрес
   ответа проверяется по неотключаемому запрету и `denyCidrs`.
3. Иначе (имя не совпало) — резолв, и **каждый** адрес обязан попасть в CIDR-правило.
4. Любой адрес вне правил или в запрете → `TargetBlockedError` («не выбирать хороший из списка»). Пустой ответ или
   ошибка DNS → `dns`.
5. IPv4-mapped IPv6 (`::ffff:127.0.0.1`) нормализуется в IPv4 до проверки.
6. Возвращается первый адрес — к нему INT-04 подключится напрямую.

Неотключаемый запрет — `net.BlockList`:
- IPv4: `0.0.0.0/8`, `127.0.0.0/8`, `169.254.0.0/16`, `224.0.0.0/4`, `240.0.0.0/4`;
- IPv6: `::/128`, `::1/128`, `fe80::/10`, `ff00::/8`, `64:ff9b::/96`.

Плюс `denyCidrs`. Для тестов INT-04 экспортировать `_allowLoopbackForTests(on: boolean)`. Функция действует только
при `NODE_ENV === "test"`, иначе бросает.

### Шифрование (`secretBox.ts`)

- `seal(plain: string, key: Buffer): string` → `v1.<iv>.<ciphertext>.<tag>` (base64url; IV 12 байт из
  `randomBytes`).
- `open(sealed: string, key: Buffer): string` при неверном ключе, формате или подмене бросает
  `SecretUnavailableError`.
- Никакого логирования аргументов.

## Тесты

`egress.test.ts`, таблица случаев:

| Случай | Ожидание |
|---|---|
| `https://hooks.corp.local/x` при правиле `hooks.corp.local`, резолв в `10.1.2.3` | разрешено |
| `https://a.corp.local` при `*.corp.local`; `https://corp.local` при `*.corp.local` | разрешено; `not_allowed` |
| `http://…` без `allowHttp`; `ftp://…` | `scheme` |
| `https://user:pw@hooks.corp.local` | `shape` |
| `https://127.0.0.1`, `https://[::1]`, `https://[::ffff:127.0.0.1]`, `https://169.254.169.254` при правиле `0.0.0.0/0` | `denied_range` |
| `https://2130706433` и `https://0x7f.1` (WHATWG превращает в 127.0.0.1) при `0.0.0.0/0` | `denied_range` |
| имя по правилу `host`, резолв `[10.1.2.3, 127.0.0.1]` | `denied_range` |
| имя не в правилах, резолв в `10.20.1.1` при CIDR `10.20.0.0/16` | разрешено |
| имя не в правилах, резолв в `10.21.1.1` при CIDR `10.20.0.0/16` | `not_allowed` |
| адрес внутри `denyCidrs` при разрешающем правиле | `denied_range` |
| пустой список правил | `not_allowed` для всего |
| ошибка DNS (заглушка `lookup` бросает) | `dns` |
| `redactUrl("https://u:p@h:8443/a/b?token=x#f")` | `https://h:8443/a/b` |

`secretBox.test.ts`: шифрование и расшифровка; разные IV на одинаковый текст; чужой ключ, испорченный tag, чужой
формат → `SecretUnavailableError`.

`config.webhooks.test.ts`: значения по умолчанию; падение без ключа при `enabled`; плохой CIDR; ключ в hex и base64.

## Критерии приёмки

- `cd server && npm run typecheck && npm test` — зелёно.
- Сервер стартует с пустыми новыми переменными (функция выключена) — существующие тесты не меняются.

## Не входит

HTTP-отправка (INT-04); маршруты (INT-05); ротация `WEBHOOK_SECRET_KEY` (открытый вопрос, формат `v1.` оставляет
место для `kid`).

## Риски и откат

Ошибка в нормализации адреса — дыра SSRF; поэтому таблица тестов — минимум, расширять можно. Откат — revert,
модули ещё никем не используются.
