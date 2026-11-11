-- MaishaPay online payments for agency plans, beside FlexPaie
-- (web/lib/maishapay.js, web/lib/maishapayRules.js, web/lib/maishapayPayments.js,
--  web/lib/subscriptionRenewals.js, /api/payments/maishapay/*, /api/payments/status,
--  /api/cron/subscription-renewals, /compte/agent/abonnement/payer).
--
-- Run with:  node scripts/run-sql-migration.js migrations/20261112_maishapay_payments.sql --write
--
-- ADDITIVE AND IDEMPOTENT. Builds on migrations/20261018_flexpaie_payments.sql
-- (subscriptions, invoices, payment_logs). Nothing is dropped except the
-- provider CHECK on invoices, which is re-created wider.
--
--   invoices.provider        'flexpaie' | 'maishapay'
--   invoices.payment_channel 'mobile_money' | 'card' (NULL on FlexPaie rows)
--   invoices.wallet_provider MPESA | ORANGE | AIRTEL | AFRICELL | VISA | MASTERCARD
--   invoices.auto_renew      what the agent chose on the checkout page; copied
--                            onto the subscription when the invoice is paid
--   invoices.is_renewal      created by the monthly renewal sweep, not by the agent
--
--   subscriptions.auto_renew        renew automatically (a new PIN prompt each period)
--   subscriptions.renewal_*         where the next prompt goes (mobile money only)
--   subscriptions.renewal_notified_at / renewal_attempts
--                                   per-period idempotence for the sweep: one
--                                   attempt a day, three per period at most
--   subscriptions.cancelled_at      when the agent stopped automatic renewal

BEGIN;

-- Wider provider check. The original constraint was unnamed, so Postgres
-- called it invoices_provider_check.
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_provider_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_provider_check
  CHECK (provider IN ('flexpaie', 'maishapay'));

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_channel TEXT
  CHECK (payment_channel IS NULL OR payment_channel IN ('mobile_money', 'card'));
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS wallet_provider TEXT
  CHECK (wallet_provider IS NULL OR wallet_provider IN ('MPESA', 'ORANGE', 'AIRTEL', 'AFRICELL', 'VISA', 'MASTERCARD'));
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS auto_renew BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS is_renewal BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS provider TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS auto_renew BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS renewal_channel TEXT
  CHECK (renewal_channel IS NULL OR renewal_channel IN ('mobile_money', 'card'));
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS renewal_provider TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS renewal_phone TEXT
  CHECK (renewal_phone IS NULL OR renewal_phone ~ '^[0-9]{7,15}$');
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS renewal_notified_at TIMESTAMPTZ;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS renewal_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

-- The sweep's own index: active, auto-renewing, ordered by when they end.
CREATE INDEX IF NOT EXISTS subscriptions_renewal_due_idx
  ON subscriptions (current_period_end)
  WHERE status = 'active' AND auto_renew;

-- One open renewal invoice per subscription at a time.
CREATE INDEX IF NOT EXISTS invoices_subscription_pending_idx
  ON invoices (subscription_id) WHERE status = 'pending';

COMMIT;
