# Тестовый LDAP

Локальный OpenLDAP для разработки и тестов LDAP-аутентификации
(см. [`../../../LDAP_MIGRATION.md`](../../../LDAP_MIGRATION.md), D7).
Реального корпоративного AD у нас нет — весь LDAP-путь проверяется против него.

## Без Docker: `mock-ldap.mjs`

Если Docker недоступен — тот же каталог поднимает мок на `ldapjs`:

```bash
node test/ldap/mock-ldap.mjs        # ldap://127.0.0.1:1389, MOCK_LDAP_PORT для смены порта
```

Дерево, пользователи и группы идентичны `bootstrap.ldif`. Для сервера тогда
`LDAP_URL=ldap://127.0.0.1:1389`, `LDAP_GROUP_MEMBERSHIP=search`, `LDAP_ATTR_LOGIN=uid` и т.д.
(полный набор — ниже). Это отладочный инструмент, не замена OpenLDAP в CI.

## Запуск (Docker)

`osixia/openldap:1.5.0`. Образ создаёт только пустой суффикс `dc=taskira,dc=test`;
дерево (люди/группы) заливаем сами — так видно ошибки LDIF.

```bash
cd server
docker compose -f docker-compose.ldap.yml up -d
# дождаться healthcheck (docker compose ps), затем:
docker compose -f docker-compose.ldap.yml exec openldap \
  ldapadd -x -H ldap://localhost:389 -D cn=admin,dc=taskira,dc=test -w admin -f /ldifs/bootstrap.ldif

docker compose -f docker-compose.ldap.yml down -v     # погасить + сбросить данные
```

## Что внутри

- База: `dc=taskira,dc=test`; админ директории: `cn=admin,dc=taskira,dc=test` / `admin`.
- Пользователи (`ou=people`, `inetOrgPerson`), пароль у всех — `testpass123`:
  `t.admin`, `t.manager`, `t.employee`, `t.viewer`, `t.outsider`.
- Группы (`ou=groups`, `groupOfNames`, атрибут `member`):
  | Группа | Члены | Смысл в Taskira |
  |---|---|---|
  | `cn=taskira-admins,ou=groups,dc=taskira,dc=test` | `t.admin` | `global_role='admin'` |
  | `cn=dept-infosec,ou=groups,dc=taskira,dc=test` | `t.manager`, `t.employee` | департамент D1 |
  | `cn=dept-it,ou=groups,dc=taskira,dc=test` | `t.viewer` | департамент D2 |
  `t.outsider` — ни в одной группе.

## Проверка вручную

```bash
# связь + поиск
ldapsearch -x -H ldap://localhost:389 -b dc=taskira,dc=test \
  -D cn=admin,dc=taskira,dc=test -w admin "(uid=t.manager)"

# членство в группах (обратный поиск — так же делает сервер при LDAP_GROUP_MEMBERSHIP=search)
ldapsearch -x -H ldap://localhost:389 -b ou=groups,dc=taskira,dc=test \
  -D cn=admin,dc=taskira,dc=test -w admin \
  "(&(objectClass=groupOfNames)(member=uid=t.manager,ou=people,dc=taskira,dc=test))"
```

## Env для сервера (`AUTH_MODE=ldap`)

```
AUTH_MODE=ldap
LDAP_URL=ldap://localhost:389
LDAP_BIND_DN=cn=admin,dc=taskira,dc=test
LDAP_BIND_PASSWORD=admin
LDAP_USER_BASE_DN=ou=people,dc=taskira,dc=test
LDAP_USER_FILTER=(uid={username})
LDAP_GROUP_MEMBERSHIP=search
LDAP_GROUP_BASE_DN=ou=groups,dc=taskira,dc=test
LDAP_ADMIN_GROUP_DN=cn=taskira-admins,ou=groups,dc=taskira,dc=test
LDAP_ATTR_LOGIN=uid
LDAP_ATTR_NAME=cn
LDAP_ATTR_MAIL=mail
```

Отличия реального AD (`sAMAccountName`, `memberOf`, LDAPS, вложенные группы) — в
`LDAP_SETUP.md` (появится в Фазе 6).
