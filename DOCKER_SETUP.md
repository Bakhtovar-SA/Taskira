# DOCKER_SETUP — деплой всего стека через docker-compose

Эксплуатационная инструкция: поднять PostgreSQL + API + клиент одной командой.
Раньше в репозитории были только `server/docker-compose.*.yml` для тестовых
зависимостей CI (LDAP/mail/S3) — ни одного compose-файла для деплоя самого
приложения не было (ARCHITECTURE.md, follow-up).

---

## 1. Что где

| Файл | Роль |
|---|---|
| `docker-compose.yml` (корень) | оркестрация: `postgres` + `server` + `client` |
| `scripts/render-compose.sh` | единый генератор обычного и offline compose |
| `server/Dockerfile` | сборка API (`tsc` → тонкий рантайм, без devDependencies и исходников) |
| `Dockerfile` (корень) | сборка клиента (`vite build` → статика, раздаёт `nginx`) |
| `nginx.conf` (корень) | конфиг nginx для контейнера клиента |
| `.env.example` (корень) | переменные для docker-compose (**не** `server/.env` — тот для `cd server && npm run dev` без Docker) |

`server/.env` в контейнер не попадает и не читается — вся конфигурация идёт
через `environment:` в `docker-compose.yml`. `config.ts` сам это поддерживает:
файл `.env` — необязательный фолбэк, `process.env` (в контейнере — из
`environment:`) имеет приоритет (см. CLAUDE.md, «Server imports» и раздел
про парсер `.env`).

---

## 2. Запуск

```bash
cp .env.example .env
# заполнить POSTGRES_PASSWORD (openssl rand -hex 24 — НЕ -base64: тот даёт +/=,
# а пароль подставляется в DATABASE_URL без URL-экранирования, см. .env.example),
# JWT_SECRET (≥32 симв., напр. openssl rand -base64 32), ADMIN_PASSWORD —
# без них server не поднимется (fail-fast, как и в server/.env.example)
docker compose up -d --build
```

По умолчанию клиент и API доступны через единую точку входа
`http://localhost:8081`; API находится по пути `/api`. Контейнер `server`
напрямую на хост не публикуется.
Первый старт `server` сам прогонит миграции и создаст админа/дефолтный проект
(`migrate()` → `seedAdmin()` → `seedProject()` в `src/index.ts` — то же самое,
что при обычном `npm run dev`, идемпотентно).

Проверить:

```bash
curl http://localhost:8081/api/health   # {"ok":true,...}
docker compose ps                        # все три — healthy
docker compose logs -f server
```

Остановить (данные останутся в volume `pgdata`/`attachments`):

```bash
docker compose down
```

Стереть вместе с данными:

```bash
docker compose down -v
```

---

## 3. Адрес клиента и API

По умолчанию `VITE_API_URL` пуст: браузер обращается к тому же origin, с которого
получил SPA, а nginx в контейнере клиента проксирует `/api` (включая WebSocket)
к сервису `server` по внутренней compose-сети. Это делает client image
переносимым между адресами и является режимом офлайн-релиза.

- `VITE_API_URL` — необязательный legacy-режим для API на отдельном origin.
  Значение впекается при `vite build`, поэтому его изменение требует пересборки
  client image. `http://server:8080` указывать нельзя: это имя недоступно браузеру.
- `CORS_ORIGIN` (`server`, окружение) — какой `Origin` сервер обязан принимать.
  Должен совпадать с тем, откуда реально отдаётся клиент (`CLIENT_PORT`).

Если после `docker compose up` в консоли браузера есть ошибки CORS, проверьте,
что `CORS_ORIGIN` точно совпадает с адресом клиента в браузере, включая схему и
порт. Для обычного compose `VITE_API_URL` оставьте пустым.

---

## 4. Это не сам reverse-proxy

`client` публикуется в сеть, а `server` доступен только во внутренней
compose-сети. Это не позволяет клиенту обойти встроенный nginx и подделать
`X-Forwarded-For`. Целевая архитектура (ARCHITECTURE.md, «Компоненты»)
предполагает
**внешний** nginx с TLS перед обоими — этот compose его не заменяет и не
включает. `TRUST_PROXY=true` уже включён для встроенного nginx; если внешний
прокси добавляет больше одного доверенного hop, задайте более точную настройку
согласно корневому README, раздел «Аутентификация».

> **Обновление существующей HTTPS-инсталляции.** До появления параметра
> `SESSION_COOKIE_SECURE` production-образ всегда добавлял cookie-флаг
> `Secure`. Теперь HTTP является рабочим режимом по умолчанию, поэтому при TLS
> termination во внешнем reverse proxy обязательно добавьте в `.env`
> `SESSION_COOKIE_SECURE=true` до перезапуска контейнеров. Внешний proxy должен
> направлять HTTP и WebSocket на опубликованный порт `client`, а не `server`.

---

## 5. Опции сверх дефолта

LDAP/AD, S3-хранилище, email-уведомления — те же переменные, что и в
`server/.env.example` ([LDAP_SETUP.md](LDAP_SETUP.md), [STORAGE_SETUP.md](STORAGE_SETUP.md),
[NOTIFICATIONS_SETUP.md](NOTIFICATIONS_SETUP.md)). Добавьте их в
`services.server.environment` в `docker-compose.yml`, либо смонтируйте
готовый файл через `env_file:`. Единственное отличие для `S3`:
`STORAGE_DIR`/том `attachments` в этом compose не нужны — можно убрать volume.

---

## 6. Бэкапы

`server/BACKUP.md`/`server/scripts/backup.sh` работают без изменений — им
нужен только `DATABASE_URL`, указывающий на `POSTGRES_PORT` (по умолчанию
внутренний, не публикуется; при необходимости бэкапить снаружи — добавьте
`ports: ["5432:5432"]` сервису `postgres`, только за файрволом).

---

## 7. Обновление образов

```bash
git pull
docker compose up -d --build   # пересобирает server/client, если изменился код
```

Миграции применяются автоматически при старте `server` — накатывать вручную
не нужно (`migrate()` идемпотентна, помнит применённое в `schema_migrations`).

---

## 8. Офлайн-релиз для закрытого сервера

Обычный `docker compose up --build` требует исходники и доступ к registry для
базовых образов. Для поставки в закрытый контур собирайте самодостаточный архив
на Linux-машине с интернетом, GNU coreutils/tar и Docker либо Podman. Рабочее
дерево Git должно быть чистым, а версия — SemVer без `latest`:

```bash
./scripts/build-release.sh 1.4.0
```

Результат: `dist/releases/taskira-1.4.0.tar.gz` и контрольная сумма архива
`taskira-1.4.0.tar.gz.sha256`. Внутри находятся версионные
образы клиента и API, образ PostgreSQL, compose без секций `build`, установщик
с обязательной проверкой SHA-256, манифест, changelog и подробный
`README_INSTALL.md`. Миграции уже включены в образ API.

Тег каждого собственного образа в точности равен версии (`1.4.0`), а Git SHA,
дата коммита, OCI image ID и контрольная сумма каждого tar записываются в
`manifest.json`. PostgreSQL тоже экспортируется в комплект: на целевом хосте
не остаётся ни одного образа, требующего загрузки из registry.

На закрытом сервере достаточно распаковать архив и выполнять только команды из
`README_INSTALL.md`. Скрипт установки не вызывает `pull`, загружает и проверяет
наличие каждого точного versioned image до запуска Compose. Release-compose не
использует необязательные расширения Compose, которые расходятся между Docker
и разными Podman provider.
