-- Repair installations where the avatar migration was recorded without MIME metadata.
-- Existing avatar objects and metadata remain unchanged; old migrations stay immutable.
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_content_type text;
