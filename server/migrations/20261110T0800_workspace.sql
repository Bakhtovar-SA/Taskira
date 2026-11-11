-- Additive workspace modules. Existing projects remain disabled; task history is collected independently.
CREATE TABLE workspace_modules (
  project_id uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  documents boolean NOT NULL DEFAULT false, objects boolean NOT NULL DEFAULT false,
  processes boolean NOT NULL DEFAULT false, planning boolean NOT NULL DEFAULT false
);
CREATE TABLE workspace_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title text NOT NULL, parent_id uuid REFERENCES workspace_documents(id), owner_id uuid REFERENCES users(id) ON DELETE SET NULL,
  generation integer NOT NULL DEFAULT 1, revision integer NOT NULL DEFAULT 1, content_revision integer NOT NULL DEFAULT 0,
  content bytea, content_json jsonb NOT NULL DEFAULT '{"type":"doc","content":[{"type":"paragraph"}]}', search_text text NOT NULL DEFAULT '',
  verified_version_id uuid, verified_content_revision integer, valid_until date, archived boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX workspace_documents_project ON workspace_documents(project_id, updated_at DESC);
CREATE INDEX workspace_documents_search ON workspace_documents USING gin(to_tsvector('simple', title || ' ' || search_text));
CREATE TABLE workspace_document_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), document_id uuid NOT NULL REFERENCES workspace_documents(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '', content bytea, content_json jsonb NOT NULL, content_revision integer NOT NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX workspace_versions_document ON workspace_document_versions(document_id,created_at DESC);
CREATE TABLE workspace_document_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), document_id uuid NOT NULL REFERENCES workspace_documents(id) ON DELETE CASCADE,
  body text NOT NULL, block_id text, parent_id uuid REFERENCES workspace_document_comments(id),
  author_id uuid REFERENCES users(id) ON DELETE SET NULL, resolved boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE workspace_document_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), document_id uuid NOT NULL REFERENCES workspace_documents(id) ON DELETE CASCADE,
  filename text NOT NULL, content_type text NOT NULL, size integer NOT NULL, storage_key text NOT NULL UNIQUE, storage_driver text NOT NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE workspace_object_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL, fields jsonb NOT NULL DEFAULT '[]', revision integer NOT NULL DEFAULT 1
);
CREATE TABLE workspace_objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type_id uuid NOT NULL REFERENCES workspace_object_types(id), title text NOT NULL, owner_id uuid REFERENCES users(id) ON DELETE SET NULL,
  field_values jsonb NOT NULL DEFAULT '{}', archived boolean NOT NULL DEFAULT false, revision integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX workspace_objects_project ON workspace_objects(project_id,type_id,updated_at DESC);
CREATE INDEX workspace_objects_search ON workspace_objects USING gin(to_tsvector('simple', title || ' ' || field_values::text));
CREATE TABLE workspace_entity_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_kind text NOT NULL CHECK(source_kind IN ('issue','document','object','process')), source_id uuid NOT NULL,
  target_kind text NOT NULL CHECK(target_kind IN ('issue','document','object','process')), target_id uuid NOT NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, source_kind,source_id,target_kind,target_id), CHECK(source_kind <> target_kind OR source_id <> target_id)
);
CREATE INDEX workspace_entity_links_reverse ON workspace_entity_links(project_id,target_kind,target_id);
CREATE TABLE workspace_process_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL, draft jsonb NOT NULL, revision integer NOT NULL DEFAULT 1, published_version_id uuid,
  archived boolean NOT NULL DEFAULT false
);
CREATE TABLE workspace_process_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), template_id uuid NOT NULL REFERENCES workspace_process_templates(id) ON DELETE CASCADE,
  version integer NOT NULL, spec jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(template_id,version)
);
CREATE TABLE workspace_process_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title text NOT NULL, template_version_id uuid NOT NULL REFERENCES workspace_process_versions(id), owner_id uuid NOT NULL REFERENCES users(id),
  object_id uuid REFERENCES workspace_objects(id), parameters jsonb NOT NULL DEFAULT '{}', assignee_ids uuid[] NOT NULL DEFAULT '{}',
  state text NOT NULL DEFAULT 'running' CHECK(state IN ('running','paused','completed','cancelled')), error text,
  request_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(project_id,request_id)
);
CREATE TABLE workspace_process_steps (
  position integer NOT NULL DEFAULT 0,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid NOT NULL REFERENCES workspace_process_runs(id) ON DELETE CASCADE,
  step_key text NOT NULL, spec jsonb NOT NULL, state text NOT NULL DEFAULT 'waiting' CHECK(state IN ('waiting','active','review','completed','skipped')),
  issue_id uuid REFERENCES issues(id) ON DELETE SET NULL, approved boolean NOT NULL DEFAULT false, UNIQUE(run_id,step_key)
);
CREATE TABLE workspace_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES users(id), name text NOT NULL, spec jsonb NOT NULL, enabled boolean NOT NULL DEFAULT false, error text
);
CREATE TABLE workspace_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind text NOT NULL, entity_id uuid NOT NULL, action text NOT NULL, actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  detail jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX workspace_history_entity ON workspace_history(project_id,kind,entity_id,created_at);
CREATE TABLE workspace_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type text NOT NULL, issue_id uuid, actor_id uuid, data jsonb NOT NULL DEFAULT '{}',
  root_id uuid NOT NULL DEFAULT gen_random_uuid(), depth integer NOT NULL DEFAULT 0,
  failed_rule_id uuid REFERENCES workspace_rules(id) ON DELETE SET NULL,
  attempts integer NOT NULL DEFAULT 0, processed_at timestamptz, error text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX workspace_events_pending ON workspace_events(created_at) WHERE processed_at IS NULL;
CREATE TABLE workspace_rule_executions (
  event_id uuid NOT NULL REFERENCES workspace_events(id) ON DELETE CASCADE, rule_id uuid NOT NULL REFERENCES workspace_rules(id) ON DELETE CASCADE,
  PRIMARY KEY(event_id,rule_id)
);
CREATE TABLE workspace_due_events (issue_id uuid NOT NULL REFERENCES issues(id) ON DELETE CASCADE, due_date date NOT NULL, PRIMARY KEY(issue_id,due_date));
CREATE TABLE workspace_completion_history (
  issue_id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  complexity text, completed_at timestamptz NOT NULL, reopens integer NOT NULL DEFAULT 0
);
INSERT INTO workspace_completion_history(issue_id,project_id,complexity,completed_at)
SELECT id,project_id,complexity,done_at FROM issues WHERE done_at IS NOT NULL AND done_at >= created_at;
CREATE INDEX workspace_completion_project ON workspace_completion_history(project_id,completed_at);
CREATE TABLE workspace_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  plan_id uuid REFERENCES workspace_plans(id), name text NOT NULL, target_date date, items jsonb NOT NULL DEFAULT '[]',
  revision integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION workspace_issue_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cat text; oldcat text; event_type text;
BEGIN
  SELECT category INTO cat FROM workflow_statuses WHERE id=NEW.status_id;
  IF TG_OP='UPDATE' THEN SELECT category INTO oldcat FROM workflow_statuses WHERE id=OLD.status_id; END IF;
  IF cat='done' AND (TG_OP='INSERT' OR oldcat IS DISTINCT FROM 'done') THEN
    INSERT INTO workspace_completion_history(issue_id,project_id,complexity,completed_at)
    VALUES(NEW.id,NEW.project_id,NEW.complexity,COALESCE(NEW.done_at,now())) ON CONFLICT(issue_id) DO NOTHING;
  ELSIF oldcat='done' AND cat<>'done' THEN
    UPDATE workspace_completion_history SET reopens=reopens+1 WHERE issue_id=NEW.id;
  END IF;
  IF EXISTS(SELECT 1 FROM workspace_modules WHERE project_id=NEW.project_id AND processes) THEN
    event_type := CASE WHEN TG_OP='INSERT' THEN 'issue.created' WHEN OLD.status_id IS DISTINCT FROM NEW.status_id THEN 'issue.statusChanged' ELSE 'issue.updated' END;
    INSERT INTO workspace_events(project_id,type,issue_id,actor_id,data,root_id,depth)
    VALUES(NEW.project_id,event_type,NEW.id,NEW.reporter_id,to_jsonb(NEW),
      COALESCE(NULLIF(current_setting('taskira.workspace_root',true),'')::uuid,gen_random_uuid()),
      COALESCE(NULLIF(current_setting('taskira.workspace_depth',true),'')::integer,0));
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER workspace_issue_event AFTER INSERT OR UPDATE OF status_id,title,description,priority_id,due_date,complexity,labels ON issues FOR EACH ROW EXECUTE FUNCTION workspace_issue_event();

ALTER TABLE notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK(type IN ('issue.assigned','issue.comment','issue.mention','issue.status','issue.collaborator','project.member','issue.dueSoon','issue.reminder','workspace')) NOT VALID;
ALTER TABLE notifications VALIDATE CONSTRAINT notifications_type_check;
CREATE TABLE workspace_document_reviews(document_id uuid NOT NULL REFERENCES workspace_documents(id) ON DELETE CASCADE,version_id uuid NOT NULL,valid_until date NOT NULL,PRIMARY KEY(document_id,version_id,valid_until));

-- Field edits enter the same transactional outbox as task column edits.
CREATE FUNCTION workspace_custom_field_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE task_id uuid; task_row issues%ROWTYPE; field_name text; field_value text;
BEGIN
  task_id:=CASE WHEN TG_OP='DELETE' THEN OLD.issue_id ELSE NEW.issue_id END;
  SELECT * INTO task_row FROM issues WHERE id=task_id;
  IF task_row.id IS NULL OR NOT EXISTS(SELECT 1 FROM workspace_modules WHERE project_id=task_row.project_id AND processes) THEN RETURN NULL; END IF;
  SELECT name INTO field_name FROM custom_fields WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.custom_field_id ELSE NEW.custom_field_id END;
  field_value:=CASE WHEN TG_OP='DELETE' THEN NULL ELSE NEW.value END;
  INSERT INTO workspace_events(project_id,type,issue_id,actor_id,data,root_id,depth)
  VALUES(task_row.project_id,'issue.updated',task_id,task_row.reporter_id,to_jsonb(task_row)||jsonb_build_object(COALESCE(field_name,'customField'),field_value),COALESCE(NULLIF(current_setting('taskira.workspace_root',true),'')::uuid,gen_random_uuid()),COALESCE(NULLIF(current_setting('taskira.workspace_depth',true),'')::integer,0));
  RETURN NULL;
END $$;
CREATE TRIGGER workspace_custom_fields AFTER INSERT OR UPDATE OR DELETE ON custom_field_values FOR EACH ROW EXECUTE FUNCTION workspace_custom_field_event();

CREATE TABLE workspace_action_executions (
  execution_key text PRIMARY KEY,event_id uuid NOT NULL REFERENCES workspace_events(id) ON DELETE CASCADE,
  rule_id uuid NOT NULL REFERENCES workspace_rules(id) ON DELETE CASCADE,action_index integer NOT NULL,
  action_type text NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(event_id,rule_id,action_index)
);
