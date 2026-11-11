-- migration-transaction: none
-- recovery: SELECT indexrelid::regclass, indisvalid FROM pg_index WHERE indexrelid = to_regclass('idx_recurring_runs_issue'); DROP INDEX CONCURRENTLY IF EXISTS idx_recurring_runs_issue; затем повторно запустить миграции.
-- Метка повторения на карточке (issueRepeatBatch, GET …/issues) и issueRecurringRule ищут запуски по issue_id, а у recurring_runs
-- были только индексы по (rule_id, …) и по ran_at: вторая ветка запроса сканировала таблицу, растущую на строку за каждое повторение.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_recurring_runs_issue
    ON recurring_runs (issue_id)
    WHERE issue_id IS NOT NULL;
