#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
INSTALL_DIR="$TMP_DIR/install"
VERSION="2.0.0"
BACKUP_ARCHIVE="$TMP_DIR/taskira-backup.tar.gz"
SUPPORT_ARCHIVE="$TMP_DIR/taskira-support.tar.gz"
BASE_URL="http://127.0.0.1:18082"
COOKIE="$TMP_DIR/cookie.txt"
ISSUE_TITLE="restore-rehearsal-issue-20260919"
ATTACHMENT_CONTENT="restore-rehearsal-attachment-20260919"

cleanup() {
  if [ -f "$INSTALL_DIR/docker-compose.yml" ] && [ -f "$INSTALL_DIR/.env" ]; then
    (cd "$INSTALL_DIR" && docker compose --env-file .env -f docker-compose.yml down -v) >/dev/null 2>&1 || true
  fi
  rm -rf -- "$TMP_DIR"
}
trap cleanup EXIT INT TERM

mkdir -p "$INSTALL_DIR"
docker build --build-arg "TASKIRA_VERSION=$VERSION" -t "localhost/taskira-server:$VERSION" "$ROOT_DIR/server"
docker build --build-arg VITE_API_URL= --build-arg "VITE_APP_VERSION=$VERSION" \
  -t "localhost/taskira-client:$VERSION" "$ROOT_DIR"
docker pull postgres:16-alpine
docker tag postgres:16-alpine "localhost/taskira-postgres:$VERSION"

"$ROOT_DIR/scripts/render-compose.sh" release "$VERSION" > "$INSTALL_DIR/docker-compose.yml"
printf '%s\n' "$VERSION" > "$INSTALL_DIR/VERSION"
printf 'localhost/taskira-client:%s\nlocalhost/taskira-server:%s\nlocalhost/taskira-postgres:%s\n' \
  "$VERSION" "$VERSION" "$VERSION" > "$INSTALL_DIR/IMAGES.txt"
find "$ROOT_DIR/server/migrations" -maxdepth 1 -type f -name '*.sql' -printf '%f\n' | LC_ALL=C sort > "$INSTALL_DIR/MIGRATIONS.txt"
for file in backup.sh restore.sh support-bundle.sh operations-common.sh; do
  cp "$ROOT_DIR/scripts/$file" "$INSTALL_DIR/$file"
done
cp "$ROOT_DIR/scripts/release/container-engine.sh" "$INSTALL_DIR/container-engine.sh"
chmod +x "$INSTALL_DIR"/*.sh
cat > "$INSTALL_DIR/.env" <<'EOF'
POSTGRES_USER=taskira
POSTGRES_PASSWORD=backup-restore-db-secret
POSTGRES_DB=taskira
JWT_SECRET=backup-restore-jwt-secret-000000000000000000000
ADMIN_USERNAME=admin
ADMIN_PASSWORD=backup-restore-admin-secret
ADMIN_NAME=Backup Admin
CORS_ORIGIN=http://127.0.0.1:18082
CLIENT_PORT=18082
SESSION_COOKIE_SECURE=false
STORAGE_DRIVER=local
EOF

(cd "$INSTALL_DIR" && docker compose --env-file .env -f docker-compose.yml up -d)
for _ in $(seq 1 60); do
  curl --fail --silent "$BASE_URL/api/health" >/dev/null 2>&1 && break
  sleep 2
done
curl --fail --silent --show-error "$BASE_URL/api/health" >/dev/null
curl --fail --silent --show-error -c "$COOKIE" -H 'content-type: application/json' \
  -d '{"username":"admin","password":"backup-restore-admin-secret"}' \
  "$BASE_URL/api/auth/login" >/dev/null
project_id="$(curl --fail --silent --show-error -b "$COOKIE" "$BASE_URL/api/projects" | jq -r '.[0].id')"
[ -n "$project_id" ] && [ "$project_id" != null ]
issue_json="$(curl --fail --silent --show-error -b "$COOKIE" -H 'content-type: application/json' \
  -d "{\"title\":\"$ISSUE_TITLE\",\"description\":\"backup restore probe\",\"typeId\":\"task\",\"priorityId\":\"medium\",\"assigneeIds\":[],\"epicId\":null,\"labels\":[],\"complexity\":null,\"checklistItems\":[]}" \
  "$BASE_URL/api/projects/$project_id/issues")"
issue_id="$(printf '%s' "$issue_json" | jq -r '.id')"
[ -n "$issue_id" ] && [ "$issue_id" != null ]
printf '%s' "$ATTACHMENT_CONTENT" > "$TMP_DIR/probe.txt"
attachment_json="$(curl --fail --silent --show-error -b "$COOKIE" \
  -F "file=@$TMP_DIR/probe.txt;type=text/plain" \
  "$BASE_URL/api/projects/$project_id/issues/$issue_id/attachments")"
attachment_id="$(printf '%s' "$attachment_json" | jq -r '.id')"
[ -n "$attachment_id" ] && [ "$attachment_id" != null ]

"$INSTALL_DIR/backup.sh" --install-dir "$INSTALL_DIR" --engine docker --output "$BACKUP_ARCHIVE"
"$INSTALL_DIR/support-bundle.sh" --install-dir "$INSTALL_DIR" --engine docker --lines 100 --output "$SUPPORT_ARCHIVE"
mkdir "$TMP_DIR/support"
tar -xzf "$SUPPORT_ARCHIVE" -C "$TMP_DIR/support"
grep -Fq $'public.issues\t1' "$TMP_DIR/support/table-row-counts.tsv"
! grep -R -Fq 'backup-restore-admin-secret' "$TMP_DIR/support"
! grep -R -Fq 'backup-restore-jwt-secret' "$TMP_DIR/support"
! grep -R -Fq "$ISSUE_TITLE" "$TMP_DIR/support"
! grep -R -Fq "$ATTACHMENT_CONTENT" "$TMP_DIR/support"

# Disaster rehearsal: remove both persistent volumes, not merely containers.
(cd "$INSTALL_DIR" && docker compose --env-file .env -f docker-compose.yml down -v)
"$INSTALL_DIR/restore.sh" --install-dir "$INSTALL_DIR" --engine docker --archive "$BACKUP_ARCHIVE" --yes

rm -f "$COOKIE"
curl --fail --silent --show-error -c "$COOKIE" -H 'content-type: application/json' \
  -d '{"username":"admin","password":"backup-restore-admin-secret"}' \
  "$BASE_URL/api/auth/login" >/dev/null
restored_issue="$(curl --fail --silent --show-error -b "$COOKIE" \
  "$BASE_URL/api/projects/$project_id/issues/$issue_id")"
[ "$(printf '%s' "$restored_issue" | jq -r '.title')" = "$ISSUE_TITLE" ]
curl --fail --silent --show-error -b "$COOKIE" \
  "$BASE_URL/api/projects/$project_id/issues/$issue_id/attachments/$attachment_id" \
  -o "$TMP_DIR/restored.txt"
cmp "$TMP_DIR/probe.txt" "$TMP_DIR/restored.txt"

echo "backup, volume destruction, login, task, and attachment restore rehearsal passed"
