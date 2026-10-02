# HTTPS: taskira.megafon.tj, Debian и rootless Podman

Схема: браузер → host Nginx:443 → `127.0.0.1:8081` → client Nginx → server:8080.
Адрес сервера: `10.241.103.16`. DNS должен указывать на этот сервер. Порт 8081 остаётся HTTP;
пользователи открывают `https://taskira.megafon.tj` без порта. Файлы здесь — шаблоны для установки,
они сами не меняют сервер. Команды Podman выполняются пользователем `taskira`, без `sudo podman`.

## Настройки приложения

В существующем `.env` каталога развёртывания заменить только эти значения, сохранив секреты:

```dotenv
CORS_ORIGIN=https://taskira.megafon.tj
SESSION_COOKIE_SECURE=true
CLIENT_PORT=8081
```

В штатном Compose `APP_BASE_URL` уже берётся из `CORS_ORIGIN`. Клиент использует относительный `/api`:
`VITE_API_URL` для новой сборки оставить пустым. Если готовый образ собирали с HTTP-адресом API,
его нужно пересобрать с пустым `VITE_API_URL`, иначе браузер будет блокировать mixed content.
Обычная смена этих серверных env не требует пересборки клиентского образа.

Пересоздать сервисы тем же скриптом/Compose project name, которым они первоначально запускались.
Для штатного Compose из каталога развёртывания:

```bash
podman compose --env-file .env -f docker-compose.yml up -d
podman compose --env-file .env -f docker-compose.yml ps
curl --fail http://127.0.0.1:8081/api/health
```

Не выполнять `down -v`: данные находятся в существующих томах. До первого доступа пользователей
ограничить порт 8081 соединениями от host Nginx (loopback binding либо правила имеющегося firewall).
Снаружи внутренней сети порт 443 также не нужен. Конкретные правила зависят от firewall сервера.

## Сертификат и host Nginx

Нужны существующий PEM-сертификат для `taskira.megafon.tj`, приватный ключ и промежуточная цепочка.
В `fullchain.pem` первым идёт сертификат сайта, затем промежуточные сертификаты. Если файл уже
содержит цепочку, повторно добавлять её не нужно. Рабочие станции должны доверять корпоративному CA.

Установить host Nginx из доступного Debian-репозитория, если он ещё не установлен. Поместить
fullchain в `/etc/nginx/tls/taskira.megafon.tj.fullchain.pem`, ключ — в
`/etc/nginx/tls/taskira.megafon.tj.key` (root:root, режим 0600). Содержимое ключа не помещать в Git.
Затем скопировать `taskira.megafon.tj.conf.example` в
`/etc/nginx/conf.d/taskira.megafon.tj.conf`. Сохранить уже существующую конфигурацию этого домена,
если она есть, и исключить дублирующий `server_name`. Перед применением:

```bash
sudo nginx -t
sudo systemctl enable nginx
sudo systemctl reload-or-restart nginx
curl --fail https://taskira.megafon.tj/api/health
curl --head http://taskira.megafon.tj/
```

HTTP должен вернуть 308 на HTTPS. Для CA, ещё не установленного в доверие системы,
проверять `curl --cacert /path/to/corporate-root-ca.pem`, сохраняя проверку сертификата.
В браузере проверить вход, сохранение после обновления страницы, загрузку вложения и уведомления
между двумя вкладками. Cookie сессии должен иметь `Secure`; WebSocket `/api/ws` — соединение `wss`.

## Реальный IP через второй proxy

Контейнерный `nginx.conf` отбрасывает входящий XFF и передаёт свой `$remote_addr` API. Поэтому при
добавлении host proxy нужно настроить его существующий include `/etc/nginx/taskira-real-ip/*.conf`,
чтобы IP в аудите и лимитах входа соответствовал пользователю. Сначала ограничить доступ к 8081;
затем определить адрес host proxy, видимый в access log client после запроса через HTTPS. Rootless
Podman может подменять адрес источника своим gateway — `10.241.103.16` здесь нельзя считать верным автоматически.

В `real-ip.conf.example` заменить `TRUSTED_HOST_PROXY_IP` только этим адресом и монтировать файл
read-only в сервис `client`, в `/etc/nginx/taskira-real-ip/trusted.conf`. Это дополнительный bind mount;
тома базы и вложений сохраняются. Затем проверить `nginx -t` внутри client, пересоздать client через
тот же Compose и подтвердить разные IP двух рабочих станций в аудите. При SELinux учитывать метку
bind mount, если SELinux включён. Значение серверного `TRUST_PROXY` остаётся сетью Compose.

Официальные источники: [HTTPS и цепочка сертификатов](https://nginx.org/en/docs/http/configuring_https_servers.html),
[WebSocket proxy](https://nginx.org/en/docs/http/websocket.html),
[доверенные proxy и real IP](https://nginx.org/en/docs/http/ngx_http_realip_module.html).
