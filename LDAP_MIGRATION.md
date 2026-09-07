# LDAP_MIGRATION — аутентификация через LDAP/AD + членство в департаменте

Статус: **решения §3 подтверждены (D1–D8, см. «РЕШЕНО»). Фаза 1 — в работе.**
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

### Фаза 2 — LDAP-клиент + аутентификация  *(план)*

- **`ldapts`** в `server/package.json`.
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

### Фаза 3 — Видимость проекта по департаменту (закрывает DEPT §3.5)  *(план)*

- **`services/projects.ts` `listVisibleProjects`** — `+ OR EXISTS (SELECT 1 FROM
  department_members dm WHERE dm.user_id = $1 AND dm.department_id = p.department_id)`.
- **`middleware.ts` `requirePerm`/`requireIssuePerm`** — если явного `project_members`
  нет и не admin, но пользователь в департаменте проекта (`department_members`) **или**
  `req.project.isShared` (см. D8) → эффективная роль `viewer` (`req.projectRole='viewer'`,
  `req.impliedViewer = true`). `can()` тогда пускает `browse` и только его. Доп. запрос
  кэшировать рядом с `membershipCache` (ключ `user::dept`).
- Bootstrap `GET /api/projects/:projectId` и `GET /issues` начинают работать для членов
  департамента (как `viewer`).
- **`access.multiproject.test.ts`** — обновить сценарии видимости.
- Снять пометку «временно» в DEPT_MIGRATION.md §3.5.

### Фаза 4 — Админ-UI + ресинк + ограничения ldap-режима  *(план, аддитивно)*

- **`AdminView`** — на департаменте поле «LDAP-группа (DN)» → `PATCH /api/departments/:id
  { ldapGroupDn }`. Показывать/редактировать только при `AUTH_MODE=ldap` (флаг через
  `GET /api/auth/config` или мету bootstrap).
- **`POST /api/ldap/resync`** (глоб. admin) — прогнать `syncDepartmentMembership` по всем
  `auth_source='ldap'` (свежий групповой lookup сервис-аккаунтом на юзера). До воркера.
- **`contract.ts`** — `DepartmentBody`/новый `DepartmentPatchBody` + опц. `ldapGroupDn`
  (nullable, строка DN, лимит длины).
- **В `ldap`-режиме**: `POST /api/admin/users` и `PATCH /api/users/:id` (смена
  `global_role`) для `auth_source='ldap'` → 409 «роль управляется LDAP-группой».
  `project_members` назначаются вручную как и раньше (это модель Taskira, не LDAP).
- **`SafeUser`** += `authSource`; `DocsView`/`PermissionsView` — тексты: глобальная роль
  и членство в департаменте приходят из LDAP, правятся в директории.

### Фаза 5 — Тесты против тестового OpenLDAP  *(план)*

- **`server/test/ldap/`** — compose-сервис + `bootstrap.ldif` (D7).
- **`test/helpers.ts`** — `LDAP_TEST_*` env; фикстура связывает департаменты D1/D2 с
  `cn=dept-infosec,…` / `cn=dept-it,…`.
- **`access.ldap.test.ts`**: валидный/невалидный bind; JIT-создание новой строки;
  усыновление предсуществующего `t.manager` (сохранены `global_role` + `project_members`);
  `LDAP_ADMIN_GROUP_DN` → `global_role='admin'`; sync групп → `department_members`;
  член департамента видит проекты своего департамента (`viewer`), но не чужого не-shared;
  удаление из группы → доступ снят на следующем логине; break-glass локальный admin
  входит при `LDAP_URL` на мёртвый порт; `AUTH_MODE=local` — прежние 35 тестов зелёные.
- **`.github/workflows/test.yml`** — сервис `osixia/openldap` (или шаг
  `docker compose -f server/test/ldap/... up -d`) + env `AUTH_MODE`/`LDAP_*`.

### Фаза 6 — Верификация + LDAP_SETUP.md  *(план)*

- **`LDAP_SETUP.md`** — инструкция для реального AD:
  - таблица всех env-переменных с примерами для AD;
  - шпаргалка AD ↔ OpenLDAP: `sAMAccountName`/`userPrincipalName` vs `uid`; формат DN
    (`CN=Ivan Ivanov,OU=Users,OU=Corp,DC=corp,DC=example,DC=com`);
  - как взять DN группы в AD (`dsquery group`, «Пользователи и компьютеры» → «Редактор
    атрибутов» → `distinguishedName`) и вставить в поле департамента в AdminView;
  - `LDAP_ADMIN_GROUP_DN`;
  - LDAPS/StartTLS + приватный CA (`LDAP_TLS_CA_FILE` / `NODE_EXTRA_CA_CERTS`);
  - проверка связи: `POST /api/ldap/ping` (или `npm run ldap:check`);
  - траблшутинг: bind error 49, referrals в AD, paged search при группе > 1000,
    вложенные группы (ограничение MVP), рассинхрон часов.
- **`server/README.md`** — блок ручного чек-листа «LDAP (ldap-auth)».
- **`ARCHITECTURE.md`** — «Текущее состояние» + «Порядок разработки» п. 1 → сделано.

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
