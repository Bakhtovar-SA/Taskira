-- migration-transaction: none
-- recovery: SELECT indexrelid::regclass, indisvalid FROM pg_index WHERE indexrelid = to_regclass('idx_issues_active_sort_priority'); DROP INDEX CONCURRENTLY IF EXISTS idx_issues_active_sort_priority; затем повторно запустить миграции.
-- Сортировка «Списка задач» (priority) по активным задачам проекта. Выражение и
-- порядок колонок совпадают с SORT_EXPR в services/issueFilters.ts; num — тай-брейк
-- (уникален в проекте), индекс читается в обе стороны. Одна команда на файл:
-- CREATE INDEX CONCURRENTLY нельзя запускать в составе нескольких команд.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_issues_active_sort_priority
    ON issues (project_id, ((CASE priority_id WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END)::float8), num)
    WHERE archived_at IS NULL;
