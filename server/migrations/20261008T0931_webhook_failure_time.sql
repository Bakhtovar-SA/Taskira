-- Historical failure times are unknown; do not infer them from mutable updated_at.
ALTER TABLE webhook_deliveries ADD COLUMN failed_at timestamptz;
CREATE INDEX idx_webhook_deliveries_failed_time ON webhook_deliveries(failed_at) WHERE state = 'failed';
