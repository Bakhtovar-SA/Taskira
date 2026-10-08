-- Отчёты операций хоста: бэкап и репетиция восстановления.
CREATE TABLE ops_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('backup', 'restore_drill')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  result text NOT NULL DEFAULT 'running' CHECK (result IN ('running', 'success', 'failure')),
  host text,
  archive text,
  app_version text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text CHECK (char_length(error) <= 2000)
);
CREATE INDEX idx_ops_runs_kind ON ops_runs (kind, started_at DESC);
