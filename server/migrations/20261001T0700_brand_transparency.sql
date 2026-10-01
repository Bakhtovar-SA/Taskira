-- Organization-wide transparency default (expand).
ALTER TABLE instance ADD COLUMN brand_transparency text NOT NULL DEFAULT 'auto'
  CHECK (brand_transparency IN ('auto', 'on'));
