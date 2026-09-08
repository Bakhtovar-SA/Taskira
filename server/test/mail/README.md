# Тестовый SMTP

Проверка email-уведомлений (`test/notifier.test.ts`,
[`../../../NOTIFICATIONS_MIGRATION.md`](../../../NOTIFICATIONS_MIGRATION.md) Фаза 3).
Реального корпоративного SMTP у нас нет — путь рассылки гоняется против ловушки.

## В CI — настоящий Mailpit

`.github/workflows/test.yml` job `mail`: `docker compose -f docker-compose.mail.yml up -d`
(`axllent/mailpit`), затем `MAIL_KIND=mailpit MAIL_API=http://localhost:8025 npm run test:mail`.
Тест читает пойманные письма через REST API Mailpit (`/api/v1/messages`,
`/api/v1/message/{ID}`).

## Локально без Docker — `sink.mjs`

`test/notifier.test.ts` сам поднимает `test/mail/sink.mjs` дочерним процессом:
SMTP-catcher на `smtp-server` + HTTP на `mailparser`, отдаёт письма JSON-ом
(`GET /` → `[{ to, from, subject, text, html, raw }]`; `DELETE /` — очистить).
Это отладочный fallback, не замена Mailpit в CI (ср. `test/ldap/mock-ldap.mjs`).

```bash
cd server
NOTIFY_EMAIL_ENABLED=true \
SMTP_HOST=127.0.0.1 SMTP_PORT=1025 \
SMTP_FROM='Taskira <noreply@taskira.test>' \
APP_BASE_URL=http://localhost:3000 \
npm run test:mail
```

`sink.mjs` при этом слушает SMTP на `SMTP_PORT` (1025) и HTTP на `SMTP_PORT+1000`
(2025). Отдельно запускать не нужно — тест форкает и гасит его сам.

Чтобы поднять `sink.mjs` вручную (посмотреть письма глазами):

```bash
node test/mail/sink.mjs           # SMTP :1025, HTTP :8025
curl -s http://127.0.0.1:8025 | jq
```

## Что проверяет `notifier.test.ts`

- **D9 (регрессия):** заголовок задачи и текст комментария из фикстуры
  **отсутствуют** в письме (subject / text / html / raw). В письме — только тип
  события, ключ задачи (`CORP-1`) и ссылка `APP_BASE_URL/#/issue/<pid>/<iid>`.
- `notify_prefs.email='off'` → `email_state='skipped'`, письма нет.
- нет `users.email` → `'skipped'` уже на этапе `emit`.
- дайджест (`email='daily'`): до истечения окна — `deferred`; после — одно
  письмо-сводка (тоже без контента).
- SMTP недоступен → ретрай, `email_tries++`, после `NOTIFY_EMAIL_MAX_TRIES` →
  `'failed'`.
