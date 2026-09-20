-- migration-transaction: none
-- recovery: SELECT indexrelid::regclass, indisvalid FROM pg_index WHERE indexrelid = to_regclass('idx_issues_active_sort_due'); DROP INDEX CONCURRENTLY IF EXISTS idx_issues_active_sort_due; затем повторно запустить миграции.
-- Сортировка «Списка задач» (due) по активным задачам проекта. Выражение и
-- порядок колонок совпадают с SORT_EXPR в services/issueFilters.ts; num — тай-брейк
-- (уникален в проекте), индекс читается в обе стороны. Одна команда на файл:
-- CREATE INDEX CONCURRENTLY нельзя запускать в составе нескольких команд.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_issues_active_sort_due
    ON issues (project_id, (COALESCE((due_date - DATE '1970-01-01'), 1000000)::float8), num)
    WHERE archived_at IS NULL;
