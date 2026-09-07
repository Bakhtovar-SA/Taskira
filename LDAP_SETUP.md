# LDAP_SETUP — подключение Taskira к реальному AD/LDAP

Практическая инструкция для эксплуатации: как перевести сервер с локального пароля
на корпоративный Active Directory (или другой LDAP). Проектные решения и обоснования —
в [LDAP_MIGRATION.md](LDAP_MIGRATION.md) (§3, D1–D8). Локальный тестовый OpenLDAP —
[server/test/ldap/README.md](server/test/ldap/README.md).

> Вся разработка велась против тестового **OpenLDAP** — реального AD у команды не было.
> Отличия AD отмечены по тексту значком **[AD]**; §6 — сводка расхождений.

---

## 1. Что делает сервер при `AUTH_MODE=ldap`

На каждый `POST /api/auth/login`:

1. **bind сервис-аккаунтом** (`LDAP_BIND_DN` + `LDAP_BIND_PASSWORD`) → **поиск**
   пользователя по `LDAP_USER_FILTER` в `LDAP_USER_BASE_DN` → чтение DN и атрибутов
   (`LDAP_ATTR_LOGIN` / `_NAME` / `_MAIL`).
   Без `LDAP_BIND_DN` — режим **прямого bind** по `LDAP_USER_DN_TEMPLATE` (проще, но
   без сервис-аккаунта нельзя делать ресинк и обратный поиск групп).
2. **re-bind найденным DN + паролем пользователя** — собственно проверка учётки.
   Ошибка «неверные креды» (LDAP result code 49) → `401`. Сеть/таймаут/отказ
   сервис-bind → пробуем break-glass (см. §4), иначе `401`.
3. **Группы пользователя**: `LDAP_GROUP_MEMBERSHIP=memberOf` (читаем атрибут `memberOf`
   из записи — **[AD]** так и надо) либо `=search` (обратный поиск
   `(&(objectClass=groupOfNames)(member=<userDN>))` в `LDAP_GROUP_BASE_DN` —
   тестовый OpenLDAP). Обратный поиск сервер делает **сервис-аккаунтом**.
4. **JIT-provisioning** ([D3/D4](LDAP_MIGRATION.md)): по `username == <LDAP_ATTR_LOGIN>`
   находим локальную строку и «усыновляем» её (`auth_source='ldap'`, `ldap_dn`,
   `email`, `password_hash=NULL`; `id`, `project_members`, авторство — сохраняются),
   либо создаём новую.
5. **`global_role`**: `admin`, если DN одной из групп пользователя совпал (без учёта
   регистра) с `LDAP_ADMIN_GROUP_DN`; иначе `member`. Гард: JIT никогда не снимает
   роль у **последнего** активного админа — поправьте членство в
   `LDAP_ADMIN_GROUP_DN` и войдите снова.
6. **Членство в департаментах**: для каждого DN группы ищем департамент с таким
   `departments.ldap_group_dn` (задаётся админом в интерфейсе, см. §3) → строки
   `department_members` с `source='ldap'`. Строки `source='manual'` не трогаются.
   Даёт неявную роль `viewer` на проектах департамента ([D8](LDAP_MIGRATION.md)).

Свежесть — на момент логина (+ до 30 с кэша роли/членства). Принудительно —
`POST /api/ldap/resync` (§5). Фоновый воркер по расписанию — [Фаза 7](LDAP_MIGRATION.md).

---

## 2. Переменные окружения

Задаются в `server/.env` (не в git; см. `server/.env.example`). При `AUTH_MODE=ldap`
сервер **падает на старте**, если не хватает обязательного ключа.

| Переменная | Обяз. | Пример OpenLDAP | Пример **[AD]** | Назначение |
|---|---|---|---|---|
| `AUTH_MODE` | да | `ldap` | `ldap` | `local` (деф.) \| `ldap` |
| `LDAP_URL` | да | `ldap://dc.corp.local:389` | `ldaps://dc.corp.example.com:636` | один хост; LDAPS см. §7 |
| `LDAP_BIND_DN` | да¹ | `cn=svc-taskira,ou=people,dc=taskira,dc=test` | `CN=svc-taskira,OU=Service,DC=corp,DC=example,DC=com` | read-only сервис-аккаунт |
| `LDAP_BIND_PASSWORD` | с `BIND_DN` | — | — | пароль сервис-аккаунта; только env, не логируется |
| `LDAP_USER_BASE_DN` | да | `ou=people,dc=taskira,dc=test` | `OU=Users,OU=Corp,DC=corp,DC=example,DC=com` | база поиска людей (scope sub) |
| `LDAP_USER_FILTER` | да | `(uid={username})` | `(sAMAccountName={username})` | должен содержать `{username}` |
| `LDAP_USER_DN_TEMPLATE` | да¹ | `uid={username},ou=people,dc=taskira,dc=test` | обычно неприменимо в AD | только для прямого bind (без `BIND_DN`) |
| `LDAP_GROUP_MEMBERSHIP` | — | `search` | `memberOf` | `memberOf` (деф.) \| `search` |
| `LDAP_GROUP_BASE_DN` | с `search` | `ou=groups,dc=taskira,dc=test` | `OU=Groups,OU=Corp,DC=corp,DC=example,DC=com` | база обратного поиска групп |
| `LDAP_ADMIN_GROUP_DN` | — | `cn=taskira-admins,ou=groups,dc=taskira,dc=test` | `CN=Taskira Admins,OU=Groups,DC=corp,DC=example,DC=com` | членство ⇒ `global_role='admin'` |
| `LDAP_ATTR_LOGIN` | — | `uid` | `sAMAccountName` (деф.) | логин-атрибут = `users.username` |
| `LDAP_ATTR_NAME` | — | `cn` | `displayName` (деф.) | отображаемое имя |
| `LDAP_ATTR_MAIL` | — | `mail` | `mail` (деф.) | e-mail (nullable) |
| `LDAP_STARTTLS` | — | `false` | `false` (при LDAPS) / `true` (StartTLS на :389) | см. §7 |
| `LDAP_TLS_CA_FILE` | — | — | `/etc/taskira/corp-ca.pem` | приватный CA для LDAPS/StartTLS |
| `LDAP_TLS_REJECT_UNAUTHORIZED` | — | `true` | `true` | `false` — **только** для отладки |
| `LDAP_TIMEOUT_MS` | — | `5000` | `5000`–`10000` | таймаут соединения и операций |

¹ Нужен **либо** `LDAP_BIND_DN` (+пароль), **либо** `LDAP_USER_DN_TEMPLATE`.
Рекомендуется `LDAP_BIND_DN` — без него не работают ресинк и обратный поиск групп.

**[AD] Логин-атрибут.** Вход по `sAMAccountName` (без домена). Если пользователи
привыкли вводить `DOMAIN\user` или `user@corp.example.com` — заведите фильтр вида
`(|(sAMAccountName={username})(userPrincipalName={username}))` и объясните формат
в подсказке к полю логина. `{username}` экранируется по RFC 4515 автоматически.

---

## 3. Маппинг групп на департаменты

Не «по OU» и не по именам ([D5](LDAP_MIGRATION.md)) — **явно**, по одному DN группы
на департамент:

1. Войдите как глобальный `admin`, откройте раздел управления (AdminView).
2. У каждого департамента — поле **«LDAP-группа»**: вставьте туда `distinguishedName`
   группы, членство в которой означает принадлежность к департаменту. `blur` →
   `PATCH /api/departments/:id`. Та же группа на втором департаменте → `409`
   (индекс `departments_ldap_group_dn_uk`, регистронезависимо, partial).
3. Пусто → департамент из LDAP не наполняется.

**Глобальный `admin`** — отдельная группа `LDAP_ADMIN_GROUP_DN` в env, **не**
департамент.

**[AD] Как взять DN группы:**
- `dsquery group -name "Taskira Admins"` — вернёт DN;
- или «Пользователи и компьютеры» → свойства группы → вкладка «Редактор атрибутов»
  → `distinguishedName` (включить «Дополнительные возможности» в меню «Вид»);
- или PowerShell: `Get-ADGroup "Taskira Admins" | Select-Object -Expand DistinguishedName`.

MVP — одна группа на департамент. N групп на департамент и вложенные группы —
[Фаза 7](LDAP_MIGRATION.md).

---

## 4. Break-glass локальный админ

В `ldap`-режиме по локальному паролю входит **только** `ADMIN_USERNAME` из
`server/.env` (`auth_source='local'`, `password_hash` на месте). Нужен, чтобы войти
и починить систему, когда LDAP недоступен или `LDAP_URL` задан с опечаткой.

- Пароль (`ADMIN_PASSWORD`) — сильный, хранится в менеджере секретов, ротация по
  регламенту. CHECK `users_local_has_password` не даёт «потерять» ему хэш.
- Имя break-glass занято: если в LDAP есть учётка с тем же `uid`/`sAMAccountName`,
  усыновления **не будет** (`provisionFromLdap` → `409`), сервер молча уходит в
  локальную проверку. Не называйте break-glass так же, как реального сотрудника.
- Все прочие локальные строки в `ldap`-режиме войти не могут (кроме как через
  усыновление при первом LDAP-логине).

---

## 5. Проверка и эксплуатация

**Связь** (глобальный admin, `ldap`-режим):

```bash
curl -sX POST http://localhost:8080/api/ldap/ping -H "Authorization: Bearer $TOKEN"
# ok:  { "authMode":"ldap", "url":"...", "bind":"service-account", "ok":true, "baseDn":"..." }
# err: { ..., "ok":false, "error":"connect ECONNREFUSED ..." }
```

**Ручной ресинк** членства по всем `auth_source='ldap'` (требует `LDAP_BIND_DN`):

```bash
curl -sX POST http://localhost:8080/api/ldap/resync -H "Authorization: Bearer $TOKEN"
# { "total": N, "synced": N, "notFound": ["uid ..."], "errors": [] }
```

`notFound` — есть в БД как `ldap`, но не найден в директории сейчас (уволен /
переименован). Деактивацию таких учёток JIT пока не делает — [Фаза 7](LDAP_MIGRATION.md);
до неё — вручную через `PATCH /api/users/:id {isActive:false}`.

**Ограничения `ldap`-режима:**
- `POST /api/admin/users` → `409` (пользователи заводятся первым входом);
- `PATCH /api/users/:id` со сменой `global_role` для `auth_source='ldap'` → `409`
  (роль из `LDAP_ADMIN_GROUP_DN`); `isActive` — менять можно.

---

## 6. Пошаговый перевод действующего сервера

1. **До переключения** сверьте `users.username` с логин-атрибутом AD. Расхождение
   (`ivan.petrov` в Taskira vs `ipetrov` в AD) → при первом входе появится **вторая**
   строка вместо усыновления первой. Переименуйте заранее:
   `UPDATE users SET username='ipetrov' WHERE username='ivan.petrov';`
2. Убедитесь, что миграция `009_ldap.sql` применена (`schema_migrations`) и у всех
   `auth_source='local'` строк есть `password_hash` (CHECK это гарантирует).
3. Заведите read-only сервис-аккаунт в AD, дайте ему право читать нужные OU и атрибут
   `memberOf`.
4. Заполните `LDAP_*` в `server/.env`, оставьте `AUTH_MODE=local`, перезапустите,
   дёрните `POST /api/ldap/ping` — должно быть `ok:true`.
5. Проставьте `ldap_group_dn` департаментам (§3), задайте `LDAP_ADMIN_GROUP_DN`.
6. Переключите `AUTH_MODE=ldap`, перезапустите. Проверьте: вход реального
   пользователя → `200` + корректные департаменты; неверный пароль → `401`;
   break-glass admin входит при погашенном LDAP.
7. `POST /api/ldap/resync` — разово наполнить членство всем, не дожидаясь их входа.

Откат: `AUTH_MODE=local` + перезапуск. Усыновлённым строкам вернуть локальный вход
нельзя без пароля — при необходимости отката держите короткое окно.

---

## 7. LDAPS / StartTLS

- **LDAPS**: `LDAP_URL=ldaps://host:636`, `LDAP_STARTTLS=false`. TLS включается
  автоматически по схеме `ldaps://`.
- **StartTLS**: `LDAP_URL=ldap://host:389`, `LDAP_STARTTLS=true`.
- Приватный CA: `LDAP_TLS_CA_FILE=/path/ca.pem` (или общесистемно —
  `NODE_EXTRA_CA_CERTS`). `LDAP_TLS_REJECT_UNAUTHORIZED=false` — только отладка,
  не для эксплуатации.
- На обычном `ldap://` без StartTLS TLS-опции **не** передаются (иначе `ldapts`
  рвёт соединение хендшейком).

---

## 8. Траблшутинг

| Симптом | Причина / что делать |
|---|---|
| Сервер не стартует, `[config] AUTH_MODE=ldap: не задан LDAP_...` | не хватает обязательного ключа — см. §2 |
| `ping` → `ECONNREFUSED` / таймаут | `LDAP_URL`/порт/файрвол; проверь `ldapsearch` с той же машины |
| `ping` → `ok:true`, но вход всех → `401` | `LDAP_USER_FILTER`/`LDAP_USER_BASE_DN` не находят запись (scope, OU); лог `bind пользователя не удался` |
| Вход `200`, но `department_members` пуст | `LDAP_GROUP_MEMBERSHIP`; для `search` — сервис-аккаунт не видит `member=`; DN в поле департамента ≠ фактический DN группы |
| **[AD]** `memberOf` пуст обратным поиском | в AD `memberOf` — операционный атрибут: ставь `LDAP_GROUP_MEMBERSHIP=memberOf`, не `search` |
| bind error 49 (`data 52e` / `data 525` / `data 533`) | 52e — неверный пароль; 525 — нет пользователя; 533 — аккаунт отключён |
| Referral / `partial results` в AD | ищи от `DC=...` конкретного домена, не от глобального каталога; при мультидомене используй GC-порт `:3268` осознанно |
| Группа > 1000 членов, часть не видна | AD отдаёт `member` порциями (range retrieval) — MVP это не разбирает; для admin/dept-групп держи < 1000 или используй `memberOf` со стороны пользователя |
| Вложенные группы не работают | ограничение MVP — только прямое членство ([Фаза 7](LDAP_MIGRATION.md): `LDAP_MATCHING_RULE_IN_CHAIN`) |
| Периодические `InvalidCredentials` у части юзеров | рассинхрон часов сервера и DC (Kerberos-подобные окна) — включи NTP |
| Уволенный сохраняет доступ | JIT-only: до следующего логина (+30 с кэша); `POST /api/ldap/resync` сужает членства, деактивацию делай вручную |

---

## 9. Тестовый OpenLDAP ≠ AD — сводка расхождений

| | Тестовый OpenLDAP | Active Directory |
|---|---|---|
| Логин-атрибут | `uid` | `sAMAccountName` / `userPrincipalName` |
| Членство в группах | обратный поиск (`search`) — оверлея `memberof` нет | атрибут `memberOf` (операционный) |
| Класс группы | `groupOfNames` / `member` | `group` / `member` |
| DN | `uid=t.manager,ou=people,dc=taskira,dc=test` | `CN=Ivan Petrov,OU=Users,OU=Corp,DC=corp,DC=example,DC=com` |
| TLS | обычно `ldap://` | почти всегда LDAPS/StartTLS + приватный CA |
| Отключённый аккаунт | `userPassword` убран / запись удалена | бит `userAccountControl` (обратный поиск это не читает) |
| Referrals, вложенные группы, range retrieval | нет | есть — см. §8 |

Всё AD-специфичное включается env-флагами (`LDAP_GROUP_MEMBERSHIP`, `LDAP_ATTR_*`,
`LDAP_URL` со схемой). Кода, завязанного на конкретный сервер, нет.
