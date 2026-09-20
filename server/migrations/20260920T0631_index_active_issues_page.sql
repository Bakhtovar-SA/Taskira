-- migration-transaction: none
-- recovery: SELECT indexrelid::regclass, indisvalid FROM pg_index WHERE indexrelid = to_regclass('idx_issues_project_rank_active'); DROP INDEX CONCURRENTLY IF EXISTS idx_issues_project_rank_active; затем повторно запустить миграции.
-- CREATE INDEX CONCURRENTLY нельзя выполнять внутри BEGIN. При обрыве PostgreSQL
-- может оставить indisvalid=false; runner не отметит миграцию применённой, а
-- команда recovery выше безопасно удаляет частичный объект перед повтором.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_issues_project_rank_active
    ON issues (project_id, rank, id)
    WHERE archived_at IS NULL;
