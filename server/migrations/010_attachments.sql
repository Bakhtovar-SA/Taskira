-- ============================================================
-- Taskira. Миграция 010: вложения к задачам (файлы).
-- Применяется server/src/db.ts migrate() целиком в одной транзакции.
-- См. FILES_MIGRATION.md (раздел «РЕШЕНО», Фаза 1).
--
-- Схемой этот шаг ограничивается — ни одного роута/middleware не трогаем.
-- Обработку multipart и эндпоинты вложений включает Фаза 2.
--
-- МОДЕЛЬ:
--   attachments — файл, прикреплённый к ОДНОЙ задаче (D6: к комментариям —
--     Фаза 6, через nullable comment_id). Видимость наследуется от задачи
--     целиком (D4): все эндпоинты вложений идут под
--     /api/projects/:projectId/issues/:id/attachments и через тот же
--     requireIssuePerm, что чтение/комментирование задачи. Отдельной модели
--     прав на вложение нет.
--
--   filename       — оригинальное имя, УЖЕ санитизированное (без путей,
--                    управляющих символов, ведущих точек); для показа/скачивания.
--   content_type   — НОРМАЛИЗОВАННЫЙ MIME (по расширению + подтверждённой
--                    magic-сигнатуре), не присланный клиентом (D3).
--   byte_size      — фактический размер записанного объекта.
--   sha256         — контроль целостности (+ будущий дедуп, Фаза 6).
--   storage_driver — 'local' | 's3': где физически лежит объект. Нужно, чтобы
--                    после переключения STORAGE_DRIVER знать, чем читать старое.
--   storage_key    — ключ объекта в хранилище: <issueId>/<uuid> (из имени
--                    файла НЕ строится).
--
-- КАСКАД: удаление задачи (или проекта → issues) снимает строки attachments.
--   Файлы в хранилище при этом остаются осиротевшими — их удаляют хендлеры
--   явного удаления; для каскада — best-effort уборка + follow-up «сборщик
--   сирот» (FILES_MIGRATION.md §5, Фаза 6). БД — источник истины: объект
--   без строки attachments считается мусором.
--
-- Обратима (DROP TABLE attachments + ручная чистка каталога/бакета).
-- Бэкфилла нет — новая возможность.
-- ============================================================

CREATE TABLE attachments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id       uuid NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  uploaded_by    uuid REFERENCES users(id) ON DELETE SET NULL,   -- кто загрузил (аудит/UI/правило удаления D2)
  filename       text   NOT NULL,
  content_type   text   NOT NULL,
  byte_size      bigint NOT NULL CHECK (byte_size > 0),
  sha256         text   NOT NULL,
  storage_driver text   NOT NULL CHECK (storage_driver IN ('local', 's3')),
  storage_key    text   NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (storage_driver, storage_key)
);

-- Список вложений задачи (getIssueDto) и каскадная чистка — обе по issue_id.
CREATE INDEX idx_attachments_issue ON attachments (issue_id);
