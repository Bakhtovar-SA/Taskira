# Linux-раннер CI за корпоративной проверкой HTTPS

Контейнерные jobs ревью и браузерных тестов и проверки образов используют Linux-раннер
(`self-hosted`, `Linux`, `docker`). Метка `docker` назначается только после успешной проверки
`docker version` под пользователем раннера; в WSL для этого дистрибутива должна быть включена
Docker Desktop WSL integration. Для двух раннеров настроены отдельные метки `taskira-a` (`linux`)
и `taskira-b` (`ubuntu`). Ручной workflow `runner readiness` проверяет оба: права аккаунта на
Docker socket, запуск контейнера, доступ к отдельным workspace/tool cache, TLS и Git.
Метка `docker` добавляется после успешной проверки, включая подготовку CA bundle на каждом хосте.
GitHub распределяет jobs между свободными раннерами с этой меткой. Проверки образов сериализованы
через `taskira-image-security`, поскольку используют фиксированные имена контейнеров и порты.
`queue: max` сохраняет несколько ожидающих проверок в очереди: новая проверка другого PR
не отменяет предыдущую ([правила очереди GitHub](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)).
Браузерные tests и ревью могут идти параллельно с ними и друг с другом.
Скрипты обновления и репетиции восстановления учитывают Docker Desktop: если путь хранилища
движка недоступен в WSL, свободное место проверяется внутри уже загруженного образа PostgreSQL.
Образ не скачивается, контейнер не получает сеть или host mounts; проверка объёма не пропускается.

Все jobs во всех workflow выполняются на собственных Linux-раннерах; `ubuntu-latest` не используется.
Перед checkout каждый host job восстанавливает владельца root-owned файлов только в своём
`GITHUB_WORKSPACE`. Контейнерные actions пишут туда от root; на файловой системе Linux это иначе
мешает следующему host job обновить `.git/FETCH_HEAD` и очистить рабочие файлы. Подготовка запускает
изолированный контейнер без сети и с read-only root filesystem; меняются только root-owned файлы
в bind mount checkout, симлинки не разыменовываются. Другие каталоги ПК и права доступа не меняются.
В конце каждого контейнерного job отдельный шаг с `always()` также возвращает владельца root-owned
файлов в `/__w/_actions`: composite action ревью устанавливает зависимости прямо в кеш Actions.
Каталог кеша принадлежит пользователю раннера; его UID/GID берутся из самого каталога, симлинки
не разыменовываются. Уже накопленные файлы на `linux` мешают даже `Set up job`, до любых шагов:
один раз под пользователем `bakhtovar` в WSL исправьте только этот кеш:

```bash
sudo chown -hRP --from=0 -- "$(id -u):$(id -g)" /home/bakhtovar/actions-runner/Taskira/_actions
```

Путь соответствует текущей рабочей папке раннера `linux`. Для другого расположения возьмите
точный каталог `_actions` из журнала ошибки; не применяйте команду ко всему домашнему каталогу.
Тестовые jobs на хосте вызывают общий action `.github/actions/prepare-test-runner`: он обновляет CA bundle,
передаёт его Node/npm/Git/curl и проверяет общие утилиты до установки зависимостей. Jobs с PostgreSQL
выбирают клиентские инструменты 16 из `/usr/lib/postgresql/16/bin`; сервер PostgreSQL 16 запускается только
в контейнере job. Сервис получает отдельный свободный порт, который передаётся тестам через `GITHUB_ENV`.

На каждом из двух раннеров нужны `jq`, Python 3, curl, Git, OpenSSL, iproute2, Docker Compose и
`postgresql-client-16`. Node 22 устанавливается через `actions/setup-node`. PostgreSQL-сервер на хосте
не требуется. Для Ubuntu 22.04/24.04/26.04 клиент 16 доступен в
[официальном репозитории PostgreSQL](https://www.postgresql.org/download/linux/ubuntu/):

```bash
sudo apt update
sudo apt install -y jq postgresql-common
sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh
sudo apt update && sudo apt install -y postgresql-client-16
```

`runner readiness` показывает отсутствующие утилиты и проверяет Compose на каждом хосте. Если версия
клиента отличается или инструменты отсутствуют, тестовые jobs завершаются с явной диагностикой,
а не используют случайную версию PostgreSQL из `PATH`.

В восьми host jobs отключено удалённое кеширование npm в `actions/setup-node`
(`package-manager-cache: false`). Постоянный npm-кеш пользователя раннера используется между
запусками; `npm ci` продолжает устанавливать зависимости по lock-файлу. На `linux` 07.10.2026
сохранение удалённого кеша после успешного серверного набора заняло 3 минуты 11 секунд
(job 112744327367), всё это время раннер не мог взять следующее задание. Контейнерный job UI
сохраняет удалённый кеш, поскольку его домашняя папка временная. Кеш установки самого Node
в tool cache раннера не меняется.

Версии среды закреплены: Node 22 Debian Bookworm и Playwright 1.56.1 Ubuntu Noble.
Windows-раннер не выбирается этими метками.

## Docker Desktop credential helper в WSL

Проверка `docker info` и запуск уже загруженного образа могут проходить, хотя загрузка образов
падает с `docker-credential-desktop.exe: exec format error`. Это обнаружено на `ubuntu` 07.10.2026:
процесс раннера не мог запустить Windows credential helper. `runner readiness` отдельно загружает
Node, Playwright и PostgreSQL тем же Docker CLI, которым GitHub запускает контейнеры заданий.

Для публичных образов CI можно выделить отдельный Docker config без Windows credential helper.
Личный `~/.docker/config.json` остаётся прежним. В папке раннера, содержащей `.runner` и `run.sh`,
под тем же пользователем выполните:

```bash
(
  set -e
  test -f .runner && test -f run.sh
  mkdir -p "$HOME/.config/taskira-runner/docker"
  chmod 700 "$HOME/.config/taskira-runner/docker"
  test -f "$HOME/.config/taskira-runner/docker/config.json" || printf '{}\n' > "$HOME/.config/taskira-runner/docker/config.json"
  docker --config "$HOME/.config/taskira-runner/docker" pull node:22-bookworm
  touch .env
  cp -p .env ".env.before-docker-fix.$(date +%s)"
  sed -i '/^DOCKER_CONFIG=/d' .env
  printf 'DOCKER_CONFIG=%s\n' "$HOME/.config/taskira-runner/docker" >> .env
)
```

После успешной загрузки перезапустите процесс или службу раннера и повторите `runner readiness`.
Переменная должна находиться в `.env` самого раннера: GitHub запускает Docker для job/service
контейнеров до шагов workflow. Обычный шаг с `export DOCKER_CONFIG` не исправляет этот этап.
Для отката восстановите сохранённую `.env` и перезапустите раннер.
Источники: [Docker: каталог CLI config](https://docs.docker.com/reference/cli/docker/#change-the-docker-directory),
[GitHub runner: загрузка переменных из .env](https://github.com/actions/runner/blob/main/src/Runner.Listener/Program.cs).

При проверке HTTPS корпоративным прокси сертификат сервера выпускается корпоративным CA.
Windows, Linux и контейнеры имеют отдельные хранилища доверия. 06.10.2026 диагностика Linux CI
для npm и GitHub OIDC показала издателя `InfoWatch Transparent Proxy Root` и ошибки проверки цепочки.

## Доверенное хранилище на ПК раннера

Получите согласованный IT корневой сертификат InfoWatch в PEM-формате (`.crt`). На Windows он находится
в `certlm.msc` → «Доверенные корневые центры сертификации» → «Сертификаты»;
экспорт «Base-64 encoded X.509» содержит публичный сертификат. Сверьте отпечаток с данными IT.
Перенесите файл локально в Linux/WSL, где работает раннер, и выполните:

```bash
openssl x509 -in ~/infowatch-root.crt -noout -subject -issuer -fingerprint -sha256
sudo install -m 0644 ~/infowatch-root.crt /usr/local/share/ca-certificates/infowatch-root.crt
sudo update-ca-certificates
curl --fail --silent --show-error --head https://registry.npmjs.org/
```

Jobs ревью и браузерных тестов сначала выполняют `prepare-runner-trust` непосредственно в Linux/WSL.
Job безопасности также готовит bundle на хосте до запуска npm/Trivy и передаёт переменные доверия
в следующие шаги, включая сохранение кеша после проверок.
Скрипт `.github/scripts/prepare-runner-trust.sh` копирует системный CA bundle в локальный tool cache раннера.
В WSL он также читает из доверенных корневых хранилищ Windows (`LocalMachine/Root`, `CurrentUser/Root`)
действующие самоподписанные CA с точным именем `InfoWatch Transparent Proxy Root` и добавляет их
публичные сертификаты в этот локальный файл. Windows interop должен быть доступен пользователю раннера.
Глобальные хранилища Windows/WSL и политика выполнения PowerShell не изменяются.

GitHub Actions уже передаёт tool cache в контейнер как `/__w/_tool`; подготовленный bundle доступен
по пути `/__w/_tool/taskira-trust/ca-certificates.crt`. Это устраняет неоднозначность абсолютного
пути `/etc/ssl` при Docker Desktop: Docker-daemon может иметь своё хранилище, отличное от WSL раннера.
Node/Bun/npm используют `NODE_EXTRA_CA_CERTS`, Git — `GIT_SSL_CAINFO`, curl — `CURL_CA_BUNDLE`,
OpenSSL — `SSL_CERT_FILE`. Проверка TLS остаётся включённой.
Сертификат хранится на ПК раннера и не добавляется в репозиторий, GitHub secrets, artifacts или логи.

Перед ревью отдельная проверка запускается в Node и Bun внутри контейнера. Она выводит только число CA,
наличие InfoWatch, SHA256 bundle и результат TLS к npm/GitHub OIDC. В запросах нет токена или заголовка
авторизации; используется только корень адреса, без параметров OIDC. Одного успешного curl в WSL
недостаточно, чтобы подтвердить доверие среды ревью.

После checkout ревью проверяет Git отдельно в Node, Bun и Bun Shell. В контейнере
добавляется только текущий `GITHUB_WORKSPACE` в `safe.directory`: временный HOME checkout
может не передавать эту настройку последующим action. Wildcard-доверие всем репозиториям
не используется; ошибка контекста обнаруживается до получения токена приложения.

Если Windows interop отключён или корень InfoWatch отсутствует в доверенном Windows Root,
скрипт использует Linux bundle. В этом случае установите согласованный сертификат в WSL по инструкции
выше. Если проверка продолжает падать, сопоставьте SHA256 bundle в host/container jobs и проверьте,
что сертификат установлен именно в дистрибутиве WSL, где работает раннер.

Для Docker Desktop включите WSL integration для дистрибутива раннера. Если TLS не проходит при
загрузке образов, настройте доверие CA в самом Docker согласно инструкции ниже.
После завершения текущих jobs перезапустите Linux-раннер и повторите упавшие проверки GitHub Actions.
При смене корпоративного CA обновляйте доверенное хранилище на этом хосте.

## Кеш сканера безопасности

Trivy использует постоянный каталог `${RUNNER_TOOL_CACHE}/taskira-trivy` на self-hosted раннере.
Удалённое кеширование action выключено: 07.10.2026 упаковка DB-кеша через tar/gzip в `/mnt/d`
задержала завершение job на 13 минут. Проверка обновлений базы Trivy и High/Critical сохраняется;
вторая проверка использует установленный первой проверкой бинарник. Кеш можно удалить локально,
следующий запуск загрузит базу заново. Он не содержит данных приложения.

Все метки в `runs-on: [self-hosted, Linux, docker]` должны присутствовать у раннера. `ubuntu-latest` выбирает
GitHub-hosted среду только как отдельное значение; добавление его в этот список требует одноимённую
метку на self-hosted раннере и не переключает его на Ubuntu.

Источники: [Docker: доверенные CA хоста и контейнеров](https://docs.docker.com/engine/network/ca-certs/),
[GitHub: прокси для self-hosted runners](https://docs.github.com/en/actions/how-tos/manage-runners/use-proxy-servers),
[Microsoft: Certificate provider](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.security/about/about_certificate_provider),
[Microsoft: запуск Windows-инструментов из WSL](https://learn.microsoft.com/en-us/windows/wsl/filesystems#run-windows-tools-from-linux).
