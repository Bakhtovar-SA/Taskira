#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
source "$SCRIPT_DIR/ci-changes.sh"

expect_paths() {
  local label="$1" expected="$2"
  shift 2
  ci_changes_paths < <(printf '%s\0' "$@")
  local actual="$server $client $ops $upgrade $docs_only"
  if [ "$actual" != "$expected" ]; then
    printf 'CI path selection failed (%s): expected [%s], got [%s]\n' "$label" "$expected" "$actual" >&2
    exit 1
  fi
}

expect_paths docs 'false false false false true' docs/design/MOTION.md README.md server/README.md
expect_paths empty 'false false false false true'
expect_paths client 'false true false true false' src/components/Board.tsx
expect_paths permissions 'true true false true false' src/permissions.ts
expect_paths validation 'true true false true false' src/validation.ts
expect_paths server-tests 'true false false false false' server/test/permissions-sync.test.ts
expect_paths server-source 'true true false true false' server/src/templates/builtin.json
expect_paths snapshots 'true false false true false' fixtures/db-snapshots/v1.sql
expect_paths migrations 'true false true true false' server/migrations/20261014_example.sql
expect_paths nested-compose 'true false true true false' server/docker-compose.storage.yml
expect_paths deployment 'false false true true false' deploy/systemd/taskira.service
expect_paths e2e 'false true false false false' e2e/board-layout.pw.ts
expect_paths styles 'false true false true false' tailwind.config.js
expect_paths public 'false true false true false' public/theme-init.js
expect_paths scripts 'true true true true false' scripts/check-motion.mjs
expect_paths packages 'true true true true false' package-lock.json
expect_paths shared 'true true true true false' shared/permissions.matrix.json
expect_paths workflow 'true true true true false' .github/workflows/test.yml
expect_paths action 'true true true true false' .github/actions/prepare-test-runner/action.yml
expect_paths unknown 'true true true true false' new-build-input.toml
expect_paths newline 'false true false true false' $'src/a file\nwith newline.ts'
expect_paths mixed 'true true false true false' docs/guide.md src/permissions.matrix.ts

TMP_ROOT="$(CDPATH= cd -- "${TMPDIR:-${TMP:-${TEMP:-/tmp}}}" && pwd -P)"
TMP_DIR="$(mktemp -d "$TMP_ROOT/taskira-ci-changes.XXXXXXXX")"
TMP_DIR="$(CDPATH= cd -- "$TMP_DIR" && pwd -P)"
cleanup() {
  # Verify the resolved absolute target before recursive removal, including Windows.
  case "$TMP_DIR" in
    "$TMP_ROOT"/taskira-ci-changes.*) rm -rf -- "$TMP_DIR" ;;
    *) echo "Refusing to remove an unexpected temporary path: $TMP_DIR" >&2; return 1 ;;
  esac
}
trap cleanup EXIT INT TERM
export GIT_AUTHOR_NAME='CI Path Test' GIT_AUTHOR_EMAIL='ci-paths@example.invalid'
export GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME" GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"
# Prevent an ambient Actions output file from being touched by the self-test.
unset GITHUB_OUTPUT

git -C "$TMP_DIR" init -q -b main
git -C "$TMP_DIR" config core.autocrlf false
mkdir -p "$TMP_DIR/src" "$TMP_DIR/docs"
printf 'baseline\n' > "$TMP_DIR/README.md"
git -C "$TMP_DIR" add .
git -C "$TMP_DIR" commit -qm baseline
BASE="$(git -C "$TMP_DIR" rev-parse HEAD)"
git -C "$TMP_DIR" checkout -qb document-pr
printf 'docs only\n' > "$TMP_DIR/docs/guide.md"
git -C "$TMP_DIR" add .
git -C "$TMP_DIR" commit -qm docs
git -C "$TMP_DIR" checkout -q main
printf 'main advanced\n' > "$TMP_DIR/src/app.ts"
git -C "$TMP_DIR" add .
git -C "$TMP_DIR" commit -qm advanced-main
git -C "$TMP_DIR" merge -q --no-ff document-pr -m merge-pr
# This is the original bug: diffing the event base also sees another PR's src.
git -C "$TMP_DIR" diff --name-only "$BASE"...HEAD | grep -Fx src/app.ts >/dev/null
expected=$'server=false\nclient=false\nops=false\nupgrade=false\ndocs_only=true'
actual="$(cd "$TMP_DIR" && bash "$SCRIPT_DIR/ci-changes.sh" pull_request)"
[ "$actual" = "$expected" ] || { echo 'merge-parent regression: unrelated main changes selected suites' >&2; exit 1; }

# Moving source code to docs must test the deleted old source path too.
git -C "$TMP_DIR" mv src/app.ts docs/app.md
git -C "$TMP_DIR" commit -qm rename-source
expected=$'server=false\nclient=true\nops=false\nupgrade=true\ndocs_only=false'
actual="$(cd "$TMP_DIR" && bash "$SCRIPT_DIR/ci-changes.sh" pull_request)"
[ "$actual" = "$expected" ] || { echo 'rename did not include the old source path' >&2; exit 1; }

expected=$'server=true\nclient=true\nops=true\nupgrade=true\ndocs_only=false'
actual="$(cd "$TMP_DIR" && bash "$SCRIPT_DIR/ci-changes.sh" push)"
[ "$actual" = "$expected" ] || { echo 'push did not select every suite' >&2; exit 1; }
# A missing parent (e.g. an incorrect shallow checkout) must fail open.
git -C "$TMP_DIR" checkout -q "$BASE"
actual="$(cd "$TMP_DIR" && bash "$SCRIPT_DIR/ci-changes.sh" pull_request 2>/dev/null)"
[ "$actual" = "$expected" ] || { echo 'missing parent did not select every suite' >&2; exit 1; }

# Verify that Actions output and stdout describe the same selection.
output="$TMP_DIR/outputs"
actual="$(cd "$TMP_DIR" && GITHUB_OUTPUT="$output" bash "$SCRIPT_DIR/ci-changes.sh" push)"
[ "$(cat "$output")" = "$actual" ] || { echo 'Actions outputs differ from stdout' >&2; exit 1; }
echo 'CI path selection checks passed (22 path cases, merge parent, rename, push, missing parent, outputs)'
