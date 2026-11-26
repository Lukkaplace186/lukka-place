-- Combined and custom console roles (/admin/team).
--
-- Run with:  node scripts/run-sql-migration.js migrations/20261126_admin_combined_custom_roles.sql --write
--
-- ADDITIVE AND IDEMPOTENT. Nothing is removed; every existing account keeps
-- exactly the access it has today (roles = ARRAY[role]).
--
-- 1. console_admin_users.roles — every role a person holds. Permissions add
--    up (web/lib/adminRoles.js resolvePermissions). `role` stays the PRIMARY
--    role (roles[1]): the page the person lands on, and what every existing
--    `role = 'owner'` check reads. `owner` is always held alone.
-- 2. console_admin_custom_roles — roles an owner defines: a name and a list of
--    permission keys. Held through the key 'custom:<id>'. `team.manage` is
--    never granted by one (enforced in the web app on read and write).
--
-- The web app runs before this migration too: reads fall back to `role`,
-- custom roles are an empty list, and saving more than one role says the
-- migration is missing.

BEGIN;

-- 1. Several roles per person.
ALTER TABLE console_admin_users ADD COLUMN IF NOT EXISTS roles TEXT[];
UPDATE console_admin_users SET roles = ARRAY[role] WHERE roles IS NULL OR cardinality(roles) = 0;
ALTER TABLE console_admin_users ALTER COLUMN roles SET DEFAULT '{}';
ALTER TABLE console_admin_users ALTER COLUMN roles SET NOT NULL;

-- Deliberately loose: web code from before this change may still be running
-- and writes `role` alone. The app reads `roles` only when roles[1] = role
-- and falls back to ARRAY[role] otherwise (web/lib/adminUsers.js rowRoles).
ALTER TABLE console_admin_users DROP CONSTRAINT IF EXISTS console_admin_users_roles_check;
ALTER TABLE console_admin_users ADD CONSTRAINT console_admin_users_roles_check
  CHECK (cardinality(roles) <= 20);

-- The primary role may now be a custom one.
ALTER TABLE console_admin_users DROP CONSTRAINT IF EXISTS console_admin_users_role_check;
ALTER TABLE console_admin_users ADD CONSTRAINT console_admin_users_role_check
  CHECK (role IN ('owner', 'moderator', 'support', 'finance', 'analyst', 'sales') OR role ~ '^custom:[1-9][0-9]*$');

CREATE INDEX IF NOT EXISTS console_admin_users_roles_idx ON console_admin_users USING GIN (roles);

-- 2. Custom roles.
CREATE TABLE IF NOT EXISTS console_admin_custom_roles (
  id           BIGSERIAL PRIMARY KEY,
  name         TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  description  TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 200),
  permissions  TEXT[] NOT NULL DEFAULT '{}',
  created_by   BIGINT REFERENCES console_admin_users (id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT console_admin_custom_roles_no_team CHECK (NOT ('team.manage' = ANY(permissions)))
);
CREATE UNIQUE INDEX IF NOT EXISTS console_admin_custom_roles_name_key ON console_admin_custom_roles (LOWER(name));

-- Same reason as every console_* table: Supabase's default grants would
-- expose it over the REST API, which nothing here uses.
DO $$
DECLARE
  role_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON console_admin_custom_roles FROM %I', role_name);
      EXECUTE format('REVOKE ALL ON SEQUENCE console_admin_custom_roles_id_seq FROM %I', role_name);
    END IF;
  END LOOP;
END $$;

COMMIT;
