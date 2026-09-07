-- ============================================================
-- Taskira. Миграция 008: участники задачи (issue collaborators).
-- Применяется server/src/db.ts migrate() целиком в одной транзакции.
-- См. COLLAB_MIGRATION.md (раздел «РЕШЕНО» D1, Фаза 1).
--
-- МОДЕЛЬ:
--   issue_collaborators — приглашённый к ОДНОЙ задаче человек. Видит эту задачу
--   и её комментарии, может комментировать. НЕ участник проекта: списка задач,
--   доски, бэклога, состава и самого проекта в переключателе не видит; в
--   исполнители не назначается (проверка assignee = admin ∪ project_members
--   уже это гарантирует, DEPT_MIGRATION.md §3.6).
--
-- ENFORCEMENT (Фаза 2): аддитивный fallback в middleware requireIssuePerm —
--   если ролевой can() не прошёл, perm ∈ {browse, comment} и есть строка
--   issue_collaborators(issue, user) → доступ. MATRIX / resolveRole не меняются.
--   Список задач и bootstrap проекта идут через requirePerm("browse") без
--   контекста задачи — там collaborator по-прежнему 403 (бэклог не течёт).
--
-- Бэкфилла нет — новая возможность. Каскады: удаление задачи (или проекта →
-- issues) снимает строки issue_collaborators.
-- ============================================================

CREATE TABLE issue_collaborators (
  issue_id  uuid NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  added_by  uuid REFERENCES users(id) ON DELETE SET NULL,  -- кто подключил (для аудита/UI)
  added_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (issue_id, user_id)
);

-- «Мои подключения» (Фаза 6, GET /api/issues/collaborating) и проверка
-- isIssueCollaborator — обе бьют по user_id.
CREATE INDEX idx_issue_collaborators_user ON issue_collaborators (user_id);
