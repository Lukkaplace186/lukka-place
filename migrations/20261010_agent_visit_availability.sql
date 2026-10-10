-- The days an agent takes no visits, for the public visit calendar.
--
-- Run with:  node scripts/run-sql-migration.js migrations/20261010_agent_visit_availability.sql --write
--
-- ADDITIVE AND IDEMPOTENT. One new table. web/lib/agentAvailability.js answers
-- "nothing blocked" on 42P01, so web can deploy first; the agent's settings
-- card says the feature is not available yet until this has run.
--
-- One row per agent, written only from their own agenda page
-- (/compte/agent/visites). `closed_weekdays` are JavaScript weekdays in
-- Kinshasa time (0 = Sunday … 6 = Saturday); `blocked_dates` are single
-- Kinshasa calendar days. No row means the agent blocked nothing.
--
-- This is not opening hours: the calendar's four slots a day are the same for
-- every agent, and the agent still confirms each visit. It only removes days.

BEGIN;

CREATE TABLE IF NOT EXISTS agent_visit_availability (
  agent_id         bigint      PRIMARY KEY REFERENCES agents (id) ON DELETE CASCADE,
  closed_weekdays  smallint[]  NOT NULL DEFAULT '{}'
                   CHECK (closed_weekdays <@ ARRAY[0, 1, 2, 3, 4, 5, 6]::smallint[]),
  blocked_dates    date[]      NOT NULL DEFAULT '{}'
                   CHECK (COALESCE(array_length(blocked_dates, 1), 0) <= 60),
  updated_at       timestamptz NOT NULL DEFAULT NOW()
);

DO $$
DECLARE
  role_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON agent_visit_availability FROM %I', role_name);
    END IF;
  END LOOP;
END $$;

COMMIT;
