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
for command_name in tar sha256sum mktemp date; do command -v "$command_name" >/dev/null || fail "$command_name is required"; done

timestamp="$(date -u +'%Y%m%dT%H%M%SZ')"
[ -n "$OUTPUT" ] || OUTPUT="$PWD/taskira-backup-${timestamp}.tar.gz"
case "$OUTPUT" in /*) ;; *) OUTPUT="$PWD/$OUTPUT" ;; esac
[ ! -e "$OUTPUT" ] || fail "output already exists: $OUTPUT"
mkdir -p "$(dirname -- "$OUTPUT")"
WORK_DIR="$(mktemp -d)"
STACK_STOPPED=0
cleanup() {
  if [ "$STACK_STOPPED" = "1" ]; then
    compose up -d >/dev/null 2>&1 || echo "WARNING: could not restart Taskira; run compose up -d" >&2
  fi
  rm -rf -- "$WORK_DIR"
}
trap cleanup EXIT INT TERM
mkdir -p "$WORK_DIR/bundle/storage"
chmod 0777 "$WORK_DIR/bundle/storage"

wait_for_database
version="$(current_version)"
schema="$(latest_schema)"
[ -n "$schema" ] || fail "cannot determine schema version"

echo "Stopping application writes for a consistent backup..."
STACK_STOPPED=1
compose stop client server

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
  "storage_driver": "$storage_driver"
}
EOF
(
  cd "$WORK_DIR/bundle"
  find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS
  tar -czf "$OUTPUT" .
)
chmod 0600 "$OUTPUT"

compose up -d
wait_until_healthy "$version" "$CLIENT_PORT" "$INSTALL_DIR"
STACK_STOPPED=0
echo "Backup complete: $OUTPUT"
