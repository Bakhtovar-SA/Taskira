-- SEARCH-01: триграммные индексы для текстового поиска задач (фильтр `q`).
-- `ILIKE '%…%'` по title/key не использует btree и на 50 000 задач читает всю
-- таблицу (61–232 мс); GIN по pg_trgm — 1–6 мс.
--
-- «Создавать, если возможно»: pg_trgm — зависимость деплоя (contrib; помечено
-- trusted с PostgreSQL 13, суперпользователь не нужен). Если расширение
-- недоступно (нет contrib, нет права CREATE), миграция НЕ падает: пишет NOTICE
-- и завершается, поиск работает как раньше, только медленнее. Повторный запуск
-- после установки расширения создаст индексы.
--
-- Индексы строятся обычным CREATE INDEX (в транзакции), поэтому на время сборки
-- запись в issues блокируется: ≈1 с на 60 000 строк, растёт линейно. На
-- установке с сотнями тысяч задач создайте их заранее без блокировки:
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_issues_active_title_trgm
--     ON issues USING gin (title gin_trgm_ops) WHERE archived_at IS NULL;
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_issues_active_key_trgm
--     ON issues USING gin (key gin_trgm_ops) WHERE archived_at IS NULL;
-- — миграция увидит их (IF NOT EXISTS) и ничего не заблокирует.
DO $$
DECLARE
  ext_schema text;
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_trgm недоступно (%), триграммные индексы поиска не созданы; поиск по q останется без индекса', SQLERRM;
  END;

  -- Расширение общее для всей БД и может лежать в другой схеме, чем search_path
  -- миграции (например, его создали раньше из другой схемы): класс операторов
  -- берём из той схемы, где оно реально установлено.
  SELECT n.nspname INTO ext_schema
    FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
   WHERE e.extname = 'pg_trgm';

  IF ext_schema IS NOT NULL THEN
    BEGIN
      EXECUTE format('CREATE INDEX IF NOT EXISTS idx_issues_active_title_trgm ON issues USING gin (title %I.gin_trgm_ops) WHERE archived_at IS NULL', ext_schema);
      EXECUTE format('CREATE INDEX IF NOT EXISTS idx_issues_active_key_trgm ON issues USING gin (key %I.gin_trgm_ops) WHERE archived_at IS NULL', ext_schema);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'не удалось создать триграммные индексы (%), поиск по q останется без индекса', SQLERRM;
    END;
  END IF;
END
$$;
