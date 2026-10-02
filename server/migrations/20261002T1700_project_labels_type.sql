-- Repair legacy schema drift: suggested_labels has been text[] since project templates shipped.
-- JSON arrays of strings are converted losslessly; invalid values abort the transaction.
-- contract-phase: подтверждено, добавлено в релизе 20260927T1000_project_templates
CREATE OR REPLACE FUNCTION pg_temp.project_labels_array(value jsonb) RETURNS text[]
LANGUAGE plpgsql AS $$
BEGIN
  IF value IS NULL THEN RETURN ARRAY[]::text[]; END IF;
  IF jsonb_typeof(value) <> 'array' THEN
    RAISE EXCEPTION 'projects.suggested_labels must be an array of strings; migration cancelled';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(value) item WHERE jsonb_typeof(item) <> 'string') THEN
    RAISE EXCEPTION 'projects.suggested_labels contains a non-string label; migration cancelled';
  END IF;
  RETURN ARRAY(SELECT item FROM jsonb_array_elements_text(value) WITH ORDINALITY AS labels(item, position) ORDER BY position);
END;
$$;

DO $$
DECLARE column_type regtype;
BEGIN
  SELECT atttypid::regtype INTO column_type FROM pg_attribute
  WHERE attrelid = 'projects'::regclass AND attname = 'suggested_labels' AND NOT attisdropped;
  IF column_type = 'text[]'::regtype THEN RETURN; END IF;
  IF column_type NOT IN ('json'::regtype, 'jsonb'::regtype) OR column_type IS NULL THEN
    RAISE EXCEPTION 'Unsupported projects.suggested_labels type: %; migration cancelled', column_type;
  END IF;
  ALTER TABLE projects ALTER COLUMN suggested_labels DROP DEFAULT;
  ALTER TABLE projects ALTER COLUMN suggested_labels TYPE text[] USING pg_temp.project_labels_array(suggested_labels::jsonb);
  UPDATE projects SET suggested_labels = ARRAY[]::text[] WHERE suggested_labels IS NULL;
  ALTER TABLE projects ALTER COLUMN suggested_labels SET DEFAULT '{}';
  ALTER TABLE projects ALTER COLUMN suggested_labels SET NOT NULL;
END;
$$;
DROP FUNCTION pg_temp.project_labels_array(jsonb);
