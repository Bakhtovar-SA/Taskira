#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/taskira-storage-check.XXXXXXXX")"
cleanup() {
  case "$TEST_DIR" in "${TMPDIR:-/tmp}"/taskira-storage-check.*) rm -rf -- "$TEST_DIR" ;; *) exit 1 ;; esac
}
trap cleanup EXIT
. "$ROOT_DIR/scripts/release/container-engine.sh"
ENGINE=docker

df() { printf 'Filesystem 1024-blocks Used Available Capacity Mounted\nfixture 10000 1000 9000 10%% /\n'; }
compose() {
  [ "$*" = 'config --images postgres' ] || return 1
  printf 'postgres:16\n'
}
docker() {
  printf '%s\n' "$*" >> "$TEST_DIR/engine-requests"
  [ "$1" = run ] || return 1
  [ "${ENGINE_FAILURE:-0}" = 0 ] || return "$ENGINE_FAILURE"
  printf 'Filesystem 1024-blocks Used Available Capacity Mounted\noverlay 20000 12000 8000 60%% /\n'
}

# Native engine: the visible engine storage filesystem is the measurement.
[ "$(container_storage_available_kb "$TEST_DIR")" = 9000 ]
[ ! -e "$TEST_DIR/engine-requests" ]

# Desktop/remote engine: the daemon path is absent in the caller filesystem.
# The measurement must come from the engine, using a loaded installation image.
[ "$(container_storage_available_kb "$TEST_DIR/not-host-mounted")" = 8000 ]
grep -Fq -- '--pull=never --network none --read-only' "$TEST_DIR/engine-requests"
grep -Fq -- 'df postgres:16 -Pk /' "$TEST_DIR/engine-requests"

# An engine failure cannot silently become an available-space result.
ENGINE_FAILURE=17
if container_storage_available_kb "$TEST_DIR/not-host-mounted" > "$TEST_DIR/result"; then
  echo 'storage check accepted a failed engine query' >&2; exit 1
fi
ENGINE_FAILURE=0
compose() { return 23; }
if container_storage_available_kb "$TEST_DIR/not-host-mounted" > "$TEST_DIR/result"; then
  echo 'storage check accepted a failed Compose image lookup' >&2; exit 1
fi

echo 'native and Docker Desktop container storage checks passed'
