-- ============================================================
-- Taskira. Миграция 013: приоритеты 5 значений → 4.
-- Применяется server/src/db.ts migrate() целиком в одной транзакции.
-- См. ticket-priority-4-levels-and-modal-polish.md (Часть A).
--
-- Было:  highest | high | medium | low | lowest
-- Стало: low | medium | high | critical
--
-- Сопоставление данных (задачи не удаляются, меняется только метка):
--   highest → critical
--   lowest  → low   (сливается с low)
--   high / medium / low — без изменений
--
-- priority_id — обычный text + CHECK, не enum-тип, поэтому ALTER TYPE не
-- нужен: сначала правим данные, потом пересобираем ограничение.
-- ============================================================

UPDATE issues SET priority_id = 'critical' WHERE priority_id = 'highest';
UPDATE issues SET priority_id = 'low'      WHERE priority_id = 'lowest';

ALTER TABLE issues DROP CONSTRAINT IF EXISTS issues_priority_id_check;
ALTER TABLE issues ADD  CONSTRAINT issues_priority_id_check
  CHECK (priority_id IN ('low', 'medium', 'high', 'critical'));
