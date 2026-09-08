-- ============================================================
-- Taskira. Миграция 011: уведомления (in-app + email).
-- Применяется server/src/db.ts migrate() целиком в одной транзакции.
-- См. NOTIFICATIONS_MIGRATION.md (раздел «РЕШЕНО», Фаза 1).
--
-- Схемой этот шаг ограничивается — ни один роут / index.ts не тронут.
-- Событийный слой (emit) и in-app API — Фаза 2; email-воркер — Фаза 3.
--
-- МОДЕЛЬ:
--   notifications — одна строка на ПОЛУЧАТЕЛЯ и событие (D3). Без отдельного
--     outbox: email-состояние живёт в этой же строке (email_state), воркер
--     идёт по email_state='pending' (partial-индекс).
--
--   type        — перечислимый (драйвит рендер на клиенте и выбор email-шаблона).
--   payload     — денормализованные поля для in-app-ленты (заголовок задачи,
--                 отрывок текста, старый/новый статус…). НАРУЖУ НЕ УХОДИТ:
--                 email-шаблон payload не читает (D9 — письмо несёт только тип
--                 события + ключ задачи + ссылку).
--   read_at     — NULL = непрочитано.
--   email_state — pending → sent | skipped (нет email / off / актор) | failed
--                 (после NOTIFY_EMAIL_MAX_TRIES попыток).
--
--   users.notify_prefs — jsonb; MVP-поля: email ('instant'|'daily'|'off'),
--     selfWatch (bool). Дефолт '{}' → поведение по умолчанию (email 'instant'
--     если у юзера есть users.email, иначе 'off'; selfWatch true).
--
-- КАСКАД: удаление пользователя / проекта / задачи уносит связанные строки.
-- Обратима (DROP TABLE notifications; ALTER TABLE users DROP COLUMN notify_prefs).
-- Бэкфилла нет.
-- ============================================================

CREATE TABLE notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,   -- получатель
  type        text NOT NULL CHECK (type IN (
                'issue.assigned', 'issue.comment', 'issue.mention',
                'issue.status', 'issue.collaborator', 'project.member')),
  actor_id    uuid REFERENCES users(id)    ON DELETE SET NULL,        -- кто вызвал событие
  project_id  uuid REFERENCES projects(id) ON DELETE CASCADE,
  issue_id    uuid REFERENCES issues(id)   ON DELETE CASCADE,
  payload     jsonb       NOT NULL DEFAULT '{}',                      -- только для in-app
  created_at  timestamptz NOT NULL DEFAULT now(),
  read_at     timestamptz,                                           -- NULL = непрочитано
  email_state text     NOT NULL DEFAULT 'pending'
                CHECK (email_state IN ('pending', 'sent', 'skipped', 'failed')),
  email_tries smallint NOT NULL DEFAULT 0
);

-- Лента получателя (пагинация по created_at) и счётчик непрочитанных.
CREATE INDEX idx_notifications_user        ON notifications (user_id, created_at DESC);
CREATE INDEX idx_notifications_user_unread ON notifications (user_id, created_at DESC) WHERE read_at IS NULL;
-- Очередь воркера рассылки.
CREATE INDEX idx_notifications_email_pending ON notifications (created_at) WHERE email_state = 'pending';

-- Настройки уведомлений пользователя (D6). Расширяется без слома схемы.
ALTER TABLE users ADD COLUMN notify_prefs jsonb NOT NULL DEFAULT '{}';
