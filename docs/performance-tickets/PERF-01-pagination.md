# PERF-01 — курсорная пагинация списка задач

Статус: keyset-пагинация выполнена 20 сентября 2026 года. Ленивая загрузка
страниц в UI остаётся отдельной работой: этот PR не меняет момент загрузки и
формат элементов списка.

## Основание

После PERF-00/PERF-01-index глубокая offset-страница оставалась измеримо
дороже первой: **44,249 мс** против **17,699 мс**, то есть в 2,5 раза.
`OFFSET 49800` использовал правильный индекс, но всё равно читал 50 000 строк
и отбрасывал первые 49 800. Условие перехода к keyset выполнено по замеру.

## Контракт и совместимость

- Сортировка не менялась: `ORDER BY i.rank, i.id ASC`.
- Ответ содержит подписанный непрозрачный `nextCursor` или `null`.
- Курсор — бинарная версия + IEEE-754 `rank` + UUID + усечённый HMAC-SHA256,
  закодированные base64url. В нём нет JSON и внешнего контракта имён полей.
- Следующая страница добавляет точный предикат
  `(i.rank, i.id) > ($lastRank, $lastId)` и использует индекс
  `idx_issues_project_rank_active (project_id, rank, id)` из PERF-00 fix.
- `offset` и `hasMore` сохранены на один expand-релиз. Если переданы и cursor,
  и offset, cursor имеет приоритет. Удаление offset — отдельный релиз.
- Zod-схема `IssueListPageMeta` — источник истины. Скрипт
  `server/scripts/generate-client-contracts.mjs` формирует клиентский тип (удалён в ТЗ 2.1: клиент теперь
  импортирует `IssueListPageMeta` из `server/src/contract.ts` напрямую);
  CI проверяет, что сгенерированный файл актуален.
- Клиент хранит cursor только в локальной переменной последовательного обхода.
  URL и сохранённые фильтры его не содержат.

## Baseline до/после

Тот же изолированный стенд `taskira_perf`: 50 000 активных задач, PostgreSQL
18.6, Node 24.20.0, один последовательный клиент, `limit=200`. Для каждой
точки: 5 запросов прогрева и 10 измеряемых. Глубокий cursor получен
последовательным обходом 249 страниц и указывает на позицию 49 800.

| Страница | Offset до | Cursor после | После min–max |
|---|---:|---:|---:|
| Первая | 17,699 мс | **13,982 мс** | 8,800–19,891 мс |
| Глубокая, позиция 49 800 | 44,249 мс | **15,291 мс** | 8,363–20,588 мс |

Первая страница, значения после: `11.843, 18.714, 12.215, 18.705,
15.827, 9.778, 19.891, 15.749, 9.983, 8.800` мс.

Глубокая cursor-страница, значения после: `12.480, 9.633, 20.588,
17.253, 14.946, 15.049, 15.757, 15.532, 16.233, 8.363` мс.

Глубокая страница теперь отличается от первой на **1,309 мс / 9,4%** и
укладывается в тот же наблюдаемый диапазон. Главный критерий выполнен.
Замер воспроизводится скриптом
`server/scripts/performance-cursor-baseline.mjs`.

## EXPLAIN (ANALYZE, BUFFERS)

### Первая страница

```text
Limit  (cost=0.57..26.19 rows=201 width=291) (actual time=0.133..0.290 rows=201.00 loops=1)
  Buffers: shared hit=11
  ->  Nested Loop  (cost=0.57..6374.11 rows=50000 width=291) (actual time=0.131..0.276 rows=201.00 loops=1)
        Buffers: shared hit=11
        ->  Index Scan using idx_issues_project_rank_active on issues i  (cost=0.41..5124.91 rows=50000 width=291) (actual time=0.037..0.118 rows=201.00 loops=1)
              Index Cond: (project_id = 'a843a88a-46d0-421d-9534-26dacfe9dff2'::uuid)
              Index Searches: 1
              Buffers: shared hit=9
        ->  Memoize  (cost=0.16..0.18 rows=1 width=16) (actual time=0.001..0.001 rows=1.00 loops=201)
              Cache Key: i.status_id
              Cache Mode: logical
              Hits: 200  Misses: 1  Evictions: 0  Overflows: 0  Memory Usage: 1kB
              Buffers: shared hit=2
              ->  Index Only Scan using workflow_statuses_pkey on workflow_statuses ws  (cost=0.15..0.17 rows=1 width=16) (actual time=0.084..0.084 rows=1.00 loops=1)
                    Index Cond: (id = i.status_id)
                    Heap Fetches: 1
                    Index Searches: 1
                    Buffers: shared hit=2
Planning:
  Buffers: shared hit=445
Planning Time: 12.776 ms
Execution Time: 0.387 ms
```

### Глубокая cursor-страница после позиции 49 800

```text
Limit  (cost=0.57..345.48 rows=199 width=291) (actual time=0.044..0.259 rows=200.00 loops=1)
  Buffers: shared hit=15
  ->  Nested Loop  (cost=0.57..345.48 rows=199 width=291) (actual time=0.043..0.245 rows=200.00 loops=1)
        Buffers: shared hit=15
        ->  Index Scan using idx_issues_project_rank_active on issues i  (cost=0.41..338.90 rows=199 width=291) (actual time=0.031..0.161 rows=200.00 loops=1)
              Index Cond: ((project_id = 'a843a88a-46d0-421d-9534-26dacfe9dff2'::uuid) AND (ROW(rank, id) > ROW('49800'::double precision, '74cce3ab-c92b-4249-8c51-1fad42725888'::uuid)))
              Index Searches: 1
              Buffers: shared hit=11
        ->  Memoize  (cost=0.16..0.42 rows=1 width=16) (actual time=0.000..0.000 rows=1.00 loops=200)
              Cache Key: i.status_id
              Cache Mode: logical
              Hits: 198  Misses: 2  Evictions: 0  Overflows: 0  Memory Usage: 1kB
              Buffers: shared hit=4
              ->  Index Only Scan using workflow_statuses_pkey on workflow_statuses ws  (cost=0.15..0.41 rows=1 width=16) (actual time=0.005..0.005 rows=1.00 loops=2)
                    Index Cond: (id = i.status_id)
                    Heap Fetches: 2
                    Index Searches: 2
                    Buffers: shared hit=4
Planning:
  Buffers: shared hit=13
Planning Time: 0.333 ms
Execution Time: 0.319 ms
```

В обоих планах используется `Index Scan`; `Seq Scan`, `Sort` и temp buffers
отсутствуют. Глубокий запрос читает 200 строк результата и 15 shared buffers,
а не 50 000 строк и 1 575 buffers, как offset-вариант до изменения.

## Проверки корректности

- Интеграционный тест фиксирует набор, читает первую страницу, вставляет новую
  задачу перед cursor и дочитывает список: исходные записи не теряются и не
  дублируются, новая строка позади cursor повторно не сдвигает окно.
- Повреждённый или подписанный другим ключом cursor отклоняется с HTTP 400.
- Старый `offset` покрыт тестом и продолжает возвращать прежние страницы.
- Нумерация страниц не добавлялась; сортировка и элементы списка не менялись.
