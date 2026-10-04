# INT-13 — `ops_runs`, отчёт бэкапа, регулярная репетиция восстановления `restore-drill.sh`

**Трек:** [L](../tracks/TRACK-L-INTEGRATIONS.md) · **ADR:** 0031 · **Зависит от:** — · **Блокирует:** INT-14

## Цель

Каждый бэкап и каждая репетиция восстановления оставляют в БД запись об итоге. Репетицию можно поставить на
еженедельный таймер: она проверяет архив в изолированном стеке и ничего не отправляет наружу.

## Файлы

Создать:
- `server/migrations/<YYYYMMDDTHHMM>_ops_runs.sql` — SQL из трека L §3.4. Первая строка комментария:
  `-- Отчёты операций хоста: бэкап и репетиция восстановления.`
- `scripts/ops-report.sh` — функции записи в `ops_runs`.
- `scripts/restore-drill.sh`.
- `deploy/systemd/taskira-restore-drill.service`, `deploy/systemd/taskira-restore-drill.timer` (примеры).

Изменить:
- `scripts/backup.sh` — запись начала и итога.
- `scripts/restore.sh` — опция `--storage-driver local` (п. 4).
- `scripts/build-release.sh` — включить `restore-drill.sh`, `ops-report.sh` и примеры systemd в архив релиза (там
  же, где `backup.sh`).
- `scripts/test-backup-restore-integration.sh` — после бэкапа запустить `restore-drill.sh` и проверить записи.
- `server/test/helpers.ts` — `ops_runs` в список `TRUNCATE` (у таблицы нет FK, каскад её не очистит).
- `server/src/services/maintenance.ts` — хранить 200 последних строк `ops_runs` на `kind`.
- `docs/OPERATIONS.md` — раздел «Регулярная репетиция восстановления» вместо одноразового описания от 19.09.2026
  (старый абзац сохранить как историю в конце раздела).

## Задание

### 1. `ops-report.sh`

Подключается из `backup.sh` и `restore-drill.sh` после `ops_init`.

```bash
ops_run_start KIND            # печатает id или пусто, если таблицы нет (предупреждение в stderr)
ops_run_finish ID RESULT DETAILS_JSON ERROR_TEXT   # RESULT: success|failure; пустой ID — ничего не делать
```

- Запись через `compose exec -T postgres psql -At -v ON_ERROR_STOP=1 -v kind=… -U "$POSTGRES_USER" -d "$POSTGRES_DB"`
  с SQL на **stdin** (heredoc): переменные `:'kind'` подставляются только при чтении из stdin, не через `-c`. Никакой
  подстановки значений в текст SQL.
- `to_regclass('ops_runs') IS NULL` → предупреждение «схема старше — отчёт не записан» и пустой id.
- `ERROR_TEXT` обрезается до 2 000 символов. Из него вырезаются строки, похожие на секреты: та же функция
  редактирования, что в `support-bundle.sh` — вынести её в `operations-common.sh`.
- `host` = `hostname`, `archive` = `basename`, `app_version` = `current_version`.

### 2. `backup.sh`

- В начале `OPS_RUN_ID=$(ops_run_start backup)`.
- `trap` на ошибку: `ops_run_finish "$OPS_RUN_ID" failure '{}' "<последняя ошибка>"`.
- В конце `success` с `details = {"bytes": <размер>, "durationSec": …, "storageDriver": …}`.
- Запись в `ops_runs` идёт, пока `server` остановлен — PostgreSQL доступен. Сбой записи отчёта **не** роняет бэкап:
  предупреждение и код 0, если сам бэкап успешен.

### 3. `restore-drill.sh`

```
./restore-drill.sh --install-dir DIR (--archive FILE | --backup-dir DIR) [--keep-on-failure] [--engine docker|podman]
```

Последовательность (каждый шаг с понятным сообщением; любой провал → `failure` в `ops_runs` **рабочей** БД и код 1):
1. `ops_init "$INSTALL_DIR"` (рабочая установка), `OPS_RUN_ID=$(ops_run_start restore_drill)`.
2. Архив: явный или самый новый `taskira-*.tar.gz` в `--backup-dir`. Свободное место в `TMPDIR` и в хранилище
   образов ≥ 3 × размер архива, иначе `failure: insufficient_space`.
3. Каталог `DRILL_DIR=$(mktemp -d)`:
   - копии `docker-compose.yml`, `VERSION`, `IMAGES.txt`, `MIGRATIONS.txt`, скриптов операций;
   - `.env` строится заново, а не копируется. Несекретные поля — через `write_public_env`. Секреты новые случайные
     (`JWT_SECRET`, `POSTGRES_PASSWORD` — `openssl rand -hex 24`, `ADMIN_PASSWORD` по политике паролей);
   - `COMPOSE_PROJECT_NAME=taskira-drill-<ts>`;
   - **выключено всё исходящее**: `NOTIFY_EMAIL_ENABLED=false`, `NOTIFY_WORKER_ENABLED=false`,
     `WEBHOOKS_ENABLED=false`, `RECURRING_ENABLED=false`, `DUE_REMINDER_ENABLED=false`, `MAINTENANCE_ENABLED=false`,
     `AUTH_MODE=local`, без `LDAP_*`, `SMTP_*`, `S3_*`; `STORAGE_DRIVER=local`;
   - `TASKIRA_NETWORK_CIDR` — свободная подсеть, отличная от рабочей.
4. `drill.override.yml`: у `client` нет опубликованных портов (`ports: !reset []`; если движок не поддерживает
   `!reset` — привязка к `127.0.0.1` на свободный порт), сеть compose `internal: true`.
   `restore.sh --install-dir "$DRILL_DIR" --archive … --yes --storage-driver local`. Новая опция `restore.sh`
   импортирует хранилище из архива в local-том независимо от `storage_driver` в манифесте. **Рабочий бакет S3
   драйвер никогда не трогает** — это проверка теста.
5. Проверки внутри стека, через `compose exec -T server node -e …` (наружу порты не открыты):
   - `/ready` → 200;
   - временный администратор `drill-<ts>` вставлен SQL-ом с bcrypt-хешем, полученным
     `compose exec -T server node -e "…bcryptjs.hashSync…"`; `POST /api/auth/login` → 200, `GET /api/projects` → 200;
   - число строк `projects` и `issues` в БД стенда равно числам из `manifest.json` архива. Для этого `backup.sh`
     (раздел 2 этого тикета) дописывает в манифест `"counts": {"projects": N, "issues": N}` — `count(*)` перед
     дампом, пока `server` остановлен. Архив без `counts` (старый) — проверка пропускается с пометкой в `details`;
   - одно случайное вложение скачивается через API и совпадает по SHA-256 с файлом из архива.
6. `trap EXIT`: `compose down -v` проекта стенда и `rm -rf "$DRILL_DIR"`. При `--keep-on-failure` и провале стенд
   остаётся, команда очистки печатается.
7. `ops_run_finish … success '{"archive":…, "durationSec":…, "projects":N, "issues":N, "checks":["ready","login","counts","attachment"]}'`.

### 4. Таймер

Пример `taskira-restore-drill.timer`: `OnCalendar=Sun *-*-* 03:30:00`, `Persistent=true`. `.service`:
`Type=oneshot`, `ExecStart=/opt/taskira/current/restore-drill.sh --install-dir /opt/taskira/current --backup-dir /var/backups/taskira`.
В `docs/OPERATIONS.md` — systemd и cron. Мониторинг кода возврата
(`OnFailure=` или проверка `systemctl status`) и метрика `taskira_ops_last_success_timestamp_seconds` (INT-14).

## Тесты

`scripts/test-backup-restore-integration.sh` (CI-джоба `backup, destroy volumes, and restore`), после существующего
сценария:
- в `ops_runs` есть `backup/success` с `details.bytes > 0`;
- `restore-drill.sh --archive …` → код 0, в `ops_runs` рабочей установки `restore_drill/success`;
- после прогона нет контейнеров, томов и сетей с именем `taskira-drill-` (`docker ps -a`, `docker volume ls`,
  `docker network ls`);
- во время прогона приёмник на хосте (`nc -l` на порту, адрес которого прописан в рабочем `.env` как SMTP-хост) не
  получил ни одного соединения;
- испорченный архив (обрезанный файл) → код 1, `restore_drill/failure`, стенд удалён;
- `backup.sh` на установке, где миграция `ops_runs` не применена, — бэкап успешен, в выводе предупреждение.

`server/test`: нет новых тестов, кроме того, что `resetDb()` очищает `ops_runs`.

## Критерии приёмки

- CI-джоба `backup, destroy volumes, and restore` зелёная с новыми шагами.
- `bash scripts/test-release-scripts.sh` — зелёно (скрипты в архиве релиза).
- `cd server && npm test` — зелёно; `bash scripts/check-migrations.sh` — зелёно.

## Не входит

Экран (INT-15), API (INT-14). Письма о провале. Репетиция для S3-архивов в S3: всегда local-стенд.

## Риски и откат

- Репетиция с ошибкой изоляции может разослать письма или вебхуки из прошлого. Защиты — выключенные флаги и
  `internal`-сеть; обе проверяет тест.
- Нехватка места на хосте — проверка до начала.
- Откат — revert. Таблица `ops_runs` остаётся, скрипты старой версии её не пишут.
