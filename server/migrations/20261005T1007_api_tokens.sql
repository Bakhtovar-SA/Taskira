-- API-токены и сервисные учётные записи (auth_source = 'service').
-- Нестандартный CHECK нельзя молча оставить: он может запрещать service после expand.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attname='auth_source'
    WHERE c.conrelid='users'::regclass AND c.contype='c' AND a.attnum=ANY(c.conkey)
      AND c.conname NOT IN ('users_auth_source_check','users_local_has_password')
  ) THEN
    RAISE EXCEPTION 'Unexpected CHECK on users.auth_source; inspect the customized constraint before upgrading';
  END IF;
END $$;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_auth_source_check;
ALTER TABLE users ADD CONSTRAINT users_auth_source_check CHECK (auth_source IN ('local','ldap','service'));
ALTER TABLE users ADD CONSTRAINT users_service_shape
  CHECK (auth_source <> 'service' OR (global_role='member' AND password_hash IS NULL AND ldap_dn IS NULL));

CREATE TABLE api_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  prefix text NOT NULL UNIQUE CHECK (prefix ~ '^[a-z0-9]{8}$'),
  secret_hash bytea NOT NULL CHECK (octet_length(secret_hash)=32),
  scope text NOT NULL CHECK (scope IN ('read','write')),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_used_at timestamptz,
  last_used_ip inet,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES users(id) ON DELETE SET NULL,
  CHECK (expires_at>created_at AND expires_at<=created_at+interval '366 days')
);
CREATE INDEX idx_api_tokens_user_active ON api_tokens(user_id) WHERE revoked_at IS NULL;
