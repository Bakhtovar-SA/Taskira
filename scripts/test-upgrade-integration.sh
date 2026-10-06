#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
INSTALL_DIR="$TMP_DIR/install"
RELEASE_DIR="$TMP_DIR/release"
DOWNGRADE_DIR="$TMP_DIR/downgrade-release"
OLD_SOURCE_DIR="$TMP_DIR/old-source"

# OPS-UPG-01: the "N-1" side of the upgrade is the latest published release tag,
# not a pinned commit. Overrides (all optional):
#   OLD_REF          any git ref/commit to upgrade FROM (skips tag lookup)
#   OLD_VERSION      SemVer to install the old side as (default: derived from ref)
#   NEW_VERSION      SemVer of the candidate build (default: next minor after OLD)
#   UPGRADE_SNAPSHOT path to a fixtures/db-snapshots/*.sql to load into the old install
LEGACY_REF="d6c3966"
LEGACY_SNAPSHOT="$ROOT_DIR/fixtures/db-snapshots/schema-023-d6c3966.sql"
SEMVER_RELEASE_RE='^v?([0-9]+)\.([0-9]+)\.([0-9]+)$'

# Latest plain-SemVer release tag, skipping a tag that points at HEAD itself
# (when HEAD is the release being built, N-1 is the release before it).
latest_release_tag() {
  head_sha="$(git -C "$ROOT_DIR" rev-parse HEAD)"
  git -C "$ROOT_DIR" tag --list --sort=-v:refname | while IFS= read -r tag; do
    [[ "$tag" =~ $SEMVER_RELEASE_RE ]] || continue
    [ "$(git -C "$ROOT_DIR" rev-list -n 1 "$tag")" = "$head_sha" ] && continue
    printf '%s\n' "$tag"
    break
  done
}

OLD_SNAPSHOT="${UPGRADE_SNAPSHOT:-}"
if [ -z "${OLD_REF:-}" ]; then
  OLD_REF="$(latest_release_tag)"
  if [ -z "$OLD_REF" ]; then
    # No release has been published yet. Keep the historical behaviour so CI
    # still exercises a real upgrade, and say loudly that this is a stand-in.
    echo "WARNING: no release tag (vX.Y.Z) found; falling back to legacy commit $LEGACY_REF with its DB snapshot." >&2
    echo "         After the first release is tagged this fallback is never used. If CI shows this, the checkout" >&2
    echo "         lacks tags (needs fetch-depth: 0) or nothing has been tagged. Override with OLD_REF=<ref>." >&2
    OLD_REF="$LEGACY_REF"
    OLD_SNAPSHOT="${OLD_SNAPSHOT:-$LEGACY_SNAPSHOT}"
  fi
fi
git -C "$ROOT_DIR" cat-file -e "$OLD_REF^{commit}" || {
  echo "ERROR: OLD_REF '$OLD_REF' is not a commit in this checkout (missing tags? use fetch-depth: 0)" >&2
  exit 1
}
if [ "$OLD_REF" = "$LEGACY_REF" ] && [ -z "$OLD_SNAPSHOT" ]; then
  OLD_SNAPSHOT="$LEGACY_SNAPSHOT"
fi

if [ -z "${OLD_VERSION:-}" ]; then
  if [[ "$OLD_REF" =~ $SEMVER_RELEASE_RE ]]; then
    OLD_VERSION="${OLD_REF#v}"
  else
    OLD_VERSION="0.0.1" # arbitrary ref: any valid SemVer lower than NEW_VERSION
  fi
fi
if [ -z "${NEW_VERSION:-}" ]; then
  if [[ "$OLD_VERSION" =~ $SEMVER_RELEASE_RE ]]; then
    NEW_VERSION="${BASH_REMATCH[1]}.$((BASH_REMATCH[2] + 1)).0"
  else
    NEW_VERSION="0.1.0"
  fi
fi
echo "Upgrade integration: $OLD_VERSION (from $OLD_REF) -> $NEW_VERSION (candidate HEAD)"

cleanup() {
  if [ -f "$INSTALL_DIR/docker-compose.yml" ] && [ -f "$INSTALL_DIR/.env" ]; then
    (cd "$INSTALL_DIR" && docker compose --env-file .env -f docker-compose.yml down -v) >/dev/null 2>&1 || true
  fi
  rm -rf -- "$TMP_DIR"
}
trap cleanup EXIT INT TERM

mkdir -p "$INSTALL_DIR" "$RELEASE_DIR/images" "$DOWNGRADE_DIR/images" "$OLD_SOURCE_DIR"
git -C "$ROOT_DIR" archive "$OLD_REF" | tar -x -C "$OLD_SOURCE_DIR"
# A ref that predates the offline bundle's versioned health contract gets that
# release wiring only (application code, assets, dependencies and migrations
# remain from OLD_REF). Refs that already report cfg.version are left untouched.
if ! grep -Fq 'version: cfg.version' "$OLD_SOURCE_DIR/server/src/app.ts"; then
  grep -Fq 'send({ ok: db, db, ts:' "$OLD_SOURCE_DIR/server/src/app.ts"
  sed -i "s/send({ ok: db, db, ts:/send({ ok: db, db, version: \"$OLD_VERSION\", ts:/" \
    "$OLD_SOURCE_DIR/server/src/app.ts"
fi
cp "$ROOT_DIR/nginx.conf" "$OLD_SOURCE_DIR/nginx.conf"

docker build --build-arg "TASKIRA_VERSION=$OLD_VERSION" -t "localhost/taskira-server:$OLD_VERSION" "$OLD_SOURCE_DIR/server"
docker build --build-arg "TASKIRA_VERSION=$NEW_VERSION" -t "localhost/taskira-server:$NEW_VERSION" "$ROOT_DIR/server"
docker build --build-arg VITE_API_URL= --build-arg "VITE_APP_VERSION=$OLD_VERSION" \
  -t "localhost/taskira-client:$OLD_VERSION" "$OLD_SOURCE_DIR"
docker build --build-arg VITE_API_URL= --build-arg "VITE_APP_VERSION=$NEW_VERSION" \
  -t "localhost/taskira-client:$NEW_VERSION" "$ROOT_DIR"
docker pull postgres:16-alpine
docker tag postgres:16-alpine "localhost/taskira-postgres:$OLD_VERSION"
docker tag postgres:16-alpine "localhost/taskira-postgres:$NEW_VERSION"

"$ROOT_DIR/scripts/render-compose.sh" release "$OLD_VERSION" > "$INSTALL_DIR/docker-compose.yml"
printf '%s\n' "$OLD_VERSION" > "$INSTALL_DIR/VERSION"
printf 'localhost/taskira-client:%s\nlocalhost/taskira-server:%s\nlocalhost/taskira-postgres:%s\n' \
  "$OLD_VERSION" "$OLD_VERSION" "$OLD_VERSION" > "$INSTALL_DIR/IMAGES.txt"
find "$OLD_SOURCE_DIR/server/migrations" -maxdepth 1 -type f -name '*.sql' -printf '%f\n' | LC_ALL=C sort > "$INSTALL_DIR/MIGRATIONS.txt"
OLD_LAST_MIGRATION="$(tail -n 1 "$INSTALL_DIR/MIGRATIONS.txt")"
cat > "$INSTALL_DIR/.env" <<'EOF'
POSTGRES_USER=taskira
POSTGRES_PASSWORD=taskira-upgrade
POSTGRES_DB=taskira
JWT_SECRET=upgrade-integration-secret-000000000000000
ADMIN_USERNAME=admin
ADMIN_PASSWORD=Upgrade-Install-42!Secure
ADMIN_NAME=Upgrade Admin
CORS_ORIGIN=http://127.0.0.1:18081
CLIENT_PORT=18081
SESSION_COOKIE_SECURE=false
EOF

"$ROOT_DIR/scripts/render-compose.sh" release "$NEW_VERSION" > "$RELEASE_DIR/docker-compose.yml"
printf '%s\n' "$NEW_VERSION" > "$RELEASE_DIR/VERSION"
printf 'localhost/taskira-client:%s\nlocalhost/taskira-server:%s\nlocalhost/taskira-postgres:%s\n' \
  "$NEW_VERSION" "$NEW_VERSION" "$NEW_VERSION" > "$RELEASE_DIR/IMAGES.txt"
find "$ROOT_DIR/server/migrations" -maxdepth 1 -type f -name '*.sql' -printf '%f\n' | LC_ALL=C sort > "$RELEASE_DIR/MIGRATIONS.txt"
# First migration the candidate has and the old release lacks (empty = none pending).
FIRST_PENDING_MIGRATION="$(LC_ALL=C comm -13 "$INSTALL_DIR/MIGRATIONS.txt" "$RELEASE_DIR/MIGRATIONS.txt" | head -n 1)"
cp "$ROOT_DIR/scripts/upgrade.sh" "$RELEASE_DIR/upgrade.sh"
cp "$ROOT_DIR/scripts/release/container-engine.sh" "$RELEASE_DIR/container-engine.sh"
chmod +x "$RELEASE_DIR/upgrade.sh"
docker save --output "$RELEASE_DIR/images/client.tar" "localhost/taskira-client:$NEW_VERSION"
docker save --output "$RELEASE_DIR/images/server.tar" "localhost/taskira-server:$NEW_VERSION"
docker save --output "$RELEASE_DIR/images/postgres.tar" "localhost/taskira-postgres:$NEW_VERSION"
(
  cd "$RELEASE_DIR"
  find . -type f ! -name SHA256SUMS -print0 | LC_ALL=C sort -z | xargs -0 sha256sum > SHA256SUMS
)

cp "$ROOT_DIR/scripts/upgrade.sh" "$DOWNGRADE_DIR/upgrade.sh"
cp "$ROOT_DIR/scripts/release/container-engine.sh" "$DOWNGRADE_DIR/container-engine.sh"
cp "$RELEASE_DIR/docker-compose.yml" "$DOWNGRADE_DIR/docker-compose.yml"
cp "$RELEASE_DIR/MIGRATIONS.txt" "$DOWNGRADE_DIR/MIGRATIONS.txt"
: > "$DOWNGRADE_DIR/IMAGES.txt"
printf '%s\n' '0.0.0' > "$DOWNGRADE_DIR/VERSION"
(
  cd "$DOWNGRADE_DIR"
  find . -type f ! -name SHA256SUMS -print0 | LC_ALL=C sort -z | xargs -0 sha256sum > SHA256SUMS
)

(
  cd "$INSTALL_DIR"
  docker compose --env-file .env -f docker-compose.yml up -d postgres
  # The official Postgres entrypoint briefly accepts connections on a temporary
  # server and then restarts it. Require several consecutive SQL probes so the
  # snapshot is not piped into that shutdown window.
  stable_probes=0
  while [ "$stable_probes" -lt 3 ]; do
    if docker compose --env-file .env -f docker-compose.yml exec -T postgres \
      psql -At -U taskira -d taskira -c 'SELECT 1' >/dev/null 2>&1; then
      stable_probes=$((stable_probes + 1))
    else
      stable_probes=0
    fi
    sleep 1
  done
  if [ -n "$OLD_SNAPSHOT" ]; then
    docker compose --env-file .env -f docker-compose.yml exec -T postgres psql -v ON_ERROR_STOP=1 -U taskira -d taskira \
      < "$OLD_SNAPSHOT"
  fi
  docker compose --env-file .env -f docker-compose.yml up -d
  # Wait until the old release has applied all of its own migrations.
  applied=""
  for _ in $(seq 1 120); do
    applied="$(docker compose --env-file .env -f docker-compose.yml exec -T postgres \
      psql -At -U taskira -d taskira -c 'SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1' 2>/dev/null || true)"
    [ "$applied" = "$OLD_LAST_MIGRATION" ] && break
    sleep 2
  done
  [ "$applied" = "$OLD_LAST_MIGRATION" ] || { echo "old release $OLD_VERSION did not reach $OLD_LAST_MIGRATION" >&2; exit 1; }
  if [ -z "$OLD_SNAPSHOT" ]; then
    # A clean old install has no snapshot probe row; plant one to prove data survives the upgrade.
    docker compose --env-file .env -f docker-compose.yml exec -T postgres psql -v ON_ERROR_STOP=1 -U taskira -d taskira \
      -c "CREATE TABLE upgrade_snapshot_probe (value text NOT NULL); INSERT INTO upgrade_snapshot_probe VALUES ('$OLD_LAST_MIGRATION')"
  fi
)

before_upgrade="$(cd "$INSTALL_DIR" && docker compose --env-file .env -f docker-compose.yml exec -T postgres \
  psql -At -U taskira -d taskira -c 'SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1')"
[ "$before_upgrade" = "$OLD_LAST_MIGRATION" ]
if "$DOWNGRADE_DIR/upgrade.sh" --install-dir "$INSTALL_DIR" --engine docker --dry-run > "$TMP_DIR/downgrade.log" 2>&1; then
  echo "upgrade.sh accepted a downgrade" >&2
  exit 1
fi
grep -Fq 'ERROR: refusing downgrade' "$TMP_DIR/downgrade.log"
dry_run_output="$("$RELEASE_DIR/upgrade.sh" --install-dir "$INSTALL_DIR" --engine docker --dry-run)"
printf '%s\n' "$dry_run_output"
if [ -n "$FIRST_PENDING_MIGRATION" ]; then
  printf '%s\n' "$dry_run_output" | grep -Fq "  - $FIRST_PENDING_MIGRATION"
  ! printf '%s\n' "$dry_run_output" | grep -Fq 'Pending migrations: none'
else
  printf '%s\n' "$dry_run_output" | grep -Fq 'Pending migrations: none'
fi
"$RELEASE_DIR/upgrade.sh" --install-dir "$INSTALL_DIR" --engine docker
[ "$(cat "$INSTALL_DIR/VERSION")" = "$NEW_VERSION" ]

after_upgrade="$(cd "$INSTALL_DIR" && docker compose --env-file .env -f docker-compose.yml exec -T postgres \
  psql -At -U taskira -d taskira -c 'SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1')"
if [ -n "$FIRST_PENDING_MIGRATION" ]; then
  [ "$after_upgrade" != "$before_upgrade" ]
fi

probe="$(cd "$INSTALL_DIR" && docker compose --env-file .env -f docker-compose.yml exec -T postgres \
  psql -At -U taskira -d taskira -c 'SELECT value FROM upgrade_snapshot_probe')"
[ "$probe" = "$OLD_LAST_MIGRATION" ]

backup_dir="$(find "$INSTALL_DIR/backups" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
[ -n "$backup_dir" ]
"$RELEASE_DIR/upgrade.sh" --install-dir "$INSTALL_DIR" --engine docker --rollback "$backup_dir"
[ "$(cat "$INSTALL_DIR/VERSION")" = "$OLD_VERSION" ]
probe="$(cd "$INSTALL_DIR" && docker compose --env-file .env -f docker-compose.yml exec -T postgres \
  psql -At -U taskira -d taskira -c 'SELECT value FROM upgrade_snapshot_probe')"
[ "$probe" = "$OLD_LAST_MIGRATION" ]
after_rollback="$(cd "$INSTALL_DIR" && docker compose --env-file .env -f docker-compose.yml exec -T postgres \
  psql -At -U taskira -d taskira -c 'SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1')"
[ "$after_rollback" = "$before_upgrade" ]

echo "offline upgrade and rollback integration passed"
