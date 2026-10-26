-- Every agent sign-in attempt, for the console (/admin/agents "Dernière
-- connexion" column and the per-agent "Historique de connexion").
-- Written by web/lib/agentLoginLog.js from the agent login, code
-- verification, WhatsApp verification and activation actions.
--
-- Run with:  node scripts/run-sql-migration.js migrations/20261024_agent_login_attempts.sql --write
--
-- ADDITIVE AND IDEMPOTENT. One new table, nothing backfilled: no attempt
-- before this was recorded anywhere except agents.failed_login_count, which
-- is reset on every success.
--
-- Only attempts on an EXISTING account are kept (a number with no account
-- is not stored): this is "when did this agent try to get in", not a log of
-- every number typed into the form. The web code works before the table
-- exists (42P01 is swallowed), so the order against the deploy is free.

BEGIN;

CREATE TABLE IF NOT EXISTS agent_login_attempts (
  id           BIGSERIAL PRIMARY KEY,
  agent_id     BIGINT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  outcome      TEXT NOT NULL CHECK (outcome IN (
                 'success',          -- password right, signed in
                 'wrong_password',
                 'locked',           -- tried while locked out
                 'verify_required',  -- password right, number not verified yet
                 'wrong_code',
                 'expired_code',
                 'code_verified',    -- signed in by the WhatsApp code
                 'whatsapp_verified',-- signed in by the reverse WhatsApp check
                 'activated'         -- first password set from the activation link
               )),
  ip_address   TEXT,
  user_agent   TEXT,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS agent_login_attempts_agent_time
  ON agent_login_attempts (agent_id, attempted_at DESC);

-- Closed to PostgREST like every console table (root CLAUDE.md, Security).
ALTER TABLE agent_login_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON agent_login_attempts FROM anon, authenticated;
REVOKE ALL ON SEQUENCE agent_login_attempts_id_seq FROM anon, authenticated;

COMMIT;
