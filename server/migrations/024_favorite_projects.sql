-- ============================================================
-- Taskira. Миграция 024: избранные проекты пользователя.
-- Применяется server/src/db.ts migrate() целиком в одной транзакции.
--
-- Отдельная junction-таблица (по образцу project_members), а не jsonb-поле
-- на users, как users.notify_prefs (миграция 011): «избранное» — множество
-- с toggle-семантикой (добавить/убрать одну запись), а не документ, который
-- читают/пишут целиком. INSERT ... ON CONFLICT DO NOTHING / DELETE по PK —
-- без гонки чтения-изменения-записи, которую jsonb-merge (notify_prefs)
-- иначе потребовал бы для той же операции.
-- ============================================================

-- Отдельный индекс на user_id не нужен: PRIMARY KEY (user_id, project_id) уже
-- даёт btree с этим префиксом, покрывающий WHERE user_id = $1 в listFavoriteProjectIds
-- (leftmost-prefix). Лишний индекс добавил бы только запись на каждый toggle.
CREATE TABLE user_favorite_projects (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, project_id)
);
