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

По умолчанию: клиент — `http://localhost:8081`, API — `http://localhost:8080`.
Первый старт `server` сам прогонит миграции и создаст админа/дефолтный проект
(`migrate()` → `seedAdmin()` → `seedProject()` в `src/index.ts` — то же самое,
что при обычном `npm run dev`, идемпотентно).

Проверить:

```bash
curl http://localhost:8080/api/health   # {"ok":true,...}
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

## 3. VITE_API_URL vs CORS_ORIGIN — это не опечатка, они должны совпасть

Клиент — статическая SPA; `VITE_API_URL` **впекается в сборку** на этапе
`vite build` (`Dockerfile` в корне, `ARG`/`ENV`), а не читается в рантайме —
после сборки поменять адрес API без пересборки образа клиента нельзя.

- `VITE_API_URL` — куда браузер пользователя должен стучаться за API. Это
  адрес, по которому **реально доступен** `server` снаружи (например,
  `http://localhost:8080` при локальной проверке, или публичный домен на
  проде) — **не** `http://server:8080` (это имя видно только внутри
  docker-сети, из браузера недоступно).
- `CORS_ORIGIN` (`server`, окружение) — какой `Origin` сервер обязан принимать.
  Должен совпадать с тем, откуда реально отдаётся клиент (`CLIENT_PORT`).

Если после `docker compose up` в консоли браузера `CORS` ошибки — почти
всегда рассинхрон именно этих двух переменных; смотрите готовые дефолты в
`.env.example`.

---

## 4. Это не сам reverse-proxy

`client` и `server` публикуют порты по отдельности — как в `npm run dev`
(`:3000`/`:8080`), только вместо Vite dev-сервера клиент раздаёт `nginx` со
статикой. Целевая архитектура (ARCHITECTURE.md, «Компоненты») предполагает
**внешний** nginx с TLS перед обоими — этот compose его не заменяет и не
включает. Если ставите такой прокси (443 → сюда), обязательно выставите
`TRUST_PROXY` серверу (корневой README, раздел «Аутентификация») — иначе
`req.ip` будет адресом прокси и сломает rate-limit логина по IP.

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
