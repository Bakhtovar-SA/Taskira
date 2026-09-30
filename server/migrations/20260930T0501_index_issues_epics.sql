-- migration-transaction: none
-- recovery: SELECT indexrelid::regclass, indisvalid FROM pg_index WHERE indexrelid = to_regclass('idx_issues_active_epics'); DROP INDEX CONCURRENTLY IF EXISTS idx_issues_active_epics; затем повторно запустить миграции.
-- EPIC-01: справочник направлений проекта (GET …/issues/epics) в порядке rank — только строки с активными детьми.
-- Требует epic_child_total (20260930T0500).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_issues_active_epics
    ON issues (project_id, rank, id)
    WHERE epic_child_total > 0 AND archived_at IS NULL;
