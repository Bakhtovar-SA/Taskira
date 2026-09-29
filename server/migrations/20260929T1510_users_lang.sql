-- Язык интерфейса человека на сервере (трек E): на нём уходят письма и сводки. Клиент по-прежнему хранит язык в
-- браузере (taskira.lang) и сообщает серверу при переключении и при входе (PUT /api/me/lang). По умолчанию — русский,
-- как было до этой миграции.
ALTER TABLE users ADD COLUMN IF NOT EXISTS lang text NOT NULL DEFAULT 'ru';
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_lang_check;
ALTER TABLE users ADD CONSTRAINT users_lang_check CHECK (lang IN ('ru', 'en'));
