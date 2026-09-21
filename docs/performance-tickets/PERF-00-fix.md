# PERF-00: устранение подтверждённых полных проходов

Дата повторного измерения: 20 сентября 2026 года.

## Scope

Работа основана только на подтверждённых выводах
[`PERF-00-diagnosis.md`](./PERF-00-diagnosis.md): H1 (`count(*)` на каждой
странице) и H2 (Seq Scan + Sort из-за отсутствующего порядка индекса).

Не менялись keyset-пагинация, клиентская последовательная загрузка страниц и
формат самих элементов списка.

## Изменения

- Добавлен частичный составной индекс
  `idx_issues_project_rank_active (project_id, rank, id) WHERE archived_at IS NULL`.
  `project_id` — равенство базового фильтра; partial predicate — активный набор;
  `rank, id` — точный стабильный `ORDER BY` handler.
- Миграция `20260920T0631_index_active_issues_page.sql` выполняет
  `CREATE INDEX CONCURRENTLY` вне транзакции. Runner поддерживает маркер
  `-- migration-transaction: none`, проверяет `pg_index.indisvalid` до записи в
  `schema_migrations` и требует строку recovery.
- По умолчанию список выбирает `limit + 1`, возвращает `hasMore` и не запускает
  `count(*)`. Точный `total` доступен только с `includeTotal=1|true`.
- UI продолжает последовательно дочитывать те же offset-страницы, но завершает
  цикл по `hasMore`; итоговый total равен числу реально загруженных элементов.
- Проверены соседние списки:
  - кросс-проектный поиск уже использовал `LIMIT N+1` и `truncated`, без count;
  - audit export уже использовал `LIMIT N+1` и заголовок truncated, без count;
  - лента уведомлений использовала `LIMIT N+1`, но дополнительно считала unread
    на каждой странице. Count удалён из страницы; точное число запрашивается
    существующим явным `/api/notifications/unread-count`.

## До/после: baseline одного запроса

Тот же стенд и методика, что в PERF-00: 50 000 активных задач, PostgreSQL 18.6,
Node 24.20.0, один последовательный клиент, 5 запросов прогрева, затем 10
измеряемых запросов, `limit=200`.

| Страница | До, медиана | После, медиана | Изменение | После min–max |
|---|---:|---:|---:|---:|
| Первая, offset 0 | 100,952 мс | **17,699 мс** | **−82,5%** | 10,179–24,504 мс |
| Глубокая, offset 49 800 | 127,934 мс | **44,249 мс** | **−65,4%** | 33,099–49,278 мс |

Значения после, первая страница: `13.760, 18.335, 17.145, 15.418,
24.504, 21.870, 23.147, 11.732, 18.253, 10.179` мс.

Значения после, глубокая страница: `43.895, 33.099, 33.845, 43.454,
49.126, 44.603, 46.977, 49.278, 45.251, 34.741` мс.

Контроль opt-in: первая страница с `includeTotal=1` вернула `total=50000` за
33,162 мс. Без параметра поле `total` отсутствует.

## EXPLAIN после изменения

Фактический запрос сервера использует `LIMIT 201`: лишняя строка формирует
`hasMore`, наружу по-прежнему возвращается не более 200 элементов.

### Первая страница

```text
Limit  (cost=0.57..26.19 rows=201 width=291) (actual time=0.156..0.312 rows=201.00 loops=1)
  Buffers: shared hit=11
  ->  Nested Loop  (cost=0.57..6374.11 rows=50000 width=291) (actual time=0.154..0.299 rows=201.00 loops=1)
        Buffers: shared hit=11
        ->  Index Scan using idx_issues_project_rank_active on issues i  (cost=0.41..5124.91 rows=50000 width=291) (actual time=0.037..0.120 rows=201.00 loops=1)
              Index Cond: (project_id = 'a843a88a-46d0-421d-9534-26dacfe9dff2'::uuid)
              Index Searches: 1
              Buffers: shared hit=9
        ->  Memoize  (cost=0.16..0.18 rows=1 width=16) (actual time=0.001..0.001 rows=1.00 loops=201)
              Cache Key: i.status_id
              Cache Mode: logical
              Hits: 200  Misses: 1  Evictions: 0  Overflows: 0  Memory Usage: 1kB
              Buffers: shared hit=2
              ->  Index Only Scan using workflow_statuses_pkey on workflow_statuses ws  (cost=0.15..0.17 rows=1 width=16) (actual time=0.107..0.107 rows=1.00 loops=1)
                    Index Cond: (id = i.status_id)
                    Heap Fetches: 1
                    Index Searches: 1
                    Buffers: shared hit=2
Planning:
  Buffers: shared hit=454 read=1 dirtied=1
Planning Time: 19.653 ms
Execution Time: 0.419 ms
```

### Глубокая страница

```text
Limit  (cost=6348.62..6374.11 rows=200 width=291) (actual time=40.888..41.044 rows=200.00 loops=1)
  Buffers: shared hit=1575
  ->  Nested Loop  (cost=0.57..6374.11 rows=50000 width=291) (actual time=0.149..39.519 rows=50000.00 loops=1)
        Buffers: shared hit=1575
        ->  Index Scan using idx_issues_project_rank_active on issues i  (cost=0.41..5124.91 rows=50000 width=291) (actual time=0.055..23.046 rows=50000.00 loops=1)
              Index Cond: (project_id = 'a843a88a-46d0-421d-9534-26dacfe9dff2'::uuid)
              Index Searches: 1
              Buffers: shared hit=1569
        ->  Memoize  (cost=0.16..0.18 rows=1 width=16) (actual time=0.000..0.000 rows=1.00 loops=50000)
              Cache Key: i.status_id
              Cache Mode: logical
              Hits: 49997  Misses: 3  Evictions: 0  Overflows: 0  Memory Usage: 1kB
              Buffers: shared hit=6
              ->  Index Only Scan using workflow_statuses_pkey on workflow_statuses ws  (cost=0.15..0.17 rows=1 width=16) (actual time=0.029..0.029 rows=1.00 loops=3)
                    Index Cond: (id = i.status_id)
                    Heap Fetches: 3
                    Index Searches: 3
                    Buffers: shared hit=6
Planning:
  Buffers: shared hit=455
Planning Time: 14.576 ms
Execution Time: 41.128 ms
```

Обе страницы используют `Index Scan`; `Seq Scan`, `Sort` и temp buffers
исчезли. Глубокий OFFSET по-прежнему проходит 50 000 записей индекса — переход
на keyset намеренно оставлен отдельной задачей.

## Восстановление миграции

Если `CREATE INDEX CONCURRENTLY` был прерван:

```sql
SELECT indexrelid::regclass, indisvalid
  FROM pg_index
 WHERE indexrelid = to_regclass('idx_issues_project_rank_active');
DROP INDEX CONCURRENTLY IF EXISTS idx_issues_project_rank_active;
```

После этого повторно запустить приложение/миграции. CI искусственно отменяет
идущий concurrent build, проверяет оставшийся `indisvalid=false` и выполнение
идемпотентного recovery. Upgrade smoke со snapshot `schema-023-d6c3966.sql`
успешно применил все миграции до `20260920T0631_index_active_issues_page.sql`,
запустил API и сохранил probe-данные.
