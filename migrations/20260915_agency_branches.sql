-- Agency branches, and closing the REST exposure of the console's own tables.
--
-- Run with:  node scripts/run-sql-migration.js migrations/20260915_agency_branches.sql --write
--
-- ADDITIVE AND IDEMPOTENT. Two new tables and a REVOKE; nothing existing is
-- altered or dropped.
--
-- WHY BRANCHES ARE NEW TABLES, NOT A COLUMN
-- `vendors` and `agents` belong to the Laravel back-office too (CLAUDE.md,
-- "System Architecture"). Adding `agents.branch_id` would put this console's
-- model into another application's table; a join table keeps it ours, and
-- dropping it would leave Laravel's schema exactly as it was.
--
-- One branch per agent (agent_id is the primary key of the membership table).
-- A membership only counts while the branch is live AND belongs to the agent's
-- CURRENT agency: every read joins on `b.vendor_id = a.vendor_id`, so an agent
-- moved to another agency drops out of their old branch without a cleanup job.

BEGIN;

CREATE TABLE IF NOT EXISTS agency_branches (
  id           BIGSERIAL PRIMARY KEY,
  vendor_id    BIGINT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  name         TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  -- Resolved against the engine's location hierarchy by the action that
  -- writes it; NULL means not stated, never a guessed commune.
  commune      TEXT,
  phone        TEXT CHECK (phone IS NULL OR phone ~ '^[0-9]{7,15}$'),
  created_by   BIGINT REFERENCES console_admin_users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Archived, not deleted: the audit log names branches by id.
  archived_at  TIMESTAMPTZ
);

-- Two live branches of one agency cannot share a name; an archived one frees it.
CREATE UNIQUE INDEX IF NOT EXISTS agency_branches_live_name_uniq
  ON agency_branches (vendor_id, LOWER(name)) WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS agency_branch_agents (
  agent_id     BIGINT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
  branch_id    BIGINT NOT NULL REFERENCES agency_branches(id) ON DELETE CASCADE,
  assigned_by  BIGINT REFERENCES console_admin_users(id) ON DELETE SET NULL,
  assigned_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS agency_branch_agents_branch_idx ON agency_branch_agents (branch_id);

-- Supabase publishes the `public` schema over its REST API, and its default
-- privileges grant `anon` and `authenticated` access to every new table there.
-- Nothing in this product uses that API for these tables — the console reads
-- them server-side through `pg` — so the grants are pure exposure, and
-- console_admin_users holds password hashes. Revoked outright; guarded so the
-- migration also runs on a plain Postgres without Supabase's roles.
DO $$
DECLARE
  role_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'REVOKE ALL ON console_admin_users, console_admin_audit_log, console_admin_login_attempts, '
        'console_admin_notes, console_admin_saved_views, agency_branches, agency_branch_agents FROM %I',
        role_name
      );
      EXECUTE format('REVOKE ALL ON SEQUENCE agency_branches_id_seq FROM %I', role_name);
    END IF;
  END LOOP;
END $$;

COMMIT;
