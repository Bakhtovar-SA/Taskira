-- ============================================================
-- Taskira. Миграция 018: points → complexity.
-- Применяется server/src/db.ts migrate() целиком в одной транзакции.
--
-- "Оценка (очки)" была убрана из карточки ещё в round4 (UI_RESTRUCTURE.md),
-- но колонка issues.points и её валидация оставались в схеме/контракте без
-- единого места в UI, где её можно было бы задать — мёртвое поле (см.
-- ARCHITECTURE.md, follow-up). Вместо возврата числовой оценки — простая
-- трёхзначная шкала без Scrum-сленга, в духе остального продукта.
--
-- complexity — обычный text + CHECK, не enum-тип (тот же приём, что и в
-- миграции 013 для priority_id): проще менять набор значений в будущем.
--
-- Перенос данных не нужен: points никогда не выставлялся ни через один
-- существующий UI-путь (Board.tsx и CreateIssueModal.tsx жёстко слали null).
-- ============================================================

ALTER TABLE issues DROP COLUMN IF EXISTS points;

ALTER TABLE issues ADD COLUMN complexity text
  CHECK (complexity IN ('simple', 'medium', 'hard'));

COMMENT ON COLUMN issues.complexity IS
  'Простая шкала сложности задачи (не Scrum story points). NULL — не оценена.';
