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
# Podman pass through untouched. TASKIRA_PROC_SYS / TASKIRA_SUBUID_FILE / TASKIRA_SUBGID_FILE exist only
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

  local account="$(id -un)" account_id="$(id -u)" kind range_file
  for kind in UID GID; do
    if [ "$kind" = UID ]; then range_file="${TASKIRA_SUBUID_FILE:-/etc/subuid}"
    else range_file="${TASKIRA_SUBGID_FILE:-/etc/subgid}"; fi
    if [ ! -r "$range_file" ] || ! awk -F: -v name="$account" -v uid="$account_id" \
      '$1 == name || $1 == uid { found=1 } END { exit !found }' "$range_file"; then
      # NSS providers may supply working mappings without local file entries.
      echo "WARNING: no local subordinate $kind range for $account in $range_file." >&2
      echo "         An external mapping provider may supply it; if containers fail, check 'podman unshare true'" >&2
      echo "         and configure UID/GID ranges with your system administrator." >&2
    fi
  done

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

# Compose names the project (and so its volumes and network) after the install
# directory, lower-cased, keeping only [a-z0-9_-] — docker compose and
# podman-compose agree on this. Process environment wins over the install .env.
compose_project_name() {
  local name="${COMPOSE_PROJECT_NAME:-}"
  if [ -z "$name" ] && [ -f "$1/.env" ]; then
    name="$(env_file_value "$1/.env" COMPOSE_PROJECT_NAME)"
    case "$name" in \"*\") name="${name#\"}"; name="${name%\"}" ;; \'*\') name="${name#\'}"; name="${name%\'}" ;; esac
  fi
  [ -n "$name" ] || name="$(basename -- "$1")"
  printf '%s' "$name" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_-'
}

# Two installations whose directories share a name share one project: the second
# one attaches to the first one's database (and fails with "password authentication
# failed"), and its `down -v` would delete the first one's data. Found on Rocky 10.2
# (OPS-PODMAN-01). Volumes count as ours when this directory started them before
# (marker) or when their containers were created from this directory.
INSTALL_MARKER=".taskira-installed"
preflight_project_volumes() {
  dir="$1"
  adopt="$2"
  project="$(compose_project_name "$dir")"
  volume="${project}_pgdata"
  "$ENGINE" volume inspect "$volume" >/dev/null 2>&1 || return 0
  [ -f "$dir/$INSTALL_MARKER" ] && return 0
  [ "$adopt" = "1" ] && return 0
  owners=""
  for id in $("$ENGINE" ps -aq --filter "label=com.docker.compose.project=$project" 2>/dev/null || true); do
    owner="$("$ENGINE" inspect --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$id" 2>/dev/null || true)"
    case "$owner" in
      "$dir"|"$(cd "$dir" && pwd -P)") return 0 ;;
      "") ;;
      *) case " $owners " in *" $owner "*) ;; *) owners="$owners $owner" ;; esac ;;
    esac
  done
  echo "ERROR: volume $volume already exists and does not belong to this installation ($dir)." >&2
  echo "       Compose names volumes after the directory name (project \"$project\")." >&2
  if [ -n "$owners" ]; then
    echo "       It is used by the installation in:$owners" >&2
  else
    echo "       No container uses it: a leftover of an installation in a directory with the same name." >&2
  fi
  echo "       Starting here would attach to that database, and 'down -v' here would delete it." >&2
  echo "       Extract this release into a directory with another name, or, if these volumes are" >&2
  echo "       this installation's own data, rerun with --adopt-existing-volumes." >&2
  return 1
}

ipv4_to_int() {
  [[ "$1" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || return 2
  local IFS=. octet value=0
  set -- $1
  for octet in "$@"; do
    octet=$((10#$octet))
    [ "$octet" -le 255 ] || return 2
    value=$(((value << 8) + octet))
  done
  printf '%s\n' "$value"
}

cidrs_overlap() {
  local a_bits="${1#*/}" b_bits="${2#*/}" a_ip b_ip bits mask
  [[ "$a_bits" =~ ^[0-9]{1,2}$ && "$b_bits" =~ ^[0-9]{1,2}$ ]] || return 2
  a_bits=$((10#$a_bits)); b_bits=$((10#$b_bits))
  [ "$a_bits" -le 32 ] && [ "$b_bits" -le 32 ] || return 2
  a_ip="$(ipv4_to_int "${1%/*}")" || return 2
  b_ip="$(ipv4_to_int "${2%/*}")" || return 2
  bits=$((a_bits < b_bits ? a_bits : b_bits))
  mask=$((bits == 0 ? 0 : (0xFFFFFFFF << (32 - bits)) & 0xFFFFFFFF))
  [ $((a_ip & mask)) -eq $((b_ip & mask)) ]
}

cidrs_equal() {
  local a_bits=$((10#${1#*/})) b_bits=$((10#${2#*/})) a_ip b_ip mask
  [ "$a_bits" -eq "$b_bits" ] || return 1
  a_ip="$(ipv4_to_int "${1%/*}")" || return 2
  b_ip="$(ipv4_to_int "${2%/*}")" || return 2
  mask=$((a_bits == 0 ? 0 : (0xFFFFFFFF << (32 - a_bits)) & 0xFFFFFFFF))
  [ $((a_ip & mask)) -eq $((b_ip & mask)) ]
}

# The project network uses a fixed subnet (TASKIRA_NETWORK_CIDR, default
# 172.30.0.0/24). Another network on the same subnet — typically a second
# installation, even a stopped one — makes `up` die inside the provider with a
# traceback; say what to change instead.
preflight_network() {
  dir="$1"
  cidr="$(env_file_value "$dir/.env" TASKIRA_NETWORK_CIDR)"
  [ -n "$cidr" ] || cidr="172.30.0.0/24"
  if ! cidrs_overlap "$cidr" "$cidr"; then
    echo "ERROR: invalid TASKIRA_NETWORK_CIDR=$cidr; use four octets 0-255 and a prefix 0-32." >&2
    return 1
  fi
  own="$(compose_project_name "$dir")_default"
  while IFS= read -r net; do
    [ -n "$net" ] || continue
    # TASKIRA_NETWORK_CIDR is IPv4; IPv6 ranges do not overlap its address family.
    for subnet in $("$ENGINE" network inspect "$net" 2>/dev/null | grep -oiE '"subnet": *"[0-9.]+/[0-9]+"' | grep -oE '[0-9.]+/[0-9]+' || true); do
      if [ "$net" = "$own" ]; then
        if ! cidrs_equal "$cidr" "$subnet"; then
          echo "ERROR: own network $net uses $subnet, but TASKIRA_NETWORK_CIDR=$cidr has changed." >&2
          echo "       Restore the original CIDR, or stop this installation and remove its network before restarting." >&2
          return 1
        fi
        continue
      fi
      if cidrs_overlap "$cidr" "$subnet"; then
        echo "ERROR: network $net already uses $subnet, which overlaps TASKIRA_NETWORK_CIDR=$cidr." >&2
        echo "       Set another free private subnet in .env, for example TASKIRA_NETWORK_CIDR=172.31.0.0/24," >&2
        echo "       or remove that network if it is a leftover: $ENGINE network rm $net" >&2
        return 1
      fi
    done
  done < <("$ENGINE" network ls --format '{{.Name}}' 2>/dev/null || true)
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

# Docker Desktop keeps DockerRootDir in its VM, outside the caller's WSL
# filesystem. Use an already-loaded installation image to query that same
# container-storage filesystem; no image download or host mount is needed.
container_storage_available_kb() {
  local image
  if [ -d "$1" ]; then
    df -Pk "$1" | awk 'END {print $4}'
    return
  fi
  image="$(compose config --images postgres)" || return $?
  [ -n "$image" ] && [[ "$image" != *$'\n'* ]] || {
    echo 'ERROR: cannot determine the installed PostgreSQL image for the storage check' >&2
    return 1
  }
  "$ENGINE" run --rm --pull=never --network none --read-only --cap-drop ALL \
    --entrypoint df "$image" -Pk / | awk 'END {print $4}'
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
