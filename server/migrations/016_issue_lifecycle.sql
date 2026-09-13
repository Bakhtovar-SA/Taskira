-- 016: жизненный цикл задачи — дата закрытия и архив.
--
-- Проблема (аудит, LIFE-01): у задачи не было НИ ОДНОГО поля с датой закрытия.
-- `updated_at` не годится как замена — его дёргает любая правка, в том числе
-- правка уже закрытой задачи месяц спустя. Без даты закрытия невозможны ни
-- архив, ни отчётность («сколько отдел сделал за месяц»), ни метрика времени
-- жизни задачи.
--
-- done_at     — момент перехода в статус категории 'done'. Проставляется в
--               POST /issues/:id/transition, ОБНУЛЯЕТСЯ при возврате в работу
--               (задача, переоткрытая и закрытая снова, получает новую дату).
-- archived_at — момент ухода задачи из активного набора проекта. Ставится
--               фоновым воркером (services/maintenance.ts) для задач с
--               done_at старше ARCHIVE_AFTER_DAYS. НЕ удаление: строка на месте,
--               задача открывается по прямой ссылке, ищется и участвует в отчётах.

ALTER TABLE issues ADD COLUMN IF NOT EXISTS done_at     timestamptz NULL;
ALTER TABLE issues ADD COLUMN IF NOT EXISTS archived_at timestamptz NULL;

-- Разовый backfill для уже закрытых задач: точной даты закрытия взять неоткуда,
-- updated_at — лучшее доступное приближение. Идемпотентно (только там, где NULL).
UPDATE issues i
   SET done_at = i.updated_at
  FROM workflow_statuses ws
 WHERE ws.id = i.status_id
   AND ws.category = 'done'
   AND i.done_at IS NULL;

-- Активный набор проекта: доска и «Список задач» всегда идут с archived_at IS NULL.
-- Частичный индекс повторяет idx_issues_project_status, но только по живым строкам —
-- он и остаётся небольшим, когда архив разрастётся.
CREATE INDEX IF NOT EXISTS idx_issues_active
    ON issues (project_id, status_id, rank)
 WHERE archived_at IS NULL;

-- Отчётность: «что закрыто за период» по проекту, и кандидаты на архивацию.
CREATE INDEX IF NOT EXISTS idx_issues_done_at
    ON issues (project_id, done_at DESC)
 WHERE done_at IS NOT NULL;

-- Воркер архивации сканирует по done_at среди ещё не заархивированных.
CREATE INDEX IF NOT EXISTS idx_issues_archive_candidates
    ON issues (done_at)
 WHERE done_at IS NOT NULL AND archived_at IS NULL;
