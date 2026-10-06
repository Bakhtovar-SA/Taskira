#!/usr/bin/env bash
set -Eeuo pipefail

FILE="${1:-.trivyignore.yaml}"
[ -f "$FILE" ] || { echo "missing Trivy exception file: $FILE" >&2; exit 1; }

# TRIVY_IGNORE_TODAY (YYYY-MM-DD) overrides the clock; used only by tests.
TODAY="${TRIVY_IGNORE_TODAY:-$(date -u +%Y-%m-%d)}"

awk -v today="$TODAY" '
  function finish() {
    if (!active) return
    if (!statement || !owner || !expiry) {
      printf "Trivy exception %s must have statement with owner= and expired_at\n", id > "/dev/stderr"
      bad = 1
    } else if (expiry_date < today) {
      printf "Trivy exception %s expired on %s (today %s): fix the vulnerability or renew it with a new owner= decision\n", id, expiry_date, today > "/dev/stderr"
      bad = 1
    }
  }
  /^[[:space:]]*-[[:space:]]+id:/ {
    finish()
    active = 1; statement = 0; owner = 0; expiry = 0
    id = $0; sub(/^.*id:[[:space:]]*/, "", id)
    next
  }
  active && /^[[:space:]]+statement:[[:space:]]*[^[:space:]]/ {
    statement = 1
    if ($0 ~ /owner=[^[:space:]]+/) owner = 1
  }
  active && /^[[:space:]]+expired_at:[[:space:]]*[0-9]{4}-[0-9]{2}-[0-9]{2}/ {
    expiry = 1
    expiry_date = $0
    sub(/^[[:space:]]+expired_at:[[:space:]]*/, "", expiry_date)
    expiry_date = substr(expiry_date, 1, 10)
  }
  END { finish(); exit bad }
' "$FILE"
