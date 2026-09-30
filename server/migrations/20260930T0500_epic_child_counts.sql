-- EPIC-01: материализованные счётчики детей направлений (docs/tickets/EPIC-01-materialized-child-counts.md).
-- GET …/issues/epics считал childTotal/childDone агрегатом по всем активным детям направлений проекта: стоимость
-- росла с числом детей (60% задач под направлениями на 50 000 задач — 68 мс и Seq Scan). Теперь счётчики лежат на
-- строке самого направления и поддерживаются триггерами, а не кодом приложения: так они верны при любом пути
-- записи — PATCH, смена статуса, массовые действия, архивация воркером, каскад ON DELETE SET NULL, импорт, ручной SQL.
-- Expand-шаг: колонки с DEFAULT (без перезаписи таблицы), функции, триггеры и идемпотентный backfill. Индекс —
-- отдельной нетранзакционной миграцией (20260930T0501).
--
-- «Закрыт» = категория статуса ребёнка 'done' (как считал прежний запрос), «активный» = archived_at IS NULL.
-- Триггер на задачах меняет счётчики на ±1, а не пересчитывает агрегат: `SET total = total + 1` после ожидания
-- блокировки строки направления применяется к её последней версии, поэтому параллельные правки детей одного
-- направления складываются верно. Пересчёт агрегатом так не умеет — второй транзакции не видны незакоммиченные дети
-- первой, и она записала бы число без них. Заодно цена записи не зависит от размера направления. Полный пересчёт
-- (recount_epic_children) остаётся для редкой правки категории статуса и для backfill.
ALTER TABLE issues ADD COLUMN IF NOT EXISTS epic_child_total int NOT NULL DEFAULT 0;
ALTER TABLE issues ADD COLUMN IF NOT EXISTS epic_child_done int NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION recount_epic_children(epic uuid) RETURNS void
LANGUAGE sql AS $$
  UPDATE issues e
     SET epic_child_total = c.total, epic_child_done = c.done
    FROM (
      SELECT count(*)::int AS total, (count(*) FILTER (WHERE ws.category = 'done'))::int AS done
        FROM issues ch
        JOIN workflow_statuses ws ON ws.id = ch.status_id
       WHERE ch.epic_id = epic AND ch.archived_at IS NULL
    ) c
   WHERE e.id = epic
     AND (e.epic_child_total, e.epic_child_done) IS DISTINCT FROM (c.total, c.done);
$$;

CREATE OR REPLACE FUNCTION sync_epic_child_counts() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  was_done int;
  is_done int;
BEGIN
  -- Пишутся только epic_child_* — их нет в списке UPDATE OF ниже, так что рекурсии нет. Если направление удаляется
  -- (дети получают epic_id = NULL каскадом), UPDATE его строки просто ничего не находит.
  --
  -- Перенос из направления A в B трогает две строки. Без общего порядка встречные переносы A→B и B→A в двух
  -- транзакциях взяли бы по одной строке и ждали друг друга (взаимная блокировка, 40P01). Поэтому обе строки
  -- блокируются заранее и всегда в порядке id.
  IF TG_OP = 'UPDATE' AND OLD.epic_id IS NOT NULL AND NEW.epic_id IS NOT NULL AND OLD.epic_id <> NEW.epic_id THEN
    PERFORM 1 FROM issues WHERE id IN (OLD.epic_id, NEW.epic_id) ORDER BY id FOR NO KEY UPDATE;
  END IF;
  IF TG_OP <> 'INSERT' AND OLD.epic_id IS NOT NULL AND OLD.archived_at IS NULL THEN
    SELECT (category = 'done')::int INTO was_done FROM workflow_statuses WHERE id = OLD.status_id;
    UPDATE issues
       SET epic_child_total = epic_child_total - 1,
           epic_child_done = epic_child_done - coalesce(was_done, 0)
     WHERE id = OLD.epic_id;
  END IF;
  IF TG_OP <> 'DELETE' AND NEW.epic_id IS NOT NULL AND NEW.archived_at IS NULL THEN
    SELECT (category = 'done')::int INTO is_done FROM workflow_statuses WHERE id = NEW.status_id;
    UPDATE issues
       SET epic_child_total = epic_child_total + 1,
           epic_child_done = epic_child_done + coalesce(is_done, 0)
     WHERE id = NEW.epic_id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_issues_epic_counts_ins ON issues;
CREATE TRIGGER trg_issues_epic_counts_ins
  AFTER INSERT ON issues
  FOR EACH ROW WHEN (NEW.epic_id IS NOT NULL)
  EXECUTE FUNCTION sync_epic_child_counts();

DROP TRIGGER IF EXISTS trg_issues_epic_counts_del ON issues;
CREATE TRIGGER trg_issues_epic_counts_del
  AFTER DELETE ON issues
  FOR EACH ROW WHEN (OLD.epic_id IS NOT NULL)
  EXECUTE FUNCTION sync_epic_child_counts();

-- Любое другое изменение задачи (название, rank, описание…) триггер не будит.
DROP TRIGGER IF EXISTS trg_issues_epic_counts_upd ON issues;
CREATE TRIGGER trg_issues_epic_counts_upd
  AFTER UPDATE OF epic_id, archived_at, status_id ON issues
  FOR EACH ROW WHEN (
    (OLD.epic_id IS NOT NULL OR NEW.epic_id IS NOT NULL)
    AND (OLD.epic_id IS DISTINCT FROM NEW.epic_id
         OR OLD.archived_at IS DISTINCT FROM NEW.archived_at
         OR OLD.status_id IS DISTINCT FROM NEW.status_id)
  )
  EXECUTE FUNCTION sync_epic_child_counts();

-- Смена категории самого статуса (сегодня приложение так не делает — статусы не правятся, только добавляются;
-- страховка на ручной SQL и будущую правку схемы) меняет «закрыто» у всех его детей разом.
CREATE OR REPLACE FUNCTION sync_epic_counts_on_category() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM recount_epic_children(x.epic_id)
     FROM (SELECT DISTINCT epic_id FROM issues
            WHERE status_id = NEW.id AND epic_id IS NOT NULL AND archived_at IS NULL) x;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_workflow_statuses_epic_counts ON workflow_statuses;
CREATE TRIGGER trg_workflow_statuses_epic_counts
  AFTER UPDATE OF category ON workflow_statuses
  FOR EACH ROW WHEN (OLD.category IS DISTINCT FROM NEW.category)
  EXECUTE FUNCTION sync_epic_counts_on_category();

-- Backfill. ALTER TABLE выше держит ACCESS EXCLUSIVE на issues до конца транзакции, так что параллельных записей
-- во время backfill нет — агрегат точный. Повторный запуск ничего не меняет (IS DISTINCT FROM), а испорченные
-- счётчики исправляет — это и способ починки, если расхождение когда-нибудь найдётся.
UPDATE issues e
   SET epic_child_total = c.total, epic_child_done = c.done
  FROM (
    SELECT ch.epic_id,
           count(*)::int AS total,
           (count(*) FILTER (WHERE ws.category = 'done'))::int AS done
      FROM issues ch
      JOIN workflow_statuses ws ON ws.id = ch.status_id
     WHERE ch.epic_id IS NOT NULL AND ch.archived_at IS NULL
     GROUP BY ch.epic_id
  ) c
 WHERE e.id = c.epic_id
   AND (e.epic_child_total, e.epic_child_done) IS DISTINCT FROM (c.total, c.done);

UPDATE issues e
   SET epic_child_total = 0, epic_child_done = 0
 WHERE (e.epic_child_total <> 0 OR e.epic_child_done <> 0)
   AND NOT EXISTS (SELECT 1 FROM issues ch WHERE ch.epic_id = e.id AND ch.archived_at IS NULL);
