-- ТЗ 3.4 (план v2 Трек 3): полнотекстовый поиск по названию/описанию задачи,
-- комментариям и пунктам чек-листа. Аддитивная миграция — только новые
-- generated-колонки и индексы, ничего существующего не трогает.
--
-- Языковая конфигурация словаря — РЕШЕНО ЯВНО (ТЗ прямо требует зафиксировать
-- выбор, не унести его как побочный эффект): 'simple' (без стемминга),
-- НЕ 'russian'. У проекта i18n RU+EN (src/i18n/) — задачи заводит и
-- русско-, и англоязычная команда в одном проекте; 'russian'-конфигурация
-- стеммит английские слова неправильно (или не стеммит вовсе, в зависимости от
-- словаря), а две колонки на язык ('russian' + 'english' с OR) — сложнее и
-- дороже по месту при текущем масштабе данных без выигрыша, который бы это
-- окупил (SEARCH-01 меряла на 50-60k строк — тот же порядок величины, которым
-- ориентируется и этот выбор). 'simple' находит точные словоформы в обоих
-- языках без грамматической нормализации — хуже ранжирование каждого языка по
-- отдельности, но здесь это не критично: сортировка всё равно идёт по
-- ts_rank, не по абсолютному качеству стемминга.
--
-- Агрегация в ОДИН tsvector через LEFT JOIN на comments/checklist_items (как
-- буквально описано в исходном ТЗ P1-4) НЕВОЗМОЖНА технически: `GENERATED
-- ALWAYS AS` может ссылаться только на колонки ТОЙ ЖЕ строки/таблицы,
-- кросс-табличный JOIN в generated-выражении PostgreSQL не допускает. Поэтому
-- решение здесь — не выбор "по объёму данных" между двумя равноценными
-- вариантами (как ТЗ описывает развилку), а вынужденное: три отдельные
-- generated-колонки (issues/comments/checklist_items), каждая проиндексирована
-- своим GIN; поиск объединяет их запросом с UNION на уровне
-- services/search.ts, а не на уровне схемы (см. этот файл).
--
-- Индексы — обычным CREATE INDEX (не CONCURRENTLY) внутри транзакции, тот же
-- компромисс, что уже задокументирован в SEARCH-01 (20260920T1420): блокировка
-- записи на время сборки, на больших инсталляциях — собрать заранее
-- CONCURRENTLY по тому же рецепту.
ALTER TABLE issues
  ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', title || ' ' || description)) STORED;
CREATE INDEX idx_issues_search_vector ON issues USING gin (search_vector);

ALTER TABLE comments
  ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', body)) STORED;
CREATE INDEX idx_comments_search_vector ON comments USING gin (search_vector);

ALTER TABLE checklist_items
  ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', text)) STORED;
CREATE INDEX idx_checklist_items_search_vector ON checklist_items USING gin (search_vector);
