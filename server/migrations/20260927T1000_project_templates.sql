-- ТЗ 5.10 (трек 5 v2): шаблоны проектов. Встроенные шаблоны живут в репозитории
-- (server/src/templates/builtin.json); здесь — шаблоны организации, сохранённые из проекта
-- («Сохранить проект как шаблон»). Спецификация — jsonb по zod-схеме ProjectTemplateSpec
-- (contract.ts), проверяется при сохранении; сама БД её структуру не знает.
--
-- Два параметра проекта, которые шаблон задаёт, раньше не хранились нигде:
--   default_view      — с какого представления открывать проект (NULL — как раньше, Доска);
--   suggested_labels  — метки, которые предлагаются при вводе (не ограничение: можно любые).
--
-- Аддитивная (expand) миграция: новая таблица и nullable/defaulted колонки, старый код их
-- просто не читает.
CREATE TABLE IF NOT EXISTS project_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 300),
  spec        jsonb NOT NULL,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS project_templates_name_uk ON project_templates (lower(name));

ALTER TABLE projects ADD COLUMN IF NOT EXISTS default_view text
  CHECK (default_view IS NULL OR default_view IN ('board', 'backlog', 'timeline'));
ALTER TABLE projects ADD COLUMN IF NOT EXISTS suggested_labels text[] NOT NULL DEFAULT '{}';
