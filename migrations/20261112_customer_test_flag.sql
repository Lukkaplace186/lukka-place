-- Test / demo customer accounts (2026-11-12).
--
-- The team keeps demo accounts (a client, an agent, an admin) to try features
-- before rollout and to record tutorials. Agents already carry `is_test`
-- (20260929_market_history.sql); this gives customers the same flag, set from
-- /admin/customers/[id]. A test customer is left out of the growth dashboard's
-- sign-up counts and the sign-up funnel's created accounts.
--
-- Code reads the column through to_jsonb, so it runs before this migration
-- (then nobody is a test account). Idempotent.

BEGIN;

ALTER TABLE customers ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;

COMMIT;
