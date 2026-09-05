-- ============================================================
-- Taskira. Миграция 002: корпоративная модель (не Jira-клон).
-- Применяется server/src/db.ts migrate() целиком в одной транзакции.
--
-- РОЛИ:  developer → employee («Сотрудник»).
-- ТИПЫ:  допустимы task | bug | request.
--        Маппинг данных (необратим, зафиксирован решением):
--          story → task   пользовательская история ведётся как обычная задача;
--          epic  → task   «эпик» упразднён как отдельный тип. Группировка
--                         крупных инициатив сохраняется через issues.epic_id
--                         (опциональное поле, не развивается), поля таймлайна
--                         t_start/t_span оставлены для обратной совместимости.
--        request — новый тип: запрос внутреннего заказчика (IT-услуги, доступы).
-- ============================================================

-- 1) users: employee вместо developer + признак активности аккаунта
UPDATE users SET access_role = 'employee' WHERE access_role = 'developer';

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_access_role_check;
ALTER TABLE users
  ADD CONSTRAINT users_access_role_check
  CHECK (access_role IN ('admin', 'manager', 'employee', 'viewer'));
ALTER TABLE users ALTER COLUMN access_role SET DEFAULT 'employee';

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- 2) issues: новые типы + срок исполнения
UPDATE issues SET type_id = 'task' WHERE type_id IN ('story', 'epic');

ALTER TABLE issues DROP CONSTRAINT IF EXISTS issues_type_id_check;
ALTER TABLE issues
  ADD CONSTRAINT issues_type_id_check
  CHECK (type_id IN ('task', 'bug', 'request'));

ALTER TABLE issues ADD COLUMN IF NOT EXISTS due_date date NULL;
-- points и sprint_id остаются nullable: спринт-модуль опционален.
-- epic_id остаётся nullable как опциональная группировка (без развития).

-- 3) Наблюдатели задач (подписки на изменения)
CREATE TABLE IF NOT EXISTS issue_watchers (
  issue_id uuid NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  user_id  uuid NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  PRIMARY KEY (issue_id, user_id)
);

-- 4) Фильтры по срокам: частичный индекс только по заполненным датам
CREATE INDEX IF NOT EXISTS idx_issues_due_date
  ON issues (due_date) WHERE due_date IS NOT NULL;
