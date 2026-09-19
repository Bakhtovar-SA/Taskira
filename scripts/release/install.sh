#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
cd "$ROOT_DIR"

ENGINE="${CONTAINER_ENGINE:-}"
MODE="load"

usage() {
  cat <<'EOF'
Usage: ./install.sh [--engine docker|podman] [--verify-only] [--start]

  (default)      verify the release, load all images, and create .env
  --verify-only  verify checksums without changing the host
  --start        verify, load images, validate .env, and start Taskira
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --engine)
      [ "$#" -ge 2 ] || { echo "--engine requires docker or podman" >&2; exit 2; }
      ENGINE="$2"; shift 2 ;;
    --verify-only) MODE="verify"; shift ;;
    --start) MODE="start"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

verify_release() {
  [ -f SHA256SUMS ] || { echo "ERROR: SHA256SUMS is missing" >&2; exit 1; }
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum --check --strict SHA256SUMS
  elif command -v shasum >/dev/null 2>&1; then
    while IFS='  ' read -r expected file; do
      actual="$(shasum -a 256 "$file" | awk '{print $1}')"
      [ "$actual" = "$expected" ] || { echo "ERROR: checksum mismatch: $file" >&2; exit 1; }
      printf '%s: OK\n' "$file"
    done < SHA256SUMS
  else
    echo "ERROR: sha256sum (or shasum) is required" >&2
    exit 1
  fi
}

compose_run() {
  if [ "$ENGINE" = "docker" ]; then
    docker compose "$@"
  elif podman compose version >/dev/null 2>&1; then
    podman compose "$@"
  else
    echo "ERROR: Podman must provide the 'podman compose' command" >&2
    exit 1
  fi
}

env_value() {
  key="$1"
  sed -n "s/^${key}=//p" .env | tail -n 1 | sed 's/\r$//'
}

validate_env() {
  [ -f .env ] || { echo "ERROR: .env is missing; run ./install.sh once, then edit it" >&2; exit 1; }
  for key in POSTGRES_PASSWORD JWT_SECRET ADMIN_PASSWORD CORS_ORIGIN; do
    value="$(env_value "$key")"
    [ -n "$value" ] || { echo "ERROR: $key is empty in .env" >&2; exit 1; }
  done
  [ "$(env_value CORS_ORIGIN)" != "http://192.0.2.10:8081" ] || {
    echo "ERROR: CORS_ORIGIN still contains the example address" >&2
    exit 1
  }
  jwt="$(env_value JWT_SECRET)"
  [ "${#jwt}" -ge 32 ] || { echo "ERROR: JWT_SECRET must contain at least 32 characters" >&2; exit 1; }
}

wait_until_healthy() {
  port="$(env_value CLIENT_PORT)"
  [ -n "$port" ] || port="8081"
  expected="$(cat VERSION)"
  attempt=1
  while [ "$attempt" -le 60 ]; do
    health="$(curl --fail --silent --show-error "http://127.0.0.1:${port}/api/health" 2>/dev/null || true)"
    if printf '%s' "$health" | grep -Fq "\"version\":\"${expected}\""; then
      echo "Taskira $expected is healthy: $health"
      return
    fi
    sleep 2
    attempt=$((attempt + 1))
  done
  echo "ERROR: Taskira did not become healthy within 120 seconds" >&2
  compose_run --env-file .env -f docker-compose.yml ps >&2 || true
  compose_run --env-file .env -f docker-compose.yml logs --tail=100 server >&2 || true
  exit 1
}

echo "[1/4] Verifying release checksums"
verify_release
[ "$MODE" = "verify" ] && { echo "Release integrity is valid."; exit 0; }
. "$ROOT_DIR/container-engine.sh"

echo "[2/4] Detecting container engine"
detect_engine
echo "Using $ENGINE"

echo "[3/4] Loading offline images"
while IFS= read -r archive; do
  echo "Loading $archive"
  "$ENGINE" load --input "$archive"
done < <(find images -maxdepth 1 -type f -name '*.tar' -print | LC_ALL=C sort)

while IFS= read -r image; do
  [ -n "$image" ] || continue
  "$ENGINE" image inspect "$image" >/dev/null
done < IMAGES.txt

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created $ROOT_DIR/.env"
fi

if [ "$MODE" = "start" ]; then
  echo "[4/4] Starting Taskira"
  validate_env
  compose_run --env-file .env -f docker-compose.yml config >/dev/null
  compose_run --env-file .env -f docker-compose.yml up -d
  wait_until_healthy
  compose_run --env-file .env -f docker-compose.yml ps
  echo "Taskira was started. Open $(env_value CORS_ORIGIN)"
else
  echo "[4/4] Images loaded. Edit $ROOT_DIR/.env, then run:"
  echo "      ./install.sh --engine $ENGINE --start"
fi
