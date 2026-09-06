-- ============================================================
-- Taskira. Миграция 003: счётчики номеров задач.
--
-- nextIssueNum() берёт номер атомарным UPSERT'ом:
--   INSERT ... ON CONFLICT DO UPDATE SET next_num = next_num + 1 RETURNING
-- Это гонко-безопасно без явных блокировок и быстрее, чем
-- SELECT MAX(num) + 1 даже под FOR UPDATE.
-- ============================================================

CREATE TABLE project_counters (
  project_id uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  next_num   int  NOT NULL DEFAULT 1 CHECK (next_num > 0)
);
