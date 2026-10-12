ALTER TABLE issue_templates ADD COLUMN hidden boolean NOT NULL DEFAULT false;
ALTER TABLE recurring_rules ADD COLUMN source_issue_id uuid REFERENCES issues(id) ON DELETE CASCADE;
ALTER TABLE recurring_rules ADD COLUMN source_snapshot jsonb;
CREATE UNIQUE INDEX recurring_rules_source_uk ON recurring_rules(source_issue_id) WHERE source_issue_id IS NOT NULL;
CREATE TABLE issue_reminders (
 issue_id uuid NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 remind_at timestamptz NOT NULL,
 delivered_at timestamptz,
 PRIMARY KEY(issue_id,user_id)
);
CREATE INDEX issue_reminders_due ON issue_reminders(remind_at) WHERE delivered_at IS NULL;
ALTER TABLE notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK(type IN ('issue.assigned','issue.comment','issue.mention','issue.status','issue.collaborator','project.member','issue.dueSoon','issue.reminder'));

-- The private snapshot is owned by the contextual rule, including cascaded issue deletion.
CREATE FUNCTION cleanup_issue_repeat_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.source_issue_id IS NOT NULL THEN
  DELETE FROM issue_templates t WHERE t.id=OLD.template_id AND t.hidden
   AND NOT EXISTS(SELECT 1 FROM recurring_rules r WHERE r.template_id=t.id);
 END IF;
 RETURN OLD;
END;
$$;
CREATE TRIGGER cleanup_issue_repeat_snapshot AFTER DELETE ON recurring_rules
 FOR EACH ROW EXECUTE FUNCTION cleanup_issue_repeat_snapshot();
