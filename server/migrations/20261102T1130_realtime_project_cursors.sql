-- Keep dispatch fair when a project's parent row is locked. The dispatcher
-- probes the first pending row per project before applying its batch limit.
CREATE INDEX idx_realtime_pending_project_id ON realtime_pending(project_id, id);

-- Public cursors advance only for their project. The original global sequence
-- remains internal for bounded retention cleanup and older API compatibility.
CREATE TABLE realtime_project_cursors (
  project_id uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  high bigint NOT NULL CHECK (high >= 0)
);
ALTER TABLE realtime_events ADD COLUMN project_sequence bigint;

-- Preserve existing event positions when upgrading an already populated schema.
UPDATE realtime_events SET project_sequence = sequence;
INSERT INTO realtime_project_cursors(project_id, high)
SELECT project_id, max(project_sequence) FROM realtime_events GROUP BY project_id;
ALTER TABLE realtime_events ALTER COLUMN project_sequence SET NOT NULL;
CREATE UNIQUE INDEX idx_realtime_events_project_cursor ON realtime_events(project_id, project_sequence);

-- Assignment and the high watermark commit atomically with the event. Keeping
-- it in a trigger also lets the previous API insert events during rollback.
CREATE FUNCTION realtime_assign_project_cursor() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO realtime_project_cursors(project_id, high) VALUES (NEW.project_id, 1)
  ON CONFLICT (project_id) DO UPDATE SET high = realtime_project_cursors.high + 1
  RETURNING high INTO NEW.project_sequence;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_realtime_project_cursor BEFORE INSERT ON realtime_events
FOR EACH ROW EXECUTE FUNCTION realtime_assign_project_cursor();
