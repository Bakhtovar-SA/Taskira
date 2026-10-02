-- Add scheduled due-date notifications and durable, per-recipient delivery marks.
ALTER TABLE notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
  'issue.assigned', 'issue.comment', 'issue.mention', 'issue.status',
  'issue.collaborator', 'project.member', 'issue.dueSoon'));
CREATE TABLE due_reminder_deliveries (
  issue_id uuid NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  due_date date NOT NULL,
  lead_days smallint NOT NULL CHECK (lead_days IN (0, 1, 3, 7)),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (issue_id, user_id, due_date, lead_days)
);
