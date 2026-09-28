-- ТЗ 5.11: онбординг, встроенный в продукт.
--
-- user_onboarding — прогресс «Начала работы» и закрытые подсказки, по пользователю, на сервере
--   (чтобы не повторялись на другом устройстве). done — шаги из закрытого списка contract.ts
--   (ONBOARDING_STEPS); отмечаются сервером от реальных действий. hints — id закрытых подсказок.
-- instance.setup_completed_at — администратор прошёл первичную настройку. У уже работающих
--   инсталляций строка instance есть — считаем их настроенными; у новой строку создаёт сид после
--   миграций, с NULL — первый вход администратора открывает настройку.
-- projects.is_demo — демо-проект: помечен в интерфейсе и удаляется одной кнопкой вместе со всем.
--
-- Аддитивная (expand) миграция.
CREATE TABLE IF NOT EXISTS user_onboarding (
  user_id    uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  done       text[] NOT NULL DEFAULT '{}',
  hints      text[] NOT NULL DEFAULT '{}',
  hidden     boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE instance ADD COLUMN IF NOT EXISTS setup_completed_at timestamptz;
UPDATE instance SET setup_completed_at = now() WHERE setup_completed_at IS NULL;

ALTER TABLE projects ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS projects_one_demo ON projects (is_demo) WHERE is_demo;
