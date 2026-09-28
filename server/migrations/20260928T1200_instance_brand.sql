-- ТЗ 5.14 п.5: брендирование инсталляции (white-label) — название, знак клиента, оттенок акцента в допустимом
-- диапазоне. Хранится в singleton-таблице instance (ТЗ 4.1). NULL в любом поле — как без брендирования: «Taskira»,
-- фирменный знак, оттенок 288. Диапазон оттенка — тот, для которого scripts/check-contrast.mjs проверяет все пары
-- акцента во всех темах (contract.ts BRAND_HUE); сервер принимает только его.
--
-- Аддитивная (expand) миграция: nullable-колонки, старый код их не читает.
ALTER TABLE instance ADD COLUMN IF NOT EXISTS brand_name text CHECK (brand_name IS NULL OR length(brand_name) BETWEEN 1 AND 60);
ALTER TABLE instance ADD COLUMN IF NOT EXISTS brand_hue smallint CHECK (brand_hue IS NULL OR brand_hue BETWEEN 0 AND 360);
ALTER TABLE instance ADD COLUMN IF NOT EXISTS brand_logo_driver text;
ALTER TABLE instance ADD COLUMN IF NOT EXISTS brand_logo_key text;
ALTER TABLE instance ADD COLUMN IF NOT EXISTS brand_logo_content_type text;
ALTER TABLE instance ADD COLUMN IF NOT EXISTS brand_logo_updated_at timestamptz;
