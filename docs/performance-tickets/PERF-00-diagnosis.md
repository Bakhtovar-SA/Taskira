# PERF-00: диагностика обработчика списка задач

Дата измерения: 20 сентября 2026 года.

Цель этой работы — только локализовать стоимость запроса. Индексы, SQL,
пагинация, число Node-процессов и формат ответа не менялись.

## Итог

| Гипотеза | Вердикт | Измеренное основание |
|---|---|---|
| H1 — обязательный `count(*)` делает полный скан | **Подтверждена** | `count(*)` безусловно исполняется перед выборкой каждой страницы. План содержит `Seq Scan on issues`, 50 000 строк, `shared hit=1210`, `Execution Time: 20.700 ms`. |
| H2 — `ORDER BY` не поддержан подходящим индексом | **Подтверждена** | Первая страница: `Parallel Seq Scan` + `Sort Method: top-N heapsort`, 1 225 shared buffers. Глубокая: `Seq Scan` + `Sort Method: external merge`, 8 640 kB temp, `temp read=1080 written=1083`. |
| H3 — время не в SQL, а в правах/валидации/сериализации | **Опровергнута** | В 20 запросах SQL списка + count + batch исполнителей заняли в среднем 125,475 мс из 126,715 мс до сериализованного payload (99,0%). Проверка прав — 0,133 мс, построение DTO — 0,479 мс, сериализация — 0,294 мс. Исходящей Zod-валидации и построчной проверки прав нет. |
| H4 — узкое место в однопоточности Node | **Опровергнута** | API действительно обслуживает один Node-процесс без `cluster`/worker threads, но измеренный JS вне SQL занимает около 1,2 мс, тогда как почти всё время handler ожидает PostgreSQL. План первой страницы сам использует один parallel worker PostgreSQL. Single-process Node — ограничение конфигурации, но не измеренное узкое место этого запроса. |

Таким образом, старые 8,108 секунды среднего времени при 200 соединениях нельзя
считать временем одного запроса без очереди. На прогретом стенде один запрос
первой страницы имеет медиану 100,952 мс. При конкурентном прогоне запросы
конкурируют прежде всего за выполнение трёх SQL через пул из 10 соединений.

## Стенд и методика

- Данные: 50 000 активных задач проекта `PERF`, 200 нагрузочных пользователей,
  фикстура `server/scripts/performance-seed.mjs` без изменений.
- Чтобы не менять локальную рабочую БД, фикстура создана в изолированной схеме
  `taskira_perf`; `search_path` задан в отдельной строке подключения процесса.
- PostgreSQL 18.6 x64 на Windows, `work_mem=4MB`,
  `max_parallel_workers_per_gather=2`.
- Node v24.20.0, Windows 10.0.26200 x64, Intel Core i3-N305,
  8 логических CPU, 8 ГБ RAM.
- API и PostgreSQL работали на том же хосте. Запросы baseline выполнялись
  строго последовательно одним пользователем, `limit=200`.
- Перед каждой серией выполнено 5 прогревочных запросов. В измеряемые серии они
  не входят. Клиент читал тело ответа полностью через `response.text()`.
- Первая страница: `offset=0`; глубокая: `offset=49800`.

## Фактический обработчик и запросы

Обработчик находится в `server/src/routes/issues.ts`, функция `issuesRoutes`,
маршрут `GET /api/projects/:projectId/issues`. Регистрация полного префикса —
в `server/src/app.ts`. DTO строится функцией `mapIssue` из
`server/src/services/issues.ts`.

До handler выполняются однократная проверка проектного права
`requirePerm("browse")` и входная Zod-валидация `IssueQuery`. Права не
проверяются для каждой выбранной строки. Исходящей Zod-схемы или Fastify
response schema у маршрута нет.

Ответ имеет вид:

```json
{
  "items": [],
  "total": 50000
}
```

Поле общего количества есть и обязательно заполняется на каждой странице.

Фильтр собирается динамически. Базовое условие:

```ts
const clauses = ["i.project_id = $1"];
if (f.archived === "1") clauses.push("i.archived_at IS NOT NULL");
else if (f.archived !== "all") clauses.push("i.archived_at IS NULL");
```

К нему могут добавляться условия по `status`, `assignee`, `type`, `q`,
`dueFrom`, `dueTo`, `overdue`. Для измеренного запроса без дополнительных
фильтров сервер исполняет следующие запросы последовательно.

Count:

```sql
SELECT count(*)::text AS n FROM issues i
  JOIN workflow_statuses ws ON ws.id = i.status_id
 WHERE i.project_id = $1
   AND i.archived_at IS NULL;
```

Страница:

```sql
SELECT i.* FROM issues i
  JOIN workflow_statuses ws ON ws.id = i.status_id
 WHERE i.project_id = $1
   AND i.archived_at IS NULL
 ORDER BY i.rank, i.id
 LIMIT $2 OFFSET $3;
```

Исполнители выбранных 200 задач загружаются одним batch-запросом, не N+1:

```sql
SELECT issue_id, user_id
  FROM issue_assignees
 WHERE issue_id = ANY($1)
 ORDER BY added_at, user_id;
```

## Baseline без конкуренции

### Первая страница

- Медиана: **100,952 мс**.
- Разброс min–max: **93,468–108,891 мс** (15,423 мс).
- 10 значений, мс: `106.256, 101.034, 108.891, 94.247, 100.870,
  103.745, 97.431, 93.468, 98.205, 106.221`.

### Глубокая страница

- Медиана: **127,934 мс**.
- Разброс min–max: **109,255–193,157 мс** (83,903 мс).
- 10 значений, мс: `109.255, 119.520, 114.269, 116.162, 112.960,
  136.348, 175.881, 193.146, 188.617, 193.157`.

Глубокая страница не только читает 50 000 строк до `OFFSET`: её сортировка
выходит из `work_mem=4MB` во временный файл. Это согласуется с большим временем
и разбросом относительно первой страницы.

## Разбивка времени по фазам

В `server/src/routes/issues.ts` оставлена диагностическая инструментация,
которая создаёт route-local таймеры и печатает одну JSON-строку с префиксом
`[perf-trace]` только при `PERF_TRACE=1`. При выключенном флаге hooks не
регистрируются и трассы не создаются. Инструментация не меняет SQL или payload.

Средние по 20 последовательным запросам первой страницы после прогрева:

| Фаза | Среднее, мс |
|---|---:|
| От входа в route до первого SQL | 0,431 |
| Проверка права `browse` (включена также в предыдущую строку) | 0,133 |
| Входная Zod-валидация query (включена также в первую строку) | 0,055 |
| SQL `count(*)` | 23,788 |
| SQL списка | 100,218 |
| SQL batch-загрузки исполнителей | 1,469 |
| Построение DTO ответа | 0,479 |
| Исходящая валидация | отсутствует (`0` в trace — явный маркер) |
| Fastify/JSON-сериализация | 0,294 |
| От входа в route до сериализованного payload | 126,715 |
| Полное клиентское время, среднее | 135,034 |

Кэши пользователя, членства и проекта были прогреты; поэтому первым SQL в этих
20 запросах был именно `count(*)`. Периодические выбросы находились в SQL
списка, а не в JS: клиентский диапазон серии составил 101,421–236,640 мс.

Решение: **оставить инструментацию за `PERF_TRACE=1`**. Она мала, локальна для
одного маршрута и нужна для сравнения с будущим исправлением. В обычном режиме
не пишет логи и не создаёт объекты trace.

## EXPLAIN (ANALYZE, BUFFERS)

Планы сняты после прогрева на той же фикстуре. Ниже они приведены целиком.

### Первая страница (`LIMIT 200 OFFSET 0`)

```text
Limit  (cost=3947.15..3969.94 rows=200 width=291) (actual time=67.479..73.480 rows=200.00 loops=1)
  Buffers: shared hit=1225 dirtied=1
  ->  Gather Merge  (cost=3947.15..9645.68 rows=50000 width=291) (actual time=67.475..73.462 rows=200.00 loops=1)
        Workers Planned: 1
        Workers Launched: 1
        Buffers: shared hit=1225 dirtied=1
        ->  Sort  (cost=2947.14..3020.67 rows=29412 width=291) (actual time=27.964..27.978 rows=100.00 loops=2)
              Sort Key: i.rank, i.id
              Sort Method: top-N heapsort  Memory: 76kB
              Buffers: shared hit=1225 dirtied=1
              Worker 0:  Sort Method: quicksort  Memory: 25kB
              ->  Hash Join  (cost=21.48..1675.97 rows=29412 width=291) (actual time=0.047..18.893 rows=25000.00 loops=2)
                    Hash Cond: (i.status_id = ws.id)
                    Buffers: shared hit=1210 dirtied=1
                    ->  Parallel Seq Scan on issues i  (cost=0.00..1576.65 rows=29412 width=291) (actual time=0.009..13.084 rows=25000.00 loops=2)
                          Filter: ((archived_at IS NULL) AND (project_id = 'a843a88a-46d0-421d-9534-26dacfe9dff2'::uuid))
                          Buffers: shared hit=1209
                    ->  Hash  (cost=15.10..15.10 rows=510 width=16) (actual time=0.056..0.064 rows=3.00 loops=1)
                          Buckets: 1024  Batches: 1  Memory Usage: 9kB
                          Buffers: shared hit=1 dirtied=1
                          ->  Seq Scan on workflow_statuses ws  (cost=0.00..15.10 rows=510 width=16) (actual time=0.044..0.047 rows=3.00 loops=1)
                                Buffers: shared hit=1 dirtied=1
Planning:
  Buffers: shared hit=435
Planning Time: 14.023 ms
Execution Time: 73.645 ms
```

Есть `Parallel Seq Scan on issues`. Сортировка не внешняя: top-N heap хранит
только результат лимита, но входом ей служит весь отфильтрованный набор.
Прочитано 1 225 shared buffers (1 209 на таблице задач).

### `count(*)`

```text
Aggregate  (cost=2112.82..2112.83 rows=1 width=32) (actual time=20.602..20.604 rows=1.00 loops=1)
  Buffers: shared hit=1210
  ->  Hash Join  (cost=21.48..1987.82 rows=50000 width=0) (actual time=0.067..18.435 rows=50000.00 loops=1)
        Hash Cond: (i.status_id = ws.id)
        Buffers: shared hit=1210
        ->  Seq Scan on issues i  (cost=0.00..1834.00 rows=50000 width=16) (actual time=0.027..11.783 rows=50000.00 loops=1)
              Filter: ((archived_at IS NULL) AND (project_id = 'a843a88a-46d0-421d-9534-26dacfe9dff2'::uuid))
              Buffers: shared hit=1209
        ->  Hash  (cost=15.10..15.10 rows=510 width=16) (actual time=0.029..0.029 rows=3.00 loops=1)
              Buckets: 1024  Batches: 1  Memory Usage: 9kB
              Buffers: shared hit=1
              ->  Seq Scan on workflow_statuses ws  (cost=0.00..15.10 rows=510 width=16) (actual time=0.018..0.019 rows=3.00 loops=1)
                    Buffers: shared hit=1
Planning:
  Buffers: shared hit=470
Planning Time: 11.450 ms
Execution Time: 20.700 ms
```

Есть `Seq Scan on issues`: обработаны все 50 000 строк, прочитано 1 210 shared
buffers (1 209 на таблице задач). Внешней сортировки нет.

### Глубокая страница (`LIMIT 200 OFFSET 49800`)

```text
Limit  (cost=12853.73..12854.23 rows=200 width=291) (actual time=84.949..85.132 rows=200.00 loops=1)
  Buffers: shared hit=1216, temp read=1080 written=1083
  ->  Sort  (cost=12729.23..12854.23 rows=50000 width=291) (actual time=72.247..83.393 rows=50000.00 loops=1)
        Sort Key: i.rank, i.id
        Sort Method: external merge  Disk: 8640kB
        Buffers: shared hit=1216, temp read=1080 written=1083
        ->  Hash Join  (cost=21.48..1987.82 rows=50000 width=291) (actual time=0.066..30.820 rows=50000.00 loops=1)
              Hash Cond: (i.status_id = ws.id)
              Buffers: shared hit=1210
              ->  Seq Scan on issues i  (cost=0.00..1834.00 rows=50000 width=291) (actual time=0.030..20.070 rows=50000.00 loops=1)
                    Filter: ((archived_at IS NULL) AND (project_id = 'a843a88a-46d0-421d-9534-26dacfe9dff2'::uuid))
                    Buffers: shared hit=1209
              ->  Hash  (cost=15.10..15.10 rows=510 width=16) (actual time=0.024..0.026 rows=3.00 loops=1)
                    Buckets: 1024  Batches: 1  Memory Usage: 9kB
                    Buffers: shared hit=1
                    ->  Seq Scan on workflow_statuses ws  (cost=0.00..15.10 rows=510 width=16) (actual time=0.014..0.015 rows=3.00 loops=1)
                          Buffers: shared hit=1
Planning:
  Buffers: shared hit=435
Planning Time: 12.777 ms
Execution Time: 96.640 ms
```

Есть `Seq Scan on issues` и внешний merge. Прочитано 1 216 shared buffers,
дополнительно 1 080 temp buffers; записано 1 083 temp buffers.

## Индексы таблицы задач

Проверены обеими требуемыми командами:

```sql
\d+ issues
SELECT * FROM pg_indexes
 WHERE schemaname = 'taskira_perf' AND tablename = 'issues'
 ORDER BY indexname;
```

`\d+` также подтвердил heap access method и все ограничения/FK. Индексы:

```text
issues_pkey                    UNIQUE (id)
issues_key_key                 UNIQUE (key)
issues_project_id_num_key      UNIQUE (project_id, num)
idx_issues_active              (project_id, status_id, rank) WHERE archived_at IS NULL
idx_issues_archive_candidates  (done_at) WHERE done_at IS NOT NULL AND archived_at IS NULL
idx_issues_done_at             (project_id, done_at DESC) WHERE done_at IS NOT NULL
idx_issues_due_date            (due_date) WHERE due_date IS NOT NULL
idx_issues_epic                (epic_id)
idx_issues_parent              (parent_id) WHERE parent_id IS NOT NULL
idx_issues_project_status      (project_id, status_id, rank)
idx_issues_sprint              (sprint_id)
```

Индекс `idx_issues_active` содержит `status_id` между `project_id` и `rank` и
не даёт требуемый общий порядок `(rank, id)` для страницы без фильтра status.
Индекса с порядком, соответствующим измеренному `ORDER BY i.rank, i.id`, нет.

## Параллелизм API

Точка входа `server/src/index.ts` один раз вызывает `buildApp()` и один раз
`app.listen()`. В репозитории нет использования `cluster`, `worker_threads`,
PM2 `instances` или оркестраторной настройки replicas. `docker-compose.yml`
также описывает один сервис `server` без реплик. На измерительном запуске
маршрут обслуживал один процесс Node (PID 14892).

JS handler исполняется на одном event loop. Параллелизм ожидания SQL ограничен
пулом `pg`: `PG_POOL_MAX`, по умолчанию **10**. Поэтому при 200 одновременных
запросах большинство SQL-операций ожидают свободное соединение. Сам PostgreSQL
не однопоточен: план первой страницы запустил один parallel worker.

Это объясняет, почему наличие только одного Node-процесса само по себе не
подтверждает H4: измеренный CPU-bound JS (права, DTO, сериализация) слишком мал,
а наблюдаемая стоимость находится в SQL и ожидании пула.
