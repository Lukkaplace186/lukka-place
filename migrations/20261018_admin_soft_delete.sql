-- Bulk "Supprimer la sélection" on /admin/agents, /admin/agencies and
-- /admin/listings, with a 10-second "Annuler" (web/lib/adminSoftDelete.js).
--
-- Run with:  node scripts/run-sql-migration.js migrations/20261018_admin_soft_delete.sql --write
--
-- ADDITIVE AND IDEMPOTENT. Nullable columns on three existing tables and one
-- new table. Nothing is backfilled: no row has been deleted this way yet.
--
-- A soft delete is TWO writes per row: `deleted_at` (hides it from every
-- console list) and `status = 0` (takes it off the storefront, the agent
-- directory and every engine read that already gates on status). The row's
-- previous status is kept in console_soft_deletions so "Annuler" puts back
-- exactly what was there — an agent who was already suspended stays
-- suspended after an undo.
--
-- `agents` and `vendors` are shared with the Laravel back-office; nullable
-- columns it does not know about change nothing for it.
--
-- DEPLOY ORDER: run this BEFORE deploying the web and engine code that reads
-- `deleted_at` — those queries name the column and fail without it.

BEGIN;

ALTER TABLE agents     ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE agents     ADD COLUMN IF NOT EXISTS deleted_by TEXT;
ALTER TABLE vendors    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE vendors    ADD COLUMN IF NOT EXISTS deleted_by TEXT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS deleted_by TEXT;

CREATE INDEX IF NOT EXISTS agents_deleted_at_idx     ON agents (deleted_at)     WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS vendors_deleted_at_idx    ON vendors (deleted_at)    WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS properties_deleted_at_idx ON properties (deleted_at) WHERE deleted_at IS NOT NULL;

-- One row per record a delete touched, cascaded ones included (an agency's
-- agents, an agent's listings). `root` marks the records the admin selected.
CREATE TABLE IF NOT EXISTS console_soft_deletions (
  id               BIGSERIAL PRIMARY KEY,
  batch_id         UUID NOT NULL,
  entity_type      TEXT NOT NULL CHECK (entity_type IN ('agency', 'agent', 'listing')),
  entity_id        BIGINT NOT NULL,
  root             BOOLEAN NOT NULL DEFAULT false,
  previous_status  INTEGER,
  deleted_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_by       TEXT CHECK (deleted_by IS NULL OR char_length(deleted_by) <= 200),
  restored_at      TIMESTAMPTZ,
  restored_by      TEXT CHECK (restored_by IS NULL OR char_length(restored_by) <= 200)
);

CREATE INDEX IF NOT EXISTS console_soft_deletions_batch_idx  ON console_soft_deletions (batch_id);
CREATE INDEX IF NOT EXISTS console_soft_deletions_entity_idx ON console_soft_deletions (entity_type, entity_id);

DO $$
DECLARE
  role_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON console_soft_deletions FROM %I', role_name);
      EXECUTE format('REVOKE ALL ON SEQUENCE console_soft_deletions_id_seq FROM %I', role_name);
    END IF;
  END LOOP;
END $$;

COMMIT;
