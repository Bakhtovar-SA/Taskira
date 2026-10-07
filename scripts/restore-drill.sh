#!/usr/bin/env bash
set -Eeuo pipefail
export LC_ALL=C
umask 077

OPS_SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
INSTALL_DIR="${TASKIRA_INSTALL_DIR:-}"
ENGINE="${CONTAINER_ENGINE:-}"
ARCHIVE=""
BACKUP_DIR=""
KEEP_ON_FAILURE=0
usage() {
  echo 'Usage: ./restore-drill.sh --install-dir DIR (--archive FILE | --backup-dir DIR) [--keep-on-failure] [--engine docker|podman]'
}
while [ "$#" -gt 0 ]; do
  case "$1" in
    --install-dir) INSTALL_DIR="$2"; shift 2 ;;
    --archive) ARCHIVE="$2"; shift 2 ;;
    --backup-dir) BACKUP_DIR="$2"; shift 2 ;;
    --keep-on-failure) KEEP_ON_FAILURE=1; shift ;;
    --engine) ENGINE="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done
[ -n "$INSTALL_DIR" ] && { [ -n "$ARCHIVE" ] || [ -n "$BACKUP_DIR" ]; } &&
  ! { [ -n "$ARCHIVE" ] && [ -n "$BACKUP_DIR" ]; } || { usage >&2; exit 2; }
. "$OPS_SCRIPT_DIR/operations-common.sh"
ops_init "$INSTALL_DIR"
. "$OPS_SCRIPT_DIR/ops-report.sh"
STARTED_AT="$(date +%s)"
OPS_ARCHIVE="$ARCHIVE"
OPS_RUN_ID="$(ops_run_start restore_drill)"
DRILL_DIR=""
DRILL_PROJECT=""
DRILL_CONFIGURED=0
ERROR_CAPTURED=0
ERROR_LOG=""
ERROR_TEE_PID=""
DETAILS='{}'
OPS_LAST_ERROR='restore drill failed'

# All changes of INSTALL_DIR and compose options stay in this subshell.
drill_compose() (
  unset COMPOSE_PROJECT_NAME TASKIRA_COMPOSE_OVERRIDE
  # Shell env has precedence over --env-file. Remove every interpolated key
  # from the working compose before resolving fresh drill credentials.
  while IFS= read -r variable; do unset "$variable"; done < <(
    grep -oE '\$\{[A-Za-z_][A-Za-z0-9_]*' "$INSTALL_DIR/docker-compose.yml" | sed 's/^\${//' | sort -u
  )
  ops_init "$DRILL_DIR"
  TASKIRA_COMPOSE_OVERRIDE=drill.override.yml
  compose "$@"
)
cleanup() {
  local code=$? cleanup_failed=0
  trap - EXIT ERR
  if [ "$ERROR_CAPTURED" = 1 ]; then
    exec 2>&3
    wait "$ERROR_TEE_PID" || true
    if [ "$code" != 0 ]; then
      OPS_LAST_ERROR+=$'\n'"$(tail -n 20 "$ERROR_LOG" 2>/dev/null || true)"
      if [ -n "$DRILL_DIR" ]; then redact_stream < "$ERROR_LOG" > "$DRILL_DIR/error.log"; fi
    fi
    rm -f -- "$ERROR_LOG"
  fi
  OPS_LAST_ERROR="$(printf '%s\n' "$OPS_LAST_ERROR" | redact_stream)"
  if [ -n "$DRILL_DIR" ] && [ "$KEEP_ON_FAILURE" = 1 ] && [ "$code" != 0 ]; then
    echo "Kept failed drill: $DRILL_DIR" >&2
    printf 'Cleanup: (cd %q && %q compose --env-file .env -p %q -f docker-compose.yml -f drill.override.yml down -v) && rm -rf -- %q\n' \
      "$DRILL_DIR" "$ENGINE" "$DRILL_PROJECT" "$DRILL_DIR" >&2
  elif [ -n "$DRILL_DIR" ]; then
    if [ "$DRILL_CONFIGURED" = 1 ]; then
      drill_compose down -v --remove-orphans >/dev/null || cleanup_failed=1
    fi
    if [ "$cleanup_failed" = 0 ]; then
      # Only the canonical mktemp directory carrying our ownership marker can
      # be removed. Never derive a deletion target from the installation path.
      if [ -f "$DRILL_DIR/.taskira-drill-owned" ] &&
         [ "$(cat "$DRILL_DIR/.taskira-drill-owned")" = "$DRILL_PROJECT" ] &&
         [ "$(CDPATH= cd -- "$DRILL_DIR" && pwd)" = "$DRILL_DIR" ] &&
         [ "$DRILL_DIR" != "$INSTALL_DIR" ] && [ "$DRILL_DIR" != / ]; then
        rm -rf -- "$DRILL_DIR" || cleanup_failed=1
      else
        cleanup_failed=1
      fi
    fi
  fi
  if [ "$cleanup_failed" = 1 ]; then
    code=1
    OPS_LAST_ERROR="drill cleanup failed; retained directory: $DRILL_DIR"
    echo "ERROR: $OPS_LAST_ERROR" >&2
  fi
  if [ "$code" = 0 ]; then
    ops_run_finish "$OPS_RUN_ID" success "$DETAILS" ''
  else
    ops_run_finish "$OPS_RUN_ID" failure "$DETAILS" "$OPS_LAST_ERROR"
  fi
  exit "$code"
}
trap cleanup EXIT
trap 'OPS_LAST_ERROR="restore drill failed at line $LINENO (exit $?): $BASH_COMMAND"' ERR
trap 'OPS_LAST_ERROR="restore drill interrupted"; exit 130' INT
trap 'OPS_LAST_ERROR="restore drill terminated"; exit 143' TERM

for command_name in tar sha256sum mktemp date df awk jq openssl ip stat find tee tail; do
  command -v "$command_name" >/dev/null || fail "$command_name is required"
done
# Capture errors before archive selection and Docker inspection, including
# failures inside command substitutions. The private file exists before the
# drill directory and is always removed by cleanup.
ERROR_LOG="$(mktemp "${TMPDIR:-/tmp}/taskira-drill-error.XXXXXXXX")"
exec 3>&2
exec 2> >(tee "$ERROR_LOG" >&3)
ERROR_TEE_PID=$!
ERROR_CAPTURED=1
if [ -n "$BACKUP_DIR" ]; then
  [ -d "$BACKUP_DIR" ] || fail "backup directory is missing"
  latest_time=0
  while IFS= read -r -d '' candidate; do
    modified="$(stat -c %Y "$candidate")"
    if [ "$modified" -ge "$latest_time" ]; then ARCHIVE="$candidate"; latest_time="$modified"; fi
  done < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'taskira-*.tar.gz' -print0)
fi
[ -n "$ARCHIVE" ] && [ -f "$ARCHIVE" ] || fail 'no backup archive found'
case "$ARCHIVE" in /*) ;; *) ARCHIVE="$PWD/$ARCHIVE" ;; esac
OPS_ARCHIVE="$ARCHIVE"
bytes="$(wc -c < "$ARCHIVE" | tr -d ' ')"
required_bytes=$((bytes * 3))
if [ "$ENGINE" = docker ]; then
  image_root="$(docker info --format '{{.DockerRootDir}}')"
else
  image_root="$(podman info --format '{{.Store.GraphRoot}}')"
fi
for directory in "${TMPDIR:-/tmp}" "$image_root"; do
  [ -d "$directory" ] || fail "image or temporary storage is not accessible on this host: $directory"
  free_bytes="$(df -Pk "$directory" | awk 'END {printf "%.0f", $4 * 1024}')"
  [[ "$free_bytes" =~ ^[0-9]+$ ]] && [ "$free_bytes" -ge "$required_bytes" ] || fail 'insufficient_space'
done
echo 'Preparing an isolated restore stack...'
DRILL_DIR="$(mktemp -d "${TMPDIR:-/tmp}/taskira-drill.XXXXXXXX")"
DRILL_DIR="$(CDPATH= cd -- "$DRILL_DIR" && pwd)"
DRILL_PROJECT="taskira-drill-$(date -u +%Y%m%d%H%M%S)-$(openssl rand -hex 4)"
printf '%s\n' "$DRILL_PROJECT" > "$DRILL_DIR/.taskira-drill-owned"
for file in docker-compose.yml VERSION IMAGES.txt MIGRATIONS.txt; do
  require_file "$INSTALL_DIR/$file"
  cp "$INSTALL_DIR/$file" "$DRILL_DIR/$file"
done
for file in operations-common.sh ops-report.sh restore.sh restore-drill-probe.cjs; do
  cp "$OPS_SCRIPT_DIR/$file" "$DRILL_DIR/$file"
done
if [ -f "$OPS_SCRIPT_DIR/container-engine.sh" ]; then
  cp "$OPS_SCRIPT_DIR/container-engine.sh" "$DRILL_DIR/container-engine.sh"
else
  cp "$OPS_SCRIPT_DIR/release/container-engine.sh" "$DRILL_DIR/container-engine.sh"
fi
mkdir "$DRILL_DIR/archive"
safe_extract "$ARCHIVE" "$DRILL_DIR/archive"
for file in manifest.json SHA256SUMS storage/objects.json; do require_file "$DRILL_DIR/archive/$file"; done
(cd "$DRILL_DIR/archive" && sha256sum --check --strict SHA256SUMS >/dev/null)

# Keep only harmless public settings. No inherited SMTP, LDAP, S3 endpoints,
# credentials or caller-provided compose project names enter the drill env.
write_public_env "$INSTALL_DIR/.env" "$DRILL_DIR/env.public"
grep -E '^(TASKIRA_VERSION|POSTGRES_USER|POSTGRES_DB|DUE_REMINDER_TIMEZONE|DUE_REMINDER_HOUR|SESSION_TTL_SECONDS|SESSION_ROTATE_AFTER_SECONDS|ACCOUNT_LOCK_MAX_FAILURES|ACCOUNT_LOCK_SECONDS)=' \
  "$DRILL_DIR/env.public" > "$DRILL_DIR/.env" || true
rm "$DRILL_DIR/env.public"
drill_username="drill-$(openssl rand -hex 8)"
cat >> "$DRILL_DIR/.env" <<EOF
COMPOSE_PROJECT_NAME=$DRILL_PROJECT
POSTGRES_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 24)
ADMIN_USERNAME=bootstrap-$(openssl rand -hex 8)
ADMIN_PASSWORD=Aa9!$(openssl rand -hex 24)
AUTH_MODE=local
STORAGE_DRIVER=local
SESSION_COOKIE_SECURE=false
NOTIFY_EMAIL_ENABLED=false
NOTIFY_WORKER_ENABLED=false
WEBHOOKS_ENABLED=false
RECURRING_ENABLED=false
DUE_REMINDER_ENABLED=false
MAINTENANCE_ENABLED=false
EOF
OPS_EXTRA_REDACT_ENV="$DRILL_DIR/.env"

# Reject overlaps with all engine networks and the host's routed CIDRs.
reserved="$(ip -4 route show | awk '$1 ~ /^[0-9.]+\// {print $1}')"
reserved+=$'\n'"$(env_file_value "$INSTALL_DIR/.env" TASKIRA_NETWORK_CIDR)"$'\n''172.30.0.0/24'
mapfile -t network_ids < <("$ENGINE" network ls -q)
if [ "${#network_ids[@]}" -gt 0 ]; then
  reserved+=$'\n'"$("$ENGINE" network inspect "${network_ids[@]}" | jq -r '.[].IPAM.Config[]?.Subnet // empty, .[].subnets[]?.subnet // empty')"
fi
cidr_overlaps() {
  awk -v candidate="$1" '
    function bounds(c, a,b,n,i,size) {
      split(c,a,"/"); if (a[1] !~ /^[0-9.]+$/) return 0;
      split(a[1],b,"."); n=0; for(i=1;i<=4;i++) n=n*256+b[i];
      size=2^(32-(a[2]=="" ? 32 : a[2])); lo=int(n/size)*size; hi=lo+size-1; return 1;
    }
    BEGIN {bounds(candidate); start=lo; end=hi}
    {if(bounds($0) && lo<=end && hi>=start) found=1}
    END {exit found ? 0 : 1}' <<< "$reserved"
}
start_octet=$((16#$(openssl rand -hex 1)))
drill_cidr=""
for offset in $(seq 0 255); do
  candidate="172.31.$(((start_octet + offset) % 256)).0/24"
  if ! cidr_overlaps "$candidate"; then drill_cidr="$candidate"; break; fi
done
[ -n "$drill_cidr" ] || fail 'no unused drill network subnet found'
printf 'TASKIRA_NETWORK_CIDR=%s\n' "$drill_cidr" >> "$DRILL_DIR/.env"
cat > "$DRILL_DIR/drill.override.yml" <<'EOF'
services:
  server:
    environment:
      AUTH_MODE: local
      STORAGE_DRIVER: local
      NOTIFY_EMAIL_ENABLED: 'false'
      NOTIFY_WORKER_ENABLED: 'false'
      WEBHOOKS_ENABLED: 'false'
      RECURRING_ENABLED: 'false'
      DUE_REMINDER_ENABLED: 'false'
      MAINTENANCE_ENABLED: 'false'
networks:
  default:
    internal: true
EOF

# Resolve the copied compose file, then remove ports altogether. JSON is valid
# Compose YAML, including with providers that cannot parse !reset tags.
drill_compose config --format json > "$DRILL_DIR/compose.resolved.json"
jq -e '(.services | keys | sort) == ["client","postgres","server"] and
  all(.services[]; (.image | type) == "string" and (has("build") | not) and
    all(.volumes[]?; .type == "volume" and (.source == "pgdata" or .source == "attachments")))' \
  "$DRILL_DIR/compose.resolved.json" >/dev/null || fail 'drill requires an unmodified release compose stack with named volumes'
jq --arg project "$DRILL_PROJECT" --arg cidr "$drill_cidr" '
  .name=$project |
  .services |= with_entries(.value |= (del(.ports, .network_mode) + {restart:"no",pull_policy:"never",networks:{default:null}})) |
  .services.server.environment |= with_entries(select((.key | test("^(LDAP_|SMTP_|STORAGE_S3_)")) | not)) |
  .volumes |= with_entries(.value = {name:($project+"_"+.key)}) |
  .networks = {default:{name:($project+"_default"),internal:true,ipam:{config:[{subnet:$cidr}]}}}
' "$DRILL_DIR/compose.resolved.json" > "$DRILL_DIR/docker-compose.yml"
rm "$DRILL_DIR/compose.resolved.json"
drill_compose config --format json > "$DRILL_DIR/compose.checked.json"
jq -e --arg project "$DRILL_PROJECT" '
  .networks.default.internal == true and all(.services[]; ((.ports // []) | length) == 0) and
  all(.volumes[]; .name | startswith($project+"_")) and
  (.services.server.environment | .AUTH_MODE == "local" and .STORAGE_DRIVER == "local" and
    .NOTIFY_EMAIL_ENABLED == "false" and .NOTIFY_WORKER_ENABLED == "false" and .WEBHOOKS_ENABLED == "false" and
    .RECURRING_ENABLED == "false" and .DUE_REMINDER_ENABLED == "false" and .MAINTENANCE_ENABLED == "false" and
    all(to_entries[]; (.key | test("^(LDAP_|SMTP_|STORAGE_S3_)")) | not))
' "$DRILL_DIR/compose.checked.json" >/dev/null || fail 'drill isolation configuration check failed'
while IFS= read -r image; do
  grep -Fxq "$image" "$DRILL_DIR/IMAGES.txt" || fail 'drill image is not listed in the release'
  "$ENGINE" image inspect "$image" >/dev/null || fail 'a release image is unavailable locally'
done < <(jq -r '.services[].image' "$DRILL_DIR/compose.checked.json")
rm "$DRILL_DIR/compose.checked.json"
DRILL_CONFIGURED=1
echo 'Restoring into private volumes, without published ports or outgoing workers...'
TASKIRA_COMPOSE_OVERRIDE=drill.override.yml TASKIRA_INTERNAL_HEALTH=1 \
  bash "$DRILL_DIR/restore.sh" --install-dir "$DRILL_DIR" --archive "$ARCHIVE" --engine "$ENGINE" --yes --storage-driver local

echo 'Checking row counts and authenticated API access...'
actual_counts="$(drill_compose exec -T postgres psql -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "SELECT json_build_object('projects', (SELECT count(*) FROM projects), 'issues', (SELECT count(*) FROM issues))")"
counts_skipped=false
if jq -e 'has("counts")' "$DRILL_DIR/archive/manifest.json" >/dev/null; then
  jq -e --argjson actual "$actual_counts" '.counts == $actual' "$DRILL_DIR/archive/manifest.json" >/dev/null || fail 'restored project or issue counts differ from the archive'
else
  counts_skipped=true
  echo 'Old archive has no row counts; count comparison skipped.'
fi
hash="$(drill_compose exec -T server node - hash < "$DRILL_DIR/restore-drill-probe.cjs")"
drill_compose exec -T postgres psql -qAt -v ON_ERROR_STOP=1 -v username="$drill_username" -v hash="$hash" \
  -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null <<'SQL'
INSERT INTO users (username, password_hash, name, global_role, auth_source)
VALUES (:'username', :'hash', 'Restore drill', 'admin', 'local');
SQL
attachment="$(drill_compose exec -T postgres psql -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
  "SELECT json_build_object('id', a.id, 'issueId', a.issue_id, 'projectId', i.project_id, 'key', a.storage_key)
   FROM attachments a JOIN issues i ON i.id=a.issue_id ORDER BY random() LIMIT 1")"
attachment_skipped=false
if [ -n "$attachment" ]; then
  expected_hash="$(jq -er --arg key "$(jq -r .key <<< "$attachment")" '.objects[] | select(.key == $key) | .sha256' "$DRILL_DIR/archive/storage/objects.json")"
  [[ "$expected_hash" =~ ^[a-f0-9]{64}$ ]] || fail 'attachment is missing from the archive object manifest'
  attachment="$(jq --arg hash "$expected_hash" '. + {sha256:$hash}' <<< "$attachment")"
else
  attachment=null
  attachment_skipped=true
  echo 'Archive has no attachments; attachment probe skipped.'
fi
drill_compose exec -T server node - probe "$drill_username" "$attachment" < "$DRILL_DIR/restore-drill-probe.cjs"
DETAILS="$(jq -n --arg archive "$(basename -- "$ARCHIVE")" --argjson duration "$(($(date +%s) - STARTED_AT))" \
  --argjson counts "$actual_counts" --argjson countsSkipped "$counts_skipped" --argjson attachmentSkipped "$attachment_skipped" \
  '{archive:$archive,durationSec:$duration,projects:$counts.projects,issues:$counts.issues,
    countsSkipped:$countsSkipped,attachmentSkipped:$attachmentSkipped,
    checks:(["ready","login","projects"] + (if $countsSkipped then [] else ["counts"] end) + (if $attachmentSkipped then [] else ["attachment"] end))}')"
echo 'Restore drill passed; removing the isolated stack...'
