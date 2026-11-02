-- Cheaper realtime capture triggers (review of 20261102T1000_realtime_sync.sql).
-- The generic trigger serialized whole rows with to_jsonb(OLD/NEW) — including
-- issues.description — on every write just to detect no-ops and read a few ids,
-- and looked up parent/epic issues even when both were NULL. Bulk paths (rank
-- rebalance, archive batches, import) paid that per row. Behaviour is unchanged:
-- the same (project, issue) pairs are enqueued; only the cost of finding them drops.

-- issues: compare records natively and read columns directly.
CREATE OR REPLACE FUNCTION realtime_capture_issue_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  related uuid[];
  affected record;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD IS NOT DISTINCT FROM NEW THEN RETURN NULL; END IF;
    PERFORM realtime_enqueue(NEW.project_id, NEW.id);
    IF OLD.project_id IS DISTINCT FROM NEW.project_id THEN
      PERFORM realtime_enqueue(OLD.project_id, OLD.id);
    END IF;
    related := ARRAY[OLD.parent_id, NEW.parent_id, OLD.epic_id, NEW.epic_id];
  ELSIF TG_OP = 'INSERT' THEN
    PERFORM realtime_enqueue(NEW.project_id, NEW.id);
    related := ARRAY[NEW.parent_id, NEW.epic_id];
  ELSE
    PERFORM realtime_enqueue(OLD.project_id, OLD.id);
    related := ARRAY[OLD.parent_id, OLD.epic_id];
  END IF;
  -- Both old and new parents/epics may have different summaries after a move.
  related := array_remove(related, NULL);
  IF cardinality(related) > 0 THEN
    FOR affected IN SELECT id, project_id FROM issues WHERE id = ANY(related) LOOP
      PERFORM realtime_enqueue(affected.project_id, affected.id);
    END LOOP;
  END IF;
  RETURN NULL;
END $$;

-- Tables keyed by issue_id: one PK lookup, none for a no-op update.
CREATE FUNCTION realtime_capture_related_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  related uuid[];
  affected record;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD IS NOT DISTINCT FROM NEW THEN RETURN NULL; END IF;
    related := CASE WHEN OLD.issue_id = NEW.issue_id THEN ARRAY[NEW.issue_id]
                    ELSE ARRAY[OLD.issue_id, NEW.issue_id] END;
  ELSIF TG_OP = 'INSERT' THEN
    related := ARRAY[NEW.issue_id];
  ELSE
    related := ARRAY[OLD.issue_id];
  END IF;
  -- Missing issues during cascaded deletion are covered by the issue trigger.
  FOR affected IN SELECT id, project_id FROM issues WHERE id = ANY(related) LOOP
    PERFORM realtime_enqueue(affected.project_id, affected.id);
  END LOOP;
  RETURN NULL;
END $$;

-- issue_links: both sides, including cross-project links.
CREATE FUNCTION realtime_capture_link_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  related uuid[];
  affected record;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD IS NOT DISTINCT FROM NEW THEN RETURN NULL; END IF;
    related := ARRAY[OLD.issue_id, OLD.linked_issue_id, NEW.issue_id, NEW.linked_issue_id];
  ELSIF TG_OP = 'INSERT' THEN
    related := ARRAY[NEW.issue_id, NEW.linked_issue_id];
  ELSE
    related := ARRAY[OLD.issue_id, OLD.linked_issue_id];
  END IF;
  FOR affected IN SELECT id, project_id FROM issues WHERE id = ANY(related) LOOP
    PERFORM realtime_enqueue(affected.project_id, affected.id);
  END LOOP;
  RETURN NULL;
END $$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'comments', 'activity', 'issue_assignees', 'issue_collaborators',
    'attachments', 'checklist_items', 'custom_field_values'
  ] LOOP
    EXECUTE format('DROP TRIGGER trg_realtime_change ON %I', table_name);
    EXECUTE format('CREATE TRIGGER trg_realtime_change AFTER INSERT OR UPDATE OR DELETE ON %I
      FOR EACH ROW EXECUTE FUNCTION realtime_capture_related_change()', table_name);
  END LOOP;
END $$;
DROP TRIGGER trg_realtime_change ON issue_links;
CREATE TRIGGER trg_realtime_change AFTER INSERT OR UPDATE OR DELETE ON issue_links
FOR EACH ROW EXECUTE FUNCTION realtime_capture_link_change();

-- Project metadata: same no-op check without JSON serialization. Every table in
-- this group has project_id; sprints/custom_fields are already per-project rows.
CREATE OR REPLACE FUNCTION realtime_capture_project_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD IS NOT DISTINCT FROM NEW THEN RETURN NULL; END IF;
    PERFORM realtime_enqueue(NEW.project_id, NULL);
    IF OLD.project_id IS DISTINCT FROM NEW.project_id THEN PERFORM realtime_enqueue(OLD.project_id, NULL); END IF;
  ELSIF TG_OP = 'INSERT' THEN
    PERFORM realtime_enqueue(NEW.project_id, NULL);
  ELSE
    PERFORM realtime_enqueue(OLD.project_id, NULL);
  END IF;
  RETURN NULL;
END $$;
