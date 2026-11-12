-- Product availability is independent of project module settings and permissions.
-- Existing installations retain all functionality until an administrator disables an app.
CREATE TABLE application_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  work boolean NOT NULL DEFAULT true,
  knowledge boolean NOT NULL DEFAULT true,
  objects boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (work OR knowledge OR objects)
);
INSERT INTO application_settings(singleton) VALUES(true);
