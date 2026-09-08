-- ============================================================
-- Taskira. Миграция 014: связи между задачами (relates / blocks).
-- Применяется server/src/db.ts migrate() целиком в одной транзакции.
-- См. ticket-features-polish-round4.md §3.2.
--
-- МОДЕЛЬ (сознательно минимальная — избыточная гибкость типов связей на
--   старте не нужна, ticket §3.2):
--     link_type = 'relates' — СИММЕТРИЧНАЯ «связана с». Одна строка на пару;
--       чтобы A→B и B→A не дублировались, роут нормализует порядок
--       (issue_id < linked_issue_id лексикографически) перед вставкой.
--     link_type = 'blocks'  — НАПРАВЛЕННАЯ: issue_id блокирует linked_issue_id.
--       Обратная сторона («заблокирована задачей …») выводится на клиенте из
--       той же строки, отдельной записи нет.
--
--   Обе задачи всегда в одном проекте (single-project deployment, project.ts).
--   Отдельной модели прав на связь нет: линковать может тот, у кого есть `edit`
--   на ИСХОДНУЮ задачу (requireIssuePerm('edit')), и обе задачи должны быть ему
--   видимы — проверяется в роуте, чтобы не раскрывать существование задач.
--
-- КАСКАД: удаление любой из двух задач (или проекта → issues) уносит строку.
--   Удаление автора связи — created_by → NULL (связь остаётся).
-- Обратима: DROP TABLE issue_links. Бэкфилла нет.
-- ============================================================

CREATE TABLE issue_links (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id        uuid NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  linked_issue_id uuid NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  link_type       text NOT NULL CHECK (link_type IN ('relates', 'blocks')),
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT issue_links_not_self CHECK (issue_id <> linked_issue_id),
  -- одна связь данного типа на упорядоченную пару; для 'relates' порядок
  -- нормализует роут, для 'blocks' направление значимо.
  CONSTRAINT issue_links_uniq UNIQUE (issue_id, linked_issue_id, link_type)
);

-- Выборка связей задачи идёт с обеих сторон (issue_id ИЛИ linked_issue_id).
CREATE INDEX idx_issue_links_issue  ON issue_links (issue_id);
CREATE INDEX idx_issue_links_linked ON issue_links (linked_issue_id);
