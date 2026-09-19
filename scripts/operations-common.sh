#!/usr/bin/env bash

ops_init() {
  INSTALL_DIR="$(CDPATH= cd -- "$1" && pwd)"
  require_file "$INSTALL_DIR/.env"
  require_file "$INSTALL_DIR/docker-compose.yml"
  require_file "$INSTALL_DIR/VERSION"
  if [ -f "$OPS_SCRIPT_DIR/container-engine.sh" ]; then
    . "$OPS_SCRIPT_DIR/container-engine.sh"
  else
    . "$OPS_SCRIPT_DIR/release/container-engine.sh"
  fi
  ENGINE="${ENGINE:-${CONTAINER_ENGINE:-}}"
  detect_engine
  POSTGRES_USER="$(env_file_value "$INSTALL_DIR/.env" POSTGRES_USER)"; [ -n "$POSTGRES_USER" ] || POSTGRES_USER=taskira
  POSTGRES_DB="$(env_file_value "$INSTALL_DIR/.env" POSTGRES_DB)"; [ -n "$POSTGRES_DB" ] || POSTGRES_DB=taskira
  CLIENT_PORT="$(env_file_value "$INSTALL_DIR/.env" CLIENT_PORT)"; [ -n "$CLIENT_PORT" ] || CLIENT_PORT=8081
  [[ "$POSTGRES_USER" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || fail "unsafe POSTGRES_USER"
  [[ "$POSTGRES_DB" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || fail "unsafe POSTGRES_DB"
  [[ "$CLIENT_PORT" =~ ^[0-9]+$ ]] || fail "invalid CLIENT_PORT"
}

fail() { echo "ERROR: $*" >&2; exit 1; }
require_file() { [ -f "$1" ] || fail "required file is missing: $1"; }

compose() {
  (cd "$INSTALL_DIR" && compose_run --env-file .env -f docker-compose.yml "$@")
}

wait_for_database() {
  attempt=1
  until compose exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; do
    [ "$attempt" -lt 30 ] || fail "PostgreSQL did not become ready within 60 seconds"
    sleep 2
    attempt=$((attempt + 1))
  done
}

current_version() { tr -d '\r\n' < "$INSTALL_DIR/VERSION"; }

write_public_env() {
  source_file="$1"
  target_file="$2"
  : > "$target_file"
  for key in \
    TASKIRA_VERSION POSTGRES_USER POSTGRES_DB \
    CORS_ORIGIN CLIENT_PORT TRUST_PROXY VITE_API_URL SESSION_COOKIE_SECURE \
    AUTH_MODE LDAP_URL LDAP_USER_BASE_DN LDAP_USER_FILTER LDAP_GROUP_MEMBERSHIP \
    LDAP_GROUP_BASE_DN LDAP_ADMIN_GROUP_DN LDAP_ATTR_LOGIN LDAP_ATTR_NAME LDAP_ATTR_MAIL \
    STORAGE_DRIVER STORAGE_S3_ENDPOINT STORAGE_S3_BUCKET STORAGE_S3_REGION STORAGE_S3_FORCE_PATH_STYLE \
    NOTIFY_EMAIL_ENABLED SMTP_HOST SMTP_PORT SMTP_FROM APP_BASE_URL \
    MAINTENANCE_ENABLED STORAGE_SWEEP_ENABLED STORAGE_SWEEP_INTERVAL_MS STORAGE_SWEEP_GRACE_MS; do
    value="$(env_file_value "$source_file" "$key")"
    [ -z "$value" ] || printf '%s=%s\n' "$key" "$value" >> "$target_file"
  done
  chmod 0600 "$target_file"
}

schema_migrations() {
  compose exec -T postgres psql -At -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    -c 'SELECT name FROM schema_migrations ORDER BY name'
}

latest_schema() {
  schema_migrations | tail -n 1 | tr -d '\r'
}

storage_command() {
  mode="$1"
  host_dir="$2"
  user_args=()
  [ "$mode" != "export" ] || user_args=(--user 0)
  compose run --rm --no-deps -T "${user_args[@]}" -v "$host_dir:/backup/storage" \
    server node dist/ops-storage.js "$mode" /backup/storage
}

drop_database() {
  database="$1"
  compose exec -T postgres psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres \
    -c "DROP DATABASE IF EXISTS \"$database\" WITH (FORCE)"
}

verify_database_dump() {
  dump_file="$1"
  check_db="taskira_backup_check_$(date -u +%Y%m%d%H%M%S)_$$"
  compose exec -T postgres createdb -U "$POSTGRES_USER" -O "$POSTGRES_USER" "$check_db"
  if ! compose exec -T postgres pg_restore --exit-on-error --no-owner --no-privileges \
      -U "$POSTGRES_USER" -d "$check_db" < "$dump_file"; then
    drop_database "$check_db" >/dev/null 2>&1 || true
    fail "database dump failed a full test restore"
  fi
  drop_database "$check_db" >/dev/null
}

restore_database() {
  dump_file="$1"
  safety_db="taskira_before_restore_$(date -u +%Y%m%d%H%M%S)_$$"
  exists="$(compose exec -T postgres psql -At -U "$POSTGRES_USER" -d postgres \
    -c "SELECT 1 FROM pg_database WHERE datname = '$POSTGRES_DB'")"
  moved=0
  if [ "$exists" = "1" ]; then
    compose exec -T postgres psql -1 -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres \
      -c "ALTER DATABASE \"$POSTGRES_DB\" WITH ALLOW_CONNECTIONS false" \
      -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$POSTGRES_DB'"
    for _ in $(seq 1 30); do
      count="$(compose exec -T postgres psql -At -U "$POSTGRES_USER" -d postgres \
        -c "SELECT count(*) FROM pg_stat_activity WHERE datname = '$POSTGRES_DB'")"
      [ "$count" = "0" ] && break
      sleep 1
    done
    [ "${count:-1}" = "0" ] || fail "database connections did not close"
    compose exec -T postgres psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres \
      -c "ALTER DATABASE \"$POSTGRES_DB\" RENAME TO \"$safety_db\""
    moved=1
  fi
  if ! compose exec -T postgres createdb -U "$POSTGRES_USER" -O "$POSTGRES_USER" "$POSTGRES_DB" ||
     ! compose exec -T postgres pg_restore --exit-on-error --no-owner --no-privileges \
       -U "$POSTGRES_USER" -d "$POSTGRES_DB" < "$dump_file"; then
    drop_database "$POSTGRES_DB" >/dev/null 2>&1 || true
    if [ "$moved" = "1" ]; then
      compose exec -T postgres psql -1 -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres \
        -c "ALTER DATABASE \"$safety_db\" RENAME TO \"$POSTGRES_DB\"" \
        -c "ALTER DATABASE \"$POSTGRES_DB\" WITH ALLOW_CONNECTIONS true"
    fi
    fail "database restore failed; the pre-restore database was put back"
  fi
  [ "$moved" = "0" ] || drop_database "$safety_db" >/dev/null
}

safe_extract() {
  archive="$1"
  target="$2"
  while IFS= read -r entry; do
    case "$entry" in /*|../*|*/../*|*/..) fail "unsafe path in archive: $entry" ;; esac
  done < <(tar -tzf "$archive")
  while IFS= read -r listing; do
    case "${listing:0:1}" in -|d) ;; *) fail "archive contains a link or special file" ;; esac
  done < <(tar -tvzf "$archive")
  tar -xzf "$archive" -C "$target" --no-same-owner --no-same-permissions
}
