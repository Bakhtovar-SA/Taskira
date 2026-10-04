# INT-01 — ActivityEvent: идентификаторы в событиях статуса и исполнителей

**Трек:** [L](../tracks/TRACK-L-INTEGRATIONS.md) · **ADR:** 0028 · **Зависит от:** — · **Блокирует:** INT-02, INT-04

## Цель

История статуса и исполнителей хранит идентификаторы, а не только имена, чтобы событие вебхука могло их передать.

## Файлы

Изменить:
- `server/src/contract.ts` — `ActivityEvent`.
- Все места, где пишутся события `status`, `assigneeAdded`, `assigneeRemoved`, `assigneeBulk`. Найти командой
  `grep -rn 'kind: "status"\|assigneeAdded\|assigneeRemoved\|assigneeBulk' server/src`. Ожидаются
  `services/issueTransition.ts`, `routes/issues.ts` (PATCH), `routes/issuesBulk.ts`, `services/issues.ts`. Каждое
  найденное место обязательно.
- `server/test/activity.test.ts` — новые проверки.

Создать: нет.

## Задание

1. В `ActivityEvent` (`contract.ts`) добавить **необязательные** поля, чтобы старые строки по-прежнему проходили
   схему:
   - `status`: `fromId: z.string().uuid().optional()`, `toId: z.string().uuid().optional()`;
   - `assigneeAdded`, `assigneeRemoved`: `userId: z.string().uuid().optional()`;
   - `assigneeBulk`: `userId: z.string().uuid().nullable().optional()` (`null`, если исполнители сняты).
2. Во всех местах записи передавать эти поля: id прежнего и нового статуса, id добавленного или снятого человека,
   id назначенного при массовой операции.
3. `activityText()` не меняется: фраза та же. Клиент не меняется: поля необязательные, `activityText.ts` их не
   читает.

## Тесты

В `server/test/activity.test.ts`:
- `POST …/transition` → в последней строке `activity` `payload.fromId`/`toId` равны id статусов;
- `PATCH` с новым `assigneeIds` (одного добавили, одного сняли) → две строки с правильными `userId`;
- массовое назначение (`PATCH …/issues/bulk`) → `assigneeBulk` с `userId`; массовое снятие → `userId: null`;
- строка `activity` без новых полей (как до изменения) читается `activityEventOf()` без ошибки.

## Критерии приёмки

- `cd server && npm run typecheck && npm test` — зелёно.
- В корне `npm run typecheck && npm test && npm run docs:check` (`API-SCHEMAS.md` перегенерировать
  `npm run docs:generate` и закоммитить).
- `grep` из раздела «Файлы» не находит места записи этих событий без новых полей.

## Не входит

Новые типы событий истории; изменения клиента; вебхуки.

## Риски и откат

Риск — пропустить путь записи; ловится тестами и `grep`. Откат — revert PR: поля необязательные, данные в
`payload` остаются и никому не мешают.
