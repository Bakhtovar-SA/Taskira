#!/usr/bin/env bash

# Shared by the release builder and the generated offline installer. The caller
# may pre-set ENGINE (normally from CONTAINER_ENGINE or --engine).
detect_engine() {
  if [ -n "${ENGINE:-}" ]; then
    case "$ENGINE" in docker|podman) ;; *) echo "ERROR: unsupported engine: $ENGINE" >&2; exit 2 ;; esac
    command -v "$ENGINE" >/dev/null 2>&1 || { echo "ERROR: $ENGINE is not installed" >&2; exit 1; }
    "$ENGINE" info >/dev/null
    return
  fi
  if command -v podman >/dev/null 2>&1 && podman info >/dev/null 2>&1; then
    ENGINE="podman"
  elif command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    ENGINE="docker"
  else
    echo "ERROR: neither a working Podman nor Docker installation was found" >&2
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
    return 1
  fi
}

env_file_value() {
  file="$1"
  key="$2"
  sed -n "s/^${key}=//p" "$file" | tail -n 1 | sed 's/\r$//'
}

wait_until_healthy() {
  expected="$1"
  port="$2"
  compose_dir="$3"
  attempt=1
  while [ "$attempt" -le 60 ]; do
    health="$(curl --fail --silent --show-error "http://127.0.0.1:${port}/api/health" 2>/dev/null || true)"
    if printf '%s' "$health" | grep -Fq "\"version\":\"${expected}\""; then
      echo "Taskira $expected is healthy: $health"
      return 0
    fi
    sleep 2
    attempt=$((attempt + 1))
  done
  echo "ERROR: Taskira $expected did not become healthy within 120 seconds" >&2
  (
    cd "$compose_dir"
    compose_run --env-file .env -f docker-compose.yml ps >&2 || true
    compose_run --env-file .env -f docker-compose.yml logs --tail=100 server >&2 || true
  )
  return 1
}
