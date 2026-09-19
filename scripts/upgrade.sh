#!/usr/bin/env bash
set -Eeuo pipefail

RELEASE_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
INSTALL_DIR="${TASKIRA_INSTALL_DIR:-}"
ENGINE="${CONTAINER_ENGINE:-}"
MODE="upgrade"
ROLLBACK_DIR=""
BACKUP_DIR=""
ROLLBACK_READY=0
STAGE="initialization"
TMP_DIR=""

usage() {
  cat <<'EOF'
Upgrade an existing single-host Taskira installation from an offline release.

Usage:
  ./upgrade.sh --install-dir DIR [--engine docker|podman] [--dry-run]
  ./upgrade.sh --install-dir DIR [--engine docker|podman] --rollback BACKUP_DIR

Run this script from the NEW extracted release. DIR is the existing Taskira
installation directory containing .env, VERSION and docker-compose.yml.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --install-dir) [ "$#" -ge 2 ] || { echo "--install-dir requires DIR" >&2; exit 2; }; INSTALL_DIR="$2"; shift 2 ;;
    --engine) [ "$#" -ge 2 ] || { echo "--engine requires docker or podman" >&2; exit 2; }; ENGINE="$2"; shift 2 ;;
    --dry-run) MODE="dry-run"; shift ;;
    --rollback) [ "$#" -ge 2 ] || { echo "--rollback requires BACKUP_DIR" >&2; exit 2; }; MODE="rollback"; ROLLBACK_DIR="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[ -n "$INSTALL_DIR" ] || { echo "ERROR: --install-dir is required" >&2; exit 2; }
INSTALL_DIR="$(CDPATH= cd -- "$INSTALL_DIR" && pwd)"

cleanup() {
  [ -z "$TMP_DIR" ] || rm -rf -- "$TMP_DIR"
}

rollback_command() {
  printf '  %q' "$RELEASE_DIR/upgrade.sh" --install-dir "$INSTALL_DIR" --engine "$ENGINE" --rollback "$BACKUP_DIR"
  printf '\n'
}

on_error() {
  code=$?
  trap - ERR
  echo >&2
  echo "ERROR: upgrade failed during: $STAGE" >&2
  if [ "$ROLLBACK_READY" = "1" ]; then
    compose down >/dev/null 2>&1 || true
    echo "Run this exact command to restore the previous version and database:" >&2
    rollback_command >&2
  else
    echo "No installation changes were made; rollback is not required." >&2
  fi
  exit "$code"
}
trap cleanup EXIT
trap on_error ERR

require_file() {
  [ -f "$1" ] || { echo "ERROR: required file is missing: $1" >&2; return 1; }
}

env_value() {
  key="$1"
  sed -n "s/^${key}=//p" "$INSTALL_DIR/.env" | tail -n 1 | sed 's/\r$//'
}

compose() {
  (
    cd "$INSTALL_DIR"
    if [ "$ENGINE" = "docker" ]; then
      docker compose --env-file .env -f docker-compose.yml "$@"
    else
      podman compose --env-file .env -f docker-compose.yml "$@"
    fi
  )
}

verify_release() {
  require_file "$RELEASE_DIR/SHA256SUMS"
  (cd "$RELEASE_DIR" && sha256sum --check --strict SHA256SUMS >/dev/null)
}

wait_for_database() {
  attempt=1
  until compose exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; do
    [ "$attempt" -lt 30 ] || { echo "ERROR: PostgreSQL did not become ready within 60 seconds" >&2; return 1; }
    sleep 2
    attempt=$((attempt + 1))
  done
}

wait_for_health() {
  expected="$1"
  attempt=1
  while [ "$attempt" -le 60 ]; do
    health="$(curl --fail --silent "http://127.0.0.1:${CLIENT_PORT}/api/health" 2>/dev/null || true)"
    if printf '%s' "$health" | grep -Fq "\"version\":\"${expected}\""; then
      echo "Taskira $expected is healthy: $health"
      return 0
    fi
    sleep 2
    attempt=$((attempt + 1))
  done
  echo "ERROR: Taskira $expected did not become healthy within 120 seconds" >&2
  compose logs --tail=100 server >&2 || true
  return 1
}

load_release_images() {
  while IFS= read -r archive; do
    [ -n "$archive" ] || continue
    "$ENGINE" load --input "$RELEASE_DIR/$archive"
  done < <(cd "$RELEASE_DIR" && find images -maxdepth 1 -type f -name '*.tar' -print | LC_ALL=C sort)
  while IFS= read -r image; do
    [ -n "$image" ] || continue
    "$ENGINE" image inspect "$image" >/dev/null
  done < "$RELEASE_DIR/IMAGES.txt"
}

restore_release_files() {
  source_dir="$1"
  for name in docker-compose.yml VERSION IMAGES.txt manifest.json MIGRATIONS.txt; do
    if [ -f "$source_dir/$name" ]; then
      cp "$source_dir/$name" "$INSTALL_DIR/$name.new"
      mv "$INSTALL_DIR/$name.new" "$INSTALL_DIR/$name"
    else
      rm -f "$INSTALL_DIR/$name"
    fi
  done
}

for command_name in sha256sum sed awk grep sort comm df du date mktemp curl; do
  command -v "$command_name" >/dev/null 2>&1 || { echo "ERROR: $command_name is required" >&2; exit 1; }
done
require_file "$INSTALL_DIR/.env"
require_file "$INSTALL_DIR/docker-compose.yml"
require_file "$INSTALL_DIR/VERSION"
. "$RELEASE_DIR/container-engine.sh"
detect_engine

POSTGRES_USER="$(env_value POSTGRES_USER)"; [ -n "$POSTGRES_USER" ] || POSTGRES_USER="taskira"
POSTGRES_DB="$(env_value POSTGRES_DB)"; [ -n "$POSTGRES_DB" ] || POSTGRES_DB="taskira"
CLIENT_PORT="$(env_value CLIENT_PORT)"; [ -n "$CLIENT_PORT" ] || CLIENT_PORT="8081"
[[ "$POSTGRES_USER" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || { echo "ERROR: unsafe POSTGRES_USER" >&2; exit 1; }
[[ "$POSTGRES_DB" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || { echo "ERROR: unsafe POSTGRES_DB" >&2; exit 1; }

if [ "$MODE" = "rollback" ]; then
  STAGE="rollback validation"
  ROLLBACK_DIR="$(CDPATH= cd -- "$ROLLBACK_DIR" && pwd)"
  require_file "$ROLLBACK_DIR/database.dump"
  require_file "$ROLLBACK_DIR/docker-compose.yml"
  require_file "$ROLLBACK_DIR/VERSION"
  old_version="$(tr -d '\r\n' < "$ROLLBACK_DIR/VERSION")"

  STAGE="stopping the failed upgrade"
  compose down
  STAGE="restoring previous release metadata"
  restore_release_files "$ROLLBACK_DIR"
  [ ! -f "$ROLLBACK_DIR/.env" ] || cp "$ROLLBACK_DIR/.env" "$INSTALL_DIR/.env"

  STAGE="starting PostgreSQL for restore"
  compose up -d postgres
  wait_for_database
  STAGE="recreating the database"
  compose exec -T postgres psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres \
    -c "DROP DATABASE IF EXISTS \"$POSTGRES_DB\" WITH (FORCE)"
  compose exec -T postgres createdb -U "$POSTGRES_USER" -O "$POSTGRES_USER" "$POSTGRES_DB"
  STAGE="restoring the database dump"
  compose exec -T postgres pg_restore --exit-on-error --no-owner --no-privileges \
    -U "$POSTGRES_USER" -d "$POSTGRES_DB" < "$ROLLBACK_DIR/database.dump"
  STAGE="starting previous Taskira version"
  compose up -d
  wait_for_health "$old_version"
  echo "Rollback complete. Taskira $old_version and its database were restored."
  exit 0
fi

STAGE="release integrity verification"
verify_release
require_file "$RELEASE_DIR/IMAGES.txt"
require_file "$RELEASE_DIR/MIGRATIONS.txt"
require_file "$RELEASE_DIR/VERSION"
target_version="$(tr -d '\r\n' < "$RELEASE_DIR/VERSION")"
current_version="$(tr -d '\r\n' < "$INSTALL_DIR/VERSION")"
[ "$target_version" != "$current_version" ] || { echo "ERROR: Taskira $target_version is already installed" >&2; exit 1; }

STAGE="current installation health check"
wait_for_database
wait_for_health "$current_version"

TMP_DIR="$(mktemp -d)"
compose exec -T postgres psql -At -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c 'SELECT name FROM schema_migrations ORDER BY name' > "$TMP_DIR/applied.txt"
LC_ALL=C sort "$RELEASE_DIR/MIGRATIONS.txt" > "$TMP_DIR/release.txt"
LC_ALL=C sort "$TMP_DIR/applied.txt" > "$TMP_DIR/applied-sorted.txt"
comm -23 "$TMP_DIR/release.txt" "$TMP_DIR/applied-sorted.txt" > "$TMP_DIR/pending.txt"

db_bytes="$(compose exec -T postgres psql -At -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c 'SELECT pg_database_size(current_database())' | tr -d '\r')"
[[ "$db_bytes" =~ ^[0-9]+$ ]] || { echo "ERROR: cannot determine database size" >&2; exit 1; }
images_kb="$(du -sk "$RELEASE_DIR/images" | awk '{print $1}')"
required_kb=$((images_kb + (db_bytes / 1024) * 2 + 1048576))
available_kb="$(df -Pk "$INSTALL_DIR" | awk 'NR==2 {print $4}')"
[[ "$available_kb" =~ ^[0-9]+$ ]] || { echo "ERROR: cannot determine free disk space" >&2; exit 1; }
[ "$available_kb" -ge "$required_kb" ] || {
  echo "ERROR: insufficient free space: need ${required_kb} KiB, have ${available_kb} KiB" >&2
  exit 1
}
if [ "$ENGINE" = "docker" ]; then
  engine_root="$(docker info --format '{{.DockerRootDir}}')"
else
  engine_root="$(podman info --format '{{.Store.GraphRoot}}')"
fi
engine_available_kb="$(df -Pk "$engine_root" 2>/dev/null | awk 'NR==2 {print $4}')"
[[ "$engine_available_kb" =~ ^[0-9]+$ ]] || { echo "ERROR: cannot determine free space for container storage: $engine_root" >&2; exit 1; }
engine_required_kb=$((images_kb * 3 + 524288))
[ "$engine_available_kb" -ge "$engine_required_kb" ] || {
  echo "ERROR: insufficient container storage: need ${engine_required_kb} KiB, have ${engine_available_kb} KiB" >&2
  exit 1
}

echo "Upgrade plan: Taskira $current_version -> $target_version"
echo "Database: $POSTGRES_DB ($db_bytes bytes); install filesystem free: ${available_kb} KiB"
echo "Container storage: $engine_root; free: ${engine_available_kb} KiB"
if [ -s "$TMP_DIR/pending.txt" ]; then
  echo "Pending migrations:"
  sed 's/^/  - /' "$TMP_DIR/pending.txt"
else
  echo "Pending migrations: none"
fi
if [ "$MODE" = "dry-run" ]; then
  echo "Dry run complete: no files, images, containers, or database contents were changed."
  exit 0
fi

timestamp="$(date -u +'%Y%m%dT%H%M%SZ')"
BACKUP_DIR="$INSTALL_DIR/backups/${timestamp}_${current_version}_to_${target_version}"
STAGE="creating backup directory"
mkdir -p "$INSTALL_DIR/backups"
mkdir "$BACKUP_DIR"
chmod 0700 "$BACKUP_DIR"
for name in docker-compose.yml VERSION IMAGES.txt manifest.json MIGRATIONS.txt .env; do
  [ ! -f "$INSTALL_DIR/$name" ] || cp "$INSTALL_DIR/$name" "$BACKUP_DIR/$name"
done

STAGE="creating PostgreSQL backup"
compose exec -T postgres pg_dump --format=custom --no-owner --no-privileges \
  -U "$POSTGRES_USER" -d "$POSTGRES_DB" > "$BACKUP_DIR/database.dump"
compose exec -T postgres pg_restore --list < "$BACKUP_DIR/database.dump" >/dev/null
ROLLBACK_READY=1

STAGE="stopping current containers"
compose down
STAGE="loading new offline images"
load_release_images
STAGE="installing new release metadata"
restore_release_files "$RELEASE_DIR"
STAGE="starting PostgreSQL"
compose up -d postgres
wait_for_database
STAGE="applying database migrations"
compose run --rm --no-deps server node dist/migrate.js
STAGE="starting Taskira $target_version"
compose up -d
STAGE="health-checking Taskira $target_version"
wait_for_health "$target_version"

echo "Upgrade complete: Taskira $current_version -> $target_version"
echo "Backup: $BACKUP_DIR/database.dump"
echo "Rollback command (keep until the release is accepted):"
rollback_command
