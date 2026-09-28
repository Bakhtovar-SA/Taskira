-- ТЗ 5.10 (мастер, шаги 2 и 4) и 5.14: внешний вид проекта — иконка, цвет и фон.
-- Все три — идентификаторы из закрытых списков contract.ts (PROJECT_ICONS, PROJECT_COLORS,
-- PROJECT_BACKGROUNDS); список проверяет zod, а БД — только форму значения, чтобы новый пункт
-- списка не требовал миграции. NULL — как раньше: буква ключа, цвет по ключу, личный фон человека.
--
-- Аддитивная (expand) миграция: nullable-колонки, старый код их не читает.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS icon text
  CHECK (icon IS NULL OR icon ~ '^[a-z][a-z0-9-]{0,31}$');
ALTER TABLE projects ADD COLUMN IF NOT EXISTS color text
  CHECK (color IS NULL OR color ~ '^[a-z][a-z0-9-]{0,31}$');
ALTER TABLE projects ADD COLUMN IF NOT EXISTS background text
  CHECK (background IS NULL OR background ~ '^[a-z][a-z0-9-]{0,31}$');
