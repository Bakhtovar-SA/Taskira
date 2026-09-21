#!/usr/bin/env bash
set -Eeuo pipefail
export LC_ALL=C

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

# Раннер применяет непримённые файлы в порядке имён. Новая миграция с именем
# «раньше» уже выпущенной на свежей установке выполнилась бы до неё, а на
# обновлённой — после: схемы разъезжаются. Поэтому новый файл обязан идти
# по имени после всех, что есть в базовом коммите.
latest_base_name="$(git ls-tree -r --name-only "$BASE_REF" -- server/migrations | grep -E '\.sql$' | sed 's|.*/||' | LC_ALL=C sort | tail -n 1 || true)"

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
    if [ -n "$latest_base_name" ] && [[ "$name" < "$latest_base_name" ]]; then
      echo "ERROR: new migration sorts before already released $latest_base_name: $file" >&2
      echo "Rename it so it sorts after every migration in the base commit." >&2
      failed=1
    fi
  fi

  sql="$(git show "$HEAD_REF:$file")"
  # Комментарии не участвуют в поиске опасных операций: слова DROP/TYPE в
  # пояснении не должны требовать маркера, а маркер ищется в исходном тексте.
  code="$(printf '%s\n' "$sql" | perl -0777 -pe 's/--[^\n]*//g')"
  if printf '%s\n' "$code" | grep -Eiq '\bCREATE[[:space:]]+INDEX[[:space:]]+CONCURRENTLY\b'; then
    first_line="$(printf '%s\n' "$sql" | tr -d '\r' | head -n 1)"
    if [ "$first_line" != "-- migration-transaction: none" ]; then
      echo "ERROR: CREATE INDEX CONCURRENTLY requires -- migration-transaction: none as the first line: $file" >&2
      failed=1
    fi
    if ! printf '%s\n' "$sql" | tr -d '\r' | grep -Eq '^-- recovery: .+$'; then
      echo "ERROR: non-transactional migration lacks an exact -- recovery: command: $file" >&2
      failed=1
    fi
  fi

  # Несколько команд в одном запросе PostgreSQL выполняет в неявной транзакции,
  # где CREATE INDEX CONCURRENTLY невозможен: миграция упала бы при первом
  # применении. Один нетранзакционный файл — одна команда.
  if [ "$(printf '%s\n' "$sql" | tr -d '\r' | head -n 1)" = "-- migration-transaction: none" ]; then
    statements="$(printf '%s\n' "$code" | perl -0777 -ne 'my $n = () = grep { /\S/ } split /;/; print $n;')"
    if [ "$statements" != "1" ]; then
      echo "ERROR: non-transactional migration must contain exactly one statement (found $statements): $file" >&2
      failed=1
    fi
  fi

  if printf '%s\n' "$code" | perl -0777 -ne '
      for my $statement (split /;/) {
        if ($statement =~ /\bDROP\s+COLUMN\b|\bDROP\s+TABLE\b|\bALTER\b.*\bTYPE\b|\bRENAME\b|\bTRUNCATE\b/is) {
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
