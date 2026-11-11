-- A completion cycle survives rapid reopen/close transitions between worker polls.
ALTER TABLE issues ADD COLUMN workspace_result_revision integer NOT NULL DEFAULT 0;
ALTER TABLE workspace_process_steps ADD COLUMN review_revision integer;
CREATE FUNCTION workspace_result_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status_id IS DISTINCT FROM NEW.status_id
    AND EXISTS (SELECT 1 FROM workflow_statuses WHERE id=OLD.status_id AND category='done')
    AND EXISTS (SELECT 1 FROM workflow_statuses WHERE id=NEW.status_id AND category<>'done') THEN
    NEW.workspace_result_revision := OLD.workspace_result_revision + 1;
  ELSE
    NEW.workspace_result_revision := OLD.workspace_result_revision;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER workspace_result_revision BEFORE UPDATE ON issues
FOR EACH ROW EXECUTE FUNCTION workspace_result_revision();
