-- PERF-05: денормализованный признак «есть исполнитель» для фильтра assignee=none.
-- Ленивый список «нераспределённых задач» считается anti-join'ом issues × issue_assignees
-- (39–53 мс на 50 000 задач, индекса под него нет). Флаг поддерживается триггером на
-- issue_assignees, а не кодом приложения: так он верен при любом пути записи —
-- replace-список в PATCH, каскадное удаление пользователя, ручной SQL, будущие импорты.
-- Expand-шаг: колонка с DEFAULT (в PostgreSQL 11+ — без перезаписи таблицы),
-- триггер и идемпотентный backfill. Индекс — отдельной нетранзакционной миграцией.
ALTER TABLE issues ADD COLUMN IF NOT EXISTS has_assignee boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION sync_issue_has_assignee() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE issues SET has_assignee = true WHERE id = NEW.issue_id AND NOT has_assignee;
  ELSE
    -- AFTER ROW: удалённые строки уже не видны, EXISTS отражает итог всего оператора.
    UPDATE issues SET has_assignee = false
     WHERE id = OLD.issue_id AND has_assignee
       AND NOT EXISTS (SELECT 1 FROM issue_assignees a WHERE a.issue_id = OLD.issue_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_issue_assignees_sync_flag ON issue_assignees;
CREATE TRIGGER trg_issue_assignees_sync_flag
  AFTER INSERT OR DELETE ON issue_assignees
  FOR EACH ROW EXECUTE FUNCTION sync_issue_has_assignee();

-- Backfill: триггер создан выше в этой же транзакции, поэтому параллельные записи
-- либо уже видны EXISTS, либо доедут через триггер.
UPDATE issues i SET has_assignee = true
 WHERE NOT i.has_assignee
   AND EXISTS (SELECT 1 FROM issue_assignees a WHERE a.issue_id = i.id);
