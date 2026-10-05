-- migration-transaction: none
-- recovery: SELECT indexrelid::regclass, indisvalid FROM pg_index WHERE indexrelid = to_regclass('idx_webhook_deliveries_queue'); DROP INDEX CONCURRENTLY IF EXISTS idx_webhook_deliveries_queue; затем повторно запустить миграции.
-- INT-04: до четырёх строк каждой подписки читаются в порядке очереди без сканирования
-- чужого backlog. Старый индекс оставлен; удаление — отдельный contract.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_webhook_deliveries_queue
    ON webhook_deliveries (webhook_id, next_attempt_at, id) WHERE state IN ('pending', 'sending');
