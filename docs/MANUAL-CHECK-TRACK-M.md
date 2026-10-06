# Ручная проверка трека M

## OPS-PODMAN-01. Rootless Podman на целевой ОС

Эту проверку нельзя выполнить в разработческой среде и в CI: нужна чистая машина
с реальной ОС клиента. Поля «Вывод» намеренно пустые — заполняются фактическим
выводом команд при прогоне, ничего не дописывается «по ожиданию». Если шаг не
выполнялся, оставьте пункт неотмеченным и напишите причину.

Что уже проверено автоматически (не заменяет этот список):
`scripts/test-release-scripts.sh` (предпроверки rootless на подставных `podman` и
sysctl-фикстурах) и CI-job `rootless Podman install, health and upgrade`
(Ubuntu, Podman, `podman-compose`: `install.sh` → health → `upgrade.sh` → `backup.sh`).
CI **не** покрывает: SELinux enforcing, RHEL/Astra/РЕД ОС, reboot, `loginctl
enable-linger`, порты ниже 1024, офлайн-режим без сети.

### Стенд

| Поле | Значение |
|---|---|
| Дата | 2026-10-06 (прогон 14:22–14:47 +05:00) |
| ОС и версия (`cat /etc/os-release`) | Rocky Linux 10.2 (Red Quartz) — EL10, не EL9; VM в VMware |
| Ядро (`uname -r`) | 6.12.0-211.16.1.el10_2.0.1.x86_64 |
| `podman --version` | podman version 5.8.2 |
| Compose provider и версия (`podman compose version`) | external provider `/home/test/.local/bin/podman-compose`, podman-compose version 1.6.0 (pip, не rpm) |
| SELinux (`getenforce`) | Enforcing |
| Пользователь (не root, обычный, вход по ssh/консоли) | `test`, uid=1000, группа wheel, вход по ssh |
| Релиз Taskira | `1.0.1-check.1` — собран на этой же VM `build-release.sh` из `claude/m-ops-podman-01` @ 6ea0b5c; для шага 5 — `1.0.1-check.2` из 5739558 (podman-01 + исправление healthcheck + слияние `claude/m-ops-upg-combined`) |

### 0. Предусловия

```bash
id; sysctl user.max_user_namespaces net.ipv4.ip_unprivileged_port_start
grep "^$(id -un):" /etc/subuid /etc/subgid
podman info --format 'rootless={{.Host.Security.Rootless}} graphroot={{.Store.GraphRoot}}'
```

Ожидается: `user.max_user_namespaces` > 0; строки в `/etc/subuid` и `/etc/subgid`;
`rootless=true`.

Вывод:

```
uid=1000(test) gid=1000(test) группы=1000(test),10(wheel) контекст=unconfined_u:unconfined_r:unconfined_t:s0-s0:c0.c1023
user.max_user_namespaces = 30340
net.ipv4.ip_unprivileged_port_start = 1024
/etc/subuid:test:524288:65536
/etc/subgid:test:524288:65536
rootless=true graphroot=/home/test/.local/share/containers/storage
```

### 1. Установка (README_INSTALL, разделы 2–4)

```bash
sha256sum -c taskira-<версия>.tar.gz.sha256 && tar -xzf taskira-<версия>.tar.gz && cd taskira-<версия>
./install.sh --engine podman
# заполнить .env (CLIENT_PORT=8081, CORS_ORIGIN=http://<адрес>:8081)
./install.sh --engine podman --start
```

Ожидается: строка `Rootless Podman detected`, загрузка трёх образов, `Taskira <версия>
is healthy`, `compose ps` — три контейнера `healthy`.

- [ ] Выполнено, результат соответствует ожиданию — **нет**: `client` остался `unhealthy`
  (исправлено в 9ff5a7b, см. ниже; после исправления проверено в шаге 5 на `1.0.1-check.2`)

Вывод (строки `./<файл>: ЦЕЛ` и `Copying blob` сокращены):

```
taskira-1.0.1-check.1.tar.gz: ЦЕЛ
$ ./install.sh --engine podman
[1/4] Verifying release checksums
[2/4] Detecting container engine
Using podman
Rootless Podman detected (user test)
[3/4] Loading offline images
Loaded image: localhost/taskira-postgres:1.0.1-check.1
Loaded image: localhost/taskira-client:1.0.1-check.1
Loaded image: localhost/taskira-server:1.0.1-check.1
Created /home/test/taskira-check/install/taskira-1.0.1-check.1/.env
[4/4] Images loaded. Edit .../.env, then run:
      ./install.sh --engine podman --start

# с пустыми секретами (первая попытка заполнить .env не записала значения):
[4/4] Starting Taskira
ERROR: POSTGRES_PASSWORD is empty in .env

$ ./install.sh --engine podman --start
[4/4] Starting Taskira
taskira-101-check1_postgres_1
taskira-101-check1_server_1
taskira-101-check1_client_1
Taskira 1.0.1-check.1 is healthy: {"ok":true,"db":true,"checks":{"db":true,"migrations":true,"storage":true},"version":"1.0.1-check.1","ts":"2026-10-06T09:33:41.249Z"}
Taskira was started. Open http://192.168.141.132:8081

# через ~5 минут:
taskira-101-check1_postgres_1 Up 6 minutes (healthy)
taskira-101-check1_server_1 Up 5 minutes (healthy)
taskira-101-check1_client_1 Up 5 minutes (unhealthy)
$ podman inspect taskira-101-check1_client_1 --format '{{json .State.Health}}'
{"Status":"unhealthy","FailingStreak":32,"Log":[...{"ExitCode":1,"Output":"wget: can't connect to remote host: Connection refused\n"}]}
$ podman exec taskira-101-check1_client_1 cat /etc/hosts
127.0.0.1	localhost localhost.localdomain localhost4 ...
::1	localhost localhost.localdomain localhost6 ...
$ podman exec ... netstat -tln
tcp        0      0 0.0.0.0:80              0.0.0.0:*               LISTEN
$ podman exec ... wget -q -O /dev/null http://127.0.0.1/   -> exit=0
$ podman exec ... wget -q -O /dev/null http://localhost/   -> wget: can't connect to remote host: Connection refused
$ curl http://127.0.0.1:8081/ (с хоста)                   -> 200
```

Причина: Podman пишет в `/etc/hosts` контейнера `::1 localhost`, busybox `wget` идёт по IPv6,
а nginx клиента слушает только IPv4 (`default.conf` свой, entrypoint IPv6 не включает).
Сайт работает, но healthcheck вечно падает. `install.sh` этого не замечает: ждёт только
health сервера. Исправление: healthcheck клиента на `http://127.0.0.1/healthz`
(`scripts/render-compose.sh`, `docker-compose.yml`, проверка в `test-release-scripts.sh`).

### 2. Права на тома, UID mapping, SELinux

```bash
podman volume ls
podman volume inspect $(podman volume ls -q | grep -E 'pgdata|attachments')
ls -ldZ ~/.local/share/containers/storage/volumes/*/_data
podman compose --env-file .env -f docker-compose.yml exec -T server id
podman compose --env-file .env -f docker-compose.yml exec -T server ls -ld /app/var/attachments
sudo ausearch -m avc -ts recent --input-logs   # при getenforce = Enforcing; без --input-logs висит, если stdin не tty
```

Ожидается: тома созданы; владелец `_data` — субпользователь из `/etc/subuid`
(не root и не вы); `server` работает как `node`; `/app/var/attachments` принадлежит
`node`; новых AVC-отказов нет.

- [x] Выполнено, результат соответствует ожиданию

Вывод:

```
$ podman volume ls
DRIVER      VOLUME NAME
local       taskira-101-check1_pgdata
local       taskira-101-check1_attachments
$ podman volume inspect ...   (сокращено)
"Name": "taskira-101-check1_pgdata",      "Mountpoint": "/home/test/.local/share/containers/storage/volumes/taskira-101-check1_pgdata/_data"
"Name": "taskira-101-check1_attachments", "Mountpoint": ".../taskira-101-check1_attachments/_data", "UID": 1000, "GID": 1000
$ ls -ldZ ~/.local/share/containers/storage/volumes/*/_data   (с -n)
drwxr-xr-x.  2 525287 525287 system_u:object_r:container_file_t:s0    6 ... taskira-101-check1_attachments/_data
drwx------. 19 524357 524357 system_u:object_r:container_file_t:s0 4096 ... taskira-101-check1_pgdata/_data
$ podman compose ... exec -T server id
uid=1000(node) gid=1000(node) groups=1000(node)
$ podman compose ... exec -T server ls -ld /app/var/attachments
drwxr-xr-x    2 node     node             6 Oct  6 09:24 /app/var/attachments
$ sudo ausearch -m avc -ts recent --input-logs
<no matches>
```

Заметка: без tty (ssh с командой, скрипт) `sudo ausearch -m avc -ts recent` ждёт данные из
stdin и висит — нужен `--input-logs`. Владельцы `_data`: 525287 = 524288+999 (subuid для
uid 1000 `node`), 524357 = 524288+69 (uid 70 `postgres`) — субпользователи, не root и не `test`.

### 3. Загрузка файла в задачу (запись в том `attachments`)

Войти администратором, создать задачу, прикрепить файл, скачать его и сравнить.

Ожидается: загрузка и скачивание успешны, содержимое совпало.

- [x] Выполнено, результат соответствует ожиданию

Вывод/заметки (через HTTP API тем же путём, что и браузер, `http://127.0.0.1:8081`):

```
POST /api/auth/login -> 200
logged in as: admin admin
GET /api/projects -> 200
project id: 41dbeb71-730e-4c1c-8071-6c47992b1372
POST issues -> 201
issue: CORP-1 id=631cdb83-588e-4b54-ab44-c713562376ff
# первая попытка с upload.bin:
POST attachments -> 400  {"error":{"code":"ATTACHMENT_REJECTED","reason":"Файлы с расширением .bin загружать нельзя"}}
# повтор с upload.txt (150 000 случайных байт в base64):
upload.txt sha256: 1e3482df5836520cfb1b39688636e5a4fb48bcb16497c99786254a9298292e59
POST attachments -> 201
attachment id=7413b84a-0093-4db8-8288-760f246b603a byteSize=202632
GET attachment -> 200
download.txt sha256: 1e3482df5836520cfb1b39688636e5a4fb48bcb16497c99786254a9298292e59
MATCH: downloaded content equals uploaded
-rw-r--r--. 1 525287 525287 system_u:object_r:container_file_t:s0 202632 ... attachments/_data/631cdb83-.../743c5102-...
```

### 4. Резервная копия и восстановление (проверка `:z` под SELinux)

```bash
./backup.sh --install-dir "$PWD" --engine podman --output /tmp/taskira-check.tar.gz
tar -tzf /tmp/taskira-check.tar.gz | head
./restore.sh --install-dir "$PWD" --engine podman --archive /tmp/taskira-check.tar.gz --yes
curl -f http://127.0.0.1:8081/api/health
```

Ожидается: без `permission denied` при монтировании временного каталога
(основной риск под Enforcing); после восстановления health возвращает версию, вложение
из шага 3 скачивается.

- [x] Выполнено, результат соответствует ожиданию

Вывод:

```
$ ./backup.sh --install-dir "$PWD" --engine podman --output /tmp/taskira-check.tar.gz
Stopping application writes for a consistent backup...
Creating PostgreSQL dump...
Exporting attachment storage...
[config] файл .env не найден — используются только системные переменные окружения
Exported 1 storage objects (local).
Taskira 1.0.1-check.1 is healthy: {"ok":true,...,"version":"1.0.1-check.1",...}
Backup complete: /tmp/taskira-check.tar.gz
$ tar -tzf /tmp/taskira-check.tar.gz | head
./
./storage/
./storage/objects/
./storage/objects/00000000.bin
./storage/objects.json
./database.dump
./schema-migrations.txt
./env.public
./manifest.json
./SHA256SUMS
-rw-------. 1 test test 177931 окт  6 14:41 /tmp/taskira-check.tar.gz
$ ./restore.sh --install-dir "$PWD" --engine podman --archive /tmp/taskira-check.tar.gz --yes
Verified 1 storage objects.
Stopping Taskira and restoring backup...
ALTER DATABASE
ALTER DATABASE
Imported 1 storage objects into local.
Taskira 1.0.1-check.1 is healthy: {...}
Restore complete from: /tmp/taskira-check.tar.gz
$ curl -f http://127.0.0.1:8081/api/health
{"ok":true,"db":true,"checks":{"db":true,"migrations":true,"storage":true},"version":"1.0.1-check.1","ts":"2026-10-06T09:42:32.222Z"}
$ sudo ausearch -m avc -ts recent --input-logs
<no matches>
# вложение из шага 3 после восстановления:
GET attachment 7413b84a-0093-4db8-8288-760f246b603a -> 200
MATCH: attachment intact (sha256 1e3482df…)
```

Заметка: строка `[config] файл .env не найден` идёт из одноразового контейнера сервера при
экспорте/импорте хранилища — безвредна, но пугает в выводе.

### 5. Обновление и откат

Распаковать следующий релиз рядом и выполнить:

```bash
./upgrade.sh --install-dir <каталог текущей установки> --engine podman --dry-run
./upgrade.sh --install-dir <каталог текущей установки> --engine podman
./upgrade.sh --install-dir <каталог текущей установки> --engine podman --rollback <backups/…>
```

Ожидается: dry-run ничего не меняет; обновление заканчивается `Upgrade complete`;
откат — `Rollback complete`; проверка свободного места в `GraphRoot` не падает.

- [x] Выполнено, результат соответствует ожиданию

Вывод (`1.0.1-check.1` -> `1.0.1-check.2`, `upgrade.sh` из релиза 2, т. е. с `claude/m-ops-upg-combined`):

```
$ ./upgrade.sh --install-dir .../taskira-1.0.1-check.1 --engine podman --dry-run
Taskira 1.0.1-check.1 is healthy: {...,"version":"1.0.1-check.1",...}
Upgrade plan: Taskira 1.0.1-check.1 -> 1.0.1-check.2
Database: taskira (10411031 bytes); install filesystem free: 26103892 KiB
Container storage: /home/test/.local/share/containers/storage; free: 26103892 KiB
Pending migrations: none
Dry run complete: no files, images, containers, or database contents were changed.
# sha256 docker-compose.yml/VERSION/.env, список контейнеров и backups/ до и после — без изменений

$ ./upgrade.sh --install-dir .../taskira-1.0.1-check.1 --engine podman
Taskira 1.0.1-check.1 is healthy: {...}
Upgrade plan: Taskira 1.0.1-check.1 -> 1.0.1-check.2
Pending migrations: none
Loaded image: localhost/taskira-postgres:1.0.1-check.2
Loaded image: localhost/taskira-client:1.0.1-check.2
Loaded image: localhost/taskira-server:1.0.1-check.2
Taskira 1.0.1-check.2 is healthy: {...,"version":"1.0.1-check.2","ts":"2026-10-06T09:45:36.031Z"}
Upgrade complete: Taskira 1.0.1-check.1 -> 1.0.1-check.2
Backup: .../taskira-1.0.1-check.1/backups/20261006T094515Z_1.0.1-check.1_to_1.0.1-check.2/database.dump
taskira-101-check1_postgres_1 localhost/taskira-postgres:1.0.1-check.2 Up 14 seconds (healthy)
taskira-101-check1_server_1 localhost/taskira-server:1.0.1-check.2 Up 11 seconds (healthy)
taskira-101-check1_client_1 localhost/taskira-client:1.0.1-check.2 Up 1 second (healthy)

$ ./upgrade.sh --install-dir .../taskira-1.0.1-check.1 --engine podman --rollback .../backups/20261006T094515Z_1.0.1-check.1_to_1.0.1-check.2
ALTER DATABASE
ALTER DATABASE
DROP DATABASE
Taskira 1.0.1-check.1 is healthy: {...,"version":"1.0.1-check.1","ts":"2026-10-06T09:46:10.905Z"}
Rollback complete. Taskira 1.0.1-check.1 and its database were restored.
GET attachment 7413b84a-0093-4db8-8288-760f246b603a -> 200
MATCH: attachment intact
$ sudo ausearch -m avc -ts recent --input-logs
<no matches>
```

Заметка: проверка «current installation health check» прошла — сбой из Docker-прогона
upgrade-теста на старом ПК здесь не воспроизвёлся. Клиент `1.0.1-check.2` стал `healthy`
сразу (исправленный healthcheck); после отката снова образ `check.1` со старым healthcheck.

### 6. Порты ниже 1024

```bash
# при ip_unprivileged_port_start=1024 (по умолчанию) и CLIENT_PORT=80
./install.sh --engine podman --start
# затем от root:
echo 'net.ipv4.ip_unprivileged_port_start=80' | sudo tee /etc/sysctl.d/99-taskira.conf && sudo sysctl --system
./install.sh --engine podman --start
```

Ожидается: первый запуск завершается сообщением `cannot publish port 80` до старта
контейнеров; после понижения порога — стек стартует и порт 80 отвечает.
(После проверки верните порог и `CLIENT_PORT`.)

- [x] Выполнено, результат соответствует ожиданию

Вывод:

```
CLIENT_PORT=80
net.ipv4.ip_unprivileged_port_start = 1024
$ ./install.sh --engine podman --start
[1/4] Verifying release checksums
[2/4] Detecting container engine
Using podman
Rootless Podman detected (user test)
ERROR: rootless Podman cannot publish port 80 (net.ipv4.ip_unprivileged_port_start=1024).
       Use CLIENT_PORT >= 1024 (and the same port in CORS_ORIGIN), put a reverse proxy on
       80, or as root: sysctl -w net.ipv4.ip_unprivileged_port_start=80 (persist in /etc/sysctl.d/).
exit=1     # контейнеры не тронуты, client по-прежнему на 0.0.0.0:8081
$ echo 'net.ipv4.ip_unprivileged_port_start=80' | sudo tee /etc/sysctl.d/99-taskira.conf && sudo sysctl --system
* Applying /etc/sysctl.d/99-taskira.conf ...
net.ipv4.ip_unprivileged_port_start = 80
$ ./install.sh --engine podman --start
[4/4] Starting Taskira
Taskira 1.0.1-check.1 is healthy: {...}
46c91dc9ad84  localhost/taskira-client:1.0.1-check.1  ...  0.0.0.0:80->80/tcp  taskira-101-check1_client_1
Taskira was started. Open http://192.168.141.132:8081
exit=0
$ curl http://127.0.0.1:80/api/health
{"ok":true,"db":true,...,"version":"1.0.1-check.1",...}
http=200
# возврат: /etc/sysctl.d/99-taskira.conf удалён, порог 1024, CLIENT_PORT=8081, client снова на 0.0.0.0:8081
```

Заметка: итоговая строка `Open http://…:8081` берётся из `CORS_ORIGIN`, а не из
`CLIENT_PORT` — при смене порта легко забыть поправить `CORS_ORIGIN`.

### 7. Автозапуск после перезагрузки (README_INSTALL, раздел 6)

```bash
sudo loginctl enable-linger "$USER"
loginctl show-user "$USER" -p Linger
# создать ~/.config/systemd/user/taskira.service из README_INSTALL (раздел 6), поправить пути
systemctl --user daemon-reload && systemctl --user enable --now taskira.service
systemctl --user status taskira.service
sudo reboot
# после перезагрузки, БЕЗ входа в систему:
curl -f http://<адрес>:8081/api/health
# затем войти по ssh:
podman ps
```

Ожидается: `Linger=yes`; после перезагрузки без входа health отвечает, три контейнера
`healthy`; PostgreSQL не получил повреждений (`podman logs` без recovery-ошибок).

Дополнительно проверить, что без юнита (только `restart: unless-stopped`) стек после
перезагрузки НЕ поднимается — это подтверждает необходимость юнита:

- [x] Автозапуск с юнитом работает — **после исправления юнита** (см. ниже)
- [x] Без юнита стек не поднимается (подтверждает документацию)
- [x] `systemctl --user enable podman-restart.service` — поведение зафиксировано (поднимает ли `unless-stopped`) — **поднимает** на Podman 5.8.2

Health после каждой перезагрузки проверялся с другой машины (Windows-хост,
`http://192.168.141.132:8081/api/health`) до входа по ssh. Перед этим пришлось открыть порт
в firewalld — без этого с другой машины таймаут (добавлено в README_INSTALL, раздел 6).

Вывод:

```
$ loginctl show-user "$USER" -p Linger
Linger=yes            # было включено на VM ещё до прогона

## Перезагрузка 1 — без юнита, podman-restart.service disabled
ls: невозможно получить доступ к '/home/test/.config/systemd/user/': Нет такого файла или каталога
podman-restart.service: disabled; taskira.service: not-found
$ sudo systemctl reboot            # 15:18:33, загрузка 15:18:42
health с Windows (3 попытки через ~2 мин): ERR Базовое соединение закрыто: Непредвиденная ошибка при приеме.
$ podman ps -a
taskira-101-check1_postgres_1 Exited (0) 2 minutes ago
taskira-101-check1_server_1 Exited (1) 2 minutes ago
taskira-101-check1_client_1 Exited (0) 2 minutes ago

## Перезагрузка 2 — только podman-restart.service
restart=unless-stopped
$ systemctl --user enable podman-restart.service
ExecStart=/usr/bin/podman $LOGGING start --all --filter should-start-on-boot=true
$ sudo systemctl reboot            # загрузка 15:21:33
health с Windows: {"ok":true,"db":true,"checks":{"db":true,"migrations":true,"storage":true},"version":"1.0.1-check.1","ts":"2026-10-06T10:23:41.960Z"}  (x3)
taskira-101-check1_postgres_1 Up 2 minutes (healthy)
taskira-101-check1_server_1 Up 2 minutes (healthy)
taskira-101-check1_client_1 Up 2 minutes (unhealthy)     # старый healthcheck образа check.1, см. шаг 1
postgres: database system was shut down at 2026-10-06 10:18:35 UTC
postgres: database system is ready to accept connections

## Юнит из README_INSTALL (раздел 6) дословно, podman-restart.service disabled
$ systemctl --user daemon-reload && systemctl --user enable --now taskira.service
Job for taskira.service failed because the control process exited with error code.
× taskira.service - Taskira (podman compose)
    Process: 4509 ExecStart=/usr/bin/podman compose --env-file .env -f docker-compose.yml up -d (code=exited, status=125)
podman[4509]:         * exec: "docker-compose": executable file not found in $PATH
podman[4509]:         * exec: "podman-compose": executable file not found in $PATH
# podman-compose установлен через pip в ~/.local/bin, которого нет в PATH systemd --user.
# В юнит добавлено: Environment=PATH=%h/.local/bin:/usr/local/bin:/usr/bin:/bin
$ systemctl --user daemon-reload && systemctl --user restart taskira.service
● taskira.service - Taskira (podman compose)
     Active: active (exited) since Tue 2026-10-06 15:24:43 +05
    Process: 4725 ExecStart=/usr/bin/podman compose ... up -d (code=exited, status=0/SUCCESS)

## Перезагрузка 3 — только taskira.service (исправленный)
$ sudo systemctl reboot            # загрузка 15:24:57
health с Windows: {"ok":true,"db":true,"checks":{"db":true,"migrations":true,"storage":true},"version":"1.0.1-check.1","ts":"2026-10-06T10:27:05.569Z"}  (x3)
taskira-101-check1_postgres_1 Up 2 minutes (healthy)
taskira-101-check1_server_1 Up 2 minutes (healthy)
taskira-101-check1_client_1 Up 2 minutes (starting)
● taskira.service - Taskira (podman compose)
     Active: active (exited) since Tue 2026-10-06 15:25:27 +05; 2min 8s ago
    Process: 1468 ExecStart=/usr/bin/podman compose --env-file .env -f docker-compose.yml up -d (code=exited, status=0/SUCCESS)
postgres: database system was shut down at 2026-10-06 10:24:50 UTC
postgres: database system is ready to accept connections
```

Recovery-ошибок PostgreSQL нет ни в одной перезагрузке: каждый раз чистое завершение.

### 8. Compose provider

Повторить шаг 1 для каждого provider, доступного в ОС (`docker-compose` v2 с
`systemctl --user enable --now podman.socket`; `podman-compose`). Отдельно
зафиксировать: (а) соблюдается ли `depends_on: condition: service_healthy` (`server` не
стартует до healthy PostgreSQL), (б) принимает ли provider `run --rm --no-deps -T -v
host:ctr:z --user 0` (используется в `backup.sh`/`restore.sh`), (в) минимально
рабочая версия provider.

| Provider | Версия | install/start | service_healthy | backup/restore | Вывод |
|---|---|---|---|---|---|
| docker-compose | v5.6.0 (бинарник с GitHub в `~/.local/bin`, sha256 сверен; `podman.socket` включён) | да, 3× healthy | соблюдается: postgres healthy 15:35:10, server start 15:35:11 | да | ниже |
| podman-compose | 1.6.0 (pip `--user`) | да, 3× healthy | соблюдается: postgres healthy 15:38:02, server start 15:38:03 | да | ниже |
| podman-compose | 1.0.6 (pip в venv, для проверки утверждения README) | да | **не соблюдается**: server start 15:39:23, postgres healthy 15:39:27 | да | ниже |

Каждый provider: чистая установка релиза `1.0.1-check.2` в отдельный каталог (`PODMAN_COMPOSE_PROVIDER=…`),
backup → restore → `down -v`. Основной стек `check.1` на это время остановлен (`systemctl --user stop taskira.service`).
(б) `run --rm --no-deps -T -v host:ctr:z --user 0` — принимают все три (через `backup.sh`/`restore.sh`).
(в) минимально рабочая версия: 1.6.0 работает, 1.0.6 — нет (не ждёт healthy); версии между ними не проверялись,
граница «1.1 и новее» в README остаётся непроверенной.

```
=== provider docker-compose-5.6.0: /home/test/.local/bin/docker-compose
Docker Compose version v5.6.0
$ ./install.sh --engine podman --start
 Container taskira-101-check2-client-1 Started
Taskira 1.0.1-check.2 is healthy: {...,"version":"1.0.1-check.2","ts":"2026-10-06T10:35:22.436Z"}
taskira-101-check2-postgres-1 Up 37 seconds (healthy)
taskira-101-check2-server-1 Up 31 seconds (healthy)
taskira-101-check2-client-1 Up 20 seconds (healthy)
volumes: taskira-101-check2_attachments, taskira-101-check2_pgdata
postgres started: 15:35:05; health events: 15:35:05 starting, 15:35:10 healthy; server started: 15:35:11
Backup complete: /tmp/p8-docker-compose-5.6.0.tar.gz          backup exit=0
Restore complete from: /tmp/p8-docker-compose-5.6.0.tar.gz    restore exit=0

=== provider podman-compose-1.6.0: /home/test/.local/bin/podman-compose
podman-compose version 1.6.0
Taskira 1.0.1-check.2 is healthy: {...,"ts":"2026-10-06T10:38:14.507Z"}
taskira-101-check2_postgres_1 Up 38 seconds (healthy)
taskira-101-check2_server_1 Up 32 seconds (healthy)
taskira-101-check2_client_1 Up 21 seconds (healthy)
postgres started: 15:37:57; health events: 15:37:57 starting, 15:38:02 healthy; server started: 15:38:03; server restarts: 0
Backup complete / Restore complete (прогон 15:33–15:35)        exit=0 / exit=0

=== provider podman-compose-1.0.6: /home/test/pc106/bin/podman-compose
podman-compose version 1.0.6
Taskira was started. Open http://192.168.141.132:8081      exit=0
taskira-101-check2_postgres_1 Up 26 seconds (healthy)
taskira-101-check2_server_1 Up 24 seconds (starting)
taskira-101-check2_client_1 Up 23 seconds (healthy)
postgres started: 15:39:21; health events: 15:39:22 starting, 15:39:27 healthy; server started: 15:39:23; server restarts: 0
Backup complete / Restore complete (прогон 15:36–15:37)        exit=0 / exit=0
```

Попутно найдено:
- Вторая установка на том же хосте не стартует, пока существует сеть первой (даже остановленной):
  `podman network create ... --subnet 172.30.0.0/24 taskira-101-check2_default` → exit 125. Подсеть фиксирована
  по умолчанию; обход — `TASKIRA_NETWORK_CIDR` в `.env` (так и сделано для этих прогонов).
- docker-compose называет контейнеры `taskira-101-check2-postgres-1`, podman-compose — `..._postgres_1`;
  имена томов у обоих одинаковые (`taskira-101-check2_pgdata`), так что смена provider данные не теряет.

### 9. Работа без сети

Отключить сеть до шага 1 и повторить шаги 1 и 5. Ожидается: ни одна команда не
обращается к registry.

- [x] Выполнено, результат соответствует ожиданию

Как отключалась сеть: интерфейс не выключался (иначе пропал бы ssh). Вместо этого nftables
отбрасывал весь исходящий трафик, кроме `lo` и `192.168.141.0/24` (локальная сеть VM, ssh),
с `counter log`. Это эквивалент изолированного контура: registry недоступен. Перед установкой
удалены все образы taskira/postgres, кроме двух, которые `podman rmi -f` не снял
(`localhost/taskira-server:1.0.1-check.1`, `docker.io/library/postgres:16-alpine`). Установка
сделана в отдельный каталог `offline-check`, основной стек на это время остановлен.

Вывод:

```
table inet taskira_offline { chain output { type filter hook output priority filter; policy accept;
    oif "lo" accept; ip daddr 192.168.141.0/24 accept; counter packets 0 bytes 0 log prefix "TASKIRA-OFFLINE " drop } }
$ curl -m 5 https://registry-1.docker.io/v2/
curl: (28) Connection timed out after 5001 milliseconds
install/upgrade start: 15:46:41
$ ./install.sh --engine podman
[3/4] Loading offline images
Loaded image: localhost/taskira-postgres:1.0.1-check.1
Loaded image: localhost/taskira-client:1.0.1-check.1
Loaded image: localhost/taskira-server:1.0.1-check.1
$ ./install.sh --engine podman --start
offline-check_postgres_1
offline-check_server_1
offline-check_client_1
Taskira 1.0.1-check.1 is healthy: {...,"version":"1.0.1-check.1","ts":"2026-10-06T10:47:03.466Z"}
exit=0
$ ./upgrade.sh --install-dir .../p9/offline-check --engine podman
Upgrade plan: Taskira 1.0.1-check.1 -> 1.0.1-check.2
Loaded image: localhost/taskira-postgres:1.0.1-check.2
Loaded image: localhost/taskira-client:1.0.1-check.2
Loaded image: localhost/taskira-server:1.0.1-check.2
Taskira 1.0.1-check.2 is healthy: {...,"version":"1.0.1-check.2","ts":"2026-10-06T10:47:28.500Z"}
Upgrade complete: Taskira 1.0.1-check.1 -> 1.0.1-check.2
exit=0
offline-check_postgres_1 localhost/taskira-postgres:1.0.1-check.2 Up 29 seconds (healthy)
offline-check_server_1 localhost/taskira-server:1.0.1-check.2 Up 27 seconds (healthy)
offline-check_client_1 localhost/taskira-client:1.0.1-check.2 Up 15 seconds (healthy)
install/upgrade end: 15:47:43
отброшенные пакеты (время, адрес, порт):
15:46:29–15:46:33  35.171.80.220, 100.57.240.195, 44.212.230.82, 98.89.109.200, 98.86.122.62  443/TCP   <- проверочный curl выше, до начала установки
15:46:47 125.229.191.132 123/UDP;  15:46:51 142.91.108.61 123/UDP;  15:46:52 103.186.118.214 123/UDP  <- chronyd (NTP), адреса = `chronyc sources`
(других пакетов в окне 15:46:41–15:47:43 нет)
```

Первый прогон этого шага (15:41) упал, и это отдельная находка, не связанная с сетью.
Каталог назывался так же, как у основной установки (`taskira-1.0.1-check.1`). Поэтому compose
выбрал тот же проект `taskira-101-check1` и **те же тома**. Новый случайный пароль не подошёл к
существующей базе, и `upgrade.sh` остановился на `current installation health check`:

```
server-1  | [taskira] фатальная ошибка при запуске: error: password authentication failed for user "taskira"
ERROR: upgrade failed during: current installation health check
No installation changes were made; rollback is not required.
```

Имя проекта compose берёт из имени каталога, а `name:` в compose-файле не задан. Две установки
одного релиза в разных путях с одинаковым последним компонентом делят тома, и `down -v` из одной
удалит данные другой. Основная установка в этот раз не пострадала: проверено скачиванием вложения
из шага 3, sha256 совпал.

### Итог

| Вопрос | Ответ |
|---|---|
| Что не сработало | 1) healthcheck `client` под Podman: вечный `unhealthy` (localhost → `::1`, nginx слушает только IPv4). 2) Юнит из README_INSTALL падает, если podman-compose стоит через pip: `~/.local/bin` нет в PATH у `systemd --user`. 3) firewalld на Rocky закрывает `CLIENT_PORT`, а README об этом не говорил. 4) podman-compose 1.0.6 не ждёт `service_healthy` (подтверждает README). 5) Вторая установка на том же хосте: фиксированная подсеть 172.30.0.0/24 занята сетью первой, обход — `TASKIRA_NETWORK_CIDR`. 6) Одинаковое имя каталога у двух установок = общий compose-проект и общие тома. 7) `sudo ausearch` без tty висит без `--input-logs`. |
| Что исправлено в скриптах/README по итогам | 1) `render-compose.sh` + `docker-compose.yml`: healthcheck на `http://127.0.0.1/healthz`, проверка в `test-release-scripts.sh` (9ff5a7b), подтверждено на `1.0.1-check.2`. 2) README_INSTALL, раздел 6: `Environment=PATH=%h/.local/bin:…` в юните и пояснение, подтверждено перезагрузкой. 3) README_INSTALL, раздел 6: абзац про firewalld. 7) чек-лист: `--input-logs`. 5, 6) `install.sh --start` теперь делает предпроверку и останавливается до `up` в двух случаях. Первый: том `<проект>_pgdata` уже есть, но не принадлежит этому каталогу. Свой определяется по маркеру `.taskira-installed` после первого успешного старта или по метке `com.docker.compose.project.working_dir` контейнеров; намеренно взять чужие тома можно флагом `--adopt-existing-volumes`. Второй: `TASKIRA_NETWORK_CIDR` пересекается с подсетью другой сети; в ошибке указана переменная и как удалить оставшуюся сеть. Имя проекта сознательно не меняли: существующие установки потеряли бы связь со своими томами. Проверено на Rocky с настоящим Podman: каталог с тем же именем — отказ с путём владельца; другое имя и подсеть по умолчанию — отказ с именем сети; своя подсеть — старт; маркер удалён — свои контейнеры опознаны. |
| Нужны ли Quadlet-юниты (да/нет, почему) | Пока нет. Юнит с `podman compose up -d` после правки PATH пережил перезагрузку без входа, и `podman-restart.service` на Podman 5.8.2 тоже поднимает `unless-stopped`. Quadlet имеет смысл, только если отказываться от compose provider как внешней зависимости: тогда пропадают проблемы 2 и 4. |

Стенд после прогона: основная установка `check.1` работает через `taskira.service`. В firewalld
открыт порт 8081/tcp. docker-compose и `podman.socket` после шага 8 убраны, provider по умолчанию
снова podman-compose 1.6.0. Порог портов возвращён на 1024. Файл `/etc/sysctl.d/99-taskira.conf`
удалён, nft-таблица удалена.
