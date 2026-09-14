-- ============================================================
-- Taskira. Миграция 022: шаблоны задач.
-- Применяется server/src/db.ts migrate() целиком в одной транзакции.
--
-- МОДЕЛЬ: определение — уровень проекта, по образцу custom_fields
-- (миграция 020) — та же логика прав (editWorkflow, см. ниже) и то же
-- решение не заводить отдельную таблицу под применение шаблона: выбор
-- шаблона в CreateIssueModal — чистый client-side prefill полей формы
-- (typeId/priorityId/title/description/statusId), обычный POST /issues
-- после этого ничего не знает о том, что форма была предзаполнена из
-- шаблона — как и не должен: применённый шаблон не отслеживается на
-- созданной задаче, это одноразовая подсказка при заполнении формы,
-- не связь.
--
-- status_id — необязательная подсказка стартового статуса; NULL означает
-- «как обычно» (сервер сам выберет первый статус категории todo). Ссылка
-- на workflow_statuses, а не сохранённая копия имени — статус могли
-- переименовать, шаблон не должен хранить стухшую копию.
--
-- ПРАВА: управление шаблонами (создание/правка/удаление) — тем же
--   editWorkflow, что схема workflow и custom_fields — снова та же
--   структурная «схема проекта», отдельного PermId не заводили.
--
-- КАСКАД: удаление проекта уносит его шаблоны; удаление статуса, на
--   который ссылается шаблон, обнуляет status_id (ON DELETE SET NULL) —
--   шаблон продолжает работать, просто без подсказки статуса.
--
-- УНИКАЛЬНОСТЬ ИМЕНИ — по lower(name), а не по name напрямую (по образцу
--   users_ldap_dn_uk / departments_ldap_group_dn_uk, миграция 009): роуты
--   проверяют дубликат регистронезависимо (toLowerCase()), обычный
--   UNIQUE (project_id, name) регистр не учитывает и разрешил бы завести
--   «Баг» и «баг» одновременно — рассинхрон между тем, что запрещает
--   приложение, и тем, что реально запрещает схема (см. ревью PR #47).
-- Обратима: DROP TABLE issue_templates.
-- ============================================================

CREATE TABLE issue_templates (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name         text NOT NULL,
  type_id      text NOT NULL CHECK (type_id IN ('task', 'bug', 'request')),
  priority_id  text NOT NULL CHECK (priority_id IN ('low', 'medium', 'high', 'critical')),
  title        text NOT NULL DEFAULT '',
  description  text NOT NULL DEFAULT '',
  status_id    uuid REFERENCES workflow_statuses(id) ON DELETE SET NULL,
  position     integer NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX issue_templates_name_uk ON issue_templates (project_id, lower(name));
CREATE INDEX idx_issue_templates_project ON issue_templates (project_id, position);
