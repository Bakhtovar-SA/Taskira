#!/usr/bin/env bash
set -Eeuo pipefail
export LC_ALL=C

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
    if [ "$MODE" = "rollback" ]; then
      echo "The rollback is incomplete. The original dump is unchanged." >&2
      echo "Fix the reported cause, then retry this exact restore command:" >&2
    else
      echo "Run this exact command to restore the previous version and database:" >&2
    fi
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
  env_file_value "$INSTALL_DIR/.env" "$1"
}

load_install_settings() {
  POSTGRES_USER="$(env_value POSTGRES_USER)"; [ -n "$POSTGRES_USER" ] || POSTGRES_USER="taskira"
  POSTGRES_DB="$(env_value POSTGRES_DB)"; [ -n "$POSTGRES_DB" ] || POSTGRES_DB="taskira"
  CLIENT_PORT="$(env_value CLIENT_PORT)"; [ -n "$CLIENT_PORT" ] || CLIENT_PORT="8081"
  [[ "$POSTGRES_USER" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || { echo "ERROR: unsafe POSTGRES_USER" >&2; return 1; }
  [[ "$POSTGRES_DB" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || { echo "ERROR: unsafe POSTGRES_DB" >&2; return 1; }
}

parse_semver() {
  version="$1"
  prefix="$2"
  semver_pattern='^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-([0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*))?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$'
  [[ "$version" =~ $semver_pattern ]] || { echo "ERROR: invalid semantic version: $version" >&2; return 1; }
  printf -v "${prefix}_MAJOR" '%s' "${BASH_REMATCH[1]}"
  printf -v "${prefix}_MINOR" '%s' "${BASH_REMATCH[2]}"
  printf -v "${prefix}_PATCH" '%s' "${BASH_REMATCH[3]}"
  printf -v "${prefix}_PRE" '%s' "${BASH_REMATCH[5]}"
  prerelease="${BASH_REMATCH[5]}"
  if [ -n "$prerelease" ]; then
    IFS=. read -r -a identifiers <<< "$prerelease"
    for identifier in "${identifiers[@]}"; do
      if [[ "$identifier" =~ ^[0-9]+$ ]] && [ "${#identifier}" -gt 1 ] && [ "${identifier#0}" != "$identifier" ]; then
        echo "ERROR: invalid semantic version (numeric prerelease identifier has a leading zero): $version" >&2
        return 1
      fi
    done
  fi
}

semver_is_greater() {
  parse_semver "$1" A || return 1
  parse_semver "$2" B || return 1
  for part in MAJOR MINOR PATCH; do
    eval "left=\${A_${part}}; right=\${B_${part}}"
    ((10#$left > 10#$right)) && return 0
    ((10#$left < 10#$right)) && return 1
  done
  [ -z "$A_PRE" ] && [ -n "$B_PRE" ] && return 0
  [ -n "$A_PRE" ] && [ -z "$B_PRE" ] && return 1
  [ -z "$A_PRE" ] && return 1
  IFS=. read -r -a left_ids <<< "$A_PRE"
  IFS=. read -r -a right_ids <<< "$B_PRE"
  count="${#left_ids[@]}"; [ "${#right_ids[@]}" -gt "$count" ] && count="${#right_ids[@]}"
  for ((i=0; i<count; i++)); do
    [ "$i" -lt "${#left_ids[@]}" ] || return 1
    [ "$i" -lt "${#right_ids[@]}" ] || return 0
    left="${left_ids[$i]}"; right="${right_ids[$i]}"
    [ "$left" = "$right" ] && continue
    if [[ "$left" =~ ^[0-9]+$ ]] && [[ "$right" =~ ^[0-9]+$ ]]; then
      ((10#$left > 10#$right)) && return 0 || return 1
    fi
    [[ "$left" =~ ^[0-9]+$ ]] && return 1
    [[ "$right" =~ ^[0-9]+$ ]] && return 0
    [[ "$left" > "$right" ]] && return 0 || return 1
  done
  return 1
}

compose() {
  (
    cd "$INSTALL_DIR"
    compose_run --env-file .env -f docker-compose.yml "$@"
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
  wait_until_healthy "$expected" "$CLIENT_PORT" "$INSTALL_DIR"
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

drop_database() {
  database="$1"
  compose exec -T postgres psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres \
    -c "DROP DATABASE IF EXISTS \"$database\" WITH (FORCE)"
}

wait_for_database_connections_to_close() {
  database="$1"
  attempt=1
  while [ "$attempt" -le 30 ]; do
    connection_count="$(compose exec -T postgres psql -At -U "$POSTGRES_USER" -d postgres \
      -c "SELECT count(*) FROM pg_stat_activity WHERE datname = '$database'")"
    [ "$connection_count" = "0" ] && return 0
    sleep 1
    attempt=$((attempt + 1))
  done
  echo "ERROR: connections to database $database did not close within 30 seconds" >&2
  return 1
}

verify_database_dump() {
  dump_file="$1"
  validation_db="taskira_backup_check_$(date -u +%Y%m%d%H%M%S)_$$"
  compose exec -T postgres createdb -U "$POSTGRES_USER" -O "$POSTGRES_USER" "$validation_db"
  if ! compose exec -T postgres pg_restore --exit-on-error --no-owner --no-privileges \
      -U "$POSTGRES_USER" -d "$validation_db" < "$dump_file"; then
    drop_database "$validation_db" >/dev/null 2>&1 || true
    echo "ERROR: backup cannot be restored completely" >&2
    return 1
  fi
  drop_database "$validation_db"
}

restore_database_safely() {
  dump_file="$1"
  safety_db="taskira_before_rollback_$(date -u +%Y%m%d%H%M%S)_$$"
  database_exists="$(compose exec -T postgres psql -At -U "$POSTGRES_USER" -d postgres \
    -c "SELECT 1 FROM pg_database WHERE datname = '$POSTGRES_DB'")"
  safety_moved=0
  if [ "$database_exists" = "1" ]; then
    compose exec -T postgres psql -1 -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres \
      -c "ALTER DATABASE \"$POSTGRES_DB\" WITH ALLOW_CONNECTIONS false" \
      -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$POSTGRES_DB'"
    if ! wait_for_database_connections_to_close "$POSTGRES_DB" ||
       ! compose exec -T postgres psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres \
         -c "ALTER DATABASE \"$POSTGRES_DB\" RENAME TO \"$safety_db\""; then
      compose exec -T postgres psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres \
        -c "ALTER DATABASE \"$POSTGRES_DB\" WITH ALLOW_CONNECTIONS true" >/dev/null 2>&1 || true
      return 1
    fi
    safety_moved=1
  fi
  if ! compose exec -T postgres createdb -U "$POSTGRES_USER" -O "$POSTGRES_USER" "$POSTGRES_DB" ||
     ! compose exec -T postgres pg_restore --exit-on-error --no-owner --no-privileges \
       -U "$POSTGRES_USER" -d "$POSTGRES_DB" < "$dump_file"; then
    drop_database "$POSTGRES_DB" >/dev/null 2>&1 || true
    if [ "$safety_moved" = "1" ]; then
      compose exec -T postgres psql -1 -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres \
        -c "ALTER DATABASE \"$safety_db\" RENAME TO \"$POSTGRES_DB\"" \
        -c "ALTER DATABASE \"$POSTGRES_DB\" WITH ALLOW_CONNECTIONS true" || {
          echo "CRITICAL: automatic restoration of the pre-rollback database failed; it remains named $safety_db" >&2
          return 1
        }
      echo "The pre-rollback database was restored automatically after the dump restore failed." >&2
    fi
    return 1
  fi
  [ "$safety_moved" = "0" ] || drop_database "$safety_db"
}

for command_name in sha256sum sed awk grep sort comm df du date mktemp curl; do
  command -v "$command_name" >/dev/null 2>&1 || { echo "ERROR: $command_name is required" >&2; exit 1; }
done
require_file "$INSTALL_DIR/.env"
require_file "$INSTALL_DIR/docker-compose.yml"
require_file "$INSTALL_DIR/VERSION"
. "$RELEASE_DIR/container-engine.sh"
detect_engine

load_install_settings

if [ "$MODE" = "rollback" ]; then
  STAGE="rollback validation"
  ROLLBACK_DIR="$(CDPATH= cd -- "$ROLLBACK_DIR" && pwd)"
  require_file "$ROLLBACK_DIR/database.dump"
  require_file "$ROLLBACK_DIR/database.dump.sha256"
  require_file "$ROLLBACK_DIR/docker-compose.yml"
  require_file "$ROLLBACK_DIR/VERSION"
  (cd "$ROLLBACK_DIR" && sha256sum --check --strict database.dump.sha256 >/dev/null)
  BACKUP_DIR="$ROLLBACK_DIR"
  ROLLBACK_READY=1
  old_version="$(tr -d '\r\n' < "$ROLLBACK_DIR/VERSION")"

  STAGE="stopping the failed upgrade"
  compose down
  STAGE="restoring previous release metadata"
  restore_release_files "$ROLLBACK_DIR"
  [ ! -f "$ROLLBACK_DIR/.env" ] || cp "$ROLLBACK_DIR/.env" "$INSTALL_DIR/.env"
  load_install_settings

  STAGE="starting PostgreSQL for restore"
  compose up -d postgres
  wait_for_database
  STAGE="restoring the database dump with a safety database"
  restore_database_safely "$ROLLBACK_DIR/database.dump"
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
parse_semver "$target_version" TARGET
parse_semver "$current_version" CURRENT
semver_is_greater "$target_version" "$current_version" || {
  if [ "$target_version" = "$current_version" ]; then
    echo "ERROR: Taskira $target_version is already installed" >&2
  else
    echo "ERROR: refusing downgrade: target $target_version is not newer than installed $current_version" >&2
  fi
  exit 1
}

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
required_kb=$(((db_bytes / 1024) * 2 + 1048576))
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
STAGE="verifying PostgreSQL backup with a full test restore"
verify_database_dump "$BACKUP_DIR/database.dump"
(cd "$BACKUP_DIR" && sha256sum database.dump > database.dump.sha256)
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
