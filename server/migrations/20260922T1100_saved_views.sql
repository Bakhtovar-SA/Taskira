-- ТЗ 3.2 (план v2, Трек 3): сохранённые фильтры/вьюхи. Аддитивная миграция —
-- новая таблица, ничего существующего не трогает.
--
-- filter_json хранит сериализованные условия визуального конструктора
-- (status/assignee/priority/label/sprintId — тот же набор полей, что
-- IssueFilterQuery на сервере после ТЗ 3.2; см. server/src/contract.ts) —
-- документ, не набор колонок: условия меняются вместе с UI конструктора
-- быстрее, чем стоило бы гонять через новую миграцию на каждое поле, и ни
-- одно из них не нужно ни индексировать, ни фильтровать по значению на
-- сервере (вьюха применяется целиком, одним запросом на список задач).
--
-- project_id — вьюха живёт в одном проекте (тот же масштаб, что у workflow/
-- custom_fields/issue_templates), не кросс-проектная: «Мои задачи» — отдельная,
-- системная, кросс-проектная вьюха БЕЗ строки в этой таблице (см. ТЗ 3.2,
-- дополнение 2 к P0-4 — она уже есть, HomeView.tsx, отдельный код пути).
--
-- is_default — не более одной вьюхи по умолчанию на пользователя в проекте
-- (частичный уникальный индекс, по образцу uq_sprints_one_active_per_project,
-- миграция 023): без этого ограничения было бы неопределённо, какая из
-- нескольких «default» вьюх применяется при входе.
CREATE TABLE saved_views (
  id          uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        text NOT NULL,
  filter_json jsonb NOT NULL,
  is_default  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Список вьюх пользователя в проекте — основной запрос экрана (панель
-- сохранённых вьюх сбоку от доски/списка), тот же паттерн, что PRIMARY KEY
-- в user_favorite_projects (миграция 024) даёт бесплатный leftmost-prefix.
CREATE INDEX idx_saved_views_user_project ON saved_views (user_id, project_id);

CREATE UNIQUE INDEX uq_saved_views_one_default_per_user_project
  ON saved_views (user_id, project_id)
  WHERE is_default;
