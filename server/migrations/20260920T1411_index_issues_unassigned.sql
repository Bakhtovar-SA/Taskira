-- migration-transaction: none
-- recovery: SELECT indexrelid::regclass, indisvalid FROM pg_index WHERE indexrelid = to_regclass('idx_issues_active_unassigned'); DROP INDEX CONCURRENTLY IF EXISTS idx_issues_active_unassigned; затем повторно запустить миграции.
-- «Нераспределённые» активные задачи проекта: счётчик по статусам (index-only) и
-- страницы в порядке rank с фильтром по статусу. Требует has_assignee (20260920T1410).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_issues_active_unassigned
    ON issues (project_id, status_id, rank)
    WHERE archived_at IS NULL AND has_assignee = false;
