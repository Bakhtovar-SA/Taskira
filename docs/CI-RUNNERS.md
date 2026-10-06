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

В workflows файл `/etc/ssl/certs/ca-certificates.crt` хоста монтируется только для чтения в
`/opt/taskira-runner-ca.pem` контейнера. Node/Bun/npm используют `NODE_EXTRA_CA_CERTS`, Git —
`GIT_SSL_CAINFO`, curl — `CURL_CA_BUNDLE`, OpenSSL — `SSL_CERT_FILE`. Проверка TLS остаётся включённой.
Сертификат хранится на ПК раннера и не добавляется в репозиторий, GitHub secrets или логи.

Проверьте доступность того же файла для Docker-daemon и доверие внутри контейнера:

```bash
docker run --rm --pull never \
  -v /etc/ssl/certs/ca-certificates.crt:/opt/taskira-runner-ca.pem:ro \
  -e NODE_EXTRA_CA_CERTS=/opt/taskira-runner-ca.pem node:22-bookworm \
  node -e "fetch('https://registry.npmjs.org/',{method:'HEAD'}).then(r=>{console.log(r.status);if(!r.ok)process.exitCode=1}).catch(e=>{console.error(e.message);process.exitCode=1})"
```

Для Docker Desktop включите WSL integration для дистрибутива раннера. Если TLS не проходит при
загрузке образов, настройте доверие CA в самом Docker согласно инструкции ниже.
После завершения текущих jobs перезапустите Linux-раннер и повторите упавшие проверки GitHub Actions.
При смене корпоративного CA обновляйте доверенное хранилище на этом хосте.

Источники: [Docker: доверенные CA хоста и контейнеров](https://docs.docker.com/engine/network/ca-certs/),
[GitHub: прокси для self-hosted runners](https://docs.github.com/en/actions/how-tos/manage-runners/use-proxy-servers).
