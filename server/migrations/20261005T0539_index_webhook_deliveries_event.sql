-- migration-transaction: none
-- recovery: SELECT indexrelid::regclass, indisvalid FROM pg_index WHERE indexrelid = to_regclass('idx_webhook_deliveries_event'); DROP INDEX CONCURRENTLY IF EXISTS idx_webhook_deliveries_event; затем повторно запустить миграции.
-- INT-04: ON DELETE CASCADE при очистке событий ищет доставки по event_id.
-- Составной уникальный индекс (webhook_id, event_id) не покрывает этот поиск.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_webhook_deliveries_event ON webhook_deliveries (event_id);
