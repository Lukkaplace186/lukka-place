-- Demo accounts (2026-11-14, owner request): a demo customer and a demo agent,
-- created from /admin/demo, for the team to go through the product as they
-- would without reaching a real person or publishing anything.
--
-- The pair's two accounts are ordinary `customers` / `agents` rows carrying
-- reserved numbers (243 0000 1NNNN for the agent, 243 0000 2NNNN for the
-- customer — no DRC number starts 2430), which is how the engine recognises
-- them without a lookup (services/demoAccounts.js). This table says which two
-- rows belong together and where a copy of their messages goes.
--
-- properties_demo_guard: a demo agent's listing can never become approved,
-- whoever approves it (this console, the Laravel back-office, a script), so
-- it can never reach the public filter `status = 1 AND approve_status = 1`.
--
-- Idempotent; run with `node scripts/run-sql-migration.js <file> [--write]`.

BEGIN;

CREATE TABLE IF NOT EXISTS demo_accounts (
  id                bigserial PRIMARY KEY,
  label             text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 80),
  agent_id          bigint,
  customer_id       bigint,
  agent_phone       text NOT NULL UNIQUE CHECK (agent_phone ~ '^24300001[0-9]{4}$'),
  customer_phone    text NOT NULL UNIQUE CHECK (customer_phone ~ '^24300002[0-9]{4}$'),
  -- A real number of the team's, to receive a copy of every message the demo
  -- accounts are sent. NULL = recorded only.
  deliver_to_phone  text CHECK (deliver_to_phone IS NULL OR deliver_to_phone ~ '^[0-9]{7,15}$'),
  created_by        text,
  created_at        timestamptz NOT NULL DEFAULT NOW(),
  reset_at          timestamptz,
  deleted_at        timestamptz
);

CREATE INDEX IF NOT EXISTS demo_accounts_agent_idx ON demo_accounts (agent_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS demo_accounts_customer_idx ON demo_accounts (customer_id) WHERE deleted_at IS NULL;

ALTER TABLE demo_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON demo_accounts FROM anon, authenticated;
REVOKE ALL ON SEQUENCE demo_accounts_id_seq FROM anon, authenticated;

CREATE OR REPLACE FUNCTION lukka_demo_listing_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.approve_status = 1 AND NEW.agent_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM agents a
     WHERE a.id = NEW.agent_id AND COALESCE(a.phone, '') LIKE '2430000%'
  ) THEN
    NEW.approve_status := 0;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS properties_demo_guard ON properties;
CREATE TRIGGER properties_demo_guard
  BEFORE INSERT OR UPDATE OF approve_status, agent_id ON properties
  FOR EACH ROW EXECUTE FUNCTION lukka_demo_listing_guard();

COMMIT;
