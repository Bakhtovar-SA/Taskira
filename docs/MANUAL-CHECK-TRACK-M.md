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
| Дата | |
| ОС и версия (`cat /etc/os-release`) | |
| Ядро (`uname -r`) | |
| `podman --version` | |
| Compose provider и версия (`podman compose version`) | |
| SELinux (`getenforce`) | |
| Пользователь (не root, обычный, вход по ssh/консоли) | |
| Релиз Taskira | |

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

- [ ] Выполнено, результат соответствует ожиданию

Вывод:

```
```

### 2. Права на тома, UID mapping, SELinux

```bash
podman volume ls
podman volume inspect $(podman volume ls -q | grep -E 'pgdata|attachments')
ls -ldZ ~/.local/share/containers/storage/volumes/*/_data
podman compose --env-file .env -f docker-compose.yml exec -T server id
podman compose --env-file .env -f docker-compose.yml exec -T server ls -ld /app/var/attachments
sudo ausearch -m avc -ts recent        # при getenforce = Enforcing
```

Ожидается: тома созданы; владелец `_data` — субпользователь из `/etc/subuid`
(не root и не вы); `server` работает как `node`; `/app/var/attachments` принадлежит
`node`; новых AVC-отказов нет.

- [ ] Выполнено, результат соответствует ожиданию

Вывод:

```
```

### 3. Загрузка файла в задачу (запись в том `attachments`)

Войти администратором, создать задачу, прикрепить файл, скачать его и сравнить.

Ожидается: загрузка и скачивание успешны, содержимое совпало.

- [ ] Выполнено, результат соответствует ожиданию

Вывод/заметки:

```
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

- [ ] Выполнено, результат соответствует ожиданию

Вывод:

```
```

### 5. Обновление и откат

Распаковать следующий релиз рядом и выполнить:

```bash
./upgrade.sh --install-dir <каталог текущей установки> --engine podman --dry-run
./upgrade.sh --install-dir <каталог текущей установки> --engine podman
./upgrade.sh --install-dir <каталог текущей установки> --engine podman --rollback <backups/…>
```

Ожидается: dry-run ничего не меняет; обновление заканчивается `Upgrade complete`;
откат — `Rollback complete`; проверка свободного места в `GraphRoot` не падает.

- [ ] Выполнено, результат соответствует ожиданию

Вывод:

```
```

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

- [ ] Выполнено, результат соответствует ожиданию

Вывод:

```
```

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
