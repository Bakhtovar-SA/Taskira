-- Повторяющиеся задачи: правила над шаблонами задач и журнал запусков.
CREATE TABLE recurring_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES issue_templates(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  title text,
  schedule jsonb NOT NULL,
  time_of_day time NOT NULL,
  time_zone text NOT NULL,
  start_date date NOT NULL,
  due_in_days smallint CHECK (due_in_days BETWEEN 0 AND 365),
  skip_if_open boolean NOT NULL DEFAULT false,
  owner_id uuid REFERENCES users(id) ON DELETE SET NULL,
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'paused')),
  paused_reason text CHECK (paused_reason IN ('manual', 'owner_lost_access')),
  next_run_at timestamptz,
  last_run_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((state = 'paused') = (paused_reason IS NOT NULL)),
  CHECK (state = 'paused' OR next_run_at IS NOT NULL)
);
CREATE UNIQUE INDEX recurring_rules_name_uk ON recurring_rules (project_id, lower(name));
CREATE INDEX idx_recurring_rules_due ON recurring_rules (next_run_at) WHERE state = 'active';

CREATE TABLE recurring_rule_assignees (
  rule_id uuid NOT NULL REFERENCES recurring_rules(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (rule_id, user_id)
);

CREATE TABLE recurring_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid NOT NULL REFERENCES recurring_rules(id) ON DELETE CASCADE,
  scheduled_for timestamptz NOT NULL,
  ran_at timestamptz NOT NULL DEFAULT now(),
  result text NOT NULL CHECK (result IN ('created', 'skipped_open', 'failed')),
  manual boolean NOT NULL DEFAULT false,
  missed_count integer NOT NULL DEFAULT 0,
  issue_id uuid REFERENCES issues(id) ON DELETE SET NULL,
  error_code text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (rule_id, scheduled_for)
);
CREATE INDEX idx_recurring_runs_rule ON recurring_runs (rule_id, scheduled_for DESC);
