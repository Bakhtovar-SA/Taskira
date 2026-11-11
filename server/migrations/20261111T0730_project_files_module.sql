-- Make the file catalogue configurable without hiding it on existing projects.
-- Disabling hides its tab; attachments remain with their original materials.
ALTER TABLE workspace_modules ADD COLUMN files boolean NOT NULL DEFAULT true;
