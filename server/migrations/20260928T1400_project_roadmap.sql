-- ТЗ 5.15: роадмап проектов — проекты полосами во времени, вехи, зависимости между проектами.
--
--   projects.start_date / target_date — необязательные даты начала и цели (date, без времени и пояса).
--   project_milestones                — вехи проекта: название, дата, порядок (position — при вставке, как у
--                                       checklist_items; переупорядочивания в v1 нет, сортировка — по дате).
--   project_dependencies              — «зависимый проект ждёт проект-источник». Циклы запрещает сервер
--                                       (services/roadmap.ts: проверка под advisory-блокировкой в той же транзакции);
--                                       здесь — только запрет петли на себя.
--
-- Аддитивная (expand) миграция: nullable-колонки и новые таблицы, старый код их не читает.
-- Удаление проекта каскадно убирает его вехи и зависимости в обе стороны.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS start_date date;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS target_date date;
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_roadmap_dates_ck;
ALTER TABLE projects ADD CONSTRAINT projects_roadmap_dates_ck
  CHECK (start_date IS NULL OR target_date IS NULL OR start_date <= target_date);

CREATE TABLE IF NOT EXISTS project_milestones (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name       text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  date       date NOT NULL,
  position   integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_milestones_project_idx ON project_milestones (project_id, date);

CREATE TABLE IF NOT EXISTS project_dependencies (
  source_project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  dependent_project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_project_id, dependent_project_id),
  CHECK (source_project_id <> dependent_project_id)
);
CREATE INDEX IF NOT EXISTS project_dependencies_dependent_idx ON project_dependencies (dependent_project_id);
