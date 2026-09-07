# FILES_MIGRATION — вложения к задачам (файлы)

Статус: **решения §3 подтверждены (D1–D6). Фазы 1–3 сделаны (сервер: миграция 010,
конфиг, абстракция хранилища + локальный драйвер, `@fastify/multipart`, guard по
magic-байтам, 4 роута, `npm test` 54 зелёных, живой прогон; клиент:
`attachmentsApi`/`apiUpload`/`downloadBlob`, экшены store, `<AttachmentField>` в
`IssueModal`, вложения в `SoloIssueCard`, `tsc`/`build` 0). Дальше — Фаза 4
(драйвер S3/MinIO + CI-job + STORAGE_SETUP.md).**
Ветка `feat/attachments`. Порядок фаз: 1 → 2 → 3 → 4 → 5
(Фаза 4 — драйвер S3/MinIO; при затыке с инфраструктурой отделяется в follow-up PR,
т.к. локальный драйвер к тому моменту уже оттестирован). Фаза 6 — вне захода.

Контекст: [SCOPE.md](SCOPE.md) — «Вложения к задачам (файлы)» в списке MVP;
[ARCHITECTURE.md](ARCHITECTURE.md) — компонент «Файловое хранилище — вложения к
задачам (S3-совместимое, например MinIO, для on-prem)» и п. 4 «Порядка разработки»
(«Файловое хранилище для вложений — не начато»). Предыдущие миграции —
[ROLE_MIGRATION.md](ROLE_MIGRATION.md), [DEPT_MIGRATION.md](DEPT_MIGRATION.md),
[COLLAB_MIGRATION.md](COLLAB_MIGRATION.md), [LDAP_MIGRATION.md](LDAP_MIGRATION.md).

Отдельный документ по итогам — **STORAGE_SETUP.md** (подключение S3/MinIO на
реальном on-prem сервере), см. §4 Фаза 4.

Следующий заход после этого — **уведомления** (email + in-app), тоже сначала
план по этому образцу, отдельным документом NOTIFICATIONS_MIGRATION.md.

---

## 1. Зачем

[SCOPE.md](SCOPE.md) относит вложения к MVP; [ARCHITECTURE.md](ARCHITECTURE.md)
закладывает под них отдельный компонент «файловое хранилище (S3-совместимое, on-prem)».
Сейчас прикрепить файл к задаче нельзя вообще: ни таблицы, ни эндпоинта, ни
обработки multipart. Пользователи (ИБ, HR, бухгалтерия, юристы, разработка) носят
скриншоты, PDF, docx/xlsx, логи, `.eml`/`.msg`, для ИБ — `.pcap` — сейчас всё это
идёт мимо трекера (почтой, в мессенджерах), задача теряет контекст.

Нужно: загрузка/скачивание/удаление файлов на карточке задачи, с наследованием
видимости задачи (участники проекта по роли, глоб. admin, неявный viewer по
департаменту/`is_shared`, приглашённый в задачу collaborator), с корпоративными
ограничениями по размеру и типу (в т.ч. блокировка исполняемых файлов — проверка
не только по расширению, но и по сигнатуре, чтобы переименованный `.exe → .jpg` не
проходил), и с хранилищем, которое переживёт переход с одного сервера на несколько.

**Ограничение разработки:** как и с LDAP — вся разработка идёт против локальных
средств. Драйвер локального диска работает без Docker; S3-совместимый драйвер
проверяется против **MinIO в Docker** (compose-сервис + отдельный CI-job), а на
реальном on-prem MinIO/же — по STORAGE_SETUP.md.

---

## 2. Что в коде сейчас

| Слой | Файл | Состояние |
|---|---|---|
| Задача | `services/issues.ts` `getIssueDto` | DTO задачи + `collaborators` + `participants`; **`attachments` нет** |
| Карточка задачи (клиент) | `src/components/IssueModal.tsx` | поля, метки, `<CollaboratorField>`, комментарии, watchers; **вложений нет** |
| Одиночный просмотр | `src/components/SoloView.tsx` / `CollaboratingView` | read-only карточка (`SoloIssueCard`) + комментарии; **вложений нет** |
| HTTP-слой клиента | `src/api/index.ts` `api()` | всегда `JSON.stringify(body)` + `Content-Type: application/json`; **multipart не поддержан** |
| Доступ к задаче | `middleware.ts` `requireIssuePerm(perm)` | грузит задачу в `req.issueRef`, сверяет `issue.project_id == :projectId`, резолвит роль (`effectiveRole`), fallback приглашённого для `perm ∈ {browse, comment}` |
| Права | `permissions.ts` ×2 `MATRIX` | заморожен ([ROLE_MIGRATION.md §3.2](ROLE_MIGRATION.md)); 10 прав, роли `admin/manager/employee/viewer`. `comment` есть у `admin/manager/employee` (+ collaborator через fallback); `delete` — `admin/manager` |
| Комментарии | `routes/comments.ts` | `GET` — `requireIssuePerm("browse")`; `POST` — `requireIssuePerm("comment")`; delete-эндпоинта нет |
| Multipart | — | `@fastify/multipart` не установлен; Fastify 5 сырое тело не парсит |
| Конфиг | `config.ts` | свой парсер `.env` (без dotenv), `Config` кэшируется; fail-fast паттерн (`fail()`), `envBool()` |
| БД | `db.ts` | `q`/`one`/`exec`/`withClient`; `migrate()` применяет `server/migrations/*.sql` по имени, каждый файл в одной транзакции; `pgcrypto`/`gen_random_uuid()` уже включён (001) |
| Миграции | `server/migrations/` | последняя — `009_ldap.sql` (005 пропущена); следующая — **010** |
| Аудит | `audit.ts` | fire-and-forget `audit_log`, не бросает в запрос |
| CI | `.github/workflows/test.yml` | job `server` (`postgres:16`, `AUTH_MODE=local`) + job `ldap` (docker compose OpenLDAP) |
| Хранилище файлов | — | **нет** — ни абстракции, ни драйвера, ни S3 SDK |

Схема: таблицы `attachments` нет. Каскад при удалении задачи/проекта сейчас
снимает `comments`/`activity`/`issue_watchers`/`issue_collaborators` — строки
`attachments` добавятся в этот же каскад, но **файлы в хранилище остаются
осиротевшими**, если их не удалять явно (см. D5 / §5).

---

## 3. Ключевые решения (РЕШЕНО)

Подтверждено целиком, как предложено:

| # | Решение |
|---|---|
| **D1** (вопрос 1) | Абстракция `Storage` + **оба** драйвера в этом заходе. `STORAGE_DRIVER` = `local` (деф., диск) \| `s3` (S3-совместимое: MinIO/on-prem). Локальный — dev и одно-серверные инсталляции; S3 — прод-рекомендация, проверяется отдельным CI-job против настоящего MinIO. `storage_driver` в строке `attachments`. |
| **D2** (вопрос 2) | Загрузка — `requireIssuePerm("comment")` (admin/manager/employee + приглашённый collaborator; viewer — нет). Список/скачивание — `requireIssuePerm("browse")`. Удаление — свой файл всегда, чужой — `requireIssuePerm("delete")` (admin/manager). **Новых ключей в MATRIX нет.** |
| **D3** (вопрос 3) | `ATTACH_MAX_BYTES` = **25 MiB** (env, enforce `@fastify/multipart` `limits.fileSize`), `ATTACH_MAX_PER_ISSUE` = **50**. Типы — **чёрный список** (не белый): по расширению (`ATTACH_BLOCK_EXT`) **и** по magic-байтам (`MZ`/`ELF`/Mach-O/shebang/…), плюс отказ при несовпадении расширение↔сигнатура. Свой мини-детект (~20 сигнатур), **без новой зависимости**. `content_type` в БД — нормализованный, не клиентский. Санитизация имени; ключ хранилища = `<issueId>/<uuid>`; `sha256` при приёме. |
| **D4** (вопрос 4) | Видимость вложения = видимость задачи, **отдельной модели прав нет**. Все 4 эндпоинта — под `/api/projects/:projectId/issues/:id/attachments[/:attId]`, через тот же `requireIssuePerm`, что чтение/комментирование задачи (`effectiveRole` = роль в проекте ∪ глоб. admin ∪ неявный viewer по департаменту/`is_shared` ∪ collaborator). IDOR-сверки `issue.project_id == :projectId` и `attachment.issue_id == :id`. |
| **D5** | Файл всегда **стримится через API после `requireIssuePerm`**. Никаких вечных/presigned ссылок (короткий presigned S3 — опция в STORAGE_SETUP.md, по умолчанию выкл). Заголовки: `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`; активные типы (`text/html`, `image/svg+xml`, `application/xhtml+xml`) → `application/octet-stream`. |
| **D6** | Вложения — у **задачи** (`attachments.issue_id`), не у комментариев. Прикрепление к комментарию (nullable `comment_id`) — Фаза 6. |

Ниже — обоснования и отклонённые альтернативы по каждому пункту.

### D1 (вопрос 1). Хранилище — абстракция + **оба** драйвера в этом заходе: локальный диск по умолчанию, S3/MinIO за env-переключателем и в CI

**Рекомендация.** Ввести интерфейс `Storage` (`put` / `get` (stream) / `delete` /
`stat`) и `STORAGE_DRIVER` = `local` (деф.) | `s3`.
- `local` — `LocalDiskStorage`: пишет в `STORAGE_DIR` (вне репозитория,
  git-ignored), ключ объекта `<issueId>/<uuid>`. Ноль внешних зависимостей, dev
  работает сразу.
- `s3` — `S3Storage` поверх S3-совместимого API (MinIO / любой on-prem S3):
  `STORAGE_S3_ENDPOINT` / `_BUCKET` / `_REGION` / `_ACCESS_KEY` / `_SECRET_KEY` /
  `_FORCE_PATH_STYLE`. Это правильный ответ для «нескольких серверов» (upload
  попал на один узел — download с любого).

Оба драйвера пишутся сразу. Локальный — путь для разработки и маленьких
одно-серверных инсталляций; S3 — рекомендуемый прод-вариант, проверяется
**отдельным CI-job против настоящего MinIO** (полная параллель job `ldap`).
`storage_driver` пишется в строку `attachments` — при будущей миграции хранилища
видно, где лежит каждый объект.

**Обоснование.** Пользователь просил «сразу правильно». «Правильно» здесь — не
«заставить всех поднимать MinIO в dev», а **иметь готовый и оттестированный
S3-путь**, чтобы on-prem-развёртывание на несколько узлов не требовало переделки.
Тот же приём сработал с LDAP: локальный режим по умолчанию, реальный сервер за
env и в CI. Стоимость абстракции — небольшая (интерфейс + два класса), драйверы
не текут в остальной код (роуты и сервис работают только с `Storage`).

**Отклонено.**
- *Только локальный диск.* Не растёт на несколько серверов без переделки (upload
  на узле A, download через LB на узел B → 404). Сетевой шар (NFS/SMB) как
  паллиатив — перекладывает проблему на ops и всё равно тупик.
- *Только MinIO, без локального.* Каждый `npm run dev` и каждый прогон тестов
  требует Docker; лишнее трение там, где локальный диск тривиален.
- *Прямой upload из браузера в S3 по presigned PUT.* Файл не проходит через
  сервер → серверная проверка типа/размера/magic-байт невозможна до записи
  (D3 ломается). Follow-up, не MVP.

### D2 (вопрос 2). Кто загружает/удаляет — **загрузка по праву `comment`; удаление: свой файл — всегда, чужой — по праву `delete`**. Новых ключей в MATRIX нет

**Рекомендация.**
- **Загрузка** — `requireIssuePerm("comment")`. Тот же круг, что комментирует:
  `admin` / `manager` / `employee` проекта **+ приглашённый collaborator** (через
  существующий fallback `perm ∈ {browse, comment}`). `viewer` и неявный viewer
  (департамент/`is_shared`) — не могут. Вложение — это вклад в обсуждение/запись
  по задаче, ровно как комментарий.
- **Список / скачивание** — `requireIssuePerm("browse")` (все, кто видит задачу).
- **Удаление** — загрузивший удаляет свой файл всегда; чужой — только
  `requireIssuePerm("delete")` (`admin` / `manager`). `employee` не сносит чужие
  вложения даже на своей задаче (уборка — на менеджере/админе).

**Обоснование.** Не плодим право. Загрузка ложится на `comment` без искажения
смысла; «снести чужое» ложится на `delete` — тот же повышенный порог, что у
удаления самой задачи. Замороженная зеркальная `MATRIX` не трогается (в отличие
от COLLAB, где `manageCollaborators` был **новой** способностью — здесь новой нет).

**Отклонено.**
- *Загрузка по `edit`.* `employee` правит только свои задачи → не смог бы
  приложить файл к задаче, над которой работает по обсуждению; collaborator
  (только `browse`+`comment`) — тоже нет. Слишком узко.
- *Новое право `manageAttachments` (аддитивный ключ в MATRIX ×2, как
  `manageCollaborators`).* Возможно и «честно» отображается в `PermissionsView`,
  но это *не новая* способность — это `comment`/`delete` под другим именем.
  Держим в уме как запасной вариант, если позже потребуется разнести.
- *Кто угодно с `browse` может загружать.* Тогда `viewer` пишет в задачу —
  противоречит роли «только просмотр».

### D3 (вопрос 3). Ограничения — лимит размера в env, **чёрный список** опасных типов, проверка по расширению **и** по magic-байтам, санитизация имени

**Рекомендация.**

*Размер.* `ATTACH_MAX_BYTES` (деф. **25 MiB** = `26214400`). Enforce на уровне
`@fastify/multipart` `limits.fileSize` — стрим обрывается, файл целиком в память
не буферизуется. Плюс `ATTACH_MAX_PER_ISSUE` (деф. **50**) — потолок числа
вложений на задачу.

*Типы — чёрный список, не белый.* Корпоративный трекер для всех отделов: они
шлют `.xlsx .docx .pptx .pdf .png .jpg .gif .svg .txt .csv .log .zip .7z .eml
.msg .json .xml .pcap` и десятки других легитимных форматов — белый список
превратится в стену отказов. Поэтому **разрешено по умолчанию, запрещён жёсткий
список** исполняемого/скриптового:

- **по расширению** (`ATTACH_BLOCK_EXT`, деф.): `exe dll scr com pif bat cmd
  ps1 psm1 vbs vbe js jse wsf wsh hta msi msp cpl reg lnk sh bash zsh ksh run
  bin jar apk app dmg pkg deb rpm elf so dylib gadget inf`;
- **по сигнатуре (magic-байты, первые ≤ 512 байт)** — ловит переименованный
  исполняемый файл: `MZ` (PE/DOS `4D 5A`), `\x7fELF` (`7F 45 4C 46`), Mach-O
  (`FE ED FA CE` / `CE FA ED FE` / `CA FE BA BE`), `#!` shebang, `<?php`,
  `PK\x03\x04` только если внутри `.jar`/`.apk`-структура (по расширению уже
  отсечём — здесь просто не «улучшаем» до исполняемого);
- **несовпадение расширение ↔ сигнатура** для известных сигнатур (`.jpg`, а
  байты — `MZ`; `.pdf`, а байты — `PK`) → **отказ `400`** «тип файла не
  соответствует расширению». Без сигнатуры (текст, произвольные бинарники) —
  пропускаем.

Таблица сигнатур — маленькая, ~20 записей, **без новой зависимости** (не тянем
`file-type`: это ESM-heavy пакет, а нам нужен только детект «это исполняемое?»
и грубое «jpg/png/pdf/zip/office»).

`content_type` в БД — **нормализованный** (по расширению + подтверждённой
сигнатуре), не присланный клиентом. Отдаётся при скачивании (D5).

*Имя файла.* Санитизация: убрать путь (`/`, `\`, `..`), управляющие символы,
ведущие точки/пробелы; ограничить длину (`ATTACH_MAX_FILENAME`, деф. 200);
пустое после чистки → `attachment`. Оригинальное (очищенное) имя хранится
отдельно в `filename`; ключ в хранилище — `<issueId>/<uuid>`, из имени не
строится.

*Целостность.* Считаем `sha256` при приёме, кладём в строку (контроль +
будущий дедуп).

**Обоснование (SOC-бэкграунд).** Проверка только по расширению обходится
переименованием; проверка только по MIME — клиентский `Content-Type`
подделывается. Комбинация «расширение + сигнатура + флаг несовпадения» —
дешёвая и закрывает основной вектор «прислать `.exe` под видом картинки».
Полноценный антивирус (ClamAV) — Фаза 6.

**Отклонено.**
- *Белый список расширений.* Постоянные ложные отказы для HR/бухгалтерии/юристов.
- *Доверять `Content-Type` из multipart.* Подделывается тривиально.
- *Зависимость `file-type`/`mmmagic`.* Избыточно для нашей задачи; свой
  мини-детект достаточен и не раздувает `node_modules`.

### D4 (вопрос 4). Видимость вложения = видимость задачи, **без отдельной модели прав** — ПОДТВЕРЖДАЮ

Да, это автоматически верно **при условии**, что все эндпоинты вложений сидят под
project-scoped путём и проходят через тот же `requireIssuePerm`, что и
чтение/комментирование задачи:

```
GET    /api/projects/:projectId/issues/:id/attachments            requireIssuePerm("browse")
POST   /api/projects/:projectId/issues/:id/attachments            requireIssuePerm("comment")   (multipart)
GET    /api/projects/:projectId/issues/:id/attachments/:attId     requireIssuePerm("browse")    (скачивание)
DELETE /api/projects/:projectId/issues/:id/attachments/:attId     requireIssuePerm("browse") + правило D2
```

`requireIssuePerm`:
- грузит задачу, **сверяет `issue.project_id === :projectId`** (IDOR-защита пути);
- резолвит `effectiveRole` — это и есть вся видимость: участник проекта по роли,
  глоб. `admin`, неявный `viewer` (департамент проекта / `is_shared`,
  [LDAP_MIGRATION.md D8](LDAP_MIGRATION.md)), приглашённый collaborator (fallback
  для `browse`/`comment`);
- в хендлере скачивания/удаления дополнительно сверяем **`attachment.issue_id ===
  :id`** — иначе `404`.

Отдельной таблицы прав на вложение нет и не нужно: строка `attachments` несёт
только `issue_id`, а доступ к задаче уже полностью описывает, кто её видит.
Регрессионный тест обязателен: «участник видит задачу → видит и качает её
вложения», «collaborator → да», «не-участник не-shared проекта → `404` на всех
четырёх эндпоинтах», «`/projects/A/issues/<из B>/attachments` → `404`».

### D5 (всплывает из D4). Файл всегда отдаётся **потоком через API после проверки прав**; никаких «вечных» ссылок; заголовки против stored-XSS

**Рекомендация.** Скачивание — `GET …/attachments/:attId`: после `requireIssuePerm`
сервис читает объект из `Storage.get()` и **стримит** его в ответ с:
- `Content-Disposition: attachment; filename="<санит. имя>"` — всегда вложение,
  никогда inline-рендер;
- `Content-Type` — нормализованный из БД, но для потенциально активных типов
  (`text/html`, `image/svg+xml`, `application/xhtml+xml`) принудительно
  `application/octet-stream`;
- `X-Content-Type-Options: nosniff`;
- `Cache-Control: private, no-store`.

Для драйвера `local` — стрим с диска. Для `s3` — по умолчанию тоже проксируем
поток через API (каждый GET авторизован). Presigned-URL S3 как опция — **только
короткий TTL (≤ 60 c), выдаётся после `requireIssuePerm("browse")`**; за/против
описываем в STORAGE_SETUP.md, по умолчанию выключено.

**Обоснование.** Так «наследование видимости» (D4) не размывается: нет состояния,
которое живёт дольше проверки прав. Заголовки закрывают загрузку `.html`/`.svg`
как хранимый XSS с origin API. Отдавать статику напрямую с диска nginx-ом мимо
API — соблазнительно по нагрузке, но тогда права проверять негде; отвергнуто для
MVP (внутренняя сеть, объёмы небольшие).

**Отклонено.**
- *Плоский маршрут `/api/attachments/:id`.* Нет `:projectId`/`:id` в контексте →
  `requireIssuePerm` не отработает IDOR-сверку. Только project-scoped путь.
- *Долгоживущие public/presigned ссылки.* Расшариваются вне контура, переживают
  отзыв доступа к задаче.
- *Раздача nginx-ом напрямую.* Обход проверки прав.

### D6 (всплывает). Вложения — у задачи, **не у комментариев** (MVP)

**Рекомендация.** `attachments.issue_id`, без `comment_id`. Файл прикреплён к
задаче; в треде обсуждения на него ссылаются словами. Прикрепление файла прямо к
комментарию (как в Jira/GitHub) — Фаза 6 (добавится nullable `comment_id` без
слома схемы).

**Обоснование.** Меньше поверхности в MVP; на карточке один список вложений —
проще UI и модель каскадов. Ничего не закрывает на будущее.

---

## 4. План по фазам

Критический путь: **1 → 2 → 3 → 4 → 5**. Фаза 4 (драйвер S3/MinIO + CI-job +
STORAGE_SETUP.md) при затыке инфраструктуры отделяется в follow-up PR — локальный
драйвер к тому моменту уже покрыт тестами. Фаза 6 — вне захода.

### Фаза 1 — Схема + конфиг + абстракция хранилища + локальный драйвер  *(сделано)*

Ветка `feat/attachments`. Ни одного роута/`middleware` не тронуто — деплой-безопасно.
`STORAGE_DRIVER=local` по умолчанию, `npm run typecheck` 0, `npm test` — 38 зелёных
(поведение входа/задач не изменилось). Миграция 010 применяется в тестовой схеме
(`schema_migrations`: 001–004, 006–010).

**Отличие от плана:** каталог `STORAGE_DIR` для драйвера `local` **не** обязателен и
**не** проверяется в `config.ts` — иначе каждый тест без `STORAGE_DIR` падал бы на
старте. Дефолт — `server/var/attachments` (git-ignored); `mkdir -p` + проверка
записи вынесены в `makeStorage()` (зовётся из Фазы 2, не на каждом `loadConfig`).
Fail-fast в `config.ts` остаётся только для ключей `STORAGE_S3_*` при
`STORAGE_DRIVER=s3` и для нечисловых `ATTACH_*` (как `LDAP_TIMEOUT_MS` после ревью
LDAP).

**`server/migrations/010_attachments.sql`** (после 009):

```sql
CREATE TABLE attachments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id       uuid NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  uploaded_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  filename       text NOT NULL,                 -- оригинальное, санитизированное
  content_type   text NOT NULL,                 -- нормализованный MIME (не клиентский)
  byte_size      bigint NOT NULL CHECK (byte_size > 0),
  sha256         text   NOT NULL,
  storage_driver text   NOT NULL CHECK (storage_driver IN ('local','s3')),
  storage_key    text   NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (storage_driver, storage_key)
);
CREATE INDEX idx_attachments_issue ON attachments (issue_id);
```

Бэкфилла нет — новая возможность. Обратима (`DROP TABLE attachments` + ручная
чистка каталога/бакета). Каскад: удаление задачи (или проекта → `issues`) снимает
строки; **файлы в хранилище — отдельная забота** (D5 / §5): хендлеры удаляют
объект после удаления строки; для каскада задачи/проекта — best-effort уборка +
follow-up «сборщик сирот».

**`config.ts`** — `Config.storage`:

| Переменная | Назначение |
|---|---|
| `STORAGE_DRIVER` | `local` (деф.) \| `s3` |
| `STORAGE_DIR` | драйвер `local`: каталог вне репо (git-ignored); необязателен, деф. `server/var/attachments`; `mkdir -p` + проверка записи в `makeStorage()` |
| `STORAGE_S3_ENDPOINT` | `https://minio.corp:9000` |
| `STORAGE_S3_BUCKET` / `_REGION` | бакет / регион (`us-east-1` по умолчанию для MinIO) |
| `STORAGE_S3_ACCESS_KEY` / `_SECRET_KEY` | ключи; только env, не логировать |
| `STORAGE_S3_FORCE_PATH_STYLE` | `true` для MinIO |
| `ATTACH_MAX_BYTES` | деф. `26214400` (25 MiB) |
| `ATTACH_MAX_PER_ISSUE` | деф. `50` |
| `ATTACH_MAX_FILENAME` | деф. `200` |
| `ATTACH_BLOCK_EXT` | CSV; деф. — список из D3 |

Валидация в стиле `buildLdapConfig()`: `STORAGE_DRIVER=s3` ⇒ обязательны
`ENDPOINT`/`BUCKET`/`ACCESS_KEY`/`SECRET_KEY`; числа (`ATTACH_*`) — целое > 0 либо
`fail` (`envPosInt`, как `LDAP_TIMEOUT_MS` после ревью LDAP). Каталог `local` —
см. «Отличие от плана» выше.

**`server/src/services/storage.ts`** *(новый)* — интерфейс + фабрика:

```ts
export interface StoredObject { size: number; }        // content_type держит строка attachments
export interface Storage {
  put(key: string, data: Readable, meta: { contentType: string; size: number }): Promise<void>;
  get(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;                  // идемпотентно
  stat(key: string): Promise<StoredObject | null>;
}
export function newStorageKey(issueId: string): string;        // `${issueId}/${randomUUID()}`
export function makeStorage(cfg: Config): Promise<Storage>;     // local | s3; для local — ensureReady()
```

Реализован `LocalDiskStorage` (запись/чтение/удаление в `config.storage.dir`,
`keyToRelPath` c защитой от обхода каталога, потоковая запись во временный файл
`<dest>.<uuid>.tmp` + атомарный `rename`). `S3StorageStub` — все методы `throw`
до Фазы 4.

**`server/docker-compose.storage.yml`** *(новый)* — `minio/minio`, порт 9000/9001,
том, healthcheck, дефолтный бакет через `mc` (по образцу `docker-compose.ldap.yml`).
**`.env.example`** — `STORAGE_DRIVER=local` + закомментированный блок `STORAGE_S3_*`
и `ATTACH_*`. **`.gitignore`** — `server/var/attachments/` (дефолтный `STORAGE_DIR`
для dev).

`npm run typecheck` 0, `npm test` без изменений (38 зелёных) — код не подключён к
`app.ts`.

### Фаза 2 — Сервер: multipart + роуты вложений + валидация  *(сделано)*

Ветка `feat/attachments`. `npm run typecheck` 0 (сервер + клиент), `npm test` —
**54 зелёных** (38 прежних + 16 новых в `access.attachments.test.ts`),
`npm run build` ок. Живой прогон (`.exe`→`.jpg` по magic-байтам, IDOR-скачивание)
пройден — см. конец §4.

- **`@fastify/multipart`** (`^9.4.0`, Fastify 5) в `server/package.json`;
  `app.register(multipart, { throwFileSizeLimit: true, limits: { fileSize:
  cfg.storage.maxBytes, files: 1, fields: 10, fieldSize: 1024 } })`.
- **`server/src/services/fileGuard.ts`** *(новый)* — `HEAD_BYTES=512`,
  `sanitizeFilename(raw, maxLen)`, `extOf(name)`, `sniff(head): SigId | undefined`
  (инлайн-таблица: `pe`/`elf`/`macho`/`script` + `png`/`jpeg`/`gif`/`pdf`/`zip`/
  `rar`/`7z`/`gzip`/`svg`/`xml`), `checkUpload({ filename, head, maxFilename,
  blockExt })` → `{ filename, contentType, sniffed }` либо
  `ApiHttpError(400, "ATTACHMENT_REJECTED", …)` — чёрный список расширений,
  исполняемая сигнатура, несовпадение расширение↔сигнатура. Без зависимостей.
  Клиентский `declaredMime` не используется (нормализуем сами: `EXT_MIME` →
  `SIG_MIME` → `application/octet-stream`).
- **`server/src/services/attachments.ts`** *(новый)* — `listAttachments`,
  `countForIssue`, `getAttachmentInIssue(issueId, attId)` (IDOR-сверка),
  `createAttachment({ issueId, userId, part })` (`readHead` без разрушения потока
  → `checkUpload` **до** записи → `Readable.from` с `sha256`/размером на лету →
  `Storage.put` → INSERT; `part.file.truncated` / `FST_REQ_FILE_TOO_LARGE` →
  `Storage.delete` + `413`), `openAttachment`, `canDeleteAttachment(row, userId,
  role)` (D2), `deleteAttachment`, `storageKeysForIssue` + `deleteStorageObjects`
  (уборка при удалении задачи). Хранилище — одна ленивая `makeStorage()` на процесс.
  Импортит `db` / `config` / `storage` / `fileGuard` / `permissions` — цикла нет.
- **`server/src/routes/attachments.ts`** *(новый)*, под
  `/api/projects/:projectId/issues` (`prefix: "/issues"`, рядом с `commentRoutes`):
  - `GET /:id/attachments` — `requireIssuePerm("browse")` → `AttachmentDto[]`;
  - `POST /:id/attachments` — `requireIssuePerm("comment")`, multipart; `413` при
    превышении `fileSize`, `409` при превышении `ATTACH_MAX_PER_ISSUE`, `400` от
    `fileGuard`; `201` + DTO;
  - `GET /:id/attachments/:attId` — `requireIssuePerm("browse")`; сверка
    `att.issue_id === :id` → иначе `404`; стрим + заголовки D5;
  - `DELETE /:id/attachments/:attId` — `requireIssuePerm("browse")` + правило D2
    (`att.uploaded_by === me` **или** `roleCan(role, "delete")`), иначе `403`;
    `204`; повтор → `404`.
  - Аудит `attachment.add` / `attachment.remove` (`{ issueId, projectId, attId,
    filename, byteSize, viaCollaborator? }`).
- **`routes/issues.ts` DELETE `/:id`** — `storageKeysForIssue` **до** `DELETE FROM
  issues`, затем `deleteStorageObjects` (best-effort). Удаление **проекта**
  объекты пока не чистит — подтверждено живым прогоном (осталась одна сирота) →
  сборщик сирот, Фаза 6 (§5).
- **`app.ts`** — `multipart` в `buildApp`; `attachmentRoutes` под
  `/api/projects/:projectId` рядом с `commentRoutes`.
- **`services/issues.ts`** — `IssueDetailDto += attachments: AttachmentDto[]`;
  `getIssueDto` доклеивает (только детальный `GET /:id`).
- **`contract.ts`** — `AttachmentParams = z.object({ attId: uuid })`;
  `LIMITS.attachment = { maxBytes, maxPerIssue, maxFilename }`. Роут проверяет
  `attId` инлайн-`UUID_RE` (как `:id` в middleware) → `404`, не 500 на кривом uuid.
- **`src/validation.ts`** (клиент) — те же `LIMITS.attachment` (зеркало).
- **`test/env.ts`** — `STORAGE_DIR` = os-temp, `ATTACH_MAX_BYTES=4096`,
  `ATTACH_MAX_PER_ISSUE=5` (тесты не гоняют мегабайты); `global-setup.ts` чистит
  каталог; `helpers.ts` `resetDb` += `attachments` в `TRUNCATE`.
- **Тесты** — `server/test/access.attachments.test.ts` (16), `npm test` → 54:
  - guard: `.exe` → `400` (расширение); `.jpg` с байтами `MZ` → `400` (сигнатура
    `pe`, **не** расширение); `.png` с байтами `%PDF-` → `400` (несовпадение);
    настоящий PNG → `201`, `contentType='image/png'`, `sha256` заполнен;
  - права: `viewer` upload → `403`; `employee` → `201`; collaborator → `201`;
    `employee` сносит свой → `204`, чужой → `403`; `manager` — любой → `204`,
    повтор → `404`;
  - видимость/IDOR: не-участник не-shared → `403` (список и upload);
    id вложения из чужой задачи через свой путь → `404`;
    `/projects/SEC/issues/<CORP-issue>/…` → `404`; участник (в т.ч. viewer)
    качает → `200` и получает те же байты;
  - D5: `Content-Disposition: attachment` + `X-Content-Type-Options: nosniff`;
    `.svg` (в БД `image/svg+xml`) отдаётся как `application/octet-stream`;
  - лимиты: файл > 4096 → `413`; 6-й файл → `409`;
  - `getIssueDto.attachments` отражает список; удаление задачи каскадит строки.
- Проверка: `typecheck` 0 (сервер + клиент), `npm test` 54 зелёных, `npm run build` ок.

**Живой прогон** (dev :8080, `STORAGE_DRIVER=local`, вход `admin`):

- *Сценарий 1 — `.exe` под видом `.jpg`.* Файл с байтами `4D 5A …` («MZ»),
  `filename=quarterly-report.jpg`, `Content-Type: image/jpeg` →
  **`400 ATTACHMENT_REJECTED`** «Файл распознан как исполняемый или скрипт
  (сигнатура pe) — загрузка запрещена». Контроль: тот же `.jpg` с настоящими
  байтами `FF D8 FF` → **`201`** (расширение `.jpg` не в чёрном списке — отказ
  был именно по magic-байтам). Контроль: те же `MZ`-байты как `payload.exe` →
  `400` «Файлы с расширением .exe загружать нельзя» (другой барьер).
- *Сценарий 2 — IDOR при скачивании.* Вложение загружено в задачу A. Запрос
  `GET /api/projects/<proj>/issues/<B-issue>/attachments/<A-attId>` →
  **`404`** «Вложение не найдено» (`attachment.issue_id ≠ :id`). Кросс-проектный
  вариант (id вложения из другого проекта в пути проекта CORP) → **`404`**.
  `/projects/<proj>/issues/<чужая задача>/…` → `404` «Задача не найдена в этом
  проекте» (сверка в `requireIssuePerm` до обращения к вложению). Легитимное
  скачивание по родному пути → `200` + заголовки D5.
- Удаление задачи A → строки `attachments` сняты каскадом, объект в хранилище
  удалён. Удаление **проекта** оставило объект-сироту — ожидаемо, сборщик — Фаза 6.

### Фаза 3 — Клиент: вложения на карточке задачи  *(сделано)*

`npx tsc --noEmit` 0, `npm run build` ок. Браузерная проверка — за пользователем.

- **`src/api/index.ts`** — `attachmentsApi.{ list, upload, remove, download }`.
  `upload` — **не через `api()`** (тот всегда JSON): новый `apiUpload()` — сырой
  `fetch` с `FormData` + `Authorization`, `Content-Type` не ставим (браузер сам
  добавит boundary), ошибки нормализуются в `ApiError` как в `api()` (401 → сброс
  токена). `download` — новый `downloadBlob()`: авторизованный `fetch` → `blob()` →
  `createObjectURL` → клик по скрытой `<a download>` → `revokeObjectURL`. Типы
  `ServerAttachment`, `ServerIssue.attachments?`.
- **`src/types.ts`** — `Attachment { id, filename, contentType, byteSize,
  uploadedById, createdAt }`; `Issue.attachments: Attachment[]` (required).
  `mapIssue` заполняет из `dto.attachments ?? prev?.attachments ?? []` — как
  `collaborators`; `upsertIssue` не трогает (свежий список из `openIssue`
  переживает upsert).
- **`src/store.tsx`** — `mapAttachment(dto)`; экшены `uploadAttachment(issueId,
  file)` (гейт `requirePerm("comment", issue)` + UX-проверки: размер >
  `LIMITS.attachment.maxBytes`, явно исполняемое расширение → тост, без
  раунд-трипа), `removeAttachment(issueId, attId)` (без гейта — правило D2 на
  сервере; компонент прячет «×»), `downloadAttachment(issueId, att)`. Патч
  `issue.attachments` в `data.issues` через `patchIssueAttachments`.
- **`src/validation.ts`** ↔ **`server/src/contract.ts`** — `LIMITS.attachment`
  (`maxBytes` 25 MiB, `maxPerIssue` 50, `maxFilename` 200) уже добавлен в Фазе 2,
  зеркальный.
- **`src/components/IssueModal.tsx`** — `<AttachmentField>` после
  `<CollaboratorField>`: строки «🔗 имя (кнопка-скачать) · размер · ×», «×» видно
  при `can("delete", issue)` **или** `att.uploadedById === me`; при
  `can("comment", issue)` — скрытый `<input type=file>` + кнопка «＋ прикрепить
  файл» + подпись про лимит/запрет исполняемых. Скрыт целиком, если нельзя
  грузить и вложений нет. `fmtBytes` — Б/КБ/МБ.
- **`src/components/SoloView.tsx`** (`SoloIssueCard`, он же в `CollaboratingView`)
  — блок «Вложения · N» после «Приглашены к задаче»: список со «Скачать» +
  `<input type=file>` (приглашённый имеет `comment`). Компонент api-центричен
  (как и было): грузит через `attachmentsApi.upload`, дописывает в локальный
  `issue.attachments` (`setIssue`), ошибки → `toast`.
- **`src/permissions.ts`** (клиент) — MATRIX не тронут; комментарий в шапке:
  «загрузка/удаление своего = `comment`; удаление чужого = `delete`».
- **Не сделано (осознанно):** drag&drop файла, индикатор прогресса загрузки,
  вставка скриншота из буфера — Фаза 6.

### Фаза 4 — Драйвер S3/MinIO + верификация против настоящего MinIO

- **Зависимость** — `@aws-sdk/client-s3` (S3-совместимый клиент; MinIO, Ceph RGW,
  любой on-prem S3). Альтернатива `minio` npm-клиент — отклонена: `@aws-sdk`
  покрывает больше бэкендов и уже стандарт.
- **`server/src/services/storage.ts`** — `S3Storage`: `put` (multipart upload для
  больших файлов), `get` (`GetObjectCommand` → `Readable`), `delete`, `stat`
  (`HeadObjectCommand`). `forcePathStyle` из конфига.
- **`server/test/access.attachments.test.ts`** — тот же файл гоняется и при
  `STORAGE_DRIVER=s3` + `STORAGE_S3_*` (иначе — против `local`, как сейчас).
  `npm run test:storage`.
- **`.github/workflows/test.yml`** — новый job `storage-s3`: `postgres:16` +
  `docker compose -f docker-compose.storage.yml up -d` (MinIO) + создание бакета
  (`mc`) + `STORAGE_DRIVER=s3` env + `npm run test:storage` + дамп логов MinIO
  (`if: always()`). Основной job `server` остаётся на `local`.
- **`STORAGE_SETUP.md`** *(новый, корень репо)* — по образцу
  [LDAP_SETUP.md](LDAP_SETUP.md):
  - таблица всех `STORAGE_*` / `ATTACH_*` с примерами MinIO и «большого» S3;
  - создание бакета и сервис-ключа с минимальными правами (`s3:GetObject`,
    `PutObject`, `DeleteObject`, `ListBucket` на один бакет);
  - политика бакета: **приватный**, без public-read; шифрование на покое
    (SSE-S3 / SSE-KMS) — рекомендация;
  - выбор «прокси через API» vs «короткий presigned» (по умолчанию — прокси);
  - перенос существующих файлов `local → s3` (скрипт-однодневка: читать
    `attachments` где `storage_driver='local'`, `PutObject`, обновить строку) —
    описание процедуры, без самого скрипта в MVP;
  - бэкап бакета (в один ряд с [BACKUP.md](server/BACKUP.md));
  - траблшутинг: `SignatureDoesNotMatch` (часы/регион), `PathStyle` для MinIO,
    CORS бакета (если позже presigned-upload), TLS/приватный CA
    (`NODE_EXTRA_CA_CERTS`).

### Фаза 5 — Верификация

- **Автотесты** — `access.attachments.test.ts` зелёный и на `local`, и на `s3`
  (job `storage-s3`). Итог `npm test` — прежние 38 + новые.
- **Ручной чек-лист** — блок «Вложения (attachments)» в
  [`server/README.md`](server/README.md): схема 010, лимиты, чёрный список +
  magic-байты, права D2, видимость D4, заголовки скачивания D5, каскады,
  `local` и `s3` драйверы, аудит.
- **Живой прогон** (dev :8080) — по образцу LDAP/COLLAB: upload/download/delete
  под разными ролями и приглашённым; отказ на `.exe`, на переименованном `MZ`,
  на превышении размера; `/projects/A/issues/<из B>/attachments` → `404`.
- **`ARCHITECTURE.md`** — «Текущее состояние»: файловое хранилище → «реализовано»;
  «Порядок разработки» п. 4 → ✅ (с пометкой про S3-драйвер и CI).
- **`SCOPE.md`** — правок не требует (вложения уже в списке MVP).

### Фаза 6 — Follow-ups (не в этой миграции)

- **Антивирус** — hook на приём (ClamAV `clamd` в compose + CI), карантин до
  проверки, статус `scan_state` в строке.
- **Вложения к комментариям** — nullable `attachments.comment_id`.
- **Сборщик осиротевших объектов** — фоновый проход (вместе с воркером
  уведомлений / ресинка LDAP, ARCHITECTURE п. 5): объекты в хранилище без строки
  `attachments`. **Главный источник сирот — удаление проекта:** `DELETE
  /api/projects/:projectId` каскадит `issues → attachments` (строки), но обработчик
  не собирает `storage_key` вложений всех задач проекта и объекты остаются в
  хранилище (подтверждено живым прогоном Фазы 2). Прямое удаление вложения и
  удаление одной задачи объекты чистят (`deleteStorageObjects`). Варианты
  закрытия: (а) периодический сборщик — сверка ключей в хранилище с `storage_key`
  в БД; (б) прицельная уборка в обработчике `DELETE /projects/:id` до каскада
  (быстрее, но не ловит сирот от прежних версий / оборванных загрузок). Также
  чистить пустые каталоги `<issueId>/` драйвера `local`.
- **Presigned direct-to-S3 upload** — для больших файлов, с серверной
  пост-валидацией (`HeadObject` + догрузка первых байт для `fileGuard`).
- **Превью** — миниатюры изображений/PDF (отдельный процесс, кэш в хранилище).
- **Квота на проект/департамент** — суммарный объём вложений.
- **Вставка из буфера** (`paste` скриншота в поле комментария).
- **Дедуп по `sha256`** — один объект на несколько строк (счётчик ссылок).

---

## 5. Риски и внимание

- **Сироты в хранилище.** `ON DELETE CASCADE` чистит строки `attachments` при
  удалении задачи/проекта, но не файлы. Хендлеры прямого удаления сносят объект
  сами; для каскада — best-effort уборка в роуте удаления задачи/проекта +
  follow-up сборщик. Задокументировать: «БД — источник истины, объект без строки
  считается мусором».
- **Стрим, а не буфер.** `createAttachment` обязан считать `sha256` и отдать
  первые ≤ 512 Б в `fileGuard` **на лету**, не загружая файл целиком в память.
  `@fastify/multipart` `limits.fileSize` рвёт поток — проверить, что при обрыве
  недописанный объект в хранилище не остаётся (временный файл + `rename` для
  `local`; abort multipart upload для `s3`).
- **fileGuard — не антивирус.** Сигнатурный детект ловит переименованные
  исполняемые и грубое несовпадение, но не заражённый `.docx`. ClamAV — Фаза 6;
  в чек-лист и STORAGE_SETUP.md явно.
- **Stored-XSS через вложение.** `.html`/`.svg`/`.xhtml` с origin API. Закрывается
  D5 (всегда `Content-Disposition: attachment`, `nosniff`, active-типы →
  `octet-stream`). Тест на заголовки обязателен.
- **IDOR.** Маршрут только project-scoped; `requireIssuePerm` сверяет
  `issue.project_id == :projectId`, хендлер — `attachment.issue_id == :id`.
  Плоский `/api/attachments/:id` — не заводить (D5). Тест path-confusion.
- **`api()` не умеет multipart.** Отдельный `apiUpload()` на клиенте; не ломать
  общую нормализацию ошибок (`ApiError { status, code, reason }`, 401 → сброс
  токена).
- **CORS.** Текущий `@fastify/cors` `allowedHeaders: ["Authorization",
  "Content-Type"]` — для `FormData` браузер сам ставит `Content-Type:
  multipart/...; boundary=…`, это тот же заголовок, ок. Проверить preflight на
  `POST` с `FormData` с `:3000`.
- **Размер тела Fastify.** `@fastify/multipart` `limits.fileSize` — да; но
  проверить, что глобальный `bodyLimit` Fastify (деф. 1 MiB) не режет multipart
  раньше (multipart-плагин обрабатывает поток сам, но убедиться на тесте с 20 MiB).
- **S3 и часы/регион.** `SignatureDoesNotMatch` при рассинхроне часов или неверном
  `region` — NTP + `us-east-1` для MinIO. В STORAGE_SETUP.md.
- **Зеркальные лимиты.** `LIMITS.attachment` в `contract.ts` ↔ `src/validation.ts`
  — менять в двух местах (правило CLAUDE.md), как уже сделано для
  `department.ldapGroupDn`.
- **Секреты.** `STORAGE_S3_SECRET_KEY` только в env, не логировать; debug
  `@aws-sdk` выключен в prod. `server/.env` уже в `.gitignore`; добавить
  `server/var/` туда же.
- **Драйвер в строке.** `storage_driver` в `attachments` — иначе после
  переключения `local → s3` не найти, где лежат старые объекты.

---

## 6. Оценка объёма

| Фаза | Область | Размер |
|---|---|---|
| 1 | миграция 010 + `config.storage` + `Storage`-интерфейс + `LocalDiskStorage` + compose MinIO + `.env.example` | M |
| 2 | `@fastify/multipart` + `fileGuard` + `services/attachments` + `routes/attachments` (4 эндпоинта) + `getIssueDto` + тесты | **L** |
| 3 | клиент: `apiUpload`/`attachmentsApi` + store-экшены + `<AttachmentField>` в `IssueModal` + список в `SoloIssueCard` | M |
| 4 | `S3Storage` (`@aws-sdk/client-s3`) + CI-job `storage-s3` против MinIO + `STORAGE_SETUP.md` | M–L |
| 5 | верификация + `access.attachments.test.ts` (двойной прогон) + чек-лист + `ARCHITECTURE.md` | S–M |
| 6 | ClamAV, вложения к комментариям, сборщик сирот, presigned, превью, квоты | отдельно |

Критический путь: 1 → 2 → 3 → 4 → 5. Фаза 4 при необходимости — follow-up PR
(локальный драйвер уже оттестирован). Фаза 6 — вне захода.

---

## 7. Открытые вопросы — ЗАКРЫТЫ

Все 8 подтверждены как предложено, без изменений (см. §3 «РЕШЕНО»):

1. **D1** — да, оба драйвера (`local` по умолчанию, `s3` в CI + прод-рекомендация).
2. **D2** — да, без нового ключа в MATRIX (загрузка = `comment`, удаление чужого = `delete`).
3. **D3 (тип)** — да, чёрный список + magic-байты + флаг несовпадения, свой мини-детект без зависимости; белого списка нет.
4. **D3 (лимиты)** — 25 MiB / 50 файлов, без изменений.
5. **D5** — да, прокси-стрим через API, без presigned; заголовки `attachment` + `nosniff`, active-типы → `octet-stream`.
6. **D6** — да, только задачи в MVP (не комментарии).
7. **Именование/ветка** — `FILES_MIGRATION.md` + `STORAGE_SETUP.md`, ветка `feat/attachments`.
8. **Порядок** — после вложений сразу `NOTIFICATIONS_MIGRATION.md` (план), затем реализация.
