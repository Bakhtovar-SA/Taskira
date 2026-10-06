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

# Rootless Podman preflight. Each failure names the cause and the fix, instead of
# letting podman/compose die later with an unrelated message. Docker and rootful
# Podman pass through untouched. TASKIRA_PROC_SYS / TASKIRA_SUBUID_FILE exist only
# so tests can point the reads at fixtures.
podman_is_rootless() {
  [ "$ENGINE" = "podman" ] || return 1
  [ "$(podman info --format '{{.Host.Security.Rootless}}' 2>/dev/null || true)" = "true" ]
}

preflight_rootless() {
  port="${1:-}"
  podman_is_rootless || return 0
  proc_sys="${TASKIRA_PROC_SYS:-/proc/sys}"
  echo "Rootless Podman detected (user $(id -un))"

  if [ -z "${XDG_RUNTIME_DIR:-}" ]; then
    echo "WARNING: XDG_RUNTIME_DIR is not set (typical after 'su' or 'sudo -u'). Health checks and" >&2
    echo "         'podman compose' depend on the user's systemd session; log in directly (ssh/console)." >&2
  fi

  userns="$(cat "$proc_sys/user/max_user_namespaces" 2>/dev/null || true)"
  if [ "$userns" = "0" ]; then
    echo "ERROR: user namespaces are disabled (user.max_user_namespaces=0); rootless Podman cannot run." >&2
    echo "       As root: sysctl -w user.max_user_namespaces=15000 and persist it in /etc/sysctl.d/." >&2
    return 1
  fi

  subuid_file="${TASKIRA_SUBUID_FILE:-/etc/subuid}"
  if [ -r "$subuid_file" ] && ! grep -Eq "^($(id -un)|$(id -u)):" "$subuid_file"; then
    echo "ERROR: no subordinate UID range for $(id -un) in /etc/subuid (and /etc/subgid)." >&2
    echo "       As root: usermod --add-subuids 100000-165535 --add-subgids 100000-165535 $(id -un)" >&2
    echo "       then run 'podman system migrate' as that user." >&2
    return 1
  fi

  if [ -n "$port" ]; then
    first="$(cat "$proc_sys/net/ipv4/ip_unprivileged_port_start" 2>/dev/null || true)"
    if [[ "$port" =~ ^[0-9]+$ ]] && [[ "$first" =~ ^[0-9]+$ ]] && [ "$port" -lt "$first" ]; then
      echo "ERROR: rootless Podman cannot publish port $port (net.ipv4.ip_unprivileged_port_start=$first)." >&2
      echo "       Use CLIENT_PORT >= $first (and the same port in CORS_ORIGIN), put a reverse proxy on" >&2
      echo "       $port, or as root: sysctl -w net.ipv4.ip_unprivileged_port_start=$port (persist in /etc/sysctl.d/)." >&2
      return 1
    fi
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
