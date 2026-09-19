ALTER TABLE users
  ADD COLUMN failed_login_attempts integer NOT NULL DEFAULT 0
    CHECK (failed_login_attempts >= 0),
  ADD COLUMN locked_until timestamptz;

ALTER TABLE audit_log
  ADD COLUMN result text NOT NULL DEFAULT 'success'
    CHECK (result IN ('success', 'denied', 'error'));

CREATE INDEX idx_audit_action_created ON audit_log (action, created_at DESC);
