-- ADR-0022: дашборды — личные, общие организации и обзор проекта.
--
--   owner_id   — кто создал; для личного дашборда — единственный, кто его видит и правит.
--   project_id — NULL: дашборд уровня организации; задан: «Обзор» проекта (не больше одного на проект).
--   shared     — общий (виден всем, кому доступна область); у обзора проекта всегда true.
--   widgets    — массив виджетов (тип, настройки, позиция в сетке 12 колонок). Схема — в contract.ts
--                (DashboardWidget), проверяется на сервере при записи; хранится как данные, не код.
--
-- Аддитивная (expand) миграция: новая таблица, старый код её не читает. Удаление пользователя обнуляет owner_id:
-- общие дашборды остаются, личный без владельца больше никому не виден. Удаление проекта удаляет его обзор.
CREATE TABLE IF NOT EXISTS dashboards (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  owner_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  shared     boolean NOT NULL DEFAULT false,
  widgets    jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(widgets) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Обзор проекта всегда общий.
  CHECK (project_id IS NULL OR shared)
);
CREATE UNIQUE INDEX IF NOT EXISTS dashboards_one_overview_per_project ON dashboards (project_id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS dashboards_owner_idx ON dashboards (owner_id) WHERE project_id IS NULL;
