-- ТЗ 5.14 п.2 и п.6: своё фото фона проекта («поле appearance проекта»). Клиент сам уменьшает и перекодирует фото
-- в WebP двух размеров (canvas, без нативных зависимостей на сервере) и считает среднюю светлоту; сервер проверяет
-- тип, размер и габариты и кладёт оба файла в то же хранилище, что вложения и аватарки (services/storage.ts).
-- Фото перекрывает фон из галереи (projects.background), пока оно есть; снять фото — вернуть фон из галереи.
--
-- Аддитивная (expand) миграция: nullable-колонки, старый код их не читает. Уборщик хранилища
-- (storageSweeper.ts) знает оба ключа, иначе принял бы файлы за сирот.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS bg_photo_driver text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS bg_photo_key text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS bg_photo_small_key text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS bg_photo_luma real
  CHECK (bg_photo_luma IS NULL OR (bg_photo_luma >= 0 AND bg_photo_luma <= 1));
ALTER TABLE projects ADD COLUMN IF NOT EXISTS bg_photo_updated_at timestamptz;
