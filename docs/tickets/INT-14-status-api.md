# INT-14 — `GET /api/admin/status` и метрики операций

**Трек:** [L](../tracks/TRACK-L-INTEGRATIONS.md) · **ADR:** 0031 · **Зависит от:** INT-13. Проверки `webhooks` и
`recurring` используют таблицы INT-02 и INT-10 и настройки INT-03 и INT-11. Если их ещё нет на `main`, проверка
возвращает `off` через `to_regclass` и отсутствие настройки. · **Блокирует:** INT-15

## Цель

Один ответ со всеми сигналами состояния инсталляции, по которому экран и мониторинг понимают, что сломано и где
чинить.

## Файлы

Создать:
- `server/src/services/systemStatus.ts` — по функции на проверку + `getSystemStatus()`;
- `server/test/systemStatus.test.ts`.

Изменить:
- `server/src/routes/maintenance.ts` (или новый `routes/adminStatus.ts`) — `GET /api/admin/status`,
  `GET /api/admin/ops-runs`, `requireGlobalAdmin`.
- `server/src/contract.ts` — `StatusState`, `SystemCheck`, `OpsFacts`, `SystemStatusDto`, `OpsRunDto` (трек L §4.4).
- `server/src/metrics.ts` — при scrape `taskira_ops_last_success_timestamp_seconds{kind}`,
  `taskira_ops_last_run_success{kind}`, а также gauge вебхуков из INT-04, если они ещё не считаются при scrape.
- `server/src/app.ts` — вынести вычисление `/ready` (БД, миграции, хранилище) в функцию, которую переиспользует
  проверка `database`/`storage`. Ответ `/ready` не меняется.
- `server/README.md` — маршрут и правила состояний.

## Задание

1. Каждая проверка — `async () => SystemCheck` в своём `try/catch`. Исключение даёт `{ state: "unknown", facts }`
   с нулевыми фактами и `console.error` без секретов. Все проверки идут параллельно (`Promise.all`), общий таймаут
   5 с: опоздавшая — `unknown`. Результат кешируется 15 с (`createTtlCache`).
2. Правила состояний:

| Проверка | ok | warn | fail | off |
|---|---|---|---|---|
| `database` | запрос прошёл, миграции применены | задержка `SELECT 1` > 200 мс | ошибка или есть неприменённые миграции | — |
| `storage` | готово | local: свободно < 10 % или < 2 ГиБ (`fs.statfs` каталога вложений) | не готово; local: < 2 % или < 500 МиБ | — |
| `mail` | нет проблем | старейшее ожидающее > 30 мин или отказы за 24 ч > 0 | почта включена, SMTP не настроен | почта выключена |
| `ldap` | последний ресинк успешен и не старше 3 интервалов | старше 3 интервалов или последняя попытка с ошибкой | — | `AUTH_MODE=local` или нет bind DN |
| `jobs` | у каждого задания успех не старше 3 интервалов | хоть одно старше 3 интервалов (процесс живёт дольше `startDelay` + интервал) или последний результат — ошибка | — | — |
| `license` | действует | истекает ≤ 30 дней, истекла (grace), места сверх лимита, лицензии нет | подпись неверна | — |
| `search` | индексы на месте | индексов нет (`searchIndexWarnings`) | — | — |
| `backup` | успех моложе 26 ч | 26–50 ч | старше 50 ч; последняя запись `failure`; `running` старше 6 ч (`interrupted`) | — (нет записей → `unknown`) |
| `restoreDrill` | успех моложе 8 сут | 8–15 сут | старше 15 сут; последняя `failure`/`interrupted` | — (нет записей → `unknown`) |
| `webhooks` | нет проблем | есть `disabled`; старейшая ожидающая доставка > 15 мин; `failed` за 24 ч > 0 | — | `WEBHOOKS_ENABLED=false` и нет подписок |
| `recurring` | нет проблем | есть пауза `owner_lost_access`; `failed` за 24 ч > 0 | — | `RECURRING_ENABLED=false` или 0 правил |

   Состояние заданий берётся из `getMaintenanceStatus()` этого процесса (ADR-0024: процесс один).
3. Порядок `checks` в ответе — как в union (клиент сортирует сам). Факты без текстов задач и секретов: имена
   архивов — только `basename`.
4. `GET /api/admin/ops-runs?kind=backup|restore_drill&limit≤50` — последние записи, `error` как есть (уже без
   секретов, INT-13).
5. Запрет токенам — через `requireGlobalAdmin` (INT-06).

## Тесты (`systemStatus.test.ts`)

- Не администратор → 403. Администратор → 200, все 11 проверок по схеме `SystemStatusDto.parse()` (в тесте можно
  вызывать `.parse`).
- `ops_runs`:
  - пусто → `backup.unknown`;
  - успех 1 ч назад → `ok`, 30 ч → `warn`, 60 ч → `fail`;
  - `running` 7 ч назад → `fail` с `lastResult: "interrupted"`;
  - то же для `restoreDrill` с порогами 8 и 15 суток.
- Почта выключена → `off`; включена без SMTP → `fail`; ожидающее письмо 40 мин → `warn`.
- Подписка `disabled` → `webhooks.warn`; функция выключена и подписок нет → `off`.
- Правило `owner_lost_access` → `recurring.warn`.
- Проверка, бросившая исключение (подменить функцию), → `unknown`, остальные не пострадали.
- Кэш: два вызова подряд → один набор запросов (шпион на `q`).
- `/metrics` содержит `taskira_ops_last_success_timestamp_seconds{kind="backup"}` после записи успеха.

## Критерии приёмки

- `cd server && npm run typecheck && npm test` — зелёно.
- В корне `npm run typecheck && npm run docs:check` — зелёно.
- Время ответа без кэша на стенде 50 000 задач < 100 мс (записать в PR).

## Не входит

Экран (INT-15); оповещения письмом; история состояний.

## Риски и откат

Тяжёлая проверка может замедлить экран. Защиты — общий таймаут 5 с и кэш. Откат — revert; экран INT-15 без
маршрута покажет ошибку, старый `/api/health` не тронут.
