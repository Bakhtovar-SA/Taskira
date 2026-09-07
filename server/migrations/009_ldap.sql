-- ============================================================
-- Taskira. Миграция 009: подготовка к LDAP/AD-аутентификации.
-- Применяется server/src/db.ts migrate() целиком в одной транзакции.
-- См. LDAP_MIGRATION.md (раздел «РЕШЕНО», Фаза 1).
--
-- Схемой этот шаг ограничивается — поведение логина НЕ меняется:
-- AUTH_MODE=local по умолчанию, все существующие строки — auth_source='local'
-- с паролем на месте. LDAP-путь включает Фаза 2.
--
-- МОДЕЛЬ:
--   users.auth_source   — 'local' (пароль в password_hash) | 'ldap' (пароля нет).
--   users.ldap_dn       — DN пользователя в директории (уникален, если задан).
--   users.email         — почта из директории (для будущих уведомлений).
--   department_members  — членство в департаменте (D5/D8). Отложенная таблица
--                         DEPT_MIGRATION.md §3.5; source='ldap' пересобирается
--                         синхронизацией, source='manual' правится вручную.
--   departments.ldap_group_dn — 007 завёл колонку nullable и отложил UNIQUE;
--                         вводим partial UNIQUE (регистронезависимо) сейчас.
--
-- Обратима (DROP этих объектов). Бэкфилла нет.
-- (Миграции 005 нет — 004 самодостаточна.)
-- ============================================================

ALTER TABLE users ADD COLUMN auth_source text NOT NULL DEFAULT 'local'
  CHECK (auth_source IN ('local', 'ldap'));
ALTER TABLE users ADD COLUMN ldap_dn text;
ALTER TABLE users ADD COLUMN email   text;

-- LDAP-пользователи входят через директорию — локального пароля у них нет.
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- Но у локальной учётки пароль обязателен (break-glass admin в т.ч.).
ALTER TABLE users ADD CONSTRAINT users_local_has_password
  CHECK (auth_source <> 'local' OR password_hash IS NOT NULL);

-- Один DN директории = максимум одна строка users.
CREATE UNIQUE INDEX users_ldap_dn_uk ON users (lower(ldap_dn)) WHERE ldap_dn IS NOT NULL;

-- Членство в департаменте: из групп LDAP (source='ldap') или назначено вручную.
CREATE TABLE department_members (
  department_id uuid NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id)       ON DELETE CASCADE,
  source        text NOT NULL DEFAULT 'ldap' CHECK (source IN ('ldap', 'manual')),
  synced_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (department_id, user_id)
);
CREATE INDEX idx_department_members_user ON department_members (user_id);

-- 007 отложил уникальность на ldap_group_dn — вводим (partial, регистронезависимо):
-- две группы департаментов не могут указывать на одну LDAP-группу.
CREATE UNIQUE INDEX departments_ldap_group_dn_uk
  ON departments (lower(ldap_group_dn)) WHERE ldap_group_dn IS NOT NULL;
