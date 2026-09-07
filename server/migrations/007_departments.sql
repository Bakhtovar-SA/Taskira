-- ============================================================
-- Taskira. Миграция 007: департаменты + подготовка к multi-project.
-- Применяется server/src/db.ts migrate() целиком в одной транзакции.
-- См. DEPT_MIGRATION.md (раздел 3 — решения, Фаза 1).
--
-- МОДЕЛЬ:
--   departments            — отдел организации; ldap_group_dn заполняется на
--                            этапе LDAP-синхронизации (тогда же — UNIQUE).
--   projects.department_id — «дом» проекта (NOT NULL после бэкфилла).
--   projects.is_shared     — виден за пределами своего департамента (флаг, не NULL).
--
-- Видимость проекта (временно, до LDAP, DEPT_MIGRATION.md §3.5):
--   участник project_members ИЛИ is_shared ИЛИ глобальный admin.
--
-- Ролевые таблицы (project_members, workflow_*, sprints, issues, project_counters)
-- уже несут project_id — миграции не требуют.
-- ============================================================

CREATE TABLE departments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL UNIQUE,
  ldap_group_dn text,                       -- LDAP-этап: заполнение + UNIQUE
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE projects ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES departments(id);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS is_shared     boolean NOT NULL DEFAULT false;

-- Дефолтный департамент «Общий отдел» + привязка всех существующих проектов.
-- is_shared = true: у pre-departments проекта состав кросс-департаментный,
-- принадлежность не угадываем — оставляем видимым всем (DEPT_MIGRATION.md §3.1).
-- На чистой БД (миграции до сида) projects пуст — UPDATE не трогает строк,
-- создаётся только сам департамент; seedProject() затем его переиспользует.
WITH d AS (
  INSERT INTO departments (name) VALUES ('Общий отдел')
  ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
  RETURNING id
)
UPDATE projects
   SET department_id = (SELECT id FROM d),
       is_shared     = true
 WHERE department_id IS NULL;

ALTER TABLE projects ALTER COLUMN department_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_projects_department ON projects (department_id);
