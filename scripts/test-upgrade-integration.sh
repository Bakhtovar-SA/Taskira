#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
INSTALL_DIR="$TMP_DIR/install"
RELEASE_DIR="$TMP_DIR/release"
DOWNGRADE_DIR="$TMP_DIR/downgrade-release"
OLD_VERSION="1.0.0"
NEW_VERSION="1.1.0"
OLD_REF="d6c3966"
OLD_SOURCE_DIR="$TMP_DIR/old-source"

cleanup() {
  if [ -f "$INSTALL_DIR/docker-compose.yml" ] && [ -f "$INSTALL_DIR/.env" ]; then
    (cd "$INSTALL_DIR" && docker compose --env-file .env -f docker-compose.yml down -v) >/dev/null 2>&1 || true
  fi
  rm -rf -- "$TMP_DIR"
}
trap cleanup EXIT INT TERM

mkdir -p "$INSTALL_DIR" "$RELEASE_DIR/images" "$DOWNGRADE_DIR/images" "$OLD_SOURCE_DIR"
git -C "$ROOT_DIR" cat-file -e "$OLD_REF^{commit}"
git -C "$ROOT_DIR" archive "$OLD_REF" | tar -x -C "$OLD_SOURCE_DIR"
# The historical release predates the offline bundle's same-origin proxy and
# versioned health contract. Add that release wiring only; application code,
# static assets, dependencies, and migrations remain from OLD_REF.
grep -Fq 'send({ ok: db, db, ts:' "$OLD_SOURCE_DIR/server/src/app.ts"
sed -i "s/send({ ok: db, db, ts:/send({ ok: db, db, version: \"$OLD_VERSION\", ts:/" \
  "$OLD_SOURCE_DIR/server/src/app.ts"
cp "$ROOT_DIR/nginx.conf" "$OLD_SOURCE_DIR/nginx.conf"

docker build -t "localhost/taskira-server:$OLD_VERSION" "$OLD_SOURCE_DIR/server"
docker build --build-arg "TASKIRA_VERSION=$NEW_VERSION" -t "localhost/taskira-server:$NEW_VERSION" "$ROOT_DIR/server"
docker build --build-arg VITE_API_URL= -t "localhost/taskira-client:$OLD_VERSION" "$OLD_SOURCE_DIR"
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
printf '%s\n' '0.9.0' > "$DOWNGRADE_DIR/VERSION"
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
  docker compose --env-file .env -f docker-compose.yml exec -T postgres psql -v ON_ERROR_STOP=1 -U taskira -d taskira \
    < "$ROOT_DIR/fixtures/db-snapshots/schema-023-d6c3966.sql"
  docker compose --env-file .env -f docker-compose.yml up -d
)

before_upgrade="$(cd "$INSTALL_DIR" && docker compose --env-file .env -f docker-compose.yml exec -T postgres \
  psql -At -U taskira -d taskira -c 'SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1')"
[ "$before_upgrade" = "023_sprints.sql" ]
if "$DOWNGRADE_DIR/upgrade.sh" --install-dir "$INSTALL_DIR" --engine docker --dry-run > "$TMP_DIR/downgrade.log" 2>&1; then
  echo "upgrade.sh accepted a downgrade" >&2
  exit 1
fi
grep -Fq 'ERROR: refusing downgrade' "$TMP_DIR/downgrade.log"
dry_run_output="$("$RELEASE_DIR/upgrade.sh" --install-dir "$INSTALL_DIR" --engine docker --dry-run)"
printf '%s\n' "$dry_run_output"
printf '%s\n' "$dry_run_output" | grep -Fq '  - 024_favorite_projects.sql'
! printf '%s\n' "$dry_run_output" | grep -Fq 'Pending migrations: none'
"$RELEASE_DIR/upgrade.sh" --install-dir "$INSTALL_DIR" --engine docker
[ "$(cat "$INSTALL_DIR/VERSION")" = "$NEW_VERSION" ]

after_upgrade="$(cd "$INSTALL_DIR" && docker compose --env-file .env -f docker-compose.yml exec -T postgres \
  psql -At -U taskira -d taskira -c 'SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1')"
[ "$after_upgrade" != "$before_upgrade" ]

probe="$(cd "$INSTALL_DIR" && docker compose --env-file .env -f docker-compose.yml exec -T postgres \
  psql -At -U taskira -d taskira -c 'SELECT value FROM upgrade_snapshot_probe')"
[ "$probe" = "023_sprints.sql" ]

backup_dir="$(find "$INSTALL_DIR/backups" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
[ -n "$backup_dir" ]
"$RELEASE_DIR/upgrade.sh" --install-dir "$INSTALL_DIR" --engine docker --rollback "$backup_dir"
[ "$(cat "$INSTALL_DIR/VERSION")" = "$OLD_VERSION" ]
probe="$(cd "$INSTALL_DIR" && docker compose --env-file .env -f docker-compose.yml exec -T postgres \
  psql -At -U taskira -d taskira -c 'SELECT value FROM upgrade_snapshot_probe')"
[ "$probe" = "023_sprints.sql" ]
after_rollback="$(cd "$INSTALL_DIR" && docker compose --env-file .env -f docker-compose.yml exec -T postgres \
  psql -At -U taskira -d taskira -c 'SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1')"
[ "$after_rollback" = "$before_upgrade" ]

echo "offline upgrade and rollback integration passed"
