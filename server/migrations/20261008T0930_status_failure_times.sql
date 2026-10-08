-- Время окончательного почтового отказа и индексы суточных ошибок состояния системы.
ALTER TABLE notifications ADD COLUMN email_failed_at timestamptz;
-- Исторические строки остаются NULL: время их отказа неизвестно и не подменяется временем создания.
CREATE INDEX idx_notifications_email_failed_at ON notifications (email_failed_at) WHERE email_state = 'failed';
CREATE INDEX idx_recurring_runs_failed_at ON recurring_runs (ran_at) WHERE result = 'failed';
