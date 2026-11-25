-- MaishaPay replaces FlexPaie for agency plan payments (owner, 2026-11-25)
-- (web/lib/maishapay.js, web/lib/payments.js, /api/payments/maishapay/*).
--
-- Run with:  node scripts/run-sql-migration.js migrations/20261125_maishapay_payments.sql --write
--
-- ADDITIVE AND IDEMPOTENT. Safe whether or not 20261018_flexpaie_payments.sql
-- was ever run: the three tables are created here if missing (same shape),
-- then widened for MaishaPay. Nothing is dropped; a FlexPaie row, if any
-- exists, keeps its provider.
--
--   invoices.provider        'maishapay' (the default from now on) or the
--                            legacy 'flexpaie'.
--   invoices.payer_operator  MaishaPay's provider code: MPESA, ORANGE or
--                            AIRTEL — MaishaPay checks the number belongs to it.
--   invoices.test_mode       true when the payment went through MaishaPay's
--                            sandbox (MAISHAPAY_MODE=sandbox): no money moved.
--   invoices.order_number    now MaishaPay's transactionId.
--
-- `memberships` stays THE ledger (payment_method 'MaishaPay', or
-- 'MaishaPay (test)' for a sandbox payment).

BEGIN;

CREATE TABLE IF NOT EXISTS subscriptions (
  id                    BIGSERIAL PRIMARY KEY,
  vendor_id             BIGINT NOT NULL,
  agent_id              BIGINT,
  package_id            BIGINT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'active', 'expired', 'cancelled')),
  current_period_start  TIMESTAMPTZ,
  current_period_end    TIMESTAMPTZ,
  membership_id         BIGINT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS subscriptions_vendor_idx ON subscriptions (vendor_id, status);

CREATE TABLE IF NOT EXISTS invoices (
  id                    BIGSERIAL PRIMARY KEY,
  reference             TEXT NOT NULL UNIQUE CHECK (char_length(reference) BETWEEN 6 AND 64),
  subscription_id       BIGINT REFERENCES subscriptions (id) ON DELETE SET NULL,
  vendor_id             BIGINT NOT NULL,
  agent_id              BIGINT,
  package_id            BIGINT NOT NULL,
  amount                NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  currency              TEXT NOT NULL CHECK (currency IN ('USD', 'CDF')),
  status                TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'paid', 'failed', 'cancelled')),
  provider              TEXT NOT NULL DEFAULT 'maishapay',
  order_number          TEXT UNIQUE,
  payer_phone           TEXT CHECK (payer_phone IS NULL OR payer_phone ~ '^[0-9]{7,15}$'),
  callback_token_hash   TEXT NOT NULL,
  membership_id         BIGINT,
  failure_reason        TEXT CHECK (failure_reason IS NULL OR char_length(failure_reason) <= 300),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at               TIMESTAMPTZ,
  failed_at             TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS invoices_vendor_idx  ON invoices (vendor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS invoices_pending_idx ON invoices (created_at) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS payment_logs (
  id           BIGSERIAL PRIMARY KEY,
  invoice_id   BIGINT REFERENCES invoices (id) ON DELETE SET NULL,
  direction    TEXT NOT NULL CHECK (direction IN ('outbound', 'inbound')),
  event        TEXT NOT NULL CHECK (event IN ('initiate', 'callback', 'status_check')),
  http_status  INTEGER,
  payload      JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS payment_logs_invoice_idx ON payment_logs (invoice_id, created_at);

-- FlexPaie's table pinned provider = 'flexpaie'.
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_provider_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_provider_check CHECK (provider IN ('maishapay', 'flexpaie'));
ALTER TABLE invoices ALTER COLUMN provider SET DEFAULT 'maishapay';

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payer_operator TEXT;
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_payer_operator_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_payer_operator_check
  CHECK (payer_operator IS NULL OR payer_operator IN ('MPESA', 'ORANGE', 'AIRTEL'));
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS test_mode BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
DECLARE
  role_name TEXT;
  tbl TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      FOREACH tbl IN ARRAY ARRAY['subscriptions', 'invoices', 'payment_logs'] LOOP
        EXECUTE format('REVOKE ALL ON %I FROM %I', tbl, role_name);
        EXECUTE format('REVOKE ALL ON SEQUENCE %I FROM %I', tbl || '_id_seq', role_name);
      END LOOP;
    END IF;
  END LOOP;
END $$;

COMMIT;
