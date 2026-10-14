#!/usr/bin/env bash
set -Eeuo pipefail

# NUL-delimited paths preserve spaces/newlines and deletion/rename source paths.
ci_changes_paths() {
  local path known
  server=false client=false ops=false upgrade=false docs_only=true
  while IFS= read -r -d '' path; do
    [ -n "$path" ] || continue
    # Shared code, build tooling, package changes and CI can affect every suite.
    case "$path" in
      .github/*|scripts/*|shared/*|package*.json)
        ci_changes_all
        continue
        ;;
      docs/*|*.md)
        # Markdown inside src can be imported by the application.
        case "$path" in src/*) ;; *) continue ;; esac
        ;;
    esac
    known=false
    case "$path" in
      server/*|fixtures/*|src/permissions*.ts|src/validation.ts)
        server=true; known=true ;;
    esac
    case "$path" in
      src/*|public/*|e2e/*|index.html|vite.config.*|vitest.config.*|playwright.config.*|tsconfig*.json|tailwind.config.*|postcss.config.*|server/src/*)
        client=true; known=true ;;
    esac
    case "$path" in
      Dockerfile*|*/Dockerfile*|.dockerignore|*/.dockerignore|docker-compose*.yml|*/docker-compose*.yml|compose*.yml|*/compose*.yml|deploy/*|nginx.conf|server/migrations/*|server/package*.json)
        ops=true; known=true ;;
    esac
    # Preserve the previous offline-upgrade scope, including client-only changes.
    case "$path" in
      server/src/*|src/*|public/*|fixtures/db-snapshots/*|index.html|vite.config.*|tsconfig*.json|server/tsconfig*.json|tailwind.config.*|postcss.config.*)
        upgrade=true; known=true ;;
    esac
    # A new file category must never silently bypass testing.
    if [ "$known" = false ]; then ci_changes_all; fi
  done
  if [ "$ops" = true ]; then upgrade=true; fi
  if [ "$server" = true ] || [ "$client" = true ] || [ "$ops" = true ] || [ "$upgrade" = true ]; then
    docs_only=false
  fi
}

ci_changes_all() {
  server=true client=true ops=true upgrade=true docs_only=false
}

ci_changes_emit() {
  printf 'server=%s\nclient=%s\nops=%s\nupgrade=%s\ndocs_only=%s\n' \
    "$server" "$client" "$ops" "$upgrade" "$docs_only"
}

ci_changes_main() {
  local event="${1:-${GITHUB_EVENT_NAME:-}}" paths
  if [ "$event" != pull_request ]; then
    ci_changes_all
  else
    paths="$(mktemp)"
    # The checkout is refs/pull/N/merge: its first parent is the actual main
    # used for this run, unlike the potentially stale event base SHA.
    if git diff --name-only --no-renames -z HEAD^1 HEAD > "$paths"; then
      ci_changes_paths < "$paths"
    else
      echo 'Cannot determine changed paths; running every suite.' >&2
      ci_changes_all
    fi
    rm -f -- "$paths"
  fi
  ci_changes_emit
  if [ -n "${GITHUB_OUTPUT:-}" ]; then ci_changes_emit >> "$GITHUB_OUTPUT"; fi
}

if [[ "${BASH_SOURCE[0]}" = "$0" ]]; then ci_changes_main "$@"; fi
