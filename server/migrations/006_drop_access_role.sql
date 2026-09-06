-- ============================================================
-- Taskira. Миграция 006: удаление легаси-колонки users.access_role.
-- Применяется server/src/db.ts migrate() целиком в одной транзакции.
-- См. ROLE_MIGRATION.md (Фаза 7).
--
-- С Фазы 2 права резолвятся только по users.global_role + project_members
-- (миграция 004). access_role больше нигде не читается на сервере, JWT её
-- не несёт. Параллельный прогон со старой моделью завершён.
--
-- Необратимо. Перед применением снят дамп: backup_before_006.sql.
-- (Миграции 005 нет — 004 самодостаточна.)
-- ============================================================

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_access_role_check;
ALTER TABLE users DROP COLUMN IF EXISTS access_role;
