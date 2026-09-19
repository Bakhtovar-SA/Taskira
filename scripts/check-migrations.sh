#!/usr/bin/env bash
set -Eeuo pipefail

BASE_REF="${1:-}"
HEAD_REF="${2:-HEAD}"
[ -n "$BASE_REF" ] || {
  echo "Usage: $0 BASE_REF [HEAD_REF]" >&2
  exit 2
}

git rev-parse --verify "$BASE_REF^{commit}" >/dev/null 2>&1 || {
  echo "ERROR: migration policy base ref is unavailable: $BASE_REF" >&2
  exit 2
}
git rev-parse --verify "$HEAD_REF^{commit}" >/dev/null 2>&1 || {
  echo "ERROR: migration policy head ref is unavailable: $HEAD_REF" >&2
  exit 2
}

failed=0

# Applied migration files are an immutable audit trail. A file newly added in
# the current change remains status A relative to the base and may be edited
# freely until merge; anything already present at the base must not change.
immutable_changes="$(git diff --name-status --diff-filter=MDR "$BASE_REF" "$HEAD_REF" -- 'server/migrations/*.sql')"
if [ -n "$immutable_changes" ]; then
  echo "ERROR: existing migrations cannot be modified, deleted, or renamed:" >&2
  printf '%s\n' "$immutable_changes" >&2
  failed=1
fi

while IFS=$'\t' read -r status file; do
  [ -n "$file" ] || continue

  if [ "$status" = "A" ]; then
    name="${file##*/}"
    if ! [[ "$name" =~ ^[0-9]{8}T[0-9]{4}_[a-z0-9_]+\.sql$ ]]; then
      echo "ERROR: new migration must use YYYYMMDDTHHMM_name.sql: $file" >&2
      failed=1
    fi
  fi

  sql="$(git show "$HEAD_REF:$file")"
  if printf '%s\n' "$sql" | perl -0777 -ne '
      for my $statement (split /;/) {
        if ($statement =~ /\bDROP\s+COLUMN\b|\bDROP\s+TABLE\b|\bALTER\b.*\bTYPE\b/is) {
          exit 0;
        }
      }
      exit 1;
    '
  then
    if ! printf '%s\n' "$sql" | tr -d '\r' | grep -Eq '^-- contract-phase: подтверждено, добавлено в релизе .+$'; then
      echo "ERROR: destructive migration lacks the contract-phase marker: $file" >&2
      echo "Add: -- contract-phase: подтверждено, добавлено в релизе X" >&2
      failed=1
    fi
  fi
done < <(git diff --name-status --diff-filter=A "$BASE_REF" "$HEAD_REF" -- 'server/migrations/*.sql')

exit "$failed"
