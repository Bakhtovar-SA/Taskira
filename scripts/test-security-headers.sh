#!/usr/bin/env bash
set -Eeuo pipefail

URL="${1:-http://127.0.0.1:18080/}"
headers="$(curl --fail --silent --show-error --head "$URL" | tr -d '\r')"

require_header() {
  printf '%s\n' "$headers" | grep -Eiq "^$1:" || {
    echo "missing security header: $1" >&2
    printf '%s\n' "$headers" >&2
    exit 1
  }
}

for name in Content-Security-Policy Strict-Transport-Security X-Content-Type-Options Referrer-Policy X-Frame-Options; do
  require_header "$name"
done
printf '%s\n' "$headers" | grep -Eiq '^X-Content-Type-Options:[[:space:]]*nosniff$'
printf '%s\n' "$headers" | grep -Eiq '^X-Frame-Options:[[:space:]]*DENY$'
printf '%s\n' "$headers" | grep -Eiq '^Referrer-Policy:[[:space:]]*no-referrer$'
printf '%s\n' "$headers" | grep -Eiq '^Content-Security-Policy:.*style-src-attr '\''none'\'''
if printf '%s\n' "$headers" | grep -Fqi "unsafe-inline"; then
  echo "CSP must not contain unsafe-inline" >&2
  exit 1
fi
echo "security headers passed"
