-- ============================================================
-- Taskira. Миграция 020: пользовательские поля проекта.
-- Применяется server/src/db.ts migrate() целиком в одной транзакции.
--
-- МОДЕЛЬ: поле определяется на уровне ПРОЕКТА (как workflow_statuses —
--   миграция 001), значение — на уровне задачи (одна строка на пару
--   (custom_field_id, issue_id), NULL/отсутствие строки = значение не задано).
--   Все значения хранятся как text независимо от field_type — упрощение
--   вместо отдельной колонки на каждый тип; парсинг/валидация числа,
--   даты, чекбокса — на contract.ts (zod), не на БД.
--
-- ПРАВА: определения полей (создание/переименование/удаление) — тем же
--   правом editWorkflow, что и схема workflow (см. routes/customFields.ts) —
--   это тоже структурная схема проекта, отдельного PermId под неё заводить
--   не стали, чтобы не трогать общую MATRIX (server+client, permissions-
--   sync.test.ts) ради одной узкой фичи. Значение на конкретной задаче
--   правится тем же `edit`, что приоритет/сложность/метки.
--
-- КАСКАД: удаление проекта → определений полей → их значений (двойной
--   ON DELETE CASCADE). Удаление задачи уносит только её значения.
-- Обратима: DROP TABLE custom_field_values; DROP TABLE custom_fields.
-- ============================================================

CREATE TABLE custom_fields (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        text NOT NULL,
  field_type  text NOT NULL CHECK (field_type IN ('text', 'number', 'select', 'checkbox', 'date')),
  -- Варианты для field_type='select'; для остальных типов — пустой массив.
  options     jsonb NOT NULL DEFAULT '[]'::jsonb,
  position    integer NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT custom_fields_name_uniq UNIQUE (project_id, name)
);

CREATE INDEX idx_custom_fields_project ON custom_fields (project_id, position);

CREATE TABLE custom_field_values (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  custom_field_id uuid NOT NULL REFERENCES custom_fields(id) ON DELETE CASCADE,
  issue_id        uuid NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  value           text,
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT custom_field_values_uniq UNIQUE (custom_field_id, issue_id)
);

CREATE INDEX idx_custom_field_values_issue ON custom_field_values (issue_id);
