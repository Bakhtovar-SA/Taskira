# INT-10 — Повторяющиеся задачи: миграция, расчёт расписания, создание задачи внутри транзакции

**Трек:** [L](../tracks/TRACK-L-INTEGRATIONS.md) · **ADR:** 0030 · **Зависит от:** — · **Блокирует:** INT-11

## Цель

Три вещи:
- таблицы правил и запусков;
- одна чистая функция расчёта наступлений с часовыми поясами и переходами на летнее время;
- создание задачи, вызываемое внутри чужой транзакции, с поведением ровно как у `POST …/issues`.

## Файлы

Создать:
- `server/migrations/<YYYYMMDDTHHMM>_recurring_rules.sql` — SQL из трека L §3.3. Первая строка комментария:
  `-- Повторяющиеся задачи: правила над шаблонами задач и журнал запусков.`
- `server/src/services/recurrence.ts`;
- `server/src/services/issueCreate.ts`;
- `server/test/recurrence.test.ts`.

Изменить:
- `server/src/contract.ts` — `RecurrenceSchedule` (трек L §4.3; только схема расписания, остальные DTO — INT-11).
- `server/src/routes/issues.ts` — `POST /` вызывает `issueCreate.ts`; поведение и ответы не меняются.
- `server/src/services/issues.ts` — `nextIssueNum(projectId, client?)`; `validateAssigneesInProject(…, client?)`, если
  нужен клиент транзакции.
- `docs/MIGRATION-LIST.md`, `docs/API-SCHEMAS.md` — `npm run docs:generate`.

## Задание

### 1. `recurrence.ts` (без зависимостей, только `Intl`)

```ts
export interface RuleTiming { schedule: RecurrenceSchedule; timeOfDay: string /* HH:MM */; timeZone: string; startDate: string /* YYYY-MM-DD */ }
export function localDateOf(instant: Date, timeZone: string): string;                 // YYYY-MM-DD
export function zonedToUtc(date: string, time: string, timeZone: string): Date;
export function nextOccurrence(t: RuleTiming, after: Date): Date;                      // строго позже after
export function occurrencesBetween(t: RuleTiming, fromInclusive: Date, toInclusive: Date, limit: number): Date[];
export function assertValidTiming(t: RuleTiming): void;                                // бросает badRequest
```

- **Дата подходит**, если она не раньше `startDate` и:
  - `daily`: `daysBetween(startDate, d) % every === 0`;
  - `weekly`: день недели `d` (1 = пн … 7 = вс) входит в `weekdays` и
    `weeksBetween(понедельник(startDate), понедельник(d)) % every === 0`;
  - `monthly`: `monthsBetween(startDate, d) % every === 0` и день `d` равен `min(day, дней в месяце)` (или последний
    день при `"last"`).
- Перебор местных дат вперёд от `max(startDate, localDateOf(after))`, не дальше 800 дней. Не нашли — ошибка
  «расписание не наступает» (на практике невозможна, но цикл ограничен).
- **`zonedToUtc`**: смещение пояса — через `Intl.DateTimeFormat(..., { timeZone, timeZoneName: "longOffset" })` или
  сравнение полей `formatToParts`.
  - Несуществующее местное время (разрыв весной) → момент перехода, то есть первая существующая минута (обычно
    03:00).
  - Неоднозначное (осенью) → **первый** из двух моментов.
- `assertValidTiming`:
  - пояс известен `Intl`;
  - `timeOfDay` соответствует `^([01]\d|2[0-3]):[0-5]\d$`;
  - `startDate` — реальная дата, не раньше 1 года назад и не позже 5 лет вперёд;
  - для `weekly` дни уникальны.

### 2. `issueCreate.ts`

```ts
export interface CreateIssueInput { title; description; typeId; priorityId; statusId?: string | null;
  assigneeIds: string[]; epicId?: string | null; labels: string[]; complexity: Complexity | null;
  dueDate?: string | null; checklistItems: string[]; activity?: ActivityEvent /* по умолчанию { kind: "created" } */ }
export async function createIssueInTx(client: PoolClient, project: ProjectRow, input: CreateIssueInput, actorId: string): Promise<IssueRow>;
```

- Тело перенести из `POST /` в `routes/issues.ts`: выбор статуса, проверка исполнителей и `epicId`, номер, ранг под
  `lockRankColumn`, `INSERT`, `setAssignees`, чек-лист, `logActivity`. **Все запросы — через `client`.**
- `parentId` сюда не входит: маршрут с `parentId` по-прежнему идёт через `assignParentLocked(…, (client) =>
  createIssueInTx(client, …))`, без `parentId` — через `withTransaction((client) => createIssueInTx(…))`.
- `nextIssueNum` с `client` выполняется в транзакции. В маршруте вызов остаётся **до** транзакции, как сейчас
  (поведение «номер сжигается при неверном parentId» не меняем). Для вызова из правила — внутри.
- Побочные эффекты после коммита (`audit`, `emit`, ответ) остаются в маршруте.

## Тесты (`recurrence.test.ts`)

| Случай | Ожидание |
|---|---|
| daily every=1, 09:00, `Europe/Moscow`, after = 2026-10-04T05:00Z | 2026-10-04T06:00Z |
| daily every=1, after = 2026-10-04T06:00Z (ровно наступление) | 2026-10-05T06:00Z (строго позже) |
| daily every=3 от 2026-10-01 | 01, 04, 07 октября |
| weekly every=1 [1..5], пятница 10:00 после 09:00 | понедельник 09:00 |
| weekly every=2 [1], startDate = среда 2026-10-07 | понедельники 2026-10-19, 2026-11-02 (неделя старта — нулевая; её понедельник 2026-10-05 раньше `startDate`) |
| monthly day=31, после 2027-01-31 | 2027-02-28, затем 2027-03-31 |
| monthly day="last" в 2028 (високосный) | 2028-02-29 |
| monthly every=3 day=1 от 2026-11-01 | 2026-11-01, 2027-02-01 |
| `Europe/Berlin` 02:30 на 2027-03-28 (разрыв) | 2027-03-28T01:00Z (03:00 CEST) |
| `Europe/Berlin` 02:30 на 2026-10-25 (повтор часа) | 2026-10-25T00:30Z (первый) |
| `America/New_York` 02:30 на 2027-03-14 | 2027-03-14T07:00Z |
| переход года: weekly [7] после 2026-12-31 | 2027-01-03 |
| `occurrencesBetween` за 10 дней daily | 10 элементов, по возрастанию, с учётом `limit` |
| неизвестный пояс, `24:00`, `weekdays: []`, дубли дней | `assertValidTiming` бросает |

Плюс **существующие** тесты создания задач (`lifecycle`, `subtasks`, `issueTemplates`, `access.*`) проходят без
изменений.

## Критерии приёмки

- `cd server && npm run typecheck && npm test` — зелёно.
- `bash scripts/check-migrations.sh` — зелёно.
- В корне `npm run docs:check` — зелёно.
- `git diff routes/issues.ts` — только перенос, без смены ответов и кодов (проверяет ревьюер).

## Не входит

Задание, маршруты, право (INT-11); UI (INT-12).

## Риски и откат

Регрессия создания задач из-за переноса — главный риск. Её ловят существующие тесты, поэтому перенос делать без
«улучшений» по пути. Откат — revert; таблицы пустые.
