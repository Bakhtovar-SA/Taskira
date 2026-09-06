-- ============================================================
-- Taskira. Миграция 004: ролевая модель, привязанная к проекту.
-- Применяется server/src/db.ts migrate() целиком в одной транзакции.
-- См. ROLE_MIGRATION.md (раздел 3 — решения, Фаза 1).
--
-- МОДЕЛЬ (двухуровневая):
--   users.global_role  — глобальная роль ресурса: admin | member.
--                        admin один на весь ресурс: создаёт отделы, проекты,
--                        пользователей; неявно имеет полные права в любом
--                        проекте. Права editWorkflow / manageAccess — только у него.
--   project_members    — членство пользователя в проекте + роль в нём:
--                        manager | employee | viewer. manager — руководитель
--                        своего проекта (ставит/правит/удаляет задачи, спринты).
--
-- Эффективная роль для матрицы прав (server/src/permissions.ts, Фаза 2):
--   global_role = 'admin'  -> 'admin'
--   иначе                  -> project_members.role, либо нет доступа (403).
--
-- access_role НЕ удаляется на этом шаге — параллельный прогон со старой
-- моделью; дроп отдельной миграцией (006) после верификации.
-- ============================================================

-- 1) Глобальная роль: admin | member (по умолчанию member)
ALTER TABLE users ADD COLUMN IF NOT EXISTS global_role text NOT NULL DEFAULT 'member'
  CHECK (global_role IN ('admin', 'member'));

UPDATE users SET global_role = 'admin' WHERE access_role = 'admin';

-- 2) Членство в проекте + проектная роль
CREATE TABLE IF NOT EXISTS project_members (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('manager', 'employee', 'viewer')),
  added_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members (user_id);

-- 3) Бэкфилл: активные пользователи, КРОМЕ admin, становятся участниками
--    существующего единственного проекта. admin в состав проекта не входит —
--    доступ он получает через global_role (правило ROLE_MIGRATION.md §3.3).
--    Маппинг: manager -> manager, viewer -> viewer, всё остальное
--    (employee / бывш. developer) -> employee.
--    На чистой БД (миграции идут до сида) users/projects пусты — вставка
--    ничего не делает, создаётся только структура.
INSERT INTO project_members (project_id, user_id, role)
SELECT p.id, u.id,
       CASE u.access_role
         WHEN 'manager' THEN 'manager'
         WHEN 'viewer'  THEN 'viewer'
         ELSE 'employee'
       END
FROM users u
CROSS JOIN (SELECT id FROM projects ORDER BY created_at LIMIT 1) p
WHERE u.is_active
  AND u.access_role <> 'admin'
ON CONFLICT (project_id, user_id) DO NOTHING;
