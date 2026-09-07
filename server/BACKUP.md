# BACKUP — резервное копирование PostgreSQL

Автоматический снимок БД `pg_dump` с проверкой целостности и ротацией.
Скрипты: `server/scripts/backup.sh` (Linux/macOS) и `server/scripts/backup.ps1`
(Windows). Конфиг — `server/scripts/backup.env` (в `.gitignore`).

## Что делает скрипт

1. `pg_dump --format=custom --no-owner --no-privileges` → `BACKUP_DIR/taskira_<дата>_<время>.dump`
2. Проверяет снимок: `pg_restore --list` (ловит обрезанный/битый файл).
3. По понедельникам кладёт копию в `BACKUP_DIR/weekly/`.
4. Ротация: удаляет ежедневные старше `RETENTION_DAYS` (14), еженедельные старше
   `WEEKLY_RETENTION_DAYS` (56).
5. Логирует каждый шаг; ненулевой exit при любой ошибке (чтобы cron/Task
   Scheduler это увидел).

## Настройка

```bash
cd server/scripts
cp backup.env.example backup.env
# заполнить DATABASE_URL и (на сервере) BACKUP_DIR — каталог вне репозитория,
# на отдельном томе. Пути PGDUMP/PGRESTORE — если утилиты не в PATH.
```

Проверить вручную:

```bash
bash server/scripts/backup.sh          # Linux/macOS
pwsh server/scripts/backup.ps1         # Windows
```

## Расписание

### Linux — systemd timer (рекомендуется, логи в journald)

`/etc/systemd/system/taskira-backup.service`:

```ini
[Unit]
Description=Taskira PostgreSQL backup

[Service]
Type=oneshot
User=taskira
ExecStart=/opt/taskira/server/scripts/backup.sh
```

`/etc/systemd/system/taskira-backup.timer`:

```ini
[Unit]
Description=Taskira backup daily 02:00

[Timer]
OnCalendar=*-*-* 02:00:00
Persistent=true

[Install]
WantedBy=timers.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now taskira-backup.timer
systemctl list-timers taskira-backup.timer        # проверить следующий запуск
journalctl -u taskira-backup.service --since today # логи
```

### Linux — cron (альтернатива)

```cron
0 2 * * *  /opt/taskira/server/scripts/backup.sh >> /var/log/taskira-backup.log 2>&1
```

### Windows — Task Scheduler

```powershell
schtasks /create /tn "Taskira Backup" ^
  /tr "powershell -NoProfile -ExecutionPolicy Bypass -File C:\taskira\server\scripts\backup.ps1" ^
  /sc daily /st 02:00 /ru SYSTEM
```

Логи: перенаправьте вывод в файл в самой задаче или смотрите в журнале задач.

## Восстановление

```bash
# Полное восстановление в существующую БД (снесёт текущие объекты):
pg_restore --clean --if-exists --no-owner --no-privileges \
  --dbname="postgresql://taskira:taskira@HOST:5432/taskira" \
  taskira_2026-09-07_020000.dump

# Или в свежую БД:
createdb -O taskira taskira_restored
pg_restore --no-owner --no-privileges -d taskira_restored taskira_....dump
```

## Проверяйте бэкапы

Раз в месяц: восстановите последний снимок в тест-БД и убедитесь, что
приложение стартует и `SELECT count(*)` по ключевым таблицам осмысленный.
Непроверенный бэкап — не бэкап.

## Копия вне сервера

Снимки на том же диске защищают только от логических ошибок, не от отказа
диска/машины/шифровальщика. После локального `backup.sh` копируйте `BACKUP_DIR`
на другой хост или в объектное хранилище — `rsync`/`scp`/`rclone` отдельным
шагом cron/таймера. Это вне скрипта намеренно (зависит от инфраструктуры).
