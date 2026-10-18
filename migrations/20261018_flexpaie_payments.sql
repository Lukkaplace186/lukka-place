-- FlexPaie (FlexPay DRC) mobile-money payments for agency plans
-- (web/lib/flexpaie.js, web/lib/payments.js, /api/payments/flexpaie/*).
--
-- Run with:  node scripts/run-sql-migration.js migrations/20261018_flexpaie_payments.sql --write
--
-- ADDITIVE AND IDEMPOTENT. Three new tables; nothing existing is altered.
--
-- `memberships` stays THE ledger every reader uses (billing, listing limits,
-- sales commissions, receipts). A paid invoice writes one ordinary memberships
-- row (payment_method 'FlexPaie', transaction_id = FlexPaie's orderNumber) and
-- points at it; nothing reads payments from these tables instead.
--
--   subscriptions  one row per agency plan bought online: which package, the
--                  period the last paid invoice covers, and its membership.
--   invoices       one row per payment attempt. `reference` is what FlexPaie
--                  is sent and echoes back; `order_number` is FlexPaie's id.
--                  Only a SHA-256 of the callback token is stored.
--   payment_logs   every request to and from FlexPaie, for disputes. No API
--                  key or token is ever written here.

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
  provider              TEXT NOT NULL DEFAULT 'flexpaie' CHECK (provider = 'flexpaie'),
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
