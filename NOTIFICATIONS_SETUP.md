# NOTIFICATIONS_SETUP — уведомления по email на реальном on-prem SMTP

Эксплуатационная инструкция: как включить email-канал уведомлений и подключить
Taskira к корпоративному SMTP-релею. In-app-уведомления (колокол) работают
**всегда** и от этих настроек не зависят. Проектные решения — в
[NOTIFICATIONS_MIGRATION.md](NOTIFICATIONS_MIGRATION.md) (§3, D1–D9). Локальный
тестовый SMTP — [server/docker-compose.mail.yml](server/docker-compose.mail.yml)
(Mailpit) и [server/test/mail/README.md](server/test/mail/README.md).

> Разработка велась против **Mailpit** — корпоративного SMTP у команды не было.
> Отличия реального релея (TLS, аутентификация, SPF/DKIM) — по тексту.

---

## 1. Что делает сервер при `NOTIFY_EMAIL_ENABLED=true`

- На событие ([D2](NOTIFICATIONS_MIGRATION.md): назначение, комментарий по
  подписке, `@`-упоминание, смена статуса, подключение к задаче, добавление в
  проект) пишется строка `notifications` каждому получателю (минус актор, минус
  деактивированные). Это in-app — **работает и без email**.
- Строке ставится `email_state='pending'`, только если у получателя есть
  `users.email` и `notify_prefs.email != 'off'`; иначе `'skipped'`.
- **Фоновый воркер** (`services/notifier.ts`, стартует из `index.ts` после
  `listen`, если `NOTIFY_EMAIL_ENABLED` и `NOTIFY_WORKER_ENABLED`) раз в
  `NOTIFY_WORKER_INTERVAL_MS` берёт `pending`, группирует по получателю
  (`instant` — сразу; `daily` — одно письмо-сводка по истечении
  `NOTIFY_DIGEST_WINDOW_MS` от первого события) и шлёт через `nodemailer`.
  Успех → `sent`; ошибка → `email_tries++`, после `NOTIFY_EMAIL_MAX_TRIES` →
  `failed`.

### Что уходит в письме — **[D9]** только ссылка

Тема: `Taskira · <тип события> · <ключ задачи>`.
Тело: одна фраза про тип события + ключ задачи + прямая ссылка
`APP_BASE_URL/#/issue/<projectId>/<issueId>` + строка «письмо не содержит текста
задачи». **Ни заголовка задачи, ни описания, ни текста комментария в письме нет**
— это гарантировано сигнатурой `emailTemplates.renderOne` (задачный контент туда
не передаётся) и регрессионным тестом. Всё содержательное пользователь читает
внутри Taskira по ссылке, авторизовавшись. Эту гарантию можно показать ИБ.

---

## 2. Переменные окружения

`server/.env` (не в git). При `NOTIFY_EMAIL_ENABLED=true` сервер **падает на
старте**, если не хватает `SMTP_HOST` / `SMTP_PORT` / `SMTP_FROM` / `APP_BASE_URL`.

| Переменная | Обяз. | Пример (корп. релей) | Пример (внешний SMTP) | Назначение |
|---|---|---|---|---|
| `NOTIFY_EMAIL_ENABLED` | — | `true` | `true` | `false` (деф.) — только in-app |
| `APP_BASE_URL` | да¹ | `https://taskira.corp` | `https://taskira.example.com` | база для ссылки в письме |
| `SMTP_HOST` | да¹ | `smtp-relay.corp.local` | `smtp.example.com` | адрес SMTP |
| `SMTP_PORT` | да¹ | `25` | `587` (STARTTLS) / `465` (implicit TLS) | порт |
| `SMTP_SECURE` | — | `false` | `true` для 465, `false` для 587/25 | implicit TLS |
| `SMTP_USER` / `SMTP_PASS` | — | — (аноним. релей в контуре) | логин/пароль ящика | аутентификация |
| `SMTP_FROM` | да¹ | `Taskira <noreply@corp.local>` | `Taskira <taskira@example.com>` | заголовок `From:` |
| `NOTIFY_WORKER_ENABLED` | — | `true` | `true` | стартовать воркер в этом процессе (см. §5) |
| `NOTIFY_WORKER_INTERVAL_MS` | — | `15000` | `15000` | период прохода воркера |
| `NOTIFY_EMAIL_MAX_TRIES` | — | `4` | `4` | попыток отправки до `failed` |
| `NOTIFY_DIGEST_WINDOW_MS` | — | `3600000` | `3600000` | окно дайджеста (`notify_prefs.email='daily'`) |

¹ обязателен только при `NOTIFY_EMAIL_ENABLED=true`.

**TLS с приватным CA** (STARTTLS/implicit): `NODE_EXTRA_CA_CERTS=/path/ca.pem`
общесистемно. `SMTP_SECURE` управляет только implicit-TLS (465); STARTTLS на
587/25 `nodemailer` включает сам, если сервер его предлагает.

---

## 3. Доставляемость: SPF / DKIM / DMARC

Письма шлёт домен из `SMTP_FROM`. Чтобы не попадали в спам:

- **SPF**: в DNS домена — `TXT` с адресом/сетью SMTP-релея (`v=spf1 ip4:… -all`
  или `include:` вашего почтового провайдера).
- **DKIM**: подпись на стороне релея; опубликовать публичный ключ в DNS
  (`selector._domainkey.<домен>`). Taskira сама не подписывает — это делает релей.
- **DMARC**: `TXT _dmarc.<домен>` с политикой (`p=quarantine`/`p=reject` + `rua`).
- `noreply@`-ящик должен существовать (или домен должен принимать на него), иначе
  часть фильтров режет.

`SMTP_FROM` менять на реальный домен компании — не оставлять `taskira.test`.

---

## 4. Проверка

```bash
# сервер стартует без [config]-ошибок и пишет строку про воркер:
#   [notifier] воркер email-рассылки запущен (интервал 15000 мс)
npm run start   # или npm run dev

# smoke: вызвать событие (прокомментировать задачу от другого юзера у кого есть
# users.email), подождать интервал воркера, проверить почту получателя.
# состояние рассылки в БД:
#   SELECT type, email_state, email_tries FROM notifications ORDER BY created_at DESC LIMIT 20;
```

CI-job `mail` (`.github/workflows/test.yml`) поднимает Mailpit из
`docker-compose.mail.yml` и гоняет `npm run test:mail` —
`test/notifier.test.ts` (D9-регрессия: заголовок и текст из фикстуры
отсутствуют в письме; `off`/нет email → `skipped`; дайджест; ретрай → `failed`).

---

## 5. Масштабирование на несколько узлов

MVP — **один** воркер в основном процессе (перекрытие тиков исключено
re-entrancy guard'ом). При нескольких процессах API за балансировщиком:

- поставить `NOTIFY_WORKER_ENABLED=false` **на всех, кроме одного** узла; либо
- (follow-up, Фаза 6) вынести воркер в отдельный `npm run worker` + лидер-лок
  (`pg_advisory_lock`), тогда `NOTIFY_WORKER_ENABLED=false` на всех API-узлах.

Несколько воркеров без лока = дубли писем — **не запускать**.

---

## 6. Пользователи без email

`users.email` заполняется из LDAP-директории (миграция 009). У локальных учёток
(`auth_source='local'`) — `null` → им уходит только in-app, `email_state` строк —
`'skipped'`. Поле «почта» в профиле для ручного ввода — Фаза 6. Устаревший адрес
из LDAP → письмо уйдёт не туда; сужается ресинком ([LDAP_MIGRATION.md Фаза 7](LDAP_MIGRATION.md)).

---

## 7. Настройки пользователя

`PATCH /api/notifications/prefs` (панель в меню пользователя): `email` =
`instant` (деф. если есть адрес) | `daily` (дайджест) | `off`; `selfWatch` —
авто-подписка на свои задачи (деф. `true`). Хранится в `users.notify_prefs`
(jsonb). Per-type тумблеры — Фаза 6.

---

## 8. Траблшутинг

| Симптом | Причина / что делать |
|---|---|
| `[config] NOTIFY_EMAIL_ENABLED=true: не задан SMTP_…` / `APP_BASE_URL` | не хватает обязательного ключа — §2 |
| Письма не уходят, `email_state='failed'` | лог воркера (`[notifier] отправка не удалась …`): DNS/порт/аутентификация SMTP |
| `self signed certificate` / `unable to verify` | приватный CA → `NODE_EXTRA_CA_CERTS` |
| `535 auth failed` | неверные `SMTP_USER`/`SMTP_PASS`, либо релей ждёт аноним (убрать их) |
| Письма в спам | SPF/DKIM/DMARC (§3), `SMTP_FROM` на не-существующем домене |
| Ссылка в письме битая / `localhost` | `APP_BASE_URL` не задан на реальный внешний адрес |
| Дубли писем | несколько процессов с включённым воркером — §5 |
| Воркер не стартовал | `NOTIFY_EMAIL_ENABLED` или `NOTIFY_WORKER_ENABLED` не `true`; строки про запуск нет в логе |
| Дайджест не приходит | ждёт `NOTIFY_DIGEST_WINDOW_MS` от первого события; проверить, что воркер жив |
| `notifier.test.ts` — `describe.skip` | не заданы `NOTIFY_EMAIL_ENABLED=true` + `SMTP_HOST` |

---

## 9. In-app vs email — сводка

| | in-app (колокол) | email |
|---|---|---|
| Включён | всегда | `NOTIFY_EMAIL_ENABLED=true` + SMTP |
| Доставка | polling (`unread-count` 30 c + на focus) | фоновый воркер, `instant`/`daily` |
| Содержимое | полное (заголовок, отрывок) — не покидает сервер | **только тип + ключ + ссылка** (D9) |
| Кому | всем активным получателям | у кого есть `users.email` и `email != 'off'` |
| Настройка | не отключается | `notify_prefs.email` (сразу/дайджест/выкл) |
