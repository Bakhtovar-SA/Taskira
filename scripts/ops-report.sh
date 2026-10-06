#!/usr/bin/env bash

# Reports are best effort: an old schema or an unavailable database must not
# turn a successful host operation into a failed backup.
ops_run_start() {
  local result
  if ! result="$(compose exec -T postgres psql -qAt -v ON_ERROR_STOP=1 \
      -v kind="$1" -v host="$(hostname)" -v archive="$(basename -- "${OPS_ARCHIVE:-unknown}")" \
      -v version="$(current_version)" -U "$POSTGRES_USER" -d "$POSTGRES_DB" 2>/dev/null <<'SQL'
SELECT to_regclass('public.ops_runs') IS NOT NULL AS has_ops \gset
\if :has_ops
INSERT INTO ops_runs (kind, host, archive, app_version)
VALUES (:'kind', :'host', NULLIF(:'archive', 'unknown'), :'version') RETURNING id;
\else
\echo ops_runs_missing
\endif
SQL
  )"; then
    echo 'WARNING: operation report could not be started; continuing.' >&2
  elif [ "$result" = ops_runs_missing ]; then
    echo 'WARNING: схема старше — отчёт не записан (ops_runs is missing).' >&2
  elif [[ "$result" =~ ^[0-9a-fA-F-]{36}$ ]]; then
    printf '%s\n' "$result"
  else
    echo 'WARNING: operation report returned no ID; continuing.' >&2
  fi
  return 0
}

ops_run_finish() {
  [ -n "$1" ] || return 0
  local error_text
  error_text="$(printf '%s\n' "$4" | redact_stream)"
  if ! compose exec -T postgres psql -qAt -v ON_ERROR_STOP=1 \
      -v id="$1" -v result="$2" -v details="$3" -v error="$error_text" \
      -v archive="$(basename -- "${OPS_ARCHIVE:-unknown}")" \
      -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1 <<'SQL'
UPDATE ops_runs SET finished_at = now(), result = :'result', details = :'details'::jsonb,
  archive = NULLIF(:'archive', 'unknown'), error = NULLIF(left(:'error', 2000), '')
WHERE id = :'id'::uuid;
SQL
  then
    echo 'WARNING: operation result could not be recorded; continuing.' >&2
  fi
  return 0
}
