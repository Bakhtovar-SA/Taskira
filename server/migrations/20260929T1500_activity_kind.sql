-- История задачи — события данными (трек E, docs/tracks/TRACK-E-ENGLISH-UI.md). Expand: обе колонки nullable,
-- `text` остаётся NOT NULL и по-прежнему пишется — русская фраза для клиентов до трека E, экспорта и записей,
-- сделанных до этой миграции (у них kind IS NULL, клиент показывает text). Удалять text — только отдельным
-- contract-релизом по docs/MIGRATIONS.md.
ALTER TABLE activity ADD COLUMN IF NOT EXISTS kind text;
ALTER TABLE activity ADD COLUMN IF NOT EXISTS payload jsonb;
