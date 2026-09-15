-- ============================================================
-- Taskira. Миграция 025: несколько исполнителей на задаче.
-- Применяется server/src/db.ts migrate() целиком в одной транзакции.
--
-- Раньше issues.assignee_id — один nullable FK. Разбор задач показал, что
-- задачу часто ведут вдвоём-втроём, а единственный assignee вынуждал
-- назначать "главного" произвольно или вообще никого. Не путать с
-- issue_collaborators (миграция 008): тот приглашён к ОДНОЙ задаче, видит её
-- и комментирует, но исполнителем никогда не становится — это осталось
-- неизменным, issue_assignees ниже с ним не пересекается.
--
-- МОДЕЛЬ: issue_assignees — тот же join-table приём, что issue_collaborators,
-- без иерархии: список исполнителей плоский, "основной" не выделяется.
-- added_by — кто назначил (аудит/UI), как issue_collaborators.added_by.
--
-- "Своя задача" (employee редактирует только свою — server/src/permissions.ts
-- isOwnIssue) расширяется: был assigneeId === я, стало assigneeIds.includes(я)
-- (или reporterId === я, как и раньше) — любой из исполнителей, не только
-- единственный.
--
-- БЭКФИЛЛ: существующий issues.assignee_id построчно переносится в
-- issue_assignees (added_by оставляем NULL — кто именно назначил исторически,
-- в issues эта информация не хранилась, врать было бы хуже, чем не знать).
-- После переноса колонка и её индекс удаляются; второй отдельный столбец
-- "основной исполнитель" сознательно не заводим — список исполнителей плоский,
-- как и issue_collaborators.
-- ============================================================

CREATE TABLE issue_assignees (
  issue_id  uuid NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  added_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  added_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (issue_id, user_id)
);

-- Фильтр "назначено мне" (GET /issues?assignee=, GET /issues/assigned-to-me,
-- отчёты) — все бьют по user_id.
CREATE INDEX idx_issue_assignees_user ON issue_assignees (user_id);

INSERT INTO issue_assignees (issue_id, user_id, added_by, added_at)
  SELECT id, assignee_id, NULL, created_at FROM issues WHERE assignee_id IS NOT NULL;

-- DROP COLUMN снимает и idx_issues_assignee — индекс существовал только на
-- этом столбце, Postgres роняет такие индексы автоматически вместе с ним.
ALTER TABLE issues DROP COLUMN assignee_id;
