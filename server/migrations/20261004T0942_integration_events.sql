-- Вебхуки: подписки проекта, outbox событий интеграций и журнал доставок.
-- Триггеры охватывают любой путь записи истории, как счётчики направлений в EPIC-01.
-- Правки одной задачи и типа в одной транзакции склеиваются по pg_current_xact_id().
-- Без активной подписки в проекте триггеры ничего не пишут.

CREATE TABLE webhooks (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name              text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  url_enc           text NOT NULL,            -- secretBox(URL) — URL может нести токен получателя в query
  url_display       text NOT NULL,            -- scheme://host[:port]/path, без userinfo и query
  secret_enc        text NOT NULL,            -- secretBox(whsec_…)
  prev_secret_enc   text,
  prev_secret_until timestamptz,
  events            text[] NOT NULL CHECK (cardinality(events) BETWEEN 1 AND 6)
                    CHECK (events <@ ARRAY['issue.created', 'issue.updated', 'issue.statusChanged',
                      'issue.assigned', 'issue.commented', 'issue.due']::text[]
                      AND array_position(events, NULL) IS NULL),
  state             text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'paused', 'disabled')),
  disabled_reason   text CHECK (disabled_reason IN ('failing', 'gone', 'secret_unavailable')),
  failure_streak    integer NOT NULL DEFAULT 0,
  failing_since     timestamptz,
  last_success_at   timestamptz,
  last_failure_at   timestamptz,
  created_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK ((state = 'disabled') = (disabled_reason IS NOT NULL))
);
CREATE INDEX idx_webhooks_project_active ON webhooks (project_id) WHERE state = 'active';

-- INT-04: пакетная очистка по occurred_at (webhookLogRetentionDays, по умолчанию 30 дней);
-- webhook_deliveries удаляются каскадом. Обязательна до включения API подписок в INT-05.
-- id — sequence, не порядок COMMIT: диспетчер выбирает dispatched_at IS NULL,
-- а не id > last_id, иначе поздний COMMIT более ранней транзакции потеряется.
CREATE TABLE integration_events (
  id            bigserial PRIMARY KEY,         -- "sequence" в теле
  event_id      uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  type          text NOT NULL CHECK (type IN ('issue.created', 'issue.updated', 'issue.statusChanged',
                  'issue.assigned', 'issue.commented', 'issue.due', 'ping')),
  project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  issue_id      uuid,                          -- без FK: событие переживает удаление задачи
  issue_key     text,
  actor_id      uuid,                          -- без FK, как activity.actor_id по смыслу «снимок»
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  dedupe_key    text NOT NULL UNIQUE,
  changes       jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{kind, …payload истории}]
  data          jsonb NOT NULL DEFAULT '{}'::jsonb,  -- commentId / dueDate / ping
  payload       jsonb,                         -- итоговое тело v1, пишется при раскладке
  dispatched_at timestamptz
);
CREATE INDEX idx_integration_events_undispatched ON integration_events (id) WHERE dispatched_at IS NULL;
CREATE INDEX idx_integration_events_occurred ON integration_events (occurred_at);

CREATE TABLE webhook_deliveries (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id       uuid NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event_id         bigint NOT NULL REFERENCES integration_events(id) ON DELETE CASCADE,
  manual           boolean NOT NULL DEFAULT false,
  state            text NOT NULL DEFAULT 'pending'
                     CHECK (state IN ('pending', 'sending', 'succeeded', 'failed', 'cancelled')),
  attempts         smallint NOT NULL DEFAULT 0,
  next_attempt_at  timestamptz NOT NULL DEFAULT now(),
  locked_until     timestamptz,
  last_status      smallint,
  last_error       text CHECK (last_error IN ('timeout', 'dns', 'connect', 'tls', 'target_blocked',
                     'redirect', 'http_status', 'secret_unavailable', 'too_large', 'internal')),
  last_duration_ms integer,
  response_excerpt text CHECK (octet_length(response_excerpt) <= 512),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_webhook_deliveries_due ON webhook_deliveries (next_attempt_at) WHERE state IN ('pending', 'sending');
CREATE INDEX idx_webhook_deliveries_hook ON webhook_deliveries (webhook_id, created_at DESC);
CREATE UNIQUE INDEX uq_webhook_deliveries_auto ON webhook_deliveries (webhook_id, event_id) WHERE NOT manual;

CREATE FUNCTION integration_event_type(kind text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE kind WHEN 'created' THEN 'issue.created' WHEN 'status' THEN 'issue.statusChanged'
    WHEN 'assigneeAdded' THEN 'issue.assigned' WHEN 'assigneeRemoved' THEN 'issue.assigned'
    WHEN 'assigneeBulk' THEN 'issue.assigned' ELSE 'issue.updated' END $$;

CREATE FUNCTION trg_activity_integration_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p uuid; k text; t text;
BEGIN
  IF NEW.kind IS NULL THEN RETURN NULL; END IF;
  SELECT i.project_id, i.key INTO p, k FROM issues i WHERE i.id = NEW.issue_id;
  IF p IS NULL OR NOT EXISTS (SELECT 1 FROM webhooks w WHERE w.project_id = p AND w.state = 'active') THEN
    RETURN NULL;
  END IF;
  t := integration_event_type(NEW.kind);
  INSERT INTO integration_events (type, project_id, issue_id, issue_key, actor_id, dedupe_key, changes)
  VALUES (t, p, NEW.issue_id, k, NEW.actor_id,
          'tx:' || pg_current_xact_id()::text || ':' || NEW.issue_id || ':' || t,
          jsonb_build_array(jsonb_build_object('kind', NEW.kind) || COALESCE(NEW.payload, '{}'::jsonb)))
  ON CONFLICT (dedupe_key) DO UPDATE SET changes = integration_events.changes || EXCLUDED.changes;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_activity_integration_event AFTER INSERT ON activity
  FOR EACH ROW EXECUTE FUNCTION trg_activity_integration_event();

CREATE FUNCTION trg_comments_integration_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p uuid; k text;
BEGIN
  SELECT i.project_id, i.key INTO p, k FROM issues i WHERE i.id = NEW.issue_id;
  IF p IS NULL OR NOT EXISTS (SELECT 1 FROM webhooks w WHERE w.project_id = p AND w.state = 'active') THEN
    RETURN NULL;
  END IF;
  INSERT INTO integration_events (type, project_id, issue_id, issue_key, actor_id, dedupe_key, data)
  VALUES ('issue.commented', p, NEW.issue_id, k, NEW.author_id, 'comment:' || NEW.id,
          jsonb_build_object('commentId', NEW.id))
  ON CONFLICT (dedupe_key) DO NOTHING;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_comments_integration_event AFTER INSERT ON comments
  FOR EACH ROW EXECUTE FUNCTION trg_comments_integration_event();
