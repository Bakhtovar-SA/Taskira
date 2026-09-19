-- ============================================================
-- Taskira. Миграция 027: аватарки пользователей (самообслуживание).
-- Применяется server/src/db.ts migrate() целиком в одной транзакции.
--
-- Тот же приём "хранилище знает только про ключ", что attachments
-- (010_attachments.sql, storage_driver + storage_key), без отдельной
-- таблицы: аватар — ровно один объект на пользователя, не список, так что
-- три колонки на users проще, чем join-таблица на PK=user_id. Все три
-- nullable — у большинства пользователей аватарки нет и не будет.
-- avatar_updated_at — не только "когда загрузили", но и cache-buster для
-- клиентского <img> (GET /api/users/:id/avatar?v=<avatar_updated_at>) и
-- ключ инвалидации клиентского blob-кэша при повторной загрузке.
--
-- storageSweeper.ts должен научиться видеть avatar_key как "известный"
-- объект (см. следующий коммит) — иначе первый же проход сборщика мусора
-- удалит все аватарки как осиротевшие: раньше он знал только про
-- attachments.storage_key.
-- ============================================================

-- avatar_content_type: attachments хранит content_type в СВОЕЙ строке
-- (010_attachments.sql), у аватарки такой строки нет (см. выше — три колонки
-- на users, не отдельная таблица), а LocalDiskStorage.stat() не возвращает
-- тип (комментарий в storage.ts: "тип отдаётся из строки attachments") — без
-- этой колонки отдавать GET /users/:id/avatar было бы нечем.
ALTER TABLE users
  ADD COLUMN avatar_driver text,
  ADD COLUMN avatar_key text,
  ADD COLUMN avatar_content_type text,
  ADD COLUMN avatar_updated_at timestamptz;
