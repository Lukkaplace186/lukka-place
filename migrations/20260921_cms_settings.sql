-- Editable site settings for the console's CMS page, starting with the
-- homepage hero image. One JSON value per key, read on each request, so a
-- change is live without a deploy.
--
-- Run with:  node scripts/run-sql-migration.js migrations/20260921_cms_settings.sql --write
--
-- ADDITIVE AND IDEMPOTENT. A new table only.

BEGIN;

CREATE TABLE IF NOT EXISTS cms_settings (
  key         TEXT PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_.]{1,60}$'),
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by  TEXT CHECK (updated_by IS NULL OR char_length(updated_by) <= 200)
);

DO $$
DECLARE
  role_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON cms_settings FROM %I', role_name);
    END IF;
  END LOOP;
END $$;

COMMIT;
