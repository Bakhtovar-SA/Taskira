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
