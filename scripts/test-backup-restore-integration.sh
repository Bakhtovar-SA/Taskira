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
S3_CONTAINER="taskira-restore-s3-$$"
SMTP_LISTENER_PID=""
ACTIVE_DRILL_TMP="$TMP_DIR/drills"

cleanup() {
  [ -z "$SMTP_LISTENER_PID" ] || kill "$SMTP_LISTENER_PID" >/dev/null 2>&1 || true
  docker rm -f "$S3_CONTAINER" >/dev/null 2>&1 || true
  if [ -d "$ACTIVE_DRILL_TMP" ]; then
    while IFS= read -r -d '' drill; do
      if [ -f "$drill/.env" ] && [ -f "$drill/drill.override.yml" ]; then
        (cd "$drill" && docker compose --env-file .env -f docker-compose.yml -f drill.override.yml down -v) >/dev/null 2>&1 || true
      fi
    done < <(find "$ACTIVE_DRILL_TMP" -mindepth 1 -maxdepth 1 -type d -print0)
  fi
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
for file in backup.sh restore.sh support-bundle.sh operations-common.sh ops-report.sh restore-drill.sh restore-drill-probe.cjs; do
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
ADMIN_PASSWORD=Backup-Restore-42!Secure
ADMIN_NAME=Backup Admin
CORS_ORIGIN=http://127.0.0.1:18082
CLIENT_PORT=18082
SESSION_COOKIE_SECURE=false
STORAGE_DRIVER=local
SMTP_HOST=172.30.0.1
SMTP_PORT=18083
SMTP_FROM=drill@example.test
NOTIFY_WORKER_ENABLED=false
MAINTENANCE_ENABLED=false
RECURRING_ENABLED=false
EOF
# Keep the working fixture quiet throughout the lengthy rehearsal, including
# when a host has slow image pulls. Drill overrides must still enforce flags.
sed -i '/      DATABASE_URL:/a\      MAINTENANCE_ENABLED: "false"\n      NOTIFY_WORKER_ENABLED: "false"\n      RECURRING_ENABLED: "false"' "$INSTALL_DIR/docker-compose.yml"

(cd "$INSTALL_DIR" && docker compose --env-file .env -f docker-compose.yml up -d)
for _ in $(seq 1 60); do
  curl --fail --silent "$BASE_URL/api/health" >/dev/null 2>&1 && break
  sleep 2
done
curl --fail --silent --show-error "$BASE_URL/api/health" >/dev/null
curl --fail --silent --show-error -c "$COOKIE" -H 'content-type: application/json' \
  -d '{"username":"admin","password":"Backup-Restore-42!Secure"}' \
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

working_compose() { (cd "$INSTALL_DIR" && docker compose --env-file .env -f docker-compose.yml "$@"); }
working_sql() { working_compose exec -T postgres psql -qAt -v ON_ERROR_STOP=1 -U taskira -d taskira "$@"; }
working_sql -c "INSERT INTO ops_runs (kind, started_at, finished_at, result, archive) VALUES ('backup', now() - interval '1 day', now() - interval '1 day', 'success', 'historical-backup.tar.gz')" >/dev/null
"$INSTALL_DIR/backup.sh" --install-dir "$INSTALL_DIR" --engine docker --output "$BACKUP_ARCHIVE"
[ "$(working_sql -c "SELECT count(*) FROM ops_runs WHERE kind='backup' AND result='success' AND (details->>'bytes')::bigint > 0")" = 1 ]
# A failure before pg_dump must also be reported; the valid archive stays intact.
if "$INSTALL_DIR/backup.sh" --install-dir "$INSTALL_DIR" --engine docker --output "$BACKUP_ARCHIVE" > "$TMP_DIR/duplicate-backup.log" 2>&1; then
  echo 'backup overwrote an existing archive' >&2; exit 1
fi
[ "$(working_sql -c "SELECT count(*) FROM ops_runs WHERE kind='backup' AND result='failure'")" = 1 ]

# Observe real outgoing connections on the host. The restored stack must not
# inherit the working SMTP endpoint, even with queued historical work.
mkdir -p "$ACTIVE_DRILL_TMP"
: > "$TMP_DIR/smtp-connections"
python3 - "$TMP_DIR/smtp-connections" <<'PY' &
import socket, sys
with socket.socket() as listener:
    listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    listener.bind(('0.0.0.0', 18083))
    listener.listen()
    while True:
        connection, _ = listener.accept()
        with open(sys.argv[1], 'a') as output:
            output.write('connection\n')
        connection.close()
PY
SMTP_LISTENER_PID=$!
run_drill() { TMPDIR="$ACTIVE_DRILL_TMP" "$INSTALL_DIR/restore-drill.sh" --install-dir "$INSTALL_DIR" --engine docker "$@"; }
assert_drill_cleanup() {
  [ -z "$(docker ps -a --filter label=com.docker.compose.project --format '{{.Label "com.docker.compose.project"}}' | grep '^taskira-drill-' || true)" ]
  [ -z "$(docker volume ls --format '{{.Name}}' | grep '^taskira-drill-' || true)" ]
  [ -z "$(docker network ls --format '{{.Name}}' | grep '^taskira-drill-' || true)" ]
  [ -z "$(find "$ACTIVE_DRILL_TMP" -mindepth 1 -maxdepth 1 -type d -print -quit)" ]
  [ ! -s "$TMP_DIR/smtp-connections" ]
}
run_drill --archive "$BACKUP_ARCHIVE"
[ "$(working_sql -c "SELECT count(*) FROM ops_runs WHERE kind='restore_drill' AND result='success' AND details->'checks' ? 'attachment' AND details->'checks' ? 'counts'")" = 1 ]
assert_drill_cleanup

# A real S3-backed installation: the drill must read its portable archive into
# private local storage and leave every object in the live bucket unchanged.
working_compose stop client server
network="$(working_compose config --format json | jq -r '.networks.default.name')"
docker run -d --rm --name "$S3_CONTAINER" --network "$network" --network-alias restore-s3 \
  -v "$ROOT_DIR/server/ci/seaweedfs-s3.json:/etc/seaweedfs/s3.json:ro" \
  mirror.gcr.io/chrislusf/seaweedfs:3.80 \
  server -dir=/data -s3 -s3.port=9000 -s3.config=/etc/seaweedfs/s3.json -volume.max=10 >/dev/null
sed -i '/^STORAGE_DRIVER=/d' "$INSTALL_DIR/.env"
cat >> "$INSTALL_DIR/.env" <<'EOF'
STORAGE_DRIVER=s3
STORAGE_S3_ENDPOINT=http://restore-s3:9000
STORAGE_S3_BUCKET=taskira-restore-probe
STORAGE_S3_ACCESS_KEY=taskira
STORAGE_S3_SECRET_KEY=taskira-minio-dev
STORAGE_S3_FORCE_PATH_STYLE=true
EOF
storage_key="$(working_sql -v id="$attachment_id" <<'SQL'
SELECT storage_key FROM attachments WHERE id=:'id'::uuid;
SQL
)"
working_compose run --rm --no-deps -T server node --input-type=module - "$storage_key" <<'JS'
import { S3Client, CreateBucketCommand, HeadBucketCommand, PutObjectCommand } from '@aws-sdk/client-s3';
const client = new S3Client({endpoint:process.env.STORAGE_S3_ENDPOINT,region:'us-east-1',forcePathStyle:true,maxAttempts:1,
  credentials:{accessKeyId:process.env.STORAGE_S3_ACCESS_KEY,secretAccessKey:process.env.STORAGE_S3_SECRET_KEY}});
const Bucket=process.env.STORAGE_S3_BUCKET;
for(let attempt=0;;attempt++) {
  try { await client.send(new CreateBucketCommand({Bucket}), {abortSignal:AbortSignal.timeout(2000)}); break; }
  catch(error) {
    try { await client.send(new HeadBucketCommand({Bucket}), {abortSignal:AbortSignal.timeout(2000)}); break; } catch {}
    if(attempt>=59) throw error;
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
}
await client.send(new PutObjectCommand({Bucket,Key:process.argv[2],Body:'restore-rehearsal-attachment-20260919',ContentType:'text/plain'}));
await client.send(new PutObjectCommand({Bucket,Key:'bucket-sentinel.txt',Body:'must survive a drill'}));
client.destroy();
JS
working_sql -c "UPDATE attachments SET storage_driver='s3'" >/dev/null
working_compose up -d
S3_ARCHIVE="$TMP_DIR/taskira-s3.tar.gz"
"$INSTALL_DIR/backup.sh" --install-dir "$INSTALL_DIR" --engine docker --output "$S3_ARCHIVE"
bucket_fingerprint() {
  working_compose exec -T server node --input-type=module - <<'JS'
import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
const client=new S3Client({endpoint:process.env.STORAGE_S3_ENDPOINT,region:'us-east-1',forcePathStyle:true,
 credentials:{accessKeyId:process.env.STORAGE_S3_ACCESS_KEY,secretAccessKey:process.env.STORAGE_S3_SECRET_KEY}});
const Bucket=process.env.STORAGE_S3_BUCKET;
const listed=await client.send(new ListObjectsV2Command({Bucket}));
const entries=[];
for(const {Key} of listed.Contents ?? []) {
 const object=await client.send(new GetObjectCommand({Bucket,Key}));
 const hash=createHash('sha256'); for await(const chunk of object.Body) hash.update(chunk);
 entries.push([Key,hash.digest('hex')]);
}
console.log(JSON.stringify(entries.sort((a,b)=>a[0].localeCompare(b[0]))));
client.destroy();
JS
}
before_bucket="$(bucket_fingerprint)"
run_drill --archive "$S3_ARCHIVE"
[ "$(bucket_fingerprint)" = "$before_bucket" ]
assert_drill_cleanup

# Older archives lack counts. Their ready/login/attachment checks still run.
mkdir "$TMP_DIR/old-archive"
tar -xzf "$S3_ARCHIVE" -C "$TMP_DIR/old-archive"
jq 'del(.counts)' "$TMP_DIR/old-archive/manifest.json" > "$TMP_DIR/old-manifest"
mv "$TMP_DIR/old-manifest" "$TMP_DIR/old-archive/manifest.json"
(cd "$TMP_DIR/old-archive" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)
tar -czf "$TMP_DIR/taskira-old.tar.gz" -C "$TMP_DIR/old-archive" .
touch -d '2 minutes' "$TMP_DIR/taskira-old.tar.gz"
run_drill --backup-dir "$TMP_DIR"
[ "$(working_sql -c "SELECT details->>'countsSkipped' FROM ops_runs WHERE kind='restore_drill' ORDER BY started_at DESC LIMIT 1")" = true ]
[ "$(bucket_fingerprint)" = "$before_bucket" ]
assert_drill_cleanup

head -c 100 "$S3_ARCHIVE" > "$TMP_DIR/corrupt.tar.gz"
if run_drill --archive "$TMP_DIR/corrupt.tar.gz"; then
  echo 'restore drill accepted a corrupt archive' >&2; exit 1
fi
[ "$(working_sql -c "SELECT result FROM ops_runs WHERE kind='restore_drill' ORDER BY started_at DESC LIMIT 1")" = failure ]
[ "$(working_sql -c "SELECT error LIKE '%unexpected end of file%' OR error LIKE '%Unexpected EOF%' OR error LIKE '%not in gzip format%' FROM ops_runs WHERE kind='restore_drill' ORDER BY started_at DESC LIMIT 1")" = t ]
assert_drill_cleanup

# Restore the original local fixture before the existing disaster scenario.
sed -i '/^STORAGE_DRIVER=/d; /^STORAGE_S3_/d' "$INSTALL_DIR/.env"
printf 'STORAGE_DRIVER=local\n' >> "$INSTALL_DIR/.env"
working_compose stop client server
working_sql -c "UPDATE attachments SET storage_driver='local'" >/dev/null
# Simulate a pre-migration installation; reporting is optional, backup is not.
working_sql -c "DROP TABLE ops_runs; DELETE FROM schema_migrations WHERE name='20261006T1008_ops_runs.sql'" >/dev/null
"$INSTALL_DIR/backup.sh" --install-dir "$INSTALL_DIR" --engine docker \
  --output "$TMP_DIR/taskira-legacy-schema.tar.gz" > "$TMP_DIR/legacy-backup.log" 2>&1
grep -Fq 'ops_runs is missing' "$TMP_DIR/legacy-backup.log"
"$INSTALL_DIR/support-bundle.sh" --install-dir "$INSTALL_DIR" --engine docker --lines 100 --output "$SUPPORT_ARCHIVE"
mkdir "$TMP_DIR/support"
tar -xzf "$SUPPORT_ARCHIVE" -C "$TMP_DIR/support"
cat "$TMP_DIR/support/table-row-counts.tsv"
grep -Fq $'public.issues\t1' "$TMP_DIR/support/table-row-counts.tsv" || {
  echo "support bundle has no expected issues row count" >&2; exit 1;
}
assert_bundle_excludes() {
  label="$1"
  needle="$2"
  matches="$(grep -R -F -l -- "$needle" "$TMP_DIR/support" || true)"
  [ -z "$matches" ] || { echo "support bundle leaked $label in: $matches" >&2; exit 1; }
}
assert_bundle_excludes "admin password" 'Backup-Restore-42!Secure'
assert_bundle_excludes "JWT secret" 'backup-restore-jwt-secret'
assert_bundle_excludes "task title" "$ISSUE_TITLE"
assert_bundle_excludes "attachment content" "$ATTACHMENT_CONTENT"

# Disaster rehearsal: remove both persistent volumes, not merely containers.
(cd "$INSTALL_DIR" && docker compose --env-file .env -f docker-compose.yml down -v)
"$INSTALL_DIR/restore.sh" --install-dir "$INSTALL_DIR" --engine docker --archive "$BACKUP_ARCHIVE" --yes
# Preserve completed history, without restoring this archive's own running row.
[ "$(working_sql -c "SELECT count(*) FROM ops_runs WHERE kind='backup'")" = 1 ]
[ "$(working_sql -c "SELECT count(*) FROM ops_runs WHERE kind='backup' AND result='success' AND archive='historical-backup.tar.gz'")" = 1 ]

rm -f "$COOKIE"
curl --fail --silent --show-error -c "$COOKIE" -H 'content-type: application/json' \
  -d '{"username":"admin","password":"Backup-Restore-42!Secure"}' \
  "$BASE_URL/api/auth/login" >/dev/null
restored_issue="$(curl --fail --silent --show-error -b "$COOKIE" \
  "$BASE_URL/api/projects/$project_id/issues/$issue_id")"
[ "$(printf '%s' "$restored_issue" | jq -r '.title')" = "$ISSUE_TITLE" ]
curl --fail --silent --show-error -b "$COOKIE" \
  "$BASE_URL/api/projects/$project_id/issues/$issue_id/attachments/$attachment_id" \
  -o "$TMP_DIR/restored.txt"
cmp "$TMP_DIR/probe.txt" "$TMP_DIR/restored.txt"

echo "backup, volume destruction, login, task, and attachment restore rehearsal passed"
