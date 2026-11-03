-- Extra WhatsApp numbers an agent sends listings from.
--
-- Run with:  node scripts/run-sql-migration.js migrations/20261103_agent_whatsapp_numbers.sql --write
--
-- ADDITIVE AND IDEMPOTENT. One new table. Every engine read of it tolerates
-- 42P01 (the old phone-only match runs instead), so the engine may deploy
-- before or after this.
--
-- WHY (2026-11-03): agent #50 (Ayang services) holds their account on
-- +243 974 585 309 but WhatsApps every listing from +243 910 314 309.
-- Attribution matches the SENDER's number against agents.phone only, so 15
-- listings arrived unattributed and the team assigned each one by hand.
-- Two SIMs is ordinary in Kinshasa.
--
-- WHAT A ROW MEANS: the team vouches that this number belongs to this agent
-- (services/agentNumbers.js, behind requireApiKey, called only from the
-- admin console — the same posture as services/adminAgentAccounts.js's
-- admin-verify). A listing WhatsApped from it is attributed to the agent,
-- the sender is greeted as them, and their plan quota applies. It is NOT a
-- public number: agents.phone stays the one shown on listings, dialled by the
-- CTAs and sent alerts.
--
-- `phone` is digits only and UNIQUE: one number, one agent. The engine
-- refuses a number that is any live agent's own phone (the account wins).

BEGIN;

CREATE TABLE IF NOT EXISTS agent_whatsapp_numbers (
  id          bigserial   PRIMARY KEY,
  agent_id    bigint      NOT NULL REFERENCES agents (id) ON DELETE CASCADE,
  phone       text        NOT NULL UNIQUE CHECK (phone ~ '^[0-9]{7,15}$'),
  added_by    text,
  created_at  timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS agent_whatsapp_numbers_agent_idx ON agent_whatsapp_numbers (agent_id);

ALTER TABLE agent_whatsapp_numbers ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  role_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON agent_whatsapp_numbers FROM %I', role_name);
      EXECUTE format('REVOKE ALL ON SEQUENCE agent_whatsapp_numbers_id_seq FROM %I', role_name);
    END IF;
  END LOOP;
END $$;

COMMIT;
