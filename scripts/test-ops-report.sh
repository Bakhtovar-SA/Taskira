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
id="$(ops_run_start "backup'); DELETE FROM users; --")"
[ "$id" = 01234567-89ab-cdef-0123-456789abcdef ]
grep -Fq "VALUES (:'kind', :'host'" "$TEST_DIR/sql"
! grep -Fq 'DELETE FROM users' "$TEST_DIR/sql"
grep -Fq 'archive\ with\ spaces.tar.gz' "$TEST_DIR/arguments"

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
echo 'host operation reporting and redaction checks passed'
