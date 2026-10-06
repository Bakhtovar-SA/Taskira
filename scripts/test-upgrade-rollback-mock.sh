#!/usr/bin/env bash
# OPS-UPG-02: upgrade.sh rolls back automatically when the migration fails or the
# post-start health check fails, and does not when the upgrade succeeds or when
# nothing was changed yet. Runs against a fake `docker`/`curl`/`sleep`, so it
# needs neither a container engine nor a database; the real-engine scenarios are
# in test-upgrade-integration.sh.
set -Eeuo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf -- "$TMP_DIR"' EXIT INT TERM
mkdir -p "$TMP_DIR/bin"

cat > "$TMP_DIR/bin/sleep" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

# Fake curl: /api/health answers with the installed VERSION while the stack is up,
# unless FAKE_HEALTH_BROKEN_VERSION names the version that never becomes healthy.
cat > "$TMP_DIR/bin/curl" <<'EOF'
#!/usr/bin/env bash
[ -f "$FAKE_STATE/up" ] || exit 7
version="$(tr -d '\r\n' < "$FAKE_INSTALL/VERSION")"
[ "$version" != "${FAKE_HEALTH_BROKEN_VERSION:-}" ] || exit 22
printf '{"ok":true,"version":"%s"}' "$version"
EOF

cat > "$TMP_DIR/bin/docker" <<'EOF'
#!/usr/bin/env bash
set -u
printf '%s\n' "$*" >> "$FAKE_STATE/calls.log"
case "${1:-}" in
  info) [ "${2:-}" = "--format" ] && printf '%s\n' "$FAKE_STATE"; exit 0 ;;
  load|image) exit 0 ;;
  compose) ;;
  *) echo "unexpected fake docker command: $*" >&2; exit 2 ;;
esac
shift
while [ "${1:-}" != "" ] && [ "${1:-}" != "up" ] && [ "${1:-}" != "down" ] && [ "${1:-}" != "exec" ] && [ "${1:-}" != "run" ]; do shift; done
action="${1:-}"; shift || true
all="$*"
case "$action" in
  down) rm -f "$FAKE_STATE/up" ;;
  up) case "$all" in *postgres*) ;; *) : > "$FAKE_STATE/up" ;; esac ;;
  run)
    if [ "${FAKE_BREAK_MIGRATION:-0}" = "1" ] && [ "$(tr -d '\r\n' < "$FAKE_INSTALL/VERSION")" != "1.0.0" ]; then
      echo "migration 99999999T9999_broken.sql failed: syntax error" >&2
      exit 1
    fi
    echo migrated >> "$FAKE_STATE/db-events.log" ;;
  exec)
    case "$all" in
      *schema_migrations*) printf '001_a.sql\n002_b.sql\n' ;;
      *pg_database_size*) echo 4096 ;;
      *"FROM pg_database"*) echo 1 ;;
      *"count(*) FROM pg_stat_activity"*) echo 0 ;;
      *pg_dump*) printf 'fake-dump' ;;
      *pg_restore*)
        cat > /dev/null
        echo "pg_restore $all" >> "$FAKE_STATE/db-events.log"
        n="$(grep -c '^pg_restore' "$FAKE_STATE/db-events.log")"
        [ "$n" != "${FAKE_FAIL_RESTORE_AT:-0}" ] || { echo "pg_restore: simulated failure" >&2; exit 1; } ;;
    esac ;;
esac
exit 0
EOF
chmod +x "$TMP_DIR/bin/"*

# $1 = scenario name; remaining env vars (FAKE_*) steer the fakes.
run_scenario() {
  name="$1"
  export FAKE_STATE="$TMP_DIR/$name/state" FAKE_INSTALL="$TMP_DIR/$name/install"
  release="$TMP_DIR/$name/release"
  mkdir -p "$FAKE_STATE" "$FAKE_INSTALL" "$release/images"
  : > "$FAKE_STATE/up"
  : > "$FAKE_STATE/db-events.log"
  printf 'POSTGRES_USER=taskira\nPOSTGRES_DB=taskira\nCLIENT_PORT=18081\n' > "$FAKE_INSTALL/.env"
  printf 'services: {}\n' > "$FAKE_INSTALL/docker-compose.yml"
  printf '1.0.0\n' > "$FAKE_INSTALL/VERSION"
  printf 'img:1.0.0\n' > "$FAKE_INSTALL/IMAGES.txt"
  printf '001_a.sql\n002_b.sql\n' > "$FAKE_INSTALL/MIGRATIONS.txt"
  cp "$ROOT_DIR/scripts/upgrade.sh" "$ROOT_DIR/scripts/release/container-engine.sh" "$release/"
  printf '1.1.0\n' > "$release/VERSION"
  printf 'img:1.1.0\n' > "$release/IMAGES.txt"
  printf '001_a.sql\n002_b.sql\n003_c.sql\n' > "$release/MIGRATIONS.txt"
  printf 'services: {}\n' > "$release/docker-compose.yml"
  printf 'tar' > "$release/images/server.tar"
  (cd "$release" && find . -type f ! -name SHA256SUMS -print0 | LC_ALL=C sort -z | xargs -0 sha256sum > SHA256SUMS)
  chmod +x "$release/upgrade.sh"
  set +e
  PATH="$TMP_DIR/bin:$PATH" "$release/upgrade.sh" --install-dir "$FAKE_INSTALL" --engine docker "${@:2}" \
    > "$TMP_DIR/$name/out.log" 2>&1
  EXIT_CODE=$?
  set -e
  OUT="$TMP_DIR/$name/out.log"
}

expect() { # expect <description> <command...>
  desc="$1"; shift
  if ! "$@"; then echo "FAILED: $desc" >&2; echo "--- output ---" >&2; cat "$OUT" >&2; exit 1; fi
}
expect_not() {
  desc="$1"; shift
  if "$@"; then echo "FAILED: $desc" >&2; echo "--- output ---" >&2; cat "$OUT" >&2; exit 1; fi
}
restores() { grep -c '^pg_restore' "$FAKE_STATE/db-events.log" || true; }

# (a) broken migration -> automatic rollback; the upgrade command still exits non-zero.
FAKE_BREAK_MIGRATION=1 run_scenario broken-migration
expect "broken migration: upgrade exits non-zero" [ "$EXIT_CODE" -ne 0 ]
expect "broken migration: names the failing stage" grep -Fq 'upgrade failed during: applying database migrations' "$OUT"
expect "broken migration: rollback started automatically" grep -Fq 'Starting automatic rollback' "$OUT"
expect "broken migration: rollback reported complete" grep -Fq 'Automatic rollback complete' "$OUT"
expect "broken migration: old VERSION restored" [ "$(tr -d '\r\n' < "$FAKE_INSTALL/VERSION")" = "1.0.0" ]
expect "broken migration: old compose metadata restored" grep -Fq 'img:1.0.0' "$FAKE_INSTALL/IMAGES.txt"
expect "broken migration: database restored from the dump (after the test restore)" [ "$(restores)" -eq 2 ]
expect "broken migration: previous version is up again" [ -f "$FAKE_STATE/up" ]

# (b) health check fails after start -> automatic rollback.
FAKE_HEALTH_BROKEN_VERSION=1.1.0 run_scenario unhealthy
expect "unhealthy: upgrade exits non-zero" [ "$EXIT_CODE" -ne 0 ]
expect "unhealthy: names the failing stage" grep -Fq 'upgrade failed during: health-checking Taskira 1.1.0' "$OUT"
expect "unhealthy: rollback started automatically" grep -Fq 'Starting automatic rollback' "$OUT"
expect "unhealthy: rollback reported complete" grep -Fq 'Automatic rollback complete' "$OUT"
expect "unhealthy: old VERSION restored" [ "$(tr -d '\r\n' < "$FAKE_INSTALL/VERSION")" = "1.0.0" ]
expect "unhealthy: migrations had been applied before rollback" grep -q '^migrated' "$FAKE_STATE/db-events.log"
expect "unhealthy: database restored from the dump" [ "$(restores)" -eq 2 ]
expect "unhealthy: previous version is up again" [ -f "$FAKE_STATE/up" ]

# (c) --no-auto-rollback: stack stays down, the manual command is printed instead.
FAKE_BREAK_MIGRATION=1 run_scenario no-auto --no-auto-rollback
expect "no-auto: exits non-zero" [ "$EXIT_CODE" -ne 0 ]
expect_not "no-auto: no automatic rollback" grep -Fq 'Starting automatic rollback' "$OUT"
expect "no-auto: manual command printed" grep -Fq -- '--rollback' "$OUT"
expect "no-auto: database was not restored" [ "$(restores)" -eq 1 ]

# (d) the automatic rollback itself fails (2nd pg_restore = the real restore) -> exit
# non-zero, the failure is stated and the exact manual command is printed.
FAKE_BREAK_MIGRATION=1 FAKE_FAIL_RESTORE_AT=2 run_scenario rollback-fails
expect "rollback-fails: exits non-zero" [ "$EXIT_CODE" -ne 0 ]
expect "rollback-fails: says the automatic rollback failed" grep -Fq 'automatic rollback failed' "$OUT"
expect "rollback-fails: prints the manual command" grep -Fq -- '--rollback' "$OUT"
expect_not "rollback-fails: does not claim success" grep -Fq 'Automatic rollback complete' "$OUT"

# (e) success: no rollback at all.
run_scenario success
expect "success: exits zero" [ "$EXIT_CODE" -eq 0 ]
expect_not "success: no rollback" grep -Fq 'automatic rollback' "$OUT"
expect "success: VERSION is the new one" [ "$(tr -d '\r\n' < "$FAKE_INSTALL/VERSION")" = "1.1.0" ]

# (f) failure before any change (downgrade refused): nothing to roll back.
run_scenario refuse-downgrade
printf '2.0.0\n' > "$FAKE_INSTALL/VERSION"
set +e
PATH="$TMP_DIR/bin:$PATH" "$TMP_DIR/refuse-downgrade/release/upgrade.sh" --install-dir "$FAKE_INSTALL" --engine docker \
  > "$OUT" 2>&1
EXIT_CODE=$?
set -e
expect "downgrade: refused" [ "$EXIT_CODE" -ne 0 ]
expect_not "downgrade: no rollback attempted" grep -Fq 'automatic rollback' "$OUT"
expect "downgrade: version untouched" [ "$(tr -d '\r\n' < "$FAKE_INSTALL/VERSION")" = "2.0.0" ]

echo "upgrade automatic-rollback mock checks passed"
