#!/usr/bin/env bash
#
# Taskira — снимок PostgreSQL с проверкой целостности и ротацией.
# Настройка расписания и восстановление — см. server/BACKUP.md.
#
# Конфиг: server/scripts/backup.env (см. backup.env.example) либо переменные
# окружения. Обязателен DATABASE_URL. Для прода вместо пароля в URL используйте
# ~/.pgpass или PGPASSFILE.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Парсим KEY=VALUE построчно (не source): не ломается на пробелах в путях,
# не выполняет содержимое файла. Не перезаписываем уже заданные переменные.
if [ -f "$SCRIPT_DIR/backup.env" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in '' | \#*) continue ;; esac
    key="${line%%=*}"
    key="${key// /}"
    [ "$key" = "$line" ] && continue
    val="${line#*=}"
    val="${val#"${val%%[![:space:]]*}"}" # ltrim
    val="${val%\"}" && val="${val#\"}"
    val="${val%\'}" && val="${val#\'}"
    [ -z "${!key:-}" ] && export "$key=$val"
  done < "$SCRIPT_DIR/backup.env"
fi

: "${DATABASE_URL:?DATABASE_URL не задан (backup.env или окружение)}"
BACKUP_DIR="${BACKUP_DIR:-$SCRIPT_DIR/../../backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
WEEKLY_RETENTION_DAYS="${WEEKLY_RETENTION_DAYS:-56}" # ~8 недель
PGDUMP="${PGDUMP:-pg_dump}"
PGRESTORE="${PGRESTORE:-pg_restore}"

log() { echo "[$(date '+%F %T')] $*"; }
fail() {
  log "ОШИБКА: $*"
  exit 1
}

{ [ -x "$PGDUMP" ] || command -v "$PGDUMP" >/dev/null 2>&1; } || fail "$PGDUMP не найден (задайте PGDUMP в backup.env)"
{ [ -x "$PGRESTORE" ] || command -v "$PGRESTORE" >/dev/null 2>&1; } || fail "$PGRESTORE не найден (задайте PGRESTORE в backup.env)"

ts="$(date +%Y-%m-%d_%H%M%S)"
mkdir -p "$BACKUP_DIR" "$BACKUP_DIR/weekly"
file="$BACKUP_DIR/taskira_${ts}.dump"

log "pg_dump → $file"
# -Fc: custom-формат (сжат, pg_restore с выборочным восстановлением).
# --no-owner/--no-privileges: восстановление под другой ролью проходит чисто.
if ! "$PGDUMP" --dbname="$DATABASE_URL" --format=custom --no-owner --no-privileges --file="$file"; then
  rm -f "$file"
  fail "pg_dump завершился с ошибкой"
fi

log "проверка целостности: pg_restore --list"
"$PGRESTORE" --list "$file" >/dev/null || fail "снимок повреждён (pg_restore --list не читает его)"

size="$(du -h "$file" | cut -f1)"
log "снимок ок: $file ($size)"

# Еженедельная копия по понедельникам (date +%u: 1 = Пн)
if [ "$(date +%u)" = "1" ]; then
  cp "$file" "$BACKUP_DIR/weekly/taskira_${ts}.dump"
  log "еженедельная копия: weekly/taskira_${ts}.dump"
fi

# Ротация: удаляем снимки старше срока хранения
d_daily="$(find "$BACKUP_DIR" -maxdepth 1 -name 'taskira_*.dump' -mtime "+$RETENTION_DAYS" -print -delete | wc -l | tr -d ' ')"
d_weekly="$(find "$BACKUP_DIR/weekly" -maxdepth 1 -name 'taskira_*.dump' -mtime "+$WEEKLY_RETENTION_DAYS" -print -delete | wc -l | tr -d ' ')"
log "ротация: удалено ежедневных $d_daily, еженедельных $d_weekly"

log "готово"
