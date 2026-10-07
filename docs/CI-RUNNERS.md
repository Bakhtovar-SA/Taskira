# Linux-раннер CI за корпоративной проверкой HTTPS

Контейнерные jobs ревью и браузерных тестов используют Linux-раннер (`self-hosted`, `Linux`).
Версии среды закреплены: Node 22 Debian Bookworm и Playwright 1.56.1 Ubuntu Noble.
Windows-раннер не выбирается этими метками.

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

Если Windows interop отключён или корень InfoWatch отсутствует в доверенном Windows Root,
скрипт использует Linux bundle. В этом случае установите согласованный сертификат в WSL по инструкции
выше. Если проверка продолжает падать, сопоставьте SHA256 bundle в host/container jobs и проверьте,
что сертификат установлен именно в дистрибутиве WSL, где работает раннер.

Для Docker Desktop включите WSL integration для дистрибутива раннера. Если TLS не проходит при
загрузке образов, настройте доверие CA в самом Docker согласно инструкции ниже.
После завершения текущих jobs перезапустите Linux-раннер и повторите упавшие проверки GitHub Actions.
При смене корпоративного CA обновляйте доверенное хранилище на этом хосте.

Все метки в `runs-on: [self-hosted, Linux]` должны присутствовать у раннера. `ubuntu-latest` выбирает
GitHub-hosted среду только как отдельное значение; добавление его в этот список требует одноимённую
метку на self-hosted раннере и не переключает его на Ubuntu.

Источники: [Docker: доверенные CA хоста и контейнеров](https://docs.docker.com/engine/network/ca-certs/),
[GitHub: прокси для self-hosted runners](https://docs.github.com/en/actions/how-tos/manage-runners/use-proxy-servers),
[Microsoft: Certificate provider](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.security/about/about_certificate_provider),
[Microsoft: запуск Windows-инструментов из WSL](https://learn.microsoft.com/en-us/windows/wsl/filesystems#run-windows-tools-from-linux).
