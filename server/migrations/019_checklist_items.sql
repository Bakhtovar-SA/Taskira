-- ============================================================
-- Taskira. Миграция 019: чек-листы на задаче.
-- Применяется server/src/db.ts migrate() целиком в одной транзакции.
--
-- МОДЕЛЬ (сознательно минимальная, по образцу issue_links — миграция 014):
--   один пункт = одна строка. `position` — целое, назначается один раз при
--   создании (COALESCE(MAX(position)+1, 0) в самом INSERT, см.
--   services/checklist.ts) и не пересчитывается: reorder не входит в v1 —
--   если понадобится drag-and-drop, тогда и переходить на дробный rank
--   (issues.rank, rank.ts), а не заводить его заранее ради гипотетической фичи.
--   Прав отдельной модели нет: пунктами управляет тот, у кого есть `edit` на
--   задачу (requireIssuePerm('edit')) — тот же принцип, что у issue_links.
--
-- КАСКАД: удаление задачи уносит все её пункты.
-- Обратима: DROP TABLE checklist_items. Бэкфилла нет.
-- ============================================================

CREATE TABLE checklist_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id    uuid NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  text        text NOT NULL,
  done        boolean NOT NULL DEFAULT false,
  position    integer NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Список пункто́в задачи всегда читается целиком, отсортированным по позиции.
CREATE INDEX idx_checklist_items_issue ON checklist_items (issue_id, position);
