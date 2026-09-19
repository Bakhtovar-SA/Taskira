#!/usr/bin/env bash
set -Eeuo pipefail
export LC_ALL=C

OPS_SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
INSTALL_DIR="${TASKIRA_INSTALL_DIR:-}"
ENGINE="${CONTAINER_ENGINE:-}"
ARCHIVE=""
ASSUME_YES=0

usage() {
  echo "Usage: ./restore.sh --install-dir DIR --archive FILE.tar.gz [--yes] [--engine docker|podman]"
}
while [ "$#" -gt 0 ]; do
  case "$1" in
    --install-dir) INSTALL_DIR="$2"; shift 2 ;;
    --archive) ARCHIVE="$2"; shift 2 ;;
    --yes) ASSUME_YES=1; shift ;;
    --engine) ENGINE="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done
[ -n "$INSTALL_DIR" ] && [ -n "$ARCHIVE" ] || { usage >&2; exit 2; }
case "$ARCHIVE" in /*) ;; *) ARCHIVE="$PWD/$ARCHIVE" ;; esac
[ -f "$ARCHIVE" ] || { echo "ERROR: archive not found: $ARCHIVE" >&2; exit 1; }
. "$OPS_SCRIPT_DIR/operations-common.sh"
ops_init "$INSTALL_DIR"
for command_name in tar sha256sum mktemp grep; do command -v "$command_name" >/dev/null || fail "$command_name is required"; done

WORK_DIR="$(mktemp -d)"
RESTORE_STARTED=0
cleanup() { rm -rf -- "$WORK_DIR"; }
on_error() {
  code=$?
  trap - ERR
  if [ "$RESTORE_STARTED" = "1" ]; then
    compose stop client server >/dev/null 2>&1 || true
    echo "ERROR: restore is incomplete; Taskira was left stopped." >&2
    echo "Fix the cause and retry this exact command:" >&2
    printf '  %q' "$OPS_SCRIPT_DIR/restore.sh" --install-dir "$INSTALL_DIR" --engine "$ENGINE" --archive "$ARCHIVE" --yes >&2
    printf '\n' >&2
  fi
  exit "$code"
}
trap cleanup EXIT INT TERM
trap on_error ERR
safe_extract "$ARCHIVE" "$WORK_DIR"
for file in manifest.json SHA256SUMS database.dump schema-migrations.txt env.public storage/objects.json; do require_file "$WORK_DIR/$file"; done
(cd "$WORK_DIR" && sha256sum --check --strict SHA256SUMS >/dev/null)
archive_schema="$(sed -n 's/.*"schema_version": "\([^"]*\)".*/\1/p' "$WORK_DIR/manifest.json")"
[ -n "$archive_schema" ] || fail "backup manifest has no schema version"
require_file "$INSTALL_DIR/MIGRATIONS.txt"
grep -Fxq "$archive_schema" "$INSTALL_DIR/MIGRATIONS.txt" || \
  fail "backup schema $archive_schema is newer than or unknown to this application; install a compatible Taskira release first"
while IFS= read -r migration; do
  grep -Fxq "$migration" "$INSTALL_DIR/MIGRATIONS.txt" || \
    fail "backup contains migration unknown to this application: $migration"
done < "$WORK_DIR/schema-migrations.txt"
chmod -R a+rX "$WORK_DIR/storage"
storage_command verify "$WORK_DIR/storage"

if [ "$ASSUME_YES" != "1" ]; then
  echo "WARNING: this will replace the current Taskira database and every attachment."
  printf 'Type REPLACE to continue: '
  read -r confirmation
  [ "$confirmation" = "REPLACE" ] || fail "restore cancelled"
fi

echo "Stopping Taskira and restoring backup..."
RESTORE_STARTED=1
compose stop client server
compose up -d postgres
wait_for_database
restore_database "$WORK_DIR/database.dump"
storage_command import "$WORK_DIR/storage"
version="$(current_version)"
compose up -d
wait_until_healthy "$version" "$CLIENT_PORT" "$INSTALL_DIR"
RESTORE_STARTED=0
echo "Restore complete from: $ARCHIVE"
