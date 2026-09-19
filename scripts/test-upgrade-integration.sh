#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
INSTALL_DIR="$TMP_DIR/install"
RELEASE_DIR="$TMP_DIR/release"
OLD_VERSION="1.0.0"
NEW_VERSION="1.1.0"

cleanup() {
  if [ -f "$INSTALL_DIR/docker-compose.yml" ] && [ -f "$INSTALL_DIR/.env" ]; then
    (cd "$INSTALL_DIR" && docker compose --env-file .env -f docker-compose.yml down -v) >/dev/null 2>&1 || true
  fi
  rm -rf -- "$TMP_DIR"
}
trap cleanup EXIT INT TERM

mkdir -p "$INSTALL_DIR" "$RELEASE_DIR/images"

docker build --build-arg "TASKIRA_VERSION=$OLD_VERSION" -t "localhost/taskira-server:$OLD_VERSION" "$ROOT_DIR/server"
docker build --build-arg "TASKIRA_VERSION=$NEW_VERSION" -t "localhost/taskira-server:$NEW_VERSION" "$ROOT_DIR/server"
docker build --build-arg VITE_API_URL= --build-arg "VITE_APP_VERSION=$NEW_VERSION" \
  -t "localhost/taskira-client:$NEW_VERSION" "$ROOT_DIR"
docker tag "localhost/taskira-client:$NEW_VERSION" "localhost/taskira-client:$OLD_VERSION"
docker pull postgres:16-alpine
docker tag postgres:16-alpine "localhost/taskira-postgres:$OLD_VERSION"
docker tag postgres:16-alpine "localhost/taskira-postgres:$NEW_VERSION"

"$ROOT_DIR/scripts/render-compose.sh" release "$OLD_VERSION" > "$INSTALL_DIR/docker-compose.yml"
printf '%s\n' "$OLD_VERSION" > "$INSTALL_DIR/VERSION"
printf 'localhost/taskira-client:%s\nlocalhost/taskira-server:%s\nlocalhost/taskira-postgres:%s\n' \
  "$OLD_VERSION" "$OLD_VERSION" "$OLD_VERSION" > "$INSTALL_DIR/IMAGES.txt"
find "$ROOT_DIR/server/migrations" -maxdepth 1 -type f -name '*.sql' -printf '%f\n' | LC_ALL=C sort > "$INSTALL_DIR/MIGRATIONS.txt"
cat > "$INSTALL_DIR/.env" <<'EOF'
POSTGRES_USER=taskira
POSTGRES_PASSWORD=taskira-upgrade
POSTGRES_DB=taskira
JWT_SECRET=upgrade-integration-secret-000000000000000
ADMIN_USERNAME=admin
ADMIN_PASSWORD=upgrade-admin-password
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

(
  cd "$INSTALL_DIR"
  docker compose --env-file .env -f docker-compose.yml up -d postgres
  until docker compose --env-file .env -f docker-compose.yml exec -T postgres pg_isready -U taskira -d taskira >/dev/null 2>&1; do sleep 1; done
  docker compose --env-file .env -f docker-compose.yml exec -T postgres psql -v ON_ERROR_STOP=1 -U taskira -d taskira \
    < "$ROOT_DIR/fixtures/db-snapshots/schema-023-d6c3966.sql"
  docker compose --env-file .env -f docker-compose.yml up -d
)

"$RELEASE_DIR/upgrade.sh" --install-dir "$INSTALL_DIR" --engine docker --dry-run
"$RELEASE_DIR/upgrade.sh" --install-dir "$INSTALL_DIR" --engine docker
[ "$(cat "$INSTALL_DIR/VERSION")" = "$NEW_VERSION" ]

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

echo "offline upgrade and rollback integration passed"
