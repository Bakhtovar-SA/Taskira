# INT-02 — Миграция: outbox событий, вебхуки, доставки, триггеры

**Трек:** [L](../tracks/TRACK-L-INTEGRATIONS.md) · **ADR:** 0028 · **Зависит от:** INT-01 · **Блокирует:** INT-04, INT-05

## Цель

Каждое изменение задачи, оставившее строку истории или комментарий, в проекте с активной подпиской атомарно
порождает строку outbox `integration_events`.

## Файлы

Создать:
- `server/migrations/<YYYYMMDDTHHMM>_integration_events.sql` — время UTC создания файла, позже всех миграций на
  `main`. Первая строка комментария: `-- Вебхуки: подписки проекта, outbox событий интеграций и журнал доставок.`
- `server/test/integrationOutbox.test.ts`.

Изменить:
- `docs/MIGRATION-LIST.md` — `npm run docs:generate`.
- `docs/PERFORMANCE.md` — раздел «Интеграции: стоимость триггера» (замер ниже).

## Задание

1. SQL миграции — **дословно** из трека L §3.1: таблицы `webhooks`, `integration_events`, `webhook_deliveries`,
   индексы, функции `integration_event_type`, `trg_activity_integration_event`, `trg_comments_integration_event` и
   два триггера `AFTER INSERT … FOR EACH ROW`. Комментарий-шапка объясняет:
   - зачем триггер, а не код маршрутов: любой путь записи, прецедент EPIC-01;
   - что события одной транзакции склеиваются по `pg_current_xact_id()`;
   - что без активной подписки триггер ничего не пишет.
2. Триггер комментариев:
   ```sql
   CREATE FUNCTION trg_comments_integration_event() RETURNS trigger LANGUAGE plpgsql AS $$
   DECLARE p uuid; k text;
   BEGIN
     SELECT i.project_id, i.key INTO p, k FROM issues i WHERE i.id = NEW.issue_id;
     IF p IS NULL OR NOT EXISTS (SELECT 1 FROM webhooks w WHERE w.project_id = p AND w.state = 'active') THEN
       RETURN NULL;
     END IF;
     INSERT INTO integration_events (type, project_id, issue_id, issue_key, actor_id, dedupe_key, data)
     VALUES ('issue.commented', p, NEW.issue_id, k, NEW.author_id, 'comment:' || NEW.id,
             jsonb_build_object('commentId', NEW.id))
     ON CONFLICT (dedupe_key) DO NOTHING;
     RETURN NULL;
   END $$;
   CREATE TRIGGER trg_comments_integration_event AFTER INSERT ON comments
     FOR EACH ROW EXECUTE FUNCTION trg_comments_integration_event();
   ```
3. Никакого кода приложения в этом тикете нет: таблицы пишет только триггер, подписки в тестах вставляются SQL-ом
   (`url_enc`/`secret_enc` — любые строки).
4. `server/test/helpers.ts` `resetDb()` менять не нужно: новые таблицы ссылаются на `projects` и уходят по
   `TRUNCATE … CASCADE`. Проверить, что тесты не видят строк соседнего теста.

## Тесты (`integrationOutbox.test.ts`)

Подготовка: проект, менеджер, задача. Хелпер `addWebhook(projectId, state = 'active')` вставляет строку SQL-ом.
1. **Без подписки** создание, `PATCH`, `transition`, комментарий, массовая операция → 0 строк `integration_events`.
2. **Подписка `paused` / `disabled`** → 0 строк.
3. **С активной подпиской** каждый путь даёт событие нужного типа:
   - `POST …/issues` → `issue.created`;
   - `PATCH` названия → `issue.updated`;
   - `transition` → `issue.statusChanged`, в `changes[0]` есть `fromId`/`toId`;
   - `PATCH assigneeIds` → `issue.assigned`;
   - `POST …/comments` → `issue.commented` с `data.commentId`;
   - добавление ссылки, пункта чек-листа, массовая смена приоритета → `issue.updated`.
4. **Склейка**: один `PATCH`, меняющий название, приоритет и срок, → одна строка `issue.updated` с тремя элементами
   `changes` в порядке записи истории.
5. **Две транзакции** с одинаковой правкой → две строки (разный `dedupe_key`).
6. **Откат**: транзакция `withTransaction`, где пишется история и затем бросается ошибка, → 0 строк.
7. Строка `activity` с `kind = NULL` (прямой `INSERT`) → 0 строк.
8. **Гонка**: два параллельных `PATCH` разных полей одной задачи через `Promise.all` → две строки, ни одна
   транзакция не упала (уникальность `dedupe_key` с `ON CONFLICT` не даёт ошибок).
9. Удаление проекта каскадом удаляет его события и подписки.

## Замер (в `docs/PERFORMANCE.md`)

Стенд `taskira_perf` (правила «Нагрузочный стенд» в `docs/OPERATIONS.md`, `MAINTENANCE_ENABLED=false`):
`server/scripts/performance-load.mjs` по `PATCH` и `transition`, три прогона — `main`, ветка без подписок, ветка с
3 активными подписками в проекте нагрузки. Таблица p50/p95/p99. **Бюджет: p50 +≤ 1 мс, p99 +≤ 3 мс.** Превышение
бюджета — не вливать, записать замер в PR и обсудить.

## Критерии приёмки

- `cd server && npm run typecheck && npm test` — зелёно, включая `onboarding.test.ts` (подсчёт строк всех таблиц).
- `bash scripts/check-migrations.sh` (или CI-джоба миграций) — зелёно: имя после всех, нет destructive-операций.
- `npm run docs:check` в корне — зелёно.
- Замер в `docs/PERFORMANCE.md`, бюджет соблюдён.

## Не входит

Раскладка и отправка (INT-04), API (INT-05), шифрование (INT-03), `issue.due` (INT-04).

## Риски и откат

- Ошибка в функции триггера роняет **любую** запись истории — то есть правку задач. Поэтому тест 3 обязан пройти
  каждый путь. Перед вливанием прогнать весь `server npm test`.
- Экстренное отключение на работающей инсталляции без релиза:
  `ALTER TABLE activity DISABLE TRIGGER trg_activity_integration_event;` (и для `comments`) — записать в
  `docs/OPERATIONS.md` в INT-16.
- Откат релиза: предыдущий образ на этой схеме работает (подписок нет — триггер ничего не пишет).
