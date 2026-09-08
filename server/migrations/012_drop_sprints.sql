-- ============================================================
-- Taskira. Миграция 012: полное удаление спринтов.
-- Применяется server/src/db.ts migrate() целиком в одной транзакции.
-- См. UI_RESTRUCTURE.md (раздел «РЕШЕНО», D1; Фаза 1).
--
-- SCOPE.md с самого начала помещает спринты и scrum-церемонии в
-- «Осознанно откладываем / не делаем». Мёртвая таблица, право
-- manageSprints и три роута /sprints только запутывали код.
--
-- Необратимо: теряются строки sprints и привязка issues.sprint_id.
-- На dev-БД там только дефолтный seed-спринт на проект (реального
-- планирования нет) → дамп не снимаем. На инсталляции с реальным
-- планированием в спринтах — снять `pg_dump -t sprints` ДО применения
-- (см. чек-лист «UI-реструктуризация» в server/README.md).
--
-- Историю в audit_log (entity='sprint', action LIKE 'sprint%',
-- 'issue.sprint.move') НЕ трогаем — свободный текст, FK нет.
-- ============================================================

-- DROP COLUMN снимает и FK issues_sprint_id_fkey, и idx_issues_sprint.
ALTER TABLE issues DROP COLUMN IF EXISTS sprint_id;

DROP TABLE IF EXISTS sprints;
