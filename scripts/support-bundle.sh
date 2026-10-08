#!/usr/bin/env bash
set -Eeuo pipefail
export LC_ALL=C

OPS_SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
INSTALL_DIR="${TASKIRA_INSTALL_DIR:-}"
ENGINE="${CONTAINER_ENGINE:-}"
OUTPUT=""
LOG_LINES=300

usage() {
  echo "Usage: ./support-bundle.sh --install-dir DIR [--output FILE.tar.gz] [--lines N] [--engine docker|podman]"
}
while [ "$#" -gt 0 ]; do
  case "$1" in
    --install-dir) INSTALL_DIR="$2"; shift 2 ;;
    --output) OUTPUT="$2"; shift 2 ;;
    --lines) LOG_LINES="$2"; shift 2 ;;
    --engine) ENGINE="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done
[ -n "$INSTALL_DIR" ] || { usage >&2; exit 2; }
[[ "$LOG_LINES" =~ ^[1-9][0-9]*$ ]] || { echo "ERROR: --lines must be a positive integer" >&2; exit 2; }
. "$OPS_SCRIPT_DIR/operations-common.sh"
ops_init "$INSTALL_DIR"
for command_name in tar sha256sum mktemp curl awk; do command -v "$command_name" >/dev/null || fail "$command_name is required"; done

timestamp="$(date -u +'%Y%m%dT%H%M%SZ')"
[ -n "$OUTPUT" ] || OUTPUT="$PWD/taskira-support-${timestamp}.tar.gz"
case "$OUTPUT" in /*) ;; *) OUTPUT="$PWD/$OUTPUT" ;; esac
[ ! -e "$OUTPUT" ] || fail "output already exists: $OUTPUT"
mkdir -p "$(dirname -- "$OUTPUT")"
WORK_DIR="$(mktemp -d)"
cleanup() { rm -rf -- "$WORK_DIR"; }
trap cleanup EXIT INT TERM
BUNDLE="$WORK_DIR/bundle"
mkdir -p "$BUNDLE/logs"

write_public_env "$INSTALL_DIR/.env" "$BUNDLE/config.public"
printf 'created_at=%s\napplication_version=%s\nengine=%s\n' \
  "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$(current_version)" "$ENGINE" > "$BUNDLE/system.txt"
compose ps --all >> "$BUNDLE/system.txt" 2>&1 || true
if [ -f "$INSTALL_DIR/IMAGES.txt" ]; then
  cp "$INSTALL_DIR/IMAGES.txt" "$BUNDLE/images.txt"
  while IFS= read -r image; do
    [ -z "$image" ] || "$ENGINE" image inspect --format '{{json .RepoTags}} {{.Id}} {{.Created}}' "$image"
  done < "$INSTALL_DIR/IMAGES.txt" > "$BUNDLE/image-details.txt" 2>&1 || true
fi

for service in server client postgres; do
  compose logs --no-color --tail="$LOG_LINES" "$service" 2>&1 | redact_stream > "$BUNDLE/logs/$service.log" || true
done

curl --fail --silent --show-error "http://127.0.0.1:${CLIENT_PORT}/api/health" 2>&1 | redact_stream > "$BUNDLE/health.json" || true
if compose exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" > "$BUNDLE/postgres-health.txt" 2>&1; then
  schema_migrations > "$BUNDLE/schema-migrations.txt"
  compose exec -T postgres psql -At -F $'\t' -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    -c "SELECT name, applied_at FROM schema_migrations ORDER BY name" > "$BUNDLE/migration-state.tsv"
  : > "$BUNDLE/table-row-counts.tsv"
  while IFS= read -r count_query; do
    [ -z "$count_query" ] || compose exec -T postgres psql -At -F $'\t' -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
      -c "$count_query" </dev/null >> "$BUNDLE/table-row-counts.tsv"
  done < <(compose exec -T postgres psql -At -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    -c "SELECT format('SELECT %L, count(*) FROM %I.%I', schemaname || '.' || tablename, schemaname, tablename) FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename")
fi

(
  cd "$BUNDLE"
  find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS
  tar -czf "$OUTPUT" .
)
chmod 0600 "$OUTPUT"
echo "Support bundle complete: $OUTPUT"
echo "It contains metadata and recent logs, not task rows or attachment contents. Review the archive before sharing."
