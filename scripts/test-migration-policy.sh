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

cat > "$TMP_DIR/server/migrations/20260919T1210_concurrent_index.sql" <<'SQL'
CREATE INDEX CONCURRENTLY idx_probe ON issues (id);
SQL
git -C "$TMP_DIR" add server/migrations/20260919T1210_concurrent_index.sql
git -C "$TMP_DIR" commit -qm unsafe-concurrent
UNSAFE_CONCURRENT_SHA="$(git -C "$TMP_DIR" rev-parse HEAD)"
if (cd "$TMP_DIR" && "$ROOT_DIR/scripts/check-migrations.sh" "$SAFE_SHA" "$UNSAFE_CONCURRENT_SHA" >/dev/null 2>&1); then
  echo "migration policy accepted CREATE INDEX CONCURRENTLY without transaction/recovery markers" >&2
  exit 1
fi

cat > "$TMP_DIR/server/migrations/20260919T1210_concurrent_index.sql" <<'SQL'
-- migration-transaction: none
-- recovery: DROP INDEX CONCURRENTLY IF EXISTS idx_probe; then rerun migrations.
CREATE INDEX CONCURRENTLY idx_probe ON issues (id);
SQL
git -C "$TMP_DIR" add server/migrations/20260919T1210_concurrent_index.sql
git -C "$TMP_DIR" commit -qm safe-concurrent
SAFE_CONCURRENT_SHA="$(git -C "$TMP_DIR" rev-parse HEAD)"
(cd "$TMP_DIR" && "$ROOT_DIR/scripts/check-migrations.sh" "$SAFE_SHA" "$SAFE_CONCURRENT_SHA")

# --- расширение политики (PERF-05): пробелы, найденные мутационной проверкой ---
commit_file() { # имя, содержимое из stdin
  cat > "$TMP_DIR/server/migrations/$1"
  git -C "$TMP_DIR" add "server/migrations/$1"
  git -C "$TMP_DIR" commit -qm "$1"
  git -C "$TMP_DIR" rev-parse HEAD
}
expect_reject() { # сообщение, base, head
  if (cd "$TMP_DIR" && "$ROOT_DIR/scripts/check-migrations.sh" "$2" "$3" >/dev/null 2>&1); then
    echo "migration policy accepted: $1" >&2
    exit 1
  fi
}

CUR="$SAFE_CONCURRENT_SHA"

# RENAME запрещён MIGRATIONS.md, но раньше не проверялся
RENAME_SHA="$(printf 'ALTER TABLE issues RENAME COLUMN title TO name;\n' | commit_file 20260919T1220_rename.sql)"
expect_reject "RENAME COLUMN without contract marker" "$CUR" "$RENAME_SHA"
TRUNC_SHA="$(printf 'TRUNCATE audit_log;\n' | commit_file 20260919T1221_truncate.sql)"
expect_reject "TRUNCATE without contract marker" "$RENAME_SHA" "$TRUNC_SHA"

# Новая миграция не может идти по имени раньше уже выпущенной
OLD_SHA="$(printf 'SELECT 1;\n' | commit_file 20260101T0000_too_old.sql)"
expect_reject "migration sorting before an already released one" "$TRUNC_SHA" "$OLD_SHA"

# CREATE INDEX CONCURRENTLY: две команды в одном файле падают в раннере
MULTI_SHA="$(printf -- '-- migration-transaction: none\n-- recovery: DROP INDEX CONCURRENTLY IF EXISTS a; DROP INDEX CONCURRENTLY IF EXISTS b;\nCREATE INDEX CONCURRENTLY a ON issues (id);\nCREATE INDEX CONCURRENTLY b ON issues (id);\n' | commit_file 20260919T1230_two_indexes.sql)"
expect_reject "two CONCURRENTLY statements in one file" "$OLD_SHA" "$MULTI_SHA"

# Комментарий с «DROP TABLE»/«CREATE INDEX CONCURRENTLY» не требует ни маркеров, ни recovery
git -C "$TMP_DIR" reset -q --hard "$CUR"
COMMENT_SHA="$(printf -- '-- раньше здесь был DROP TABLE legacy; и CREATE INDEX CONCURRENTLY, теперь нет\nALTER TABLE issues ADD COLUMN IF NOT EXISTS note text;\n' | commit_file 20260919T1240_comment_only.sql)"
(cd "$TMP_DIR" && "$ROOT_DIR/scripts/check-migrations.sh" "$CUR" "$COMMENT_SHA")

# RENAME с маркером фазы contract допустим
git -C "$TMP_DIR" reset -q --hard "$CUR"
RENAME_OK_SHA="$(printf -- '-- contract-phase: подтверждено, добавлено в релизе 1.8.0\nALTER TABLE issues RENAME COLUMN title TO name;\n' | commit_file 20260919T1250_rename_ok.sql)"
(cd "$TMP_DIR" && "$ROOT_DIR/scripts/check-migrations.sh" "$CUR" "$RENAME_OK_SHA")

# A column called type in an additive CHECK is not ALTER COLUMN ... TYPE.
git -C "$TMP_DIR" reset -q --hard "$CUR"
CHECK_TYPE_SHA="$(printf -- "ALTER TABLE notifications DROP CONSTRAINT notifications_type_check;\nALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN ('issue.assigned', 'issue.dueSoon'));\n" | commit_file 20260919T1300_notification_check.sql)"
(cd "$TMP_DIR" && "$ROOT_DIR/scripts/check-migrations.sh" "$CUR" "$CHECK_TYPE_SHA")
ADD_TYPE_SHA="$(printf 'ALTER TABLE probes ADD COLUMN type text;\n' | commit_file 20260919T1310_add_type_column.sql)"
(cd "$TMP_DIR" && "$ROOT_DIR/scripts/check-migrations.sh" "$CHECK_TYPE_SHA" "$ADD_TYPE_SHA")
ALTER_COLUMN_SHA="$(printf 'ALTER TABLE issues ALTER COLUMN priority_id TYPE text;\n' | commit_file 20260919T1320_change_type.sql)"
expect_reject "ALTER COLUMN TYPE without contract marker" "$ADD_TYPE_SHA" "$ALTER_COLUMN_SHA"
SET_TYPE_SHA="$(printf 'ALTER TABLE issues ALTER COLUMN "priority_id" SET DATA TYPE text;\n' | commit_file 20260919T1330_set_type.sql)"
expect_reject "quoted SET DATA TYPE without contract marker" "$ALTER_COLUMN_SHA" "$SET_TYPE_SHA"
OMITTED_COLUMN_SHA="$(printf 'ALTER TABLE issues ALTER priority_id TYPE text;\n' | commit_file 20260919T1340_implicit_column.sql)"
expect_reject "ALTER TYPE with optional COLUMN omitted" "$SET_TYPE_SHA" "$OMITTED_COLUMN_SHA"
ALTER_TYPE_SHA="$(printf 'ALTER TYPE priority ADD ATTRIBUTE note text;\n' | commit_file 20260919T1350_alter_type.sql)"
expect_reject "ALTER TYPE without contract marker" "$OMITTED_COLUMN_SHA" "$ALTER_TYPE_SHA"

SYMBOL_COLUMN_SHA="$(printf 'ALTER TABLE issues ALTER COLUMN priority$id TYPE text;\n' | commit_file 20260919T1360_symbol_column.sql)"
expect_reject "identifier containing dollar without contract marker" "$ALTER_TYPE_SHA" "$SYMBOL_COLUMN_SHA"

echo "migration policy checks passed"
