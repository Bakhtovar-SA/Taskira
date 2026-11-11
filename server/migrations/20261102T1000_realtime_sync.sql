-- Realtime invalidations are durable and independent of webhook subscriptions.
-- Pending IDs are NOT cursors: a later ID can commit before an earlier one.
-- A serialized, post-commit dispatcher assigns the public event sequence.
CREATE TABLE realtime_pending (
  id bigserial PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  issue_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  dedupe_key text NOT NULL UNIQUE
);

CREATE TABLE realtime_events (
  sequence bigserial PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  issue_ids uuid[] NOT NULL DEFAULT '{}',
  reset boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX idx_realtime_pending_created ON realtime_pending(created_at);
CREATE INDEX idx_realtime_events_project_sequence ON realtime_events(project_id, sequence);
CREATE INDEX idx_realtime_events_retention ON realtime_events(created_at);

-- Keep issue IDs after deletion, so observers can remove stale cached records.
-- Deduplicate within a transaction, including activity/assignee side effects.
CREATE FUNCTION realtime_enqueue(p uuid, i uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO realtime_pending(project_id, issue_id, dedupe_key)
  SELECT p, i, pg_current_xact_id()::text || ':' || p::text || ':' || COALESCE(i::text, '*')
  WHERE EXISTS (SELECT 1 FROM projects WHERE id = p)
  ON CONFLICT (dedupe_key) DO NOTHING;
END $$;

CREATE FUNCTION realtime_capture_issue_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  before_row jsonb;
  after_row jsonb;
  affected record;
BEGIN
  IF TG_OP <> 'INSERT' THEN before_row := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN after_row := to_jsonb(NEW); END IF;
  IF TG_OP = 'UPDATE' AND before_row = after_row THEN RETURN NULL; END IF;

  IF TG_TABLE_NAME = 'issues' THEN
    -- Both old and new parents/epics may have different summaries after a move.
    IF before_row IS NOT NULL THEN
      PERFORM realtime_enqueue((before_row->>'project_id')::uuid, (before_row->>'id')::uuid);
    END IF;
    IF after_row IS NOT NULL THEN
      PERFORM realtime_enqueue((after_row->>'project_id')::uuid, (after_row->>'id')::uuid);
    END IF;
    FOR affected IN
      SELECT id, project_id FROM issues WHERE id = ANY(ARRAY[
        (before_row->>'parent_id')::uuid, (after_row->>'parent_id')::uuid,
        (before_row->>'epic_id')::uuid, (after_row->>'epic_id')::uuid
      ])
    LOOP
      PERFORM realtime_enqueue(affected.project_id, affected.id);
    END LOOP;
  ELSE
    -- Related records, including both sides of cross-project issue links.
    -- Missing issues during cascaded deletion are covered by the issue trigger.
    FOR affected IN
      SELECT id, project_id FROM issues WHERE id = ANY(ARRAY[
        (before_row->>'issue_id')::uuid, (after_row->>'issue_id')::uuid,
        (before_row->>'linked_issue_id')::uuid, (after_row->>'linked_issue_id')::uuid
      ])
    LOOP
      PERFORM realtime_enqueue(affected.project_id, affected.id);
    END LOOP;
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER trg_realtime_issues AFTER INSERT OR UPDATE OR DELETE ON issues
FOR EACH ROW EXECUTE FUNCTION realtime_capture_issue_change();

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'comments', 'activity', 'issue_assignees', 'issue_collaborators',
    'attachments', 'checklist_items', 'custom_field_values', 'issue_links'
  ] LOOP
    EXECUTE format('CREATE TRIGGER trg_realtime_change AFTER INSERT OR UPDATE OR DELETE ON %I
      FOR EACH ROW EXECUTE FUNCTION realtime_capture_issue_change()', table_name);
  END LOOP;
END $$;

CREATE FUNCTION realtime_capture_project_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  before_row jsonb;
  after_row jsonb;
  p uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN before_row := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN after_row := to_jsonb(NEW); END IF;
  IF TG_OP = 'UPDATE' AND before_row = after_row THEN RETURN NULL; END IF;
  FOR p IN SELECT DISTINCT value FROM unnest(ARRAY[
    (before_row->>'project_id')::uuid, (after_row->>'project_id')::uuid
  ]) AS t(value) WHERE value IS NOT NULL
  LOOP
    PERFORM realtime_enqueue(p, NULL);
  END LOOP;
  RETURN NULL;
END $$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'workflow_statuses', 'workflow_transitions', 'sprints', 'custom_fields',
    'issue_templates', 'project_members'
  ] LOOP
    EXECUTE format('CREATE TRIGGER trg_realtime_metadata AFTER INSERT OR UPDATE OR DELETE ON %I
      FOR EACH ROW EXECUTE FUNCTION realtime_capture_project_change()', table_name);
  END LOOP;
END $$;

CREATE FUNCTION realtime_capture_project_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD IS DISTINCT FROM NEW THEN PERFORM realtime_enqueue(NEW.id, NULL); END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_realtime_project AFTER UPDATE ON projects
FOR EACH ROW EXECUTE FUNCTION realtime_capture_project_update();
