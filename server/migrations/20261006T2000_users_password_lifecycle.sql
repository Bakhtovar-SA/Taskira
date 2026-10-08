-- SEC-PWD-01: смена и административный сброс пароля локальных учёток (ADR-0034).
-- Expand-only: новые колонки с безопасными значениями по умолчанию; прежний образ их просто не читает.
--   must_change_password — вход разрешает только смену пароля (временный пароль после сброса
--                          или начальный пароль, заданный администратором);
--   password_expires_at  — срок действия временного пароля; NULL — пароль бессрочный (V6.2.10);
--   password_changed_at  — когда пароль последний раз менялся (аудит, «сменён N дней назад»).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS password_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS password_changed_at timestamptz;
