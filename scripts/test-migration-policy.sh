#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
cleanup() { rm -rf -- "$TMP_DIR"; }
trap cleanup EXIT INT TERM

git -C "$TMP_DIR" init -q
git -C "$TMP_DIR" config user.name "Migration Policy Test"
git -C "$TMP_DIR" config user.email "migration-policy@example.invalid"
mkdir -p "$TMP_DIR/server/migrations"
printf 'baseline\n' > "$TMP_DIR/README.md"
git -C "$TMP_DIR" add README.md
git -C "$TMP_DIR" commit -qm baseline
BASE_SHA="$(git -C "$TMP_DIR" rev-parse HEAD)"

cat > "$TMP_DIR/server/migrations/20260919T1200_drop_legacy.sql" <<'SQL'
ALTER TABLE issues DROP COLUMN legacy_value;
SQL
git -C "$TMP_DIR" add server/migrations/20260919T1200_drop_legacy.sql
git -C "$TMP_DIR" commit -qm unsafe
UNSAFE_SHA="$(git -C "$TMP_DIR" rev-parse HEAD)"
if (cd "$TMP_DIR" && "$ROOT_DIR/scripts/check-migrations.sh" "$BASE_SHA" "$UNSAFE_SHA" >/dev/null 2>&1); then
  echo "migration policy accepted DROP COLUMN without a contract marker" >&2
  exit 1
fi

cat > "$TMP_DIR/server/migrations/20260919T1200_drop_legacy.sql" <<'SQL'
-- contract-phase: подтверждено, добавлено в релизе 1.8.0
ALTER TABLE issues DROP COLUMN legacy_value;
SQL
git -C "$TMP_DIR" add server/migrations/20260919T1200_drop_legacy.sql
git -C "$TMP_DIR" commit -qm safe-contract
SAFE_SHA="$(git -C "$TMP_DIR" rev-parse HEAD)"
(cd "$TMP_DIR" && "$ROOT_DIR/scripts/check-migrations.sh" "$BASE_SHA" "$SAFE_SHA")

echo "migration policy checks passed"
