-- Монотонная версия сессии. В отличие от сравнения часов приложения с
-- PostgreSQL не зависит от clock skew между хостами.
ALTER TABLE users ADD COLUMN session_version bigint NOT NULL DEFAULT 0;
