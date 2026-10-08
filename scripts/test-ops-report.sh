#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/taskira-ops-report.XXXXXXXX")"
cleanup() {
  case "$TEST_DIR" in "${TMPDIR:-/tmp}"/taskira-ops-report.*) rm -rf -- "$TEST_DIR" ;; *) exit 1 ;; esac
}
trap cleanup EXIT
INSTALL_DIR="$TEST_DIR"
POSTGRES_USER=taskira
POSTGRES_DB=taskira
OPS_ARCHIVE="$TEST_DIR/archive with spaces.tar.gz"
printf 'SMTP_PASS=fixture-mail-secret\nADMIN_PASSWORD=RED\n' > "$INSTALL_DIR/.env"
printf '9.8.7-test\n' > "$INSTALL_DIR/VERSION"
. "$ROOT_DIR/scripts/operations-common.sh"
. "$ROOT_DIR/scripts/ops-report.sh"

actual="$(printf 'RED RED fixture-mail-secret Bearer abc123 whsec_sample taskira_session=sample\n' | redact_stream)"
[ "$actual" = '[REDACTED] [REDACTED] [REDACTED] Bearer [REDACTED] [REDACTED] taskira_session=[REDACTED]' ]

# The normal host path has no optional Compose arguments.
(
  . "$ROOT_DIR/scripts/release/container-engine.sh"
  compose_run() { printf '%s\n' "$@" > "$TEST_DIR/compose-arguments"; }
  compose version
)
[ "$(cat "$TEST_DIR/compose-arguments")" = $'--env-file\n.env\n-f\ndocker-compose.yml\nversion' ]

# Substitute only the transport. SQL is still passed on stdin, and caller
# values must remain psql variables, including quotes, newlines and secrets.
MODE=success
compose() {
  printf '%q\n' "$@" > "$TEST_DIR/arguments"
  cat > "$TEST_DIR/sql"
  case "$MODE" in
    missing) printf 'ops_runs_missing\n' ;;
    failure) return 1 ;;
    success) printf '01234567-89ab-cdef-0123-456789abcdef\n' ;;
  esac
}
STARTED_AT=1700000123
id="$(ops_run_start "backup'); DELETE FROM users; --" "$STARTED_AT")"
[ "$id" = 01234567-89ab-cdef-0123-456789abcdef ]
grep -Fq "VALUES (:'kind', :'host'" "$TEST_DIR/sql"
! grep -Fq 'DELETE FROM users' "$TEST_DIR/sql"
grep -Fq 'archive\ with\ spaces.tar.gz' "$TEST_DIR/arguments"
grep -Fq 'started_epoch=1700000123' "$TEST_DIR/arguments"
grep -Fq "to_timestamp(NULLIF(:'started_epoch', '')::double precision)" "$TEST_DIR/sql"
unset STARTED_AT

ops_run_finish "$id" failure '{"quote":"SQL '\'' and newline"}' $'fixture-mail-secret\nпроверка ошибки RED'
grep -Fq "NULLIF(left(:'error', 2000), '')" "$TEST_DIR/sql"
! grep -Fq 'fixture-mail-secret' "$TEST_DIR/arguments"
rm "$TEST_DIR/sql"
ops_run_finish '' success '{}' ''
[ ! -e "$TEST_DIR/sql" ]

MODE=missing
[ -z "$(ops_run_start backup 2> "$TEST_DIR/warning")" ]
grep -Fq 'ops_runs is missing' "$TEST_DIR/warning"
MODE=failure
[ -z "$(ops_run_start backup 2> "$TEST_DIR/warning")" ]
ops_run_finish "$id" success '{}' '' 2> "$TEST_DIR/warning"
grep -Fq 'could not be recorded' "$TEST_DIR/warning"
# Docker inspection fails inside a command substitution before the drill
# directory exists. Its diagnostic must still reach the redacted report.
mkdir "$TEST_DIR/bin"
printf 'services: {}\n' > "$INSTALL_DIR/docker-compose.yml"
touch "$TEST_DIR/archive.tar.gz"
cat > "$TEST_DIR/bin/docker" <<'SH'
#!/usr/bin/env bash
if [ "$1" = info ]; then
  [ "${2:-}" = --format ] || exit 0
  echo 'fixture DockerRootDir failure fixture-mail-secret' >&2
  exit 42
fi
printf '%q\n' "$@" >> "$OPS_REPORT_TEST_DIR/drill-arguments"
cat > "$OPS_REPORT_TEST_DIR/drill-sql"
printf '01234567-89ab-cdef-0123-456789abcdef\n'
SH
# These tools are checked but are not used by this failing path.
for tool in jq ip openssl; do printf '#!/usr/bin/env bash\nexit 0\n' > "$TEST_DIR/bin/$tool"; done
chmod +x "$TEST_DIR/bin/"*
if OPS_REPORT_TEST_DIR="$TEST_DIR" TMPDIR="$TEST_DIR" PATH="$TEST_DIR/bin:$PATH" \
  bash "$ROOT_DIR/scripts/restore-drill.sh" --install-dir "$INSTALL_DIR" --engine docker \
    --archive "$TEST_DIR/archive.tar.gz" > "$TEST_DIR/drill-output" 2>&1; then
  echo 'restore drill accepted a failed Docker inspection' >&2; exit 1
fi
grep -Fq 'fixture DockerRootDir failure' "$TEST_DIR/drill-arguments"
! grep -Fq 'fixture-mail-secret' "$TEST_DIR/drill-arguments"
grep -Fq 'REDACTED' "$TEST_DIR/drill-arguments"
[ -z "$(find "$TEST_DIR" -maxdepth 1 -name 'taskira-drill-error.*' -print)" ]

# Run the real backup orchestration with a simulated host, including a valid
# archive, to check that restart/health failures never follow a success report.
mkdir "$TEST_DIR/backup-scripts"
cp "$ROOT_DIR/scripts/backup.sh" "$TEST_DIR/backup-scripts/backup.sh"
cat > "$TEST_DIR/backup-scripts/operations-common.sh" <<'SH'
ops_init() { POSTGRES_USER=taskira; POSTGRES_DB=taskira; }
fail() { echo "ERROR: $*" >&2; exit 1; }
wait_for_database() { :; }
current_version() { echo 9.8.7-test; }
latest_schema() { echo fixture.sql; }
schema_migrations() { echo fixture.sql; }
verify_database_dump() { test -s "$1"; }
storage_command() { echo '{}' > "$2/objects.json"; }
write_public_env() { echo 'STORAGE_DRIVER=local' > "$2"; }
env_file_value() { echo local; }
compose() {
  case "$1:$2" in
    stop:*) : ;;
    up:-d)
      echo restart >> "$OPS_REPORT_TEST_DIR/events"
      [ "$BACKUP_TEST_MODE" != restart ] ;;
    exec:-T)
      case "$4" in
        psql) echo '{"projects":1,"issues":2}' ;;
        pg_dump) echo fixture-dump ;;
        *) return 2 ;;
      esac ;;
    *) return 2 ;;
  esac
}
ops_wait_for_application() {
  echo health >> "$OPS_REPORT_TEST_DIR/events"
  [ "$BACKUP_TEST_MODE" != health ]
}
SH
cat > "$TEST_DIR/backup-scripts/ops-report.sh" <<'SH'
ops_run_start() { echo fixture-id; }
ops_run_finish() { echo "finish:$2" >> "$OPS_REPORT_TEST_DIR/events"; }
SH
for mode in success restart health; do
  : > "$TEST_DIR/events"
  status=0
  OPS_REPORT_TEST_DIR="$TEST_DIR" BACKUP_TEST_MODE="$mode" \
    bash "$TEST_DIR/backup-scripts/backup.sh" --install-dir "$INSTALL_DIR" \
      --output "$TEST_DIR/backup-$mode.tar.gz" > "$TEST_DIR/backup-output" 2>&1 || status=$?
  mkdir "$TEST_DIR/verify-$mode"
  tar -xzf "$TEST_DIR/backup-$mode.tar.gz" -C "$TEST_DIR/verify-$mode"
  (cd "$TEST_DIR/verify-$mode" && sha256sum --check --strict SHA256SUMS >/dev/null)
  [ "$(grep -c '^finish:' "$TEST_DIR/events")" = 1 ]
  if [ "$mode" = success ]; then
    [ "$status" = 0 ]
    [ "$(cat "$TEST_DIR/events")" = $'restart\nhealth\nfinish:success' ]
  else
    [ "$status" != 0 ]
    grep -Fxq 'finish:failure' "$TEST_DIR/events"
    ! grep -Fxq 'finish:success' "$TEST_DIR/events"
    # Recovery must precede reporting, which can wait on an unavailable DB.
    [ "$(tail -n 2 "$TEST_DIR/events")" = $'restart\nfinish:failure' ]
  fi
done

status=0
bash "$ROOT_DIR/scripts/restore.sh" --storage-driver > "$TEST_DIR/restore-output" 2>&1 || status=$?
[ "$status" = 2 ]
grep -Fq 'Usage:' "$TEST_DIR/restore-output"
! grep -Fq 'unbound variable' "$TEST_DIR/restore-output"

# Exercise the drill's environment boundary without starting containers.
# Compose may reference host variables; clearing application credentials must
# not erase the PATH needed to invoke the engine or the host HOME.
(
  DRILL_DIR="$TEST_DIR/drill-env"
  mkdir "$DRILL_DIR"
  printf 'POSTGRES_PASSWORD=fresh-drill-secret\n' > "$DRILL_DIR/.env"
  printf 'environment: [${PATH}, ${HOME}, ${POSTGRES_PASSWORD}, ${SMTP_HOST}]\n' > "$INSTALL_DIR/docker-compose.yml"
  export POSTGRES_PASSWORD=working-secret SMTP_HOST=working-mail
  expected_path="$PATH"; expected_home="$HOME"
  ops_init() { INSTALL_DIR="$1"; }
  compose() {
    [ "$PATH" = "$expected_path" ] && [ "$HOME" = "$expected_home" ]
    [ -z "${POSTGRES_PASSWORD+x}" ] && [ -z "${SMTP_HOST+x}" ]
    [ "$TASKIRA_COMPOSE_OVERRIDE" = drill.override.yml ]
  }
  # Load the production function only; the script's top-level code runs hosts.
  eval "$(sed -n '/^drill_compose() (/ , /^)$/p' "$ROOT_DIR/scripts/restore-drill.sh")"
  drill_compose config
  [ "$POSTGRES_PASSWORD" = working-secret ] && [ "$SMTP_HOST" = working-mail ]
)

echo 'host operation reporting and redaction checks passed'
