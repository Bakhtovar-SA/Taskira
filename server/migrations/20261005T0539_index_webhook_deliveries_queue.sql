-- migration-transaction: none
-- recovery: SELECT indexrelid::regclass, indisvalid FROM pg_index WHERE indexrelid = to_regclass('idx_webhook_deliveries_queue'); DROP INDEX CONCURRENTLY IF EXISTS idx_webhook_deliveries_queue; затем повторно запустить миграции.
-- INT-04: LIMIT 16 должен читать очередь по индексу, включая одинаковое next_attempt_at
-- у всей пачки. Старый индекс оставлен для совместимости; удаление — отдельный contract.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_webhook_deliveries_queue
    ON webhook_deliveries (next_attempt_at, id) WHERE state IN ('pending', 'sending');
