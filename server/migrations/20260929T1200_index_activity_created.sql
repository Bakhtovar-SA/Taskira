-- migration-transaction: none
-- recovery: SELECT indexrelid::regclass, indisvalid FROM pg_index WHERE indexrelid = to_regclass('idx_activity_created'); DROP INDEX CONCURRENTLY IF EXISTS idx_activity_created; затем повторно запустить миграции.
-- Виджет «Активность» дашборда (ADR-0022): последние записи истории по многим проектам. Без индекса запрос
-- сортирует всю таблицу activity (на 150 000 строк — 114 мс), с ним идёт от новых и останавливается на LIMIT (1–3 мс).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activity_created ON activity (created_at DESC);
