# NOTIFICATIONS_MIGRATION — уведомления (in-app + email) + фоновый воркер

Статус: **решения §3 подтверждены (D1–D9; D9 — письмо БЕЗ содержимого
задач/комментариев). Фазы 1–5 сделаны — миграция завершена. Миграция 011;
событийный слой `services/notify.ts` + `emit()` в 5 роутах; `services/mentions.ts`;
`routes/notifications.ts`; email-воркер `services/notifier.ts` + `emailTemplates.ts`
(D9 — гарантия конструкцией); клиент — `Bell()`, polling, `<NotifySettings>`,
`<MentionText>`; `NOTIFICATIONS_SETUP.md`; CI-job `mail` vs Mailpit; чек-лист в
`server/README.md`; `ARCHITECTURE.md` п.5 → ✅; открытый вопрос `SCOPE.md` снят.
`npm test` 68 + `test:mail` 6 зелёных; правки по ревью PR #19 сложены. Осталось
влить ветку. Фаза 6 — отдельный заход.**
Ветка `feat/notifications`. Порядок фаз: 1 → 2 → 3 → 4 → 5
(Фаза 3 — email-воркер; при затыке с SMTP-инфраструктурой отделяется в follow-up
PR, in-app к тому моменту уже работает). Фаза 6 — вне захода.

Контекст: [SCOPE.md](SCOPE.md) — «Уведомления (в приложении + email) о назначении
задачи, смене статуса, упоминании» в списке MVP + **открытый вопрос**: «только в
приложении, или обязательно email через корпоративный SMTP».
[ARCHITECTURE.md](ARCHITECTURE.md) — компонент «Фоновый воркер — уведомления
(email, in-app), синхронизация членства в LDAP-группах по расписанию» и п. 5
«Порядка разработки» («Уведомления + фоновый воркер — не начато, есть только
`issue_watchers`»). Предыдущие миграции — [ROLE_MIGRATION.md](ROLE_MIGRATION.md),
[DEPT_MIGRATION.md](DEPT_MIGRATION.md), [COLLAB_MIGRATION.md](COLLAB_MIGRATION.md),
[LDAP_MIGRATION.md](LDAP_MIGRATION.md), [FILES_MIGRATION.md](FILES_MIGRATION.md).

Отдельный документ по итогам — **NOTIFICATIONS_SETUP.md** (подключение к
корпоративному SMTP на реальном on-prem сервере), см. §4 Фаза 5.

Этот заход также **создаёт скелет фонового воркера**, на который потом навесятся
два уже отложенных пункта: ресинк LDAP-членства по расписанию
([LDAP_MIGRATION.md Фаза 7](LDAP_MIGRATION.md)) и сборщик осиротевших объектов
хранилища ([FILES_MIGRATION.md Фаза 6](FILES_MIGRATION.md)).

---

## 1. Зачем

[SCOPE.md](SCOPE.md) относит уведомления к MVP. Сейчас узнать, что тебя назначили
исполнителем, упомянули в комментарии или сменили статус твоей задачи, можно
только вручную открыв задачу. `issue_watchers` (подписка) есть, но **на неё ничего
не реагирует** — нет ни модели уведомления, ни доставки.

Клиентский «колокол» в топбаре (`src/components/Topbar.tsx` `Bell()`) —
**заглушка**: собирает «Ленту активности» из `issue.activity` (а тот на
API-версии фактически пуст — read-эндпоинта у истории нет), «прочитано» = локальный
`Date.now()`, на сервер ничего не ходит. Нужно заменить настоящей моделью
уведомлений на пользователя (с состоянием «прочитано») и доставкой.

Email: `users.email` уже есть (миграция 009, заполняется из LDAP-директории; у
локальных учёток — `null`). Корпоративный SMTP — за env, как `LDAP_*` / `STORAGE_S3_*`.

**Ограничение разработки:** реального корпоративного SMTP для тестов нет. Вся
разработка и CI — против **Mailpit** (лёгкий SMTP-catcher) в Docker; отличия
реального SMTP (TLS, аутентификация, релей) — в NOTIFICATIONS_SETUP.md. Тот же
приём, что тестовый OpenLDAP (LDAP) и MinIO (FILES).

---

## 2. Что в коде сейчас

| Слой | Файл | Состояние |
|---|---|---|
| Подписка на задачу | `issue_watchers` (миграция 002) + `POST/DELETE /issues/:id/watchers/me` | таблица `(issue_id, user_id)`; на изменения **никто не реагирует** |
| История задачи | `activity` + `services/issues.ts` `logActivity` | пишется на `issue.create`/`transition`/…; **read-эндпоинта нет**, на клиенте пусто |
| «Колокол» | `src/components/Topbar.tsx` `Bell()` | **заглушка**: feed из `issue.activity`, `seen = Date.now()` локально, сервера нет |
| Аудит | `server/src/audit.ts` | fire-and-forget `audit_log`, не бросает в запрос — **образец «сделать после ответа, не роняя запрос»** |
| Realtime | `@fastify/websocket` зарегистрирован; `WsMessage` в `contract.ts` объявлен | реализации нет («Этап 3c»); `/ws` не смонтирован |
| Email / SMTP | — | ни `nodemailer`, ни `SMTP_*` |
| Фоновый воркер | — | **нет вообще** (`index.ts`: config → pool → migrate → seed → `buildApp` → listen; никаких `setInterval`) |
| Почта пользователя | `users.email` (миграция 009) | из LDAP-директории; у `auth_source='local'` — `null` |
| Упоминания | — | текст комментария/описания сохраняется как есть, `@name` не разбирается |
| Конфиг | `config.ts` | свой парсер `.env`, `Config` кэш, fail-fast (`fail()`), `envBool()`, `envPosInt()` |
| Миграции | `server/migrations/` | последняя — `010_attachments.sql`; следующая — **011** |
| Клиент — модель | `src/store.tsx` `Data` | один плоский объект; `bootstrap()` тянет проект+состав+задачи; **нет `notifications`** |

---

## 3. Ключевые решения (РЕШЕНО)

Подтверждено целиком, как предложено:

| # | Решение |
|---|---|
| **D1** каналы | In-app — всегда (строка `notifications` на получателя + `read_at`). Email — за `NOTIFY_EMAIL_ENABLED` + `SMTP_*`; при выключенном SMTP сервер как раньше. Разработка/CI — против **Mailpit** в Docker (`docker-compose.mail.yml` + job `mail`). |
| **D2** триггеры | Фиксированный набор, получатели минус актор минус деактивированные: назначен исполнителем; новый комментарий (watchers ∪ assignee ∪ reporter ∪ collaborators); `@login` в комментарии/описании (только те, кто видит задачу); смена статуса (watchers ∪ assignee ∪ reporter); подключён как collaborator; добавлен в проект / смена роли. Автор коммента/смены статуса → авто-watcher (если `notify_prefs.selfWatch`). |
| **D3** модель | Одна таблица `notifications` (`user_id`, `type`, `actor_id`, `project_id`, `issue_id`, `payload jsonb`, `created_at`, `read_at`, `email_state`, `email_tries`) — без отдельного outbox. Доставка in-app **по polling** (`GET /api/notifications`, `/unread-count`, `POST /read`); WebSocket-пуш — Фаза 6. `payload` (заголовок задачи, отрывок текста) — **только для in-app**; в email не уходит (D9). |
| **D4** воркер | `services/notifier.ts` `startNotifier()` — `setInterval` (~15 c) в основном процессе, стартует из `index.ts` после `listen` при `NOTIFY_EMAIL_ENABLED` (не в тестах/seed). Идёт по `email_state='pending'`, дайджест-группировка по `user_id`, ретрай с `email_tries`, после N → `failed`. Флаг `NOTIFY_WORKER_ENABLED` заложен под будущее вынесение в отдельный `npm run worker` + лидер-лок. **Скелет воркера этого захода — дом для отложенных LDAP-resync и storage-sweeper.** |
| **D5** упоминания | Парсит **сервер** при `POST /comments` и `PATCH /:id` (description): `@([a-z0-9._-]{3,32})` → резолв в `users.id` → **оставить только видящих задачу** (участник проекта ∪ collaborator ∪ глоб. admin), остальные токены — молча игнор. Клиентский автокомплит `@` — Фаза 6. |
| **D6** настройки | `users.notify_prefs jsonb NOT NULL DEFAULT '{}'`. MVP-поля: `email` = `instant` \| `daily` \| `off` (деф. `instant` если есть `users.email`, иначе `off`); `selfWatch` bool (деф. `true`). In-app не настраивается. `PATCH /api/notifications/prefs` + панель в клиенте. Per-type тумблеры — Фаза 6. |
| **D7** email | `nodemailer`. `SMTP_HOST/PORT/USER/PASS/SECURE/FROM`, `NOTIFY_EMAIL_ENABLED`, `APP_BASE_URL`. Тело письма — **только тип события + прямая ссылка** `APP_BASE_URL/#/issue/<pid>/<id>` (см. D9). RU, plain-text + минимальный HTML. Дайджест — одно письмо со списком ссылок по типам. |
| **D8** кого не трогаем | Актору событие не создаётся. Деактивированному (`is_active=false`) — ничего (строка не пишется). Нет `email` / `email='off'` → строка есть (in-app), `email_state='skipped'`. Удалён юзер → `ON DELETE CASCADE`. |
| **D9** содержимое письма | **Письмо НЕ содержит текста задач/комментариев** — ни заголовка задачи, ни описания, ни отрывка комментария. Только: тип события (напр. «вас назначили исполнителем», «новый комментарий», «упоминание») + идентификатор задачи (ключ `CORP-123` — это ссылка/идентификатор, не содержимое) + прямая ссылка в приложение. Всё содержимое пользователь видит уже внутри Taskira по ссылке. `payload` в БД для in-app остаётся полным; email-шаблон эти поля **не читает**. |

Ниже — обоснования и отклонённые альтернативы по каждому пункту.

### D1. Каналы — in-app всегда; email опционально за `SMTP_*` env + CI против Mailpit

**Рекомендация.** In-app-уведомления — всегда (строка в БД на получателя,
состояние «прочитано»). Email — включается `NOTIFY_EMAIL_ENABLED=true` +
`SMTP_*`; при выключенном SMTP сервер работает как раньше, шлёт только in-app.
Разработка/CI — против **Mailpit** в Docker (`docker-compose.mail.yml` +
job `mail` в `test.yml`), как тестовый OpenLDAP/MinIO.

**Обоснование.** SCOPE держит email в MVP, но там же помечает вопрос «обязателен
ли SMTP» открытым. Компромисс, совпадающий с уже принятым паттерном (LDAP, FILES):
базовый путь работает без внешней системы, «правильный» путь (email) реализован и
оттестирован, включается одним флагом. Локальные учётки без `email` получают
только in-app — это нормально и задокументировано.

**Отклонено.**
- *Только in-app.* Не закрывает SCOPE; человек, не открывавший трекер, не узнаёт
  о назначении.
- *Только email.* In-app-лента полезна сама по себе; и не у всех есть `email`.
- *Внешняя очередь (Redis/BullMQ) под рассылку.* Избыточно для on-prem одного узла.

### D2. Триггеры MVP — фиксированный набор из SCOPE + очевидные соседи

**Рекомендация.** Уведомление создаётся на событие для набора получателей
(**минус сам актор**, минус деактивированные):

| Событие | Кому |
|---|---|
| Назначен исполнителем задачи (`assigneeId` стал = мне) | новому исполнителю |
| Новый комментарий к задаче | watchers ∪ assignee ∪ reporter ∪ collaborators задачи |
| Упоминание `@login` в комментарии или описании задачи | упомянутым (если они видят задачу) |
| Смена статуса задачи | watchers ∪ assignee ∪ reporter |
| Тебя подключили к задаче как collaborator | подключённому |
| Тебя добавили в проект / сменили роль | затронутому пользователю |

Автор комментария/сменивший статус **автоматически** становится watcher’ом своей
задачи (как во многих трекерах) — опционально, вынести в prefs (D6).

**Обоснование.** Ровно то, что просит SCOPE (назначение, статус, упоминание),
плюс комментарии по подписке — иначе watchers бесполезны. Всё issue-scoped,
получатели уже вычисляются существующим кодом (watchers, `participants`).

**Отклонено.** Уведомлять о любом `PATCH` задачи (шум); о действиях в проектах,
где тебя нет (утечка).

### D3. Модель — таблица `notifications` на получателя, состояние «прочитано»; доставка in-app по polling

**Рекомендация.**

```sql
CREATE TABLE notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- получатель
  type        text NOT NULL,                 -- 'issue.assigned' | 'issue.comment' | 'issue.mention' | 'issue.status' | 'issue.collaborator' | 'project.member'
  actor_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  project_id  uuid REFERENCES projects(id) ON DELETE CASCADE,
  issue_id    uuid REFERENCES issues(id) ON DELETE CASCADE,
  payload     jsonb NOT NULL DEFAULT '{}',   -- заголовок задачи, отрывок текста, старый/новый статус…
  created_at  timestamptz NOT NULL DEFAULT now(),
  read_at     timestamptz,                   -- NULL = непрочитано
  email_state text NOT NULL DEFAULT 'pending' CHECK (email_state IN ('pending','sent','skipped','failed')),
  email_tries smallint NOT NULL DEFAULT 0
);
CREATE INDEX idx_notifications_user_unread ON notifications (user_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX idx_notifications_user ON notifications (user_id, created_at DESC);
CREATE INDEX idx_notifications_email_pending ON notifications (created_at) WHERE email_state = 'pending';
```

**Доставка in-app — polling**, не WebSocket:
- `GET /api/notifications?cursor=&limit=` — страница ленты;
- `GET /api/notifications/unread-count` — число для бейджа;
- `POST /api/notifications/read` — `{ ids? }` (пусто = отметить все прочитанными).
Клиент опрашивает `unread-count` по интервалу (~30 с) и на `focus` окна; полную
ленту — при открытии дропдауна.

**Обоснование.** Внутренний трекер, задержка в десятки секунд приемлема. WebSocket
требует sticky-сессий/pub-sub для нескольких узлов — это отдельный слой (Этап 3c).
`email_state` в той же строке — не заводим вторую таблицу-outbox: одна строка =
одно уведомление, воркер идёт по `email_state='pending'`.

**Отклонено.**
- *WebSocket-пуш сразу.* Больше инфраструктуры; polling для MVP достаточно
  (Этап 3c / Фаза 6 — заменить прозрачно).
- *Отдельная таблица `notification_outbox`.* Дублирование; `email_state` в
  `notifications` проще и хватает.
- *Переиспользовать `activity`.* Она per-issue и без состояния «прочитано» на
  пользователя; уведомления — per-recipient.

### D4. Фоновый воркер — in-process interval-луп, включается из `index.ts` (не в тестах)

**Рекомендация.** `services/notifier.ts` `startNotifier()` — `setInterval`
(~15 с), внутри: выбрать пачку `notifications WHERE email_state='pending'` (лимит),
для каждого — сформировать письмо и отправить через `nodemailer`; успех →
`email_state='sent'`, ошибка → `email_tries++`, после N попыток → `'failed'`; у
кого нет `email` / email выключен / prefs запрещают → `'skipped'` сразу при
создании. Запускается из `index.ts` **после `listen`**, только если
`NOTIFY_EMAIL_ENABLED`; в тестах (`NODE_ENV=test`) и в `seed` — не стартует.
`digest`-режим (D6) — воркер группирует `pending` одного пользователя в одно
письмо, если с момента первого события прошло ≥ интервал дайджеста.

**Обоснование.** Ноль новой инфраструктуры (планировщика в проекте нет —
ARCHITECTURE п. 5). In-app-строка пишется синхронно в запросе (быстро), медленный
email — отдельным проходом с ретраями. Это и есть минимальный «фоновый воркер»,
которого ждёт ARCHITECTURE; сюда же потом встанут LDAP-resync и storage-sweeper
(отдельными «джобами» того же лупа).

**Следствие (задокументировать).** Один узел — один воркер. При масштабировании
на несколько процессов нужен лидер-лок (`pg_advisory_lock`) или вынести воркер в
отдельный `npm run worker` — заложить `NOTIFY_WORKER_ENABLED` уже сейчас, но
MVP = в основном процессе.

**Отклонено.**
- *Fire-and-forget inline (как `audit.ts`).* Письмо теряется при рестарте/сбое
  SMTP, нет ретрая. Для in-app-строки — ок (она в БД), для email — нет.
- *Отдельный сервис/воркер сразу.* Оверинжиниринг для одного узла; флаг под это
  заложим.
- *Cron/systemd-timer.* Внешняя зависимость от окружения.

### D5. Упоминания — парсинг `@login` на сервере при записи; резолв только среди тех, кто видит задачу

**Рекомендация.** При `POST /issues/:id/comments` и `PATCH /issues/:id`
(description) сервер вытаскивает `@([a-z0-9._-]{3,32})` из текста, резолвит в
`users.id`, **оставляет только тех, кто имеет доступ к задаче** (участник проекта
∪ collaborator ∪ глоб. admin) — остальные `@`-токены игнорируются молча (не
подтверждаем существование логина, не даём пинговать чужих). На каждого — строка
`notifications type='issue.mention'`. Клиент рендерит `@login` как чип/ссылку;
автокомплит по `@` в поле ввода — **follow-up** (Фаза 6).

**Обоснование.** Парсинг на сервере = единый источник и для in-app, и для email,
и клиент не обязателен. Ограничение видимостью закрывает утечку/спам.

**Отклонено.** Резолв на клиенте (обходится); уведомлять любого по логину
(спам-вектор, разведка логинов).

### D6. Настройки пользователя — минимальные: email вкл/выкл + режим (сразу / дайджест / выкл), без per-type в MVP

**Рекомендация.** `users.notify_prefs jsonb NOT NULL DEFAULT '{}'` (или пара
колонок). MVP-поля: `email` (`instant` | `daily` | `off`, деф. `instant` если у
юзера есть `email`, иначе `off`), `selfWatch` (bool — автоподписка на свои задачи,
деф. `true`). In-app — всегда включён, не настраивается. `PATCH
/api/notifications/prefs` + панель в клиенте (простой блок в профиле/настройках).
Per-type тумблеры («не слать про смену статуса») — Фаза 6.

**Обоснование.** Меньше поверхности; закрывает главный запрос («не заваливайте
почту» → дайджест/выкл). Расширяется без слома схемы (jsonb).

**Отклонено.** Матрица «тип × канал» в MVP (много UI, мало пользы на старте);
совсем без настроек (email нельзя отключить — раздражает).

### D7. Email — `nodemailer`, plain-text + минимальный HTML, ссылка `APP_BASE_URL/#/issue/<pid>/<id>`

**Рекомендация.** Библиотека — `nodemailer` (стандарт, альтернатив нет).
`SMTP_HOST/PORT/USER/PASS/SECURE/FROM`, `NOTIFY_EMAIL_ENABLED`, `APP_BASE_URL`
(для ссылок; **без `APP_BASE_URL` email не включается** — письмо без ссылки
бессмысленно). Шаблоны — RU, плоский текст + лёгкий HTML. Дайджест — одно письмо
со списком ссылок, сгруппированных по типу события.

**Содержимое — минимальное (D9).** Ни заголовка задачи, ни описания, ни текста
комментария. Тема письма: `Taskira · <тип события> · CORP-123`; тело: одна фраза
про тип события + ключ задачи + ссылка. Пример:

```
Тема: Taskira · вас назначили исполнителем · CORP-123

Вас назначили исполнителем задачи CORP-123.
Открыть: https://taskira.corp/#/issue/<projectId>/<issueId>

Это письмо не содержит текста задачи — подробности внутри Taskira.
Отписаться / режим дайджеста: настройки уведомлений в приложении.
```

**Отклонено.** Тяжёлый шаблонизатор/вёрстка писем (MVP не нужно); внешний
email-API (SendGrid и пр. — on-prem, свой SMTP); включать отрывок текста в письмо
(D9 — запрещено).

### D9. Письмо не несёт содержимого задач/комментариев — только тип события + ссылка

**Решение (подтверждено).** Письмо, уходящее через SMTP-релей, **не должно
содержать** ни заголовка задачи, ни описания, ни отрывка комментария, ни имени
упомянувшего в свободной форме. Разрешено: тип события (перечислимый), ключ
задачи (`CORP-123` — опаковый идентификатор, он же в ссылке), прямая ссылка в
приложение, имя актора допустимо как «кто-то из команды» без раскрытия — **или
вовсе без имени** (реши при реализации в пользу минимализма). Всё содержательное
пользователь читает уже внутри Taskira, авторизовавшись.

**Реализация.** `notifications.payload` в БД по-прежнему хранит денормализованные
поля (заголовок, отрывок) — они нужны для **in-app**-ленты и наружу не уходят.
`services/emailTemplates.ts` эти поля **не читает**: на вход берёт только `type`,
`issue.key`, `projectId`/`issueId`. Тест Фазы 3 проверяет тело письма через
Mailpit: ключ и ссылка — есть; заголовок задачи / текст комментария из фикстуры —
**отсутствуют**.

**Обоснование.** Внешний SMTP (даже корпоративный релей) — это лог-файлы почтовой
системы, бэкапы, возможный внешний хоп. Содержимое задач ИБ/HR/юр. там быть не
должно. Ссылка требует аутентификации в приложении — доступ по правам сохраняется.

**Отклонено.** «Короткий отрывок безопасен» — граница размыта, любой отрывок = PII;
опция per-tenant «включить превью» — Фаза 6, если ИБ явно разрешит.

### D8. Кого не трогаем — деактивированных и себя

**Рекомендация.** Актору событие не создаётся вовсе. Деактивированному
(`is_active=false`) — ни in-app, ни email (строка не пишется). Нет `email` /
`email='off'` → строка пишется (in-app), `email_state='skipped'`. Пользователь
удалён → `ON DELETE CASCADE` уносит его уведомления.

---

## 4. План по фазам

Критический путь: **1 → 2 → 3 → 4 → 5**. Фаза 3 (email-воркер) при затыке с SMTP
отделяется в follow-up PR — in-app к тому моменту работает и покрыт тестами.
Фаза 6 — вне захода.

### Фаза 1 — Схема + конфиг + тестовый SMTP  *(сделано)*

Ветка `feat/notifications`. Ни один роут/`index.ts` не тронут — деплой-безопасно.
`npm run typecheck` 0, `npm test` — **55 зелёных** (поведение не изменилось);
миграция 011 применяется в тестовой схеме (`schema_migrations`: 001–004, 006–011).

- **`server/migrations/011_notifications.sql`** — таблица `notifications` (D3;
  `type` с `CHECK` на 6 значений, `payload jsonb` — только для in-app,
  `email_state`/`email_tries`), три индекса (лента, непрочитанные, очередь
  воркера — partial `WHERE email_state='pending'`); FK-каскады от `users` /
  `projects` / `issues`. `users.notify_prefs jsonb NOT NULL DEFAULT '{}'` (D6).
  Бэкфилла нет. Обратима.
- **`config.ts`** — `Config.notify` (`NotifyConfig` + `SmtpConfig`),
  `buildNotifyConfig()`:

  | Переменная | Назначение |
  |---|---|
  | `NOTIFY_EMAIL_ENABLED` | `false` (деф.) \| `true` — включает email-воркер |
  | `NOTIFY_WORKER_ENABLED` | `true` (деф.) — стартовать ли фоновый луп в этом процессе |
  | `NOTIFY_WORKER_INTERVAL_MS` | деф. `15000` |
  | `NOTIFY_EMAIL_MAX_TRIES` | деф. `4` |
  | `NOTIFY_DIGEST_WINDOW_MS` | окно дайджеста, деф. `3600000` (1 ч) |
  | `SMTP_HOST` / `SMTP_PORT` | обяз. при `NOTIFY_EMAIL_ENABLED` |
  | `SMTP_USER` / `SMTP_PASS` | опц. (аноним. релей в контуре) |
  | `SMTP_SECURE` | `false` (деф.) \| `true` (implicit TLS/465) |
  | `SMTP_FROM` | обяз. при email; напр. `Taskira <noreply@corp.example>` |
  | `APP_BASE_URL` | напр. `https://taskira.corp` — для ссылок в письмах |

  Валидация в стиле `buildLdapConfig`/`buildStorageConfig`: при
  `NOTIFY_EMAIL_ENABLED=true` — fail-fast на `SMTP_HOST` / `SMTP_PORT` (целое > 0) /
  `SMTP_FROM` **и `APP_BASE_URL`** (письмо без ссылки бессмысленно, D7/D9);
  числа — `envPosInt`. При `false` — `smtp = null`, сервер как раньше.
- **`server/docker-compose.mail.yml`** — `axllent/mailpit:v1.20.0` (SMTP :1025,
  веб-UI + REST API `/api/v1/messages` :8025), `healthcheck` `mailpit readyz`.
- **`.env.example`** — блок `NOTIFY_*` / `SMTP_*` / `APP_BASE_URL` (закомментирован,
  `NOTIFY_EMAIL_ENABLED=false`).

### Фаза 2 — Сервер: событийный слой + in-app API  *(сделано)*

`typecheck` 0, `npm test` — **67 зелёных** (55 + 12 новых). Живой прогон
(dev :8080) — 3 сценария ниже.

- **`server/src/services/notify.ts`** *(новый)* — `emit(ev)`: вычисляет
  получателей (для `issue.comment`/`issue.status` — `SELECT ... UNION` по
  watchers ∪ assignee ∪ reporter (∪ collaborators для comment); для остальных —
  явный `recipientIds`), `[...new Set()]` + отброс `actorId`, отсев
  `is_active=false` (D8), `INSERT ... SELECT FROM unnest($ids, $states)`.
  `email_state='pending'` только если `NOTIFY_EMAIL_ENABLED` **и** есть
  `users.email` **и** `notify_prefs.email != 'off'`, иначе `'skipped'`. Как
  `audit()` — `try/catch`, никогда не бросает. Плюс `autoWatch(issueId, userId)`
  — `INSERT ... ON CONFLICT DO NOTHING`, если `notify_prefs.selfWatch != false`.
- **`server/src/services/mentions.ts`** *(новый)* — `parseMentions(text)`
  (`/(?:^|[^\w@])@([a-z0-9._-]{3,32})/gi` — не ловит e-mail),
  `resolveVisibleMentions(projectId, issueId, logins)` → активные и видящие
  задачу (участник проекта ∪ collaborator ∪ глоб. admin; неявный viewer в MVP
  не упоминаем — D5).
- **Вызовы `emit`:**
  - `routes/comments.ts` `POST /:id/comments` — `autoWatch(автор)` →
    `emit(issue.comment)` → `emit(issue.mention)` по разобранным `@`;
  - `routes/issues.ts` `PATCH /:id` — при смене `assigneeId` на непустой →
    `emit(issue.assigned)` новому исполнителю; при смене `description` — `@` в
    описании → `emit(issue.mention)`;
  - `routes/issues.ts` `POST /:id/transition` — при реальной смене статуса →
    `autoWatch(актор)` + `emit(issue.status)` (payload `from`/`to` — имена
    статусов, для in-app; email их не читает, D9);
  - `routes/collaborators.ts` `PUT /:id/collaborators/:userId` →
    `emit(issue.collaborator)` подключённому;
  - `routes/members.ts` `PUT /:userId` → `emit(project.member)` (`issue_id=null`).
- **`server/src/routes/notifications.ts`** *(новый, `/api`, project-less,
  `requireAuth`)*:
  - `GET /api/notifications?cursor=&limit=` — лента получателя, курсор по
    `created_at`, `{ items, nextCursor, unread }`; элемент — `type`, `actor`
    (мини-профиль), `projectId`/`issueId`, `payload` (для in-app), `read`;
  - `GET /api/notifications/unread-count` → `{ count }` (partial-индекс);
  - `POST /api/notifications/read` — `{ ids? }` или пустое тело = все; `204`;
  - `PATCH /api/notifications/prefs` — `{ email?, selfWatch? }` мерж в
    `users.notify_prefs` (`|| $::jsonb`) → `{ notifyPrefs }`.
- **`contract.ts`** — `NOTIFY_TYPES`, `NotifyType`, `NotifyPrefs`,
  `NotifyPrefsBody` / `NotificationsQuery` / `MarkReadBody`.
- **`auth.ts` / `routes/auth.ts`** — `UserRow.notify_prefs`; `GET /api/auth/me`
  возвращает `notifyPrefs` (**только себе**, не в общем `safeUser` — чужие
  настройки не светим).
- **`app.ts`** — `notificationRoutes` рядом с `userRoutes`.
- **Тесты** — `server/test/notifications.test.ts` (12): актор не уведомляет себя
  (комментарий / самоназначение); деактивированный watcher не получает; комментарий
  → ровно `{assignee/reporter (1 строка), watcher, collaborator}` без актора /
  посторонних / деактивированных; смена статуса — без collaborators; `@` видимого
  → `issue.mention`, `@` невидимого / несуществующего / e-mail → игнор; `@`
  collaborator’а (не участник проекта) → приходит; назначение / подключение /
  добавление в проект; лента + `unread-count` + `read` (выборочно/все) + `prefs`;
  чужая лента пуста; `selfWatch=false` → нет авто-подписки.
- Проверка: `typecheck` 0, `npm test` 67 зелёных.

### Фаза 3 — Фоновый воркер + email  *(сделано)*

`typecheck` 0; `npm test` (без SMTP) — воркер не стартует, **67 зелёных**,
`notifier.test.ts` в `describe.skip`. Живой прогон — сырое письмо ниже.

- **Зависимости** — `nodemailer` + `@types/nodemailer` (dev). Для локальной
  проверки без Docker — `smtp-server` + `mailparser` (dev), как `ldapjs` для
  LDAP-мока.
- **`server/src/services/emailTemplates.ts`** *(новый)* — `renderOne` /
  `renderDigest`. **D9 — гарантия конструкцией:** на вход `MailItem` подаётся
  только `type`, `issueKey`, `projectId`/`issueId` — задачного контента в
  сигнатуре нет. Тема `Taskira · <тип> · <ключ>`; тело — одна строка про тип +
  ссылка `APP_BASE_URL/#/issue/<pid>/<id>` + футер «письмо не содержит текста
  задачи». Дайджест — список ссылок по типам событий.
- **`server/src/services/notifier.ts`** *(новый)* — `runNotifierOnce()`
  (экспортируется для тестов/ручного прогона) + `startNotifier()`/`stopNotifier()`.
  Пачка `email_state='pending'` (JOIN `users` + `issues` для email/prefs/ключа),
  группировка по `user_id`; `mode='off'`/нет email → `skipped`; `mode='daily'` и
  окно ещё не вышло → `deferred` (ждём); иначе `renderOne`/`renderDigest` →
  `nodemailer.sendMail` → `sent`, ошибка → `email_tries++`, при
  `>= NOTIFY_EMAIL_MAX_TRIES` → `failed`. `startNotifier` — `setInterval` c
  re-entrancy guard (`running`) — тики не перекрываются (мягкий лок одного
  процесса); несколько процессов — `NOTIFY_WORKER_ENABLED=false` кроме одного
  (лидер-лок — Фаза 6). `_resetTransport()` для тестов.
- **`server/src/index.ts`** — после `listen`: `if (cfg.notify.emailEnabled &&
  cfg.notify.workerEnabled) startNotifier()`; `stopNotifier()` в `shutdown`.
- **`server/test/mail/sink.mjs`** *(новый)* — SMTP-catcher (`smtp-server` +
  `mailparser`) + HTTP (`GET /` → письма JSON, `DELETE /` — очистить). Локальный
  fallback без Docker; `notifier.test.ts` форкает его сам при `MAIL_KIND != mailpit`.
- **`server/test/notifier.test.ts`** *(новый, `describe.skip` без
  `NOTIFY_EMAIL_ENABLED=true` + `SMTP_HOST`)* — `npm run test:mail`. **6 тестов:**
  - **D9-регрессия:** секретный заголовок задачи и секретный текст комментария
    из фикстуры **отсутствуют** в письме (subject / text / html / raw); есть
    ключ `CORP-1` и ссылка `#/issue/<pid>/<iid>`; строка → `email_state='sent'`;
  - `notify_prefs.email='off'` → `skipped` на emit, письма нет;
  - prefs сменились на `'off'` после emit → воркер защитно `skipped`, не шлёт;
  - нет `users.email` → `skipped` на emit;
  - дайджест (`'daily'`): окно не вышло → `deferred`, письма нет; «состарить»
    строки → одно письмо-сводка, `sent=2`, тоже без контента (D9);
  - SMTP недоступен → `email_tries` растёт, после лимита → `failed`, письма нет.
- **`.github/workflows/test.yml`** — job `mail`: `postgres:16` + `docker compose
  -f docker-compose.mail.yml up -d` (Mailpit) + ожидание `/api/v1/messages` +
  `NOTIFY_EMAIL_ENABLED=true` / `MAIL_KIND=mailpit` env + `npm run test:mail` +
  дамп логов Mailpit. Основной `server` job — без `NOTIFY_EMAIL_ENABLED`.
- **`server/package.json`** — `test:mail` = `vitest run test/notifier.test.ts`.
- **`server/test/mail/README.md`** — запуск (CI Mailpit / локальный sink), что
  проверяется.

### Фаза 4 — Клиент: колокол + настройки  *(сделано)*

`npx tsc --noEmit` 0, `npm run build` ок. Скриншоты `scripts/shot.mjs`:
колокол с бейджем `3` + открытый список; блок настроек в меню пользователя;
после «Прочитать всё» — бейдж и подсветка непрочитанного сняты.

- **`src/api/index.ts`** — `notificationsApi.{ list, unreadCount, markRead, setPrefs }`;
  типы `ServerNotification`, `NotifyPrefs`; `SafeUser.notifyPrefs?` (приходит
  только в `GET /me`).
- **`src/types.ts`** — `NotificationT`, `NotifyPrefsT`; `Data +=
  notifications, unreadCount, notifyPrefs`.
- **`src/store.tsx`** — `mapNotification`; экшены `refreshNotifications`,
  `refreshUnreadCount`, `markNotificationsRead(ids?)` (оптимистично помечает +
  корректирует `unreadCount`), `setNotifyPrefs(patch)` (мерж, тост). `bootstrap`
  ставит `notifyPrefs` из `/me` и зовёт `refreshNotifications()`. Polling:
  `useEffect` при `bootStatus==='ready'` — `setInterval(30 c)` +
  `visibilitychange`/`focus` → `refreshUnreadCount` (только при `visible`).
- **`src/components/Topbar.tsx`** — `Bell()` переписан: бейдж = `data.unreadCount`
  (`99+` при переполнении); `<BellPanel>` на маунте (открытие дропдауна) зовёт
  `refreshNotifications()`; строки — аватар актора + «Кто-то <глагол по типу>
  <ключ>», для `issue.status` — `from → to`, для `project.member` — имя проекта,
  время `relTime`; непрочитанные — синий фон + точка; «Прочитать всё» →
  `markNotificationsRead()`; клик по строке → `markNotificationsRead([id])` +
  `openIssue` (тот же проект) либо `#/issue/<pid>/<iid>` (чужой). Заглушечная
  «Лента активности» из `issue.activity` удалена.
- **`src/components/Topbar.tsx` `<NotifySettings>`** — блок «Уведомления по почте»
  в меню пользователя: сегменты Сразу / Дайджест / Выкл (`notify_prefs.email`) +
  чекбокс «Подписывать меня на мои задачи» (`selfWatch`) → `setNotifyPrefs`.
- **`src/components/IssueModal.tsx` `<MentionText>`** — рендер `@login` чипом
  (`bg-accentsoft text-accent`) в описании и комментариях; переиспользован в
  `SoloView`. Автокомплит по `@` — Фаза 6.
- **Не сделано (Фаза 6):** кросс-проектный переход по клику без reload (сейчас
  через hash), `@`-автокомплит, WebSocket вместо polling.

### Фаза 5 — CI против Mailpit + NOTIFICATIONS_SETUP.md + верификация  *(сделано)*

- **`.github/workflows/test.yml`** — job `mail` (добавлен в Фазе 3): `postgres:16`
  + `docker compose -f docker-compose.mail.yml up -d` (Mailpit) + ожидание
  `/api/v1/messages` + `NOTIFY_EMAIL_ENABLED=true` / `MAIL_KIND=mailpit` +
  `npm run test:mail` + дамп логов Mailpit (`if: always()`). Основной `server`
  job — без `NOTIFY_EMAIL_ENABLED` (воркер не стартует).
- **`NOTIFICATIONS_SETUP.md`** *(новый, корень репо)* — по образцу
  [LDAP_SETUP.md](LDAP_SETUP.md) / [STORAGE_SETUP.md](STORAGE_SETUP.md): §1 что
  делает сервер при `NOTIFY_EMAIL_ENABLED` + **D9-гарантия для ИБ** («письмо
  только со ссылкой»); §2 env-таблица (корп. релей / внешний SMTP), приватный CA;
  §3 SPF/DKIM/DMARC; §4 проверка + CI-job; §5 масштабирование
  (`NOTIFY_WORKER_ENABLED=false` кроме одного узла / `npm run worker` — Фаза 6);
  §6 учётки без `email`; §7 настройки пользователя; §8 траблшутинг; §9 сводка
  in-app vs email.
- **`server/README.md`** — строка `notifications` в «Статусе этапов» + блок
  ручного чек-листа «Уведомления (notifications)» (схема 011, событийный слой,
  in-app API, email-воркер + D9, клиент).
- **`ARCHITECTURE.md`** — «Текущее состояние»: уведомления + фоновый воркер →
  «реализовано»; «Порядок разработки» п. 5 → ✅; в «чего ещё нет» — LDAP-resync и
  storage-sweeper как джобы этого воркера, WebSocket-пуш.
- **`SCOPE.md`** — открытый вопрос «только in-app или обязательно SMTP» снят
  (решено D1/D9).
- Проверка: `typecheck` 0 (сервер + клиент), `npm test` **68 зелёных**,
  `npm run test:mail` **6** (против SMTP), `npm run build` ок. Живые прогоны —
  3 in-app-сценария (Фаза 2) + сырое письмо (Фаза 3) + скриншоты колокола (Фаза 4).

### Фаза 6 — Follow-ups (не в этой миграции)

- **WebSocket-пуш** вместо polling (Этап 3c: смонтировать `/ws`, слать
  `notification:new`, `WsMessage` расширить).
- **`@`-автокомплит** в полях ввода (комментарий, описание).
- **Per-type настройки** (тип × канал), «не беспокоить» по расписанию.
- **LDAP-resync по расписанию** и **сборщик осиротевших объектов хранилища** —
  как джобы того же воркер-лупа ([LDAP Фаза 7](LDAP_MIGRATION.md),
  [FILES Фаза 6](FILES_MIGRATION.md)).
- **Email локальным учёткам** — поле «почта» в профиле пользователя.
- **Браузерные push-уведомления** (Web Push / Notification API).
- **`GET /issues/:id/activity`** — read-эндпоинт истории (сейчас пишется, не читается).
- **Отдельный `npm run worker`** + лидер-лок для нескольких узлов.

---

## 5. Риски и внимание

- **`emit()` не должен ронять запрос** (как `audit()`): всё в try/catch, ошибка —
  в лог. Мутация (назначение/коммент) не откатывается из-за сбоя уведомления.
- **Шум.** Комментарий к «горячей» задаче с 10 watchers = 10 строк + 10 писем.
  Дайджест (D6) обязателен как дефолт-опция; `selfWatch` не должен слать актору
  (он исключён из получателей всегда).
- **Дубликаты писем.** Воркер обязан `UPDATE ... WHERE email_state='pending'`
  перед отправкой (мягкий лок); при рестарте в момент отправки возможен повтор —
  приемлемо, задокументировать. Несколько процессов без лока — **нельзя**
  (`NOTIFY_WORKER_ENABLED`).
- **Утечка через упоминания.** Резолв `@` строго среди тех, кто видит задачу
  (D5). Тест на `@` постороннего → нет строки.
- **Персональные данные в письме.** Закрыто D9: письмо несёт только тип события +
  ключ задачи + ссылку. `payload` в БД (заголовок/отрывок) — только для in-app,
  `emailTemplates` его не читает. Регрессионный тест Фазы 3 проверяет, что
  заголовок/текст из фикстуры в теле письма **отсутствуют**. Проверять при каждой
  правке шаблонов.
- **`users.email` из LDAP** может устареть между ресинками — письмо уйдёт на
  старый адрес. Митигация — ресинк (LDAP Фаза 7).
- **Часовой пояс дайджеста** — сервер шлёт по своему TZ; для «ежедневно в 9:00»
  нужен per-user TZ — вне MVP (дайджест = «раз в N часов от первого события»).
- **Миграция 011** должна пройти до старта воркера; `notify_prefs` с дефолтом
  `{}` — существующие юзеры получают дефолтное поведение (email `instant` если
  есть адрес).
- **Тесты не должны слать письма** — воркер не стартует при `NODE_ENV=test`;
  job `mail` — отдельный, с Mailpit.
- **Клиентский polling** — не долбить сервер: `unread-count` дёшев (partial
  index), интервал ≥ 30 с, пауза при скрытой вкладке.

---

## 6. Оценка объёма

| Фаза | Область | Размер |
|---|---|---|
| 1 | миграция 011 + `config.notify` + Mailpit compose + `.env.example` | S–M |
| 2 | `services/notify.ts` + `mentions.ts` + `emit()` в 4–5 роутах + `routes/notifications.ts` + тесты | **L** |
| 3 | `nodemailer` + `services/notifier.ts` (воркер, дайджест, ретрай) + шаблоны + тесты против Mailpit | **M–L** |
| 4 | клиент: `notificationsApi` + `data.notifications` + polling + переписанный `Bell()` + панель настроек + рендер `@` | **M–L** |
| 5 | CI-job `mail` + `NOTIFICATIONS_SETUP.md` + чек-лист + `ARCHITECTURE`/`SCOPE` | S–M |
| 6 | WebSocket-пуш, `@`-автокомплит, per-type prefs, worker-джобы LDAP/FILES, push | отдельно |

Критический путь: 1 → 2 → 3 → 4 → 5. Фаза 3 при необходимости — follow-up PR.
Фаза 6 — вне захода.

---

## 7. Открытые вопросы — ЗАКРЫТЫ

Все подтверждены как предложено (см. §3 «РЕШЕНО»):

1. **D1** — да, in-app всегда + email опционально за `SMTP_*`, Mailpit в CI.
2. **D2** — да, набор триггеров полный (назначение · комментарий по подписке ·
   `@`-упоминание · смена статуса · подключение collaborator · состав проекта).
3. **D3** — да, одна таблица `notifications` с `email_state` (без outbox);
   in-app по polling, WebSocket → Фаза 6.
4. **D4** — да, воркер в основном процессе (`setInterval`), флаг
   `NOTIFY_WORKER_ENABLED` заложен под вынесение в `npm run worker`.
5. **D5** — да, `@` парсит сервер, резолвит только среди видящих задачу;
   автокомплит → Фаза 6.
6. **D6** — да, MVP-настройки: `email` (сразу/дайджест/выкл) + `selfWatch`;
   per-type → Фаза 6.
7. **D7** — да, `nodemailer`, RU plain-text + лёгкий HTML, ссылка через
   `APP_BASE_URL`.
8. **Именование/ветка** — `NOTIFICATIONS_MIGRATION.md` + `NOTIFICATIONS_SETUP.md`,
   ветка `feat/notifications`.
9. **D9 — содержимое письма: ТОЛЬКО ссылка.** Ни заголовка задачи, ни описания,
   ни отрывка комментария в теле письма. Только тип события + ключ задачи +
   прямая ссылка в приложение. `payload` в БД полон для in-app, email-шаблон его
   не читает; регрессионный тест Фазы 3 это проверяет.
