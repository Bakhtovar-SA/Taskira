# LDAP_MIGRATION — аутентификация через LDAP/AD + членство в департаменте

Статус: **решения §3 подтверждены (D1–D8). Фазы 1–6 сделаны — миграция завершена.
Живые прогоны пройдены, 38 серверных тестов в local + 9 тестов против настоящего
OpenLDAP в CI зелёные; [LDAP_SETUP.md](LDAP_SETUP.md) написан, чек-лист в
[server/README.md](server/README.md), ARCHITECTURE.md обновлён. Осталось только
влить ветку. Фаза 7 — отдельный заход.**
Ветка `feat/ldap-auth`. Порядок: фазы 1 → 2 → 3 → 5 → 6 (Фаза 4 аддитивна, Фаза 7 — вне захода).
Контекст: пункт 1 «Порядка разработки» в [ARCHITECTURE.md](ARCHITECTURE.md) («авторизация через LDAP»);
[SCOPE.md](SCOPE.md) — иерархия доступа и **открытый вопрос**: «Как именно мапить группы
LDAP/AD на департаменты (по OU, по группе безопасности?)». Колонка `departments.ldap_group_dn`
заложена nullable ещё [миграцией 007](server/migrations/007_departments.sql) — этот этап её
заполняет и делает `UNIQUE`. Предыдущие миграции — [ROLE_MIGRATION.md](ROLE_MIGRATION.md),
[DEPT_MIGRATION.md](DEPT_MIGRATION.md), [COLLAB_MIGRATION.md](COLLAB_MIGRATION.md).

Отдельный документ по итогам — **LDAP_SETUP.md** (инструкция подключения к реальному
корпоративному AD на будущем сервере), см. §4 Фаза 6.

---

## 1. Зачем

[SCOPE.md](SCOPE.md): «Аутентификация через LDAP/AD, синхронизация членства в
департаменте по группе AD». Сейчас — только локальный логин/пароль (`bcrypt`,
`users.password_hash`), департаменты есть, но **членства в департаменте нет**:
[DEPT_MIGRATION.md §3.5](DEPT_MIGRATION.md) явно отложил таблицу `department_members`
и правило видимости «проект виден участникам своего департамента» до этого этапа —
без LDAP не было источника членства.

Нужно: аутентификация против LDAP/AD, provisioning пользователей из директории,
глобальная роль `admin` из группы, членство в департаменте из групп (маппинг через
`departments.ldap_group_dn`), и — как следствие — закрыть временное правило видимости
из DEPT §3.5.

**Ограничение разработки:** реального корпоративного AD для тестов нет. Вся разработка
и тесты — против локального **OpenLDAP в Docker** с тестовыми пользователями/группами
(см. D7). Всё AD-специфичное прячется за env-переключателями; отличия документируются
в LDAP_SETUP.md.

---

## 2. Что в коде сейчас

| Слой | Файл | Состояние |
|---|---|---|
| Логин | `routes/auth.ts` `POST /login` | rate-limit по ip (10/5 мин), `bcrypt.compare(password, users.password_hash)`, `signToken` |
| Токен | `auth.ts` `signToken` | payload `{ sub: users.id, globalRole, name }`; `sub` — локальный uuid |
| Аутентификация запроса | `middleware.ts` `requireAuth` | `jwtVerify`, затем `global_role`/`is_active` из БД (кэш 30 с) |
| Первый админ | `seed.ts` `seedAdmin` | при пустой `users` — из `ADMIN_USERNAME`/`ADMIN_PASSWORD`, `global_role='admin'`, без строки в `project_members` |
| Пользователи | `users` (миграции 001/002/004/006) | `id, username UNIQUE, password_hash NOT NULL, name, initials, color, job_role, global_role (admin\|member), is_active` |
| Департаменты | `departments` (миграция 007) | `id, name UNIQUE, ldap_group_dn text NULL` (без UNIQUE — отложено), `created_at` |
| Членство в департаменте | — | **таблицы нет** (DEPT §3.5) |
| Видимость проекта | `services/projects.ts` `listVisibleProjects` | `project_members ∪ is_shared ∪ admin` — временно, до этого этапа (DEPT §3.5) |
| Эффективная роль | `permissions.ts` `resolveRole(user, membership)` | `admin` глобально, иначе `project_members.role`, иначе `null` (403) |
| Конфиг | `config.ts` | свой парсер `.env` (без dotenv), fail-fast на `DATABASE_URL`/коротком `JWT_SECRET`; `admin` из `ADMIN_*` |
| CI | `.github/workflows/test.yml` | сервис `postgres:16`; LDAP-сервиса нет |

Схема: нет `users.auth_source`/`ldap_dn`/`email`, `password_hash` — `NOT NULL`, нет
`department_members`, `ldap_group_dn` без `UNIQUE`.

---

## 3. Ключевые решения (РЕШЕНО)

Подтверждено целиком, как предложено:

| # | Решение |
|---|---|
| **D1** (Q1) | Bind: сервис-аккаунт + поиск + re-bind (основной); прямой bind по `LDAP_USER_DN_TEMPLATE` — fallback без сервис-аккаунта. |
| **D2** (Q2) | Env `AUTH_MODE` = `local` (деф.) \| `ldap`. В `ldap` — один break-glass локальный admin (`auth_source='local'`, вход по паролю при недоступном LDAP); остальные — только LDAP. |
| **D3** (Q3) | Sync членства — JIT на каждом успешном LDAP-логине (`global_role` из `LDAP_ADMIN_GROUP_DN` + `department_members` по `ldap_group_dn`) + ручной `POST /api/ldap/resync`. Фоновый воркер — Фаза 7. |
| **D4** (Q4) | Миграция добавляет `users.auth_source`/`ldap_dn`/`email`, `password_hash` → nullable + CHECK. В `ldap`-режиме первый LDAP-логин «усыновляет» локальную строку по `username == <логин-атрибут>` (сохраняет `id`, `global_role`, `project_members`, авторство). `local`-режим — без изменений. |
| **D5** (SCOPE — открытый вопрос) | Маппинг групп на департаменты — явный, через `departments.ldap_group_dn` (одна группа на департамент, MVP), задаётся админом в AdminView. **Не** «по OU». Глобальный `admin` — из отдельной env-группы `LDAP_ADMIN_GROUP_DN`. `UNIQUE` (partial, регистронезависимо) на `ldap_group_dn` вводится сейчас. |
| **D6** | Библиотека — `ldapts`. Отклонены `ldapjs` (callback), `passport-ldapauth` (Passport), `activedirectory2` (только AD). |
| **D7** | Тестовый LDAP — `osixia/openldap` в Docker + `bootstrap.ldif` (`dc=taskira,dc=test`, `ou=people` `inetOrgPerson`, `ou=groups` `groupOfNames`; членство — обратным поиском). Compose-сервис + CI. |
| **D8** | **Вариант A.** Членство в департаменте проекта **и** `projects.is_shared` дают **неявную эффективную роль `viewer`** (browse без мутаций) на проектах этого департамента; явная `project_members.role` всегда перекрывает и может давать больше. Закрывает временное правило [DEPT_MIGRATION.md §3.5](DEPT_MIGRATION.md), реализует SCOPE «проект по умолчанию виден участникам своего департамента». |

Ниже — обоснования и отклонённые альтернативы по каждому пункту.

### D1 (Q1). Bind-стратегия — сервис-аккаунт + поиск + re-bind (основная), прямой bind (fallback)

**Рекомендация.** Основной режим: bind сервис-аккаунтом (`LDAP_BIND_DN` +
`LDAP_BIND_PASSWORD`, read-only) → поиск пользователя по `LDAP_USER_FILTER`
(`(sAMAccountName={username})` для AD, `(uid={username})` для OpenLDAP) → чтение DN,
атрибутов (`name`, `mail`) и списка групп → **повторный bind найденным DN + паролем
пользователя** для проверки учётки. Если `LDAP_BIND_DN` пуст — режим прямого bind по
шаблону `LDAP_USER_DN_TEMPLATE` (`uid={username},ou=people,dc=…`), без чтения атрибутов
до bind (группы тогда добираются отдельным поиском под тем же соединением).

**Обоснование.** Корпоративный AD: структура DN разнится, анонимный поиск обычно
запрещён, вход часто по `sAMAccountName`/`userPrincipalName`, а не по предсказуемому DN.
Сервис-аккаунт + поиск — стандарт, и группы получаем в том же обмене. Прямой bind
оставляем как простой путь для мелких OpenLDAP-инсталляций и локального теста без
сервис-аккаунта.

### D2 (Q2). Локальный логин остаётся — только для break-glass admin

**Рекомендация.** Env `AUTH_MODE` = `local` (по умолчанию) | `ldap`.
- `local` — как сейчас, LDAP не трогается (dev без LDAP работает).
- `ldap` — источник истины LDAP. **Один** break-glass локальный админ (сид из
  `ADMIN_*`, `auth_source='local'`) продолжает входить по локальному паролю — на случай
  недоступности/поломки LDAP-сервера. Все остальные — только через LDAP.

Логика логина в `ldap`-режиме: сначала `ldapAuthenticate`; если LDAP недоступен или
вернул отказ — локальная проверка пароля **только** для строк `auth_source='local'`
(то есть только break-glass).

**Обоснование.** Полный отказ от локального пароля = при падении LDAP или опечатке в
`LDAP_URL` в систему не войти и не починить. Break-glass admin — стандартная гигиена.
Пароль сильный, ротация и назначение — в LDAP_SETUP.md.

**Не рекомендую.** Полный переход без fallback.

### D3 (Q3). Синхронизация членства — JIT при логине + ручной ресинк; фоновый воркер отложен

**Рекомендация.** На каждый успешный LDAP-логин: перечитываем группы пользователя →
пересобираем его `global_role` (из `LDAP_ADMIN_GROUP_DN`) и `department_members`
(`source='ldap'`) по маппингу `departments.ldap_group_dn`. Плюс `POST /api/ldap/resync`
(глобальный admin) — принудительный прогон по всем `auth_source='ldap'` юзерам.

**Обоснование.** JIT не требует нового инфраструктурного слоя (планировщика/воркера в
проекте пока нет — ARCHITECTURE п. 5). Свежесть на момент логина достаточна для MVP.
Полноценный **фоновый воркер-ресинк по расписанию** — follow-up вместе с воркером
уведомлений (Фаза 7).

**Следствие (задокументировать).** Пользователь, удалённый из группы в AD, сохраняет
доступ до следующего логина (+ 30 с кэша `requireAuth`). `resync` и будущий воркер это
сужают.

### D4 (Q4). Существующие локальные пользователи — колонка `auth_source` + «усыновление» по `username`

**Рекомендация.** Миграция добавляет `users.auth_source` (`local`|`ldap`, дефолт
`local` — существующие строки не меняются), `users.ldap_dn`, `users.email`;
`password_hash` становится `NULL`-able (у LDAP-юзеров пароля нет) с CHECK
«`auth_source='local'` ⇒ `password_hash IS NOT NULL`».

- **`local`-режим** — ничего не меняется, `t.manager`/`t.employee`/… работают как есть.
- **`ldap`-режим**, первый успешный LDAP-логин: ищем локальную строку по
  `username == <логин-атрибут LDAP>`. Нашли → **усыновляем**: ставим `ldap_dn`,
  `email`, `auth_source='ldap'`, `password_hash=NULL`; **сохраняем** `id`,
  `global_role` (перекрывается из группы), `project_members`, авторство комментариев,
  watchers. Не нашли → вставляем новую строку. Локальные строки без LDAP-совпадения в
  `ldap`-режиме войти не могут (кроме break-glass).

**Обоснование.** `t.manager` в тестовом OpenLDAP заводим с тем же `uid` → при первом
LDAP-логине он бесшовно становится LDAP-юзером, сохранив роль и членства в проектах.
Ничего массово не сносим.

**Риск.** Если корпоративный логин-атрибут ≠ Taskira `username` для уже
существующего человека — усыновление не сработает, появится вторая строка. Митигация:
одноразовое переименование/маппинг до переключения (описать в LDAP_SETUP.md).

### D5 (SCOPE — открытый вопрос). Маппинг групп на департаменты — явный, через `departments.ldap_group_dn`

**Рекомендация.** Не «по OU» и не по соглашению об именах. Админ задаёт на каждом
департаменте **DN одной группы** (`departments.ldap_group_dn`) в AdminView. При логине:
для каждого DN группы пользователя ищем департамент с этим `ldap_group_dn` → строка в
`department_members`. Группы без сопоставленного департамента игнорируются.
Глобальный `admin` — из **отдельной** env-группы `LDAP_ADMIN_GROUP_DN` (не департамент).

**Обоснование.** Именование AD-групп в компании не обязано совпадать с названиями
департаментов Taskira; «по OU» жёстко предполагает, что дерево AD повторяет оргструктуру
(часто не так). Явный DN — гибко и без магии; ровно ради этого 007 завёл колонку.
`UNIQUE` (partial, case-insensitive) на `ldap_group_dn` вводится сейчас.

**MVP:** одна группа на департамент. Несколько групп на департамент
(`department_ldap_groups`) и вложенные группы — Фаза 7.

### D6. Библиотека — `ldapts`

**Рекомендация.** [`ldapts`](https://www.npmjs.com/package/ldapts) — promise-based,
TypeScript-native, активно поддерживается, работает и с OpenLDAP, и с AD (LDAPS/StartTLS,
paged search). Без Passport.

**Отклонено.** `ldapjs` (callback-API, провалы в поддержке), `passport-ldapauth`
(тащит Passport — у нас свой JWT-слой), `activedirectory2` (обёртка над `ldapjs`,
только AD).

### D7. Тестовый LDAP — `osixia/openldap` в Docker + bootstrap-LDIF

**Рекомендация.** `docker-compose.ldap.yml` c `osixia/openldap` и кастомным LDIF
(`server/test/ldap/bootstrap.ldif`): дерево `dc=taskira,dc=test`, `ou=people`
(`inetOrgPerson`: `uid`, `cn`, `sn`, `mail`, `userPassword`), `ou=groups`
(`groupOfNames` с `member`). Тот же compose-сервис — в CI (`test.yml`).

**Обоснование.** `osixia/openldap` принимает произвольный bootstrap-LDIF → реалистичные
группы с `member`. `bitnami/openldap` конфигурит юзеров через env, но группы —
ограниченно. `glauth` (одним TOML-файлом) удобен, но это упрощённый LDAP, хуже
воспроизводит AD-нюансы.

**Тестовая схема:**

```ldif
# server/test/ldap/bootstrap.ldif
dn: ou=people,dc=taskira,dc=test
objectClass: organizationalUnit

dn: uid=t.admin,ou=people,dc=taskira,dc=test
objectClass: inetOrgPerson
uid: t.admin
cn: Тест Админ
sn: Админ
mail: t.admin@taskira.test
userPassword: testpass123
# ...аналогично t.manager, t.employee, t.viewer, t.outsider

dn: ou=groups,dc=taskira,dc=test
objectClass: organizationalUnit

dn: cn=taskira-admins,ou=groups,dc=taskira,dc=test
objectClass: groupOfNames
member: uid=t.admin,ou=people,dc=taskira,dc=test

dn: cn=dept-infosec,ou=groups,dc=taskira,dc=test
objectClass: groupOfNames
member: uid=t.manager,ou=people,dc=taskira,dc=test
member: uid=t.employee,ou=people,dc=taskira,dc=test

dn: cn=dept-it,ou=groups,dc=taskira,dc=test
objectClass: groupOfNames
member: uid=t.viewer,ou=people,dc=taskira,dc=test
```

Членство групп в тестовом OpenLDAP читаем **обратным поиском**
(`(&(objectClass=groupOfNames)(member={userDN}))`) — оверлей `memberof` в osixia по
умолчанию не включён. Для AD — `LDAP_GROUP_MEMBERSHIP=memberOf` (операционный атрибут).

### D8. Членство в департаменте → неявная роль `viewer` — вариант A (подтверждён)

**Решение.** Членство в департаменте проекта (`department_members`) **и** флаг
`projects.is_shared` дают **неявную эффективную роль `viewer`** на проектах этого
департамента: `browse` есть, мутаций нет. Явная строка `project_members` всегда
перекрывает и может давать больше (`employee`/`manager`). Это закрывает временное
правило [DEPT §3.5](DEPT_MIGRATION.md) и реализует SCOPE «проект по умолчанию виден
участникам своего департамента».

**Следствие.** `is_shared` теперь даёт не только видимость в списке, но и bootstrap
(как `viewer`) — раньше не-участник shared-проекта получал `403` на
`GET /api/projects/:id`. Реализация: `middleware` при отсутствии явного
`project_members` и не-admin проверяет `department_members` **или** `req.project.isShared`
→ ставит `req.projectRole = 'viewer'`, `req.impliedViewer = true`; `can()` пускает
только `browse`.

**Отклонено.** Оставить `is_shared` list-only и давать неявный `viewer` лишь членам
департамента — менее консистентно (shared-проект видно в списке, но не открыть).

---

## 4. План по фазам

### Фаза 1 — Схема + конфиг + тестовый OpenLDAP (поведение не меняется)  *(сделано)*

Ветка `feat/ldap-auth`. `AUTH_MODE=local` по умолчанию — логин не изменился,
35 серверных тестов зелёные, `typecheck` 0. Миграция 009 применена на dev-БД
(`schema_migrations`: 001–004, 006–009) и в тестовой схеме.

**`server/migrations/009_ldap.sql`** (005 пропущена; после 008):

```sql
ALTER TABLE users ADD COLUMN auth_source text NOT NULL DEFAULT 'local'
  CHECK (auth_source IN ('local','ldap'));
ALTER TABLE users ADD COLUMN ldap_dn text;
ALTER TABLE users ADD COLUMN email   text;
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users ADD CONSTRAINT users_local_has_password
  CHECK (auth_source <> 'local' OR password_hash IS NOT NULL);
CREATE UNIQUE INDEX users_ldap_dn_uk ON users (lower(ldap_dn)) WHERE ldap_dn IS NOT NULL;

-- членство в департаменте (отложенная таблица DEPT_MIGRATION §3.5)
CREATE TABLE department_members (
  department_id uuid NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id)       ON DELETE CASCADE,
  source        text NOT NULL DEFAULT 'ldap' CHECK (source IN ('ldap','manual')),
  synced_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (department_id, user_id)
);
CREATE INDEX idx_department_members_user ON department_members (user_id);

-- 007 отложил UNIQUE на ldap_group_dn — вводим сейчас (partial, регистронезависимо)
CREATE UNIQUE INDEX departments_ldap_group_dn_uk
  ON departments (lower(ldap_group_dn)) WHERE ldap_group_dn IS NOT NULL;
```

Бэкфилла нет. Обратима. Все существующие строки — `auth_source='local'`, пароль на месте.

**`config.ts`** — `Config.authMode` + `Config.ldap` (все `LDAP_*` опциональны; жёсткая
валидация только при `AUTH_MODE=ldap`). Env:

| Переменная | Назначение |
|---|---|
| `AUTH_MODE` | `local` (деф.) \| `ldap` |
| `LDAP_URL` | `ldap://host:389` \| `ldaps://host:636` |
| `LDAP_BIND_DN`, `LDAP_BIND_PASSWORD` | сервис-аккаунт; пусто ⇒ прямой bind |
| `LDAP_USER_BASE_DN` | база поиска пользователей |
| `LDAP_USER_FILTER` | `(uid={username})` \| `(sAMAccountName={username})` |
| `LDAP_USER_DN_TEMPLATE` | для прямого bind: `uid={username},ou=people,dc=…` |
| `LDAP_GROUP_MEMBERSHIP` | `search` (обратный поиск) \| `memberOf` (AD) |
| `LDAP_GROUP_BASE_DN` | база групп (для `search`) |
| `LDAP_ADMIN_GROUP_DN` | членство ⇒ `global_role='admin'` |
| `LDAP_ATTR_LOGIN` / `_NAME` / `_MAIL` | `uid`/`sAMAccountName`, `cn`/`displayName`, `mail` |
| `LDAP_STARTTLS`, `LDAP_TLS_CA_FILE`, `LDAP_TLS_REJECT_UNAUTHORIZED`, `LDAP_TIMEOUT_MS` | TLS/таймаут |

Реализовано: `envBool()` + `buildLdapConfig()` (fail-fast на каждом обязательном ключе,
проверка `{username}` в фильтре/шаблоне, `search` ⇒ нужен `LDAP_GROUP_BASE_DN`,
`bindDn` ⇒ нужен `bindPassword`). `Config.ldap` = `null` при `local`.

**`server/docker-compose.ldap.yml`** — `osixia/openldap:1.5.0`, монтирует
`bootstrap.ldif`, порт 389, healthcheck.
**`server/test/ldap/bootstrap.ldif`** — `dc=taskira,dc=test`: `ou=people`
(`t.admin`/`t.manager`/`t.employee`/`t.viewer`/`t.outsider`, пароль `testpass123`),
`ou=groups` (`taskira-admins` → t.admin; `dept-infosec` → t.manager+t.employee;
`dept-it` → t.viewer).
**`server/test/ldap/README.md`** — запуск, состав, ручные `ldapsearch`, env-набор.
**`.env.example`** — `AUTH_MODE=local` + закомментированный блок `LDAP_*`.

Ни один роут/middleware не тронут. Деплой-безопасно.

### Фаза 2 — LDAP-клиент + аутентификация  *(сделано)*

Реализовано ниже как в плане. Дополнительно: `mkClient` передаёт `tlsOptions` только
для `ldaps://`/StartTLS (иначе `ldapts` рвёт обычное `ldap://`-соединение TLS-хендшейком);
`localPasswordCheck(username, pw, onlyBreakGlass)` — в `ldap`-режиме локально пускает
**только** `config.admin.username` (D2/D4); `provisionFromLdap` не усыновляет строку
break-glass админа (`409`). `mock-ldap.mjs` (`ldapjs`, devDep) — in-process тестовый
LDAP на случай отсутствия Docker.

**Живой прогон** (тестовый LDAP + инстанс `AUTH_MODE=ldap` на :8090, dev-БД):

- `POST /login t.manager/testpass123` → `{ token, user }`; JWT payload
  `{ sub: <локальный uuid>, globalRole: "member", name, iat, exp }`.
- `t.viewer` → `member`; `t.admin` (не было в БД) → **JIT-создан**, `global_role='admin'`
  (в группе `cn=taskira-admins`).
- `users`: `t.manager`/`t.viewer` (были `local`) **усыновлены** — `auth_source='ldap'`,
  `ldap_dn` заполнен, `id`/`global_role`/`job_role`/`project_members` сохранены.
- `department_members`: `t.manager` → «Департамент безопаности» (`cn=dept-infosec`),
  `t.viewer` → «Общий отдел» (`cn=dept-it`), `source='ldap'` — правильные группы.
- `POST /api/ldap/ping` → `{ authMode:"ldap", url, bind:"service-account", ok:true, baseDn }`;
  при погашенном LDAP → `{ ok:false, error:"connect ECONNREFUSED …" }`.
- неверный пароль → `401`.
- **break-glass**: локальный `admin` входит и когда LDAP работает, и когда LDAP погашен;
  обычный `t.manager` при погашенном LDAP → `401` (не break-glass).
- `AUTH_MODE=local`: 35 серверных тестов зелёные, `typecheck` 0 — путь не тронут.

**Файлы:**

- **`ldapts`** + **`ldapjs`** (dev) в `server/package.json`.
- **`services/ldap.ts`** — `ldapAuthenticate(username, password): Promise<LdapPrincipal | null>`,
  `LdapPrincipal = { dn, login, name, email: string | null, groupDns: string[] }`.
  Сервис-bind → поиск → чтение атрибутов + групп (`memberOf` или обратный поиск) →
  re-bind DN+паролем. Прямой bind при пустом `LDAP_BIND_DN`. Ошибку связи (сеть/таймаут)
  отличаем от отказа авторизации (LDAP 49). `ldapPing()` — bind + base-search для
  диагностики.
- **`services/userProvisioning.ts`** — `provisionFromLdap(principal): Promise<UserRow>`:
  усыновить-или-создать по `username == principal.login`; выставить
  `ldap_dn`/`email`/`name`/`auth_source='ldap'`/`password_hash=NULL`; `global_role` из
  `LDAP_ADMIN_GROUP_DN ∈ groupDns`; `invalidateUserCache`.
- **`services/departmentSync.ts`** — `syncDepartmentMembership(userId, groupDns)`:
  `groupDns` → департаменты по `lower(ldap_group_dn)`; заменить `source='ldap'` строки
  пользователя на вычисленный набор, `source='manual'` не трогать; аудит
  `ldap.dept.sync`.
- **`routes/auth.ts` `POST /login`** — при `AUTH_MODE=ldap`: `ldapAuthenticate` →
  `provisionFromLdap` → `syncDepartmentMembership` → `signToken`. LDAP недоступен/отказ →
  локальная проверка только для `auth_source='local'` (break-glass). `local`-режим — без
  изменений. Rate-limit как есть.
- **`routes/ldap.ts`** *(новый)* — `POST /api/ldap/ping` (глоб. admin) — проверка связи.
- **`requireAuth`** — без изменений (роль/активность по-прежнему из БД; JIT их уже
  записал). `sub` в JWT — локальный `users.id`; для новых LDAP-юзеров он появляется при
  provisioning. Шимов совместимости токенов не нужно (как ROLE §3.5).

### Фаза 3 — Видимость проекта по департаменту (закрывает DEPT §3.5)  *(сделано)*

- **`services/projects.ts` `listVisibleProjects`** — добавлен `LEFT JOIN
  department_members` → проект виден при `project_members` **ИЛИ** `department_members`
  **ИЛИ** `is_shared` **ИЛИ** глоб. admin.
- **`middleware.ts`** — `effectiveRole(u, membership, project)`: явная роль
  (`resolveRole`), иначе — если `project.isShared` **или** `isDeptMember(u, project.departmentId)`
  → `viewer`. `requirePerm`/`requireIssuePerm` считают доступ через `roleCan(role, …)` /
  `roleDenialReason(role, …)`, ставят `req.projectRole` и `req.impliedViewer`.
  `deptMemberCache` (ключ `user::dept`, TTL 30 с) + `invalidateDeptMembership`
  (зовётся из `departmentSync`). `can()`/`denialReason` в middleware больше не нужны.
- **`routes/projects.ts` bootstrap** — `users` теперь включает и участников департамента
  проекта (чтобы неявный viewer резолвился в клиентском me-memo); в `.members` их нет.
- **`departmentSync.ts`** — после синка сбрасывает `deptMemberCache` по всем
  сопоставленным департаментам пользователя.
- **`test/helpers.ts`** — `addDeptMember` / `setDeptLdapGroup`; `resetDb` чистит
  `department_members` и `issue_collaborators` явно.
- **`access.multiproject.test.ts`** +3: член департамента видит проект/задачи как viewer,
  мутации 403, в `.users` но не в `.members`; `is_shared` открывает bootstrap не-участнику
  (раньше 403); явная роль перекрывает неявный viewer. **38 тестов зелёные.**
- **Живой прогон** (dev :8080): `t.viewer` (не участник A21) — `/api/projects` без A21,
  bootstrap A21 → 403; после `INSERT department_members` — `/api/projects` с A21,
  bootstrap → 200 (в `.users`, не в `.members`), `GET .../issues` → 200,
  `POST .../issues` → 403.
- **DEPT_MIGRATION.md §3.5** — помечен как закрытый.

### Фаза 4 — Админ-UI + ресинк + ограничения ldap-режима  *(сделано)*

- **`contract.ts`** — `DepartmentBody` += опц. `ldapGroupDn`; новый `DepartmentPatchBody`
  (`{ name?, ldapGroupDn? }`, nullable DN до 1024). `routes/departments.ts` PATCH —
  динамический SET; конфликт `departments_ldap_group_dn_uk` → `409` «эта LDAP-группа уже
  привязана к другому отделу».
- **`GET /api/auth/config`** (`requireAuth`) → `{ authMode }`; **`SafeUser`** += `authSource`.
- **`services/ldap.ts` `ldapUserGroups(login)`** — DN групп по логину без пароля (сервис-bind).
  **`POST /api/ldap/resync`** (глоб. admin, только `ldap`, нужен `LDAP_BIND_DN`) — прогон
  `syncDepartmentMembership` по всем `auth_source='ldap'`; ответ `{ total, synced, notFound, errors }`;
  аудит `ldap.resync`.
- **`ldap`-режим**: `POST /api/admin/users` → `409` «пользователи заводятся автоматически
  при первом входе»; `PATCH /api/users/:id` со сменой `global_role` для `auth_source='ldap'`
  → `409` «роль управляется группой (LDAP_ADMIN_GROUP_DN)»; `is_active` менять можно.
  `provisionFromLdap` больше **не** форсит `is_active=true` на повторном входе — деактивация
  админом переживает вход.
- **Клиент**: `authApi.config` + `ldapApi.{ping,resync}`; `departmentsApi.patch(id, body)`;
  store `authMode` (из `bootstrap`), экшены `setDepartmentLdapGroup` / `resyncLdap`.
  `AdminView` — при `authMode==='ldap'`: строка «LDAP-группа» на каждом департаменте
  (инлайн-DN, blur→PATCH) + кнопка «Пересинхронизировать LDAP» в шапке.
- **Не сделано (косметика, отдельно):** тексты в `DocsView`/`PermissionsView` про
  LDAP-источник роли.

**Живой прогон** (:8090 `AUTH_MODE=ldap` + мок LDAP): `GET /auth/config` → `{authMode:"ldap"}`;
`PATCH department.ldapGroupDn` сохраняется, та же группа на другом отделе → `409`;
`POST /api/admin/users` → `409`; `PATCH /users/:id {globalRole}` на ldap-юзере → `409`,
`{isActive}` → `200`; `POST /api/ldap/resync` → `{"total":3,"synced":3,"notFound":[],"errors":[]}`,
`department_members` пересобрана по группам. `AUTH_MODE=local`: 38 тестов зелёные,
typecheck (сервер 0 / клиент 0), `npm run build` — успешно.

### Фаза 5 — Тесты против тестового OpenLDAP  *(сделано)*

- **`server/test/ldap/`** — `docker-compose.ldap.yml` (`osixia/openldap:1.5.0`),
  `bootstrap.ldif` (люди/группы), `acl.ldif` (правки cn=config для теста),
  `mock-ldap.mjs` (ldapjs, fallback без Docker) (D7).
- **`server/test/access.ldap.test.ts`** — гоняется только при `AUTH_MODE=ldap` +
  `LDAP_URL` (иначе `describe.skip`); `npm run test:ldap`. **9 тестов против
  настоящего slapd, все зелёные в CI:**
  - `LDAP-вход против настоящего OpenLDAP` (6): `t.manager` → 200 + JWT + JIT
    (`auth_source=ldap`, `ldap_dn`) + `department_members=['ИБ']`; `t.admin`
    (в `cn=taskira-admins`) → `global_role='admin'`; `t.viewer` → `department_members=['IT']`;
    неверный пароль → 401 (реальный `InvalidCredentials`, result code 49);
    break-glass локальный admin входит, хотя `uid=<admin>` в LDAP нет; reverse
    group search находит настоящее `groupOfNames`-членство.
  - `Специфика LDAP-протокола, которой нет в моке` (3): обычный search обычным
    пользователем → `SizeLimitExceededError` (серверный `sizelimit=500`);
    клиентский `sizeLimit=25` → сервер вернул ровно 25 (мок отдал бы все 600);
    **paged results (RFC 2696), `pageSize=100` → 600 записей за 6 страниц**
    (для `uid=t.outsider` снят лимит через `olcLimits size.pr/prtotal=unlimited`;
    `t.employee` на том же поиске упирается в 500 — это и проверяет предыдущий тест).
- **`ldapAuthenticate`** — reverse group search выполняется сервис-аккаунтом
  (re-bind после проверки пароля): дефолтный ACL OpenLDAP не даёт обычному
  пользователю искать по `member=` и отдаёт `noSuchObject`; для реального AD это
  тоже правильнее.
- **`.github/workflows/test.yml`** — отдельный job `ldap`: `postgres:16` +
  `docker compose … up -d` (osixia), ожидание RootDSE, `ldapadd` bootstrap.ldif,
  `ldapmodify` acl.ldif (cn=config), `npm run test:ldap`, дамп логов slapd
  (`if: always()`). Основной job `server` остаётся в `AUTH_MODE=local`
  (38 серверных тестов зелёные).

### Фаза 6 — Верификация + LDAP_SETUP.md  *(сделано)*

- **[`LDAP_SETUP.md`](LDAP_SETUP.md)** *(новый, корень репо)* — эксплуатационная
  инструкция: §1 что делает сервер при `AUTH_MODE=ldap`; §2 таблица всех `LDAP_*`
  с примерами OpenLDAP **и** AD; §3 маппинг групп на департаменты (+ как взять DN
  группы в AD: `dsquery group` / «Редактор атрибутов» / `Get-ADGroup`); §4
  break-glass admin; §5 `POST /api/ldap/ping` + `POST /api/ldap/resync` +
  ограничения ldap-режима; §6 пошаговый перевод действующего сервера (сверка
  `username`, откат); §7 LDAPS/StartTLS + приватный CA; §8 траблшутинг (bind
  error 49 `data 52e/525/533`, referrals, range retrieval при группе > 1000,
  вложенные группы, рассинхрон часов); §9 сводка OpenLDAP ≠ AD.
- **[`server/README.md`](server/README.md)** — строка `ldap-auth` в «Статусе
  этапов» + блок ручного чек-листа «LDAP-аутентификация (ldap-auth)» (схема 009,
  регрессия `local`, вход, гарды/админ-операции, клиент).
- **[`ARCHITECTURE.md`](ARCHITECTURE.md)** — «Текущее состояние»: департаменты
  (007) и LDAP (009) перенесены из «чего ещё нет» в «реализовано»; «Целевая
  архитектура» п. 3 и «Порядок разработки» п. 1 → ✅; фоновый ресинк остаётся в п. 5.

### Фаза 5.1 — Харденинг по итогам ревью  *(сделано, поверх Фазы 5)*

Точечные правки безопасности/устойчивости, не меняющие контракт:

- **`services/userProvisioning.ts`** — `KEEP_LAST_ADMIN` SQL-`CASE` в обоих
  `UPDATE`: JIT-синк не снимает `global_role='admin'` у **последнего** активного
  админа (тот же инвариант, что WHERE-гард в `PATCH /users/:id`) — LDAP-выпадение
  из `LDAP_ADMIN_GROUP_DN` не запирает систему. Гонка двух первых логинов одного
  `username` → `23505` на `users_username_key` ловится, один повторный проход
  уходит в ветку adopt/update.
- **`services/ldap.ts`** — `escFilter` чинит класс символов (`^@` → реальный `\0`);
  новый `escDn()` (RFC 4514) для подстановки `{username}` в `LDAP_USER_DN_TEMPLATE`
  при прямом bind (раньше значение из тела запроса шло в DN без экранирования).
- **`routes/auth.ts`** — `ApiHttpError 409` из `provisionFromLdap` (login == имя
  break-glass) больше не утекает клиенту отдельным статусом: уходим в обычную
  локальную проверку (`401`, либо вход, если это правда break-glass). Аудит
  `auth.login.denied` восстанавливает `actor_id` по `username` (джойн неудачных
  попыток к `users.id` для мониторинга).
- **`routes/projects.ts`** — bootstrap `users` для `is_shared`-проекта включает всех
  активных (тот же неявный `viewer`, что даёт `effectiveRole`), чтобы текущий юзер
  резолвился в клиентском me-memo.

`typecheck` 0, `npm test` (local) 38 зелёных, 9 ldap-тестов в CI зелёные.

### Фаза 7 — Follow-ups (не в этой миграции)

- Фоновый воркер-ресинк по расписанию (вместе с воркером уведомлений, ARCHITECTURE п. 5).
- `department_ldap_groups` — N групп на департамент.
- Вложенные/транзитивные группы (AD `LDAP_MATCHING_RULE_IN_CHAIN` или рекурсия).
- Paged search для больших групп; пул соединений / reconnect для `ldapts`.
- Деактивация пользователя, полностью пропавшего из директории (сейчас — только смена
  членств на логине).

---

## 5. Риски и внимание

- **Нет реального AD для разработки.** Тестовый OpenLDAP ≠ AD в: `sAMAccountName` vs
  `uid`; `memberOf` (в AD — операционный атрибут, в OpenLDAP нужен оверлей → тест на
  обратном поиске); referrals; вложенные группы; paged results; `userAccountControl`
  (отключённые аккаунты). Всё AD-специфичное — за env-флагом; дельты — в LDAP_SETUP.md.
- **Break-glass admin — постоянный локальный пароль.** Сильный, ротация, документирование;
  CHECK `users_local_has_password` держит консистентность.
- **JIT-only sync ⇒ staleness.** Доступ после удаления из группы живёт до следующего
  логина (+30 с кэша). Митигация: `resync` + будущий воркер; окно задокументировать.
- **Усыновление по `username`.** Если корпоративный логин-атрибут ≠ Taskira `username`
  для существующего человека — вместо усыновления вторая строка. Разовое
  переименование/маппинг до переключения (LDAP_SETUP.md).
- **`password_hash` NULL-able + CHECK** — миграция 009 обязана пройти до любого
  `ldap`-логина; все `local`-строки должны иметь хэш (имеют).
- **`ldap_group_dn` UNIQUE (partial, регистронезависимо)** — два департамента не могут
  указывать на одну группу; задокументировать.
- **Секреты.** `LDAP_BIND_PASSWORD` только в env; не логировать; debug `ldapts` выключен
  в prod. `server/.env` уже в `.gitignore`.
- **Правка `requirePerm`** (неявный `viewer`, D8) — горячий путь; доп. запрос только
  когда явного `project_members` нет; кэшировать рядом с `membershipCache`. `is_shared`
  теперь открывает bootstrap не-участнику (как `viewer`) — обновить сценарии в
  `access.multiproject.test.ts`, где ожидался `403`.

---

## 6. Оценка объёма

| Фаза | Область | Размер |
|---|---|---|
| 1 | миграция 009 + `config` + тестовый OpenLDAP (compose/LDIF) | M |
| 2 | `ldapts` + `services/ldap.ts` + provisioning + sync + login-путь | **L** |
| 3 | видимость по департаменту + неявный `viewer` в middleware | M |
| 4 | AdminView (`ldap_group_dn`) + `/api/ldap/resync` + ограничения ldap-режима | M |
| 5 | `access.ldap.test.ts` + CI-сервис OpenLDAP | M–L |
| 6 | `LDAP_SETUP.md` + чек-лист + правка ARCHITECTURE/DEPT | S–M |
| 7 | воркер-ресинк, N-групп-на-отдел, вложенные группы | отдельно |

Критический путь: 1 → 2 → 3 → 5 → 6. Фаза 4 аддитивна. Фаза 7 — вне захода.
