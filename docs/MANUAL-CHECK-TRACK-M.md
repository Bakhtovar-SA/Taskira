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

- [ ] Автозапуск с юнитом работает
- [ ] Без юнита стек не поднимается (подтверждает документацию)
- [ ] `systemctl --user enable podman-restart.service` — поведение зафиксировано (поднимает ли `unless-stopped`)

Вывод:

```
```

### 8. Compose provider

Повторить шаг 1 для каждого provider, доступного в ОС (`docker-compose` v2 с
`systemctl --user enable --now podman.socket`; `podman-compose`). Отдельно
зафиксировать: (а) соблюдается ли `depends_on: condition: service_healthy` (`server` не
стартует до healthy PostgreSQL), (б) принимает ли provider `run --rm --no-deps -T -v
host:ctr:z --user 0` (используется в `backup.sh`/`restore.sh`), (в) минимально
рабочая версия provider.

| Provider | Версия | install/start | service_healthy | backup/restore | Вывод |
|---|---|---|---|---|---|
| docker-compose | | | | | |
| podman-compose | | | | | |

### 9. Работа без сети

Отключить сеть до шага 1 и повторить шаги 1 и 5. Ожидается: ни одна команда не
обращается к registry.

- [ ] Выполнено, результат соответствует ожиданию

Вывод:

```
```

### Итог

| Вопрос | Ответ |
|---|---|
| Что не сработало | |
| Что исправлено в скриптах/README по итогам | |
| Нужны ли Quadlet-юниты (да/нет, почему) | |
