-- Close PostgREST access to the public tables that were still wide open.
--
-- Run with:  node scripts/run-sql-migration.js migrations/20261015_rls_lockdown.sql --write
--
-- IDEMPOTENT. Enabling RLS twice and revoking a privilege that is already gone
-- are both no-ops; a table that does not exist is skipped.
--
-- WHAT WAS WRONG (read-only probe, 2026-10-15)
-- Fourteen public tables had row-level security OFF and anon + authenticated
-- held every privilege on them (SELECT, INSERT, UPDATE, DELETE, TRUNCATE). The
-- project's anon key is public by design, so anyone holding it could read
-- `customers` (password hashes and phone numbers) through
-- https://<ref>.supabase.co/rest/v1/customers, or TRUNCATE page_views.
-- Every later table already carries its own REVOKE (see 20260924_developments
-- and others); these fourteen predate that habit.
--
-- WHY THIS CANNOT BREAK THE APP (checked on production before writing this)
--   - The engine (.env DB_USER) and the storefront (web/.env.local DB_USER)
--     both log in as `postgres`, which OWNS all fourteen tables and has
--     rolbypassrls = true. RLS is ENABLEd, not FORCEd, so it does not apply to
--     the owner either way.
--   - No code path uses the anon key: @supabase/supabase-js is only used for
--     Storage, with SUPABASE_SERVICE_ROLE_KEY (service_role, BYPASSRLS).
--   - Storage lives in the `storage` schema, untouched here. Public buckets
--     (Property_images, avatars) serve objects by URL without any table grant.
--   - The Laravel admin connects to Postgres directly (PDO), not through
--     PostgREST; anon and authenticated are NOLOGIN roles, so no direct
--     connection can be one of them.
--
-- RLS IS ENABLED WITH NO POLICY on purpose: that denies every row to anon and
-- authenticated even if a grant is ever re-added by hand. Same posture
-- `properties` and `agents` already had.
--
-- DEFAULT PRIVILEGES: Supabase's default ACL for tables, sequences and
-- functions `postgres` creates in public grants anon/authenticated everything,
-- which is how these fourteen got open. The default is changed for tables and
-- sequences so the next table starts closed instead of relying on each
-- migration remembering its REVOKE. (supabase_admin's own defaults cannot be
-- changed by postgres and are left alone; tables created by migrations here
-- are owned by postgres.)

BEGIN;

DO $$
DECLARE
  tbl TEXT;
  role_name TEXT;
  seq TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'agent_performance_logs', 'bot_locks', 'bot_sessions', 'customer_favorites',
    'customer_saved_searches', 'customers', 'exchange_rates',
    'footer_lukkaplacer_links', 'footer_professional_links', 'listing_events',
    'page_views', 'plan_change_requests', 'saved_search_notifications',
    'whatsapp_clicks'
  ] LOOP
    IF to_regclass(format('public.%I', tbl)) IS NULL THEN
      RAISE NOTICE 'skipped % (no such table)', tbl;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);

    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
        EXECUTE format('REVOKE ALL ON public.%I FROM %I', tbl, role_name);
        -- The table's own id sequence(s), found through ownership rather than
        -- by guessing the name.
        FOR seq IN
          SELECT s.relname
            FROM pg_depend d
            JOIN pg_class s ON s.oid = d.objid AND s.relkind = 'S'
           WHERE d.refobjid = format('public.%I', tbl)::regclass
             AND d.deptype IN ('a', 'i')
        LOOP
          EXECUTE format('REVOKE ALL ON SEQUENCE public.%I FROM %I', seq, role_name);
        END LOOP;
      END IF;
    END LOOP;
  END LOOP;

  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM %I', role_name);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', role_name);
    END IF;
  END LOOP;
END $$;

COMMIT;
