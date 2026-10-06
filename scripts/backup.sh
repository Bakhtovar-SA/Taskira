#!/usr/bin/env bash
set -Eeuo pipefail
export LC_ALL=C

OPS_SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
INSTALL_DIR="${TASKIRA_INSTALL_DIR:-}"
ENGINE="${CONTAINER_ENGINE:-}"
OUTPUT=""

usage() {
  echo "Usage: ./backup.sh --install-dir DIR [--output FILE.tar.gz] [--engine docker|podman]"
}
while [ "$#" -gt 0 ]; do
  case "$1" in
    --install-dir) INSTALL_DIR="$2"; shift 2 ;;
    --output) OUTPUT="$2"; shift 2 ;;
    --engine) ENGINE="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done
[ -n "$INSTALL_DIR" ] || { usage >&2; exit 2; }
. "$OPS_SCRIPT_DIR/operations-common.sh"
ops_init "$INSTALL_DIR"
. "$OPS_SCRIPT_DIR/ops-report.sh"
for command_name in tar sha256sum mktemp date; do command -v "$command_name" >/dev/null || fail "$command_name is required"; done

timestamp="$(date -u +'%Y%m%dT%H%M%SZ')"
[ -n "$OUTPUT" ] || OUTPUT="$PWD/taskira-backup-${timestamp}.tar.gz"
case "$OUTPUT" in /*) ;; *) OUTPUT="$PWD/$OUTPUT" ;; esac
OPS_ARCHIVE="$OUTPUT"
OPS_RUN_ID="$(ops_run_start backup)"
STARTED_AT="$(date +%s)"
WORK_DIR=""
STACK_STOPPED=0
cleanup() {
  local code=$?
  trap - EXIT ERR
  if [ "$code" != 0 ]; then
    ops_run_finish "$OPS_RUN_ID" failure '{}' "${OPS_LAST_ERROR:-backup failed (exit $code)}"
  fi
  if [ "$STACK_STOPPED" = "1" ]; then
    compose up -d >/dev/null 2>&1 || echo "WARNING: could not restart Taskira; run compose up -d" >&2
  fi
  [ -z "$WORK_DIR" ] || rm -rf -- "$WORK_DIR"
  exit "$code"
}
trap cleanup EXIT
trap 'OPS_LAST_ERROR="backup failed at line $LINENO (exit $?): $BASH_COMMAND"' ERR
trap 'exit 130' INT
trap 'exit 143' TERM
[ ! -e "$OUTPUT" ] || fail "output already exists: $OUTPUT"
mkdir -p "$(dirname -- "$OUTPUT")"
WORK_DIR="$(mktemp -d)"
mkdir -p "$WORK_DIR/bundle/storage"
chmod 0777 "$WORK_DIR/bundle/storage"

wait_for_database
version="$(current_version)"
schema="$(latest_schema)"
[ -n "$schema" ] || fail "cannot determine schema version"

echo "Stopping application writes for a consistent backup..."
STACK_STOPPED=1
compose stop client server
counts="$(compose exec -T postgres psql -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "SELECT json_build_object('projects', (SELECT count(*) FROM projects), 'issues', (SELECT count(*) FROM issues))")"

echo "Creating PostgreSQL dump..."
compose exec -T postgres pg_dump --format=custom --no-owner --no-privileges \
  -U "$POSTGRES_USER" -d "$POSTGRES_DB" > "$WORK_DIR/bundle/database.dump"
verify_database_dump "$WORK_DIR/bundle/database.dump"
schema_migrations > "$WORK_DIR/bundle/schema-migrations.txt"

echo "Exporting attachment storage..."
storage_command export "$WORK_DIR/bundle/storage"
write_public_env "$INSTALL_DIR/.env" "$WORK_DIR/bundle/env.public"
storage_driver="$(env_file_value "$INSTALL_DIR/.env" STORAGE_DRIVER)"; [ -n "$storage_driver" ] || storage_driver=local
cat > "$WORK_DIR/bundle/manifest.json" <<EOF
{
  "format": 1,
  "product": "Taskira",
  "created_at": "$(date -u +'%Y-%m-%dT%H:%M:%SZ')",
  "application_version": "$version",
  "schema_version": "$schema",
  "storage_driver": "$storage_driver",
  "counts": $counts
}
EOF
(
  cd "$WORK_DIR/bundle"
  find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS
  tar -czf "$OUTPUT" .
)
chmod 0600 "$OUTPUT"
bytes="$(wc -c < "$OUTPUT" | tr -d ' ')"
ops_run_finish "$OPS_RUN_ID" success \
  "{\"bytes\":$bytes,\"durationSec\":$(($(date +%s) - STARTED_AT)),\"storageDriver\":\"$storage_driver\"}" ''

compose up -d
ops_wait_for_application "$version"
STACK_STOPPED=0
echo "Backup complete: $OUTPUT"
