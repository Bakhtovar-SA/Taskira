-- ТЗ 4.1 (план v2, Трек 4): singleton-таблица instance вместо будущей сущности organizations.
-- Решение и его обоснование — docs/adr/0009-database-per-tenant.md: при database-per-tenant
-- одна БД физически не может содержать вторую организацию, и схема обязана выражать это явно,
-- а не полагаться на соглашение в коде. `id smallint primary key check (id = 1)` делает вторую
-- строку невозможной на уровне PostgreSQL: PRIMARY KEY отклоняет повтор id=1, CHECK отклоняет
-- любой другой id.
--
-- Аддитивная миграция: новая таблица, ничего существующего не трогает. instance_id/
-- organization_id НЕ добавляется ни в одну существующую таблицу — это то самое решение ADR-0009,
-- а не упущение этой миграции.
--
-- Строка засеивается при старте сервера (seedInstance(), server/src/seedInstance.ts), не здесь —
-- миграция описывает схему, данные конкретной инсталляции (имя, план) заполняет провижининг
-- (ТЗ 4.2). license_key/license_expires_at остаются NULL до механизма лицензии (ТЗ 4.3) —
-- их отсутствие не блокирует работу инсталляции.
CREATE TABLE instance (
  id                 smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  name               text NOT NULL,
  plan               text NOT NULL DEFAULT 'default',
  license_key        text,
  license_expires_at timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);
