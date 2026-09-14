-- ============================================================
-- Taskira. Миграция 023: спринты — опциональный, отключаемый по умолчанию
-- модуль (SPRINTS_MIGRATION.md).
-- Применяется server/src/db.ts migrate() целиком в одной транзакции.
--
-- ВАЖНО — это осознанное точечное исключение из решения 012_drop_sprints.sql
-- (UI_RESTRUCTURE.md §D1), а не его отмена. §D1 остаётся верным для всех
-- проектов, у которых новый флаг projects.sprints_enabled выключен (значение
-- по умолчанию для всех существующих и новых строк) — для них ничего не
-- меняется ни в схеме видимости, ни в UI. Причина точечного обхода — новая
-- бизнес-цель, которой не было на момент §D1 (см. SPRINTS_MIGRATION.md).
--
-- Форма таблицы намеренно повторяет удалённую миграцией 012 версию (те же
-- статусы future/active/completed, та же связь issues.sprint_id ON DELETE
-- SET NULL) — это восстановление уже проверенной модели под новым флагом
-- включения, а не изобретение новой.
--
-- Одно отличие от старой схемы: частичный уникальный индекс
-- uq_sprints_one_active_per_project — в прошлой версии не более одного
-- активного спринта на проект проверялось только в роуте (TOCTOU-гонка при
-- двух конкурентных «Старт спринта»); здесь это гарантия на уровне БД,
-- по тому же принципу, что issue_templates_name_uk (миграция 022).
-- ============================================================

ALTER TABLE projects ADD COLUMN sprints_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE sprints (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name       text NOT NULL,
  goal       text NOT NULL DEFAULT '',
  status     text NOT NULL DEFAULT 'future' CHECK (status IN ('future', 'active', 'completed')),
  start_date date,
  end_date   date,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sprints_project ON sprints (project_id, created_at);

CREATE UNIQUE INDEX uq_sprints_one_active_per_project ON sprints (project_id) WHERE status = 'active';

ALTER TABLE issues ADD COLUMN sprint_id uuid REFERENCES sprints(id) ON DELETE SET NULL;
CREATE INDEX idx_issues_sprint ON issues (sprint_id);
