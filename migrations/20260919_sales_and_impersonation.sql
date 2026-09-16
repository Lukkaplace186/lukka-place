-- Sales team (reps, commission plans, commission ledger, payouts) and the
-- admin "view as" impersonation log.
--
-- Run with:  node scripts/run-sql-migration.js migrations/20260919_sales_and_impersonation.sql --write
--
-- ADDITIVE AND IDEMPOTENT. New tables only, plus one CHECK constraint widened
-- on console_admin_users to allow the new `sales` role. Nothing touches
-- Laravel's tables beyond foreign keys pointing at `agents`.

BEGIN;

-- 1. The `sales` console role: a rep who signs in sees their own page only.
ALTER TABLE console_admin_users DROP CONSTRAINT IF EXISTS console_admin_users_role_check;
ALTER TABLE console_admin_users ADD CONSTRAINT console_admin_users_role_check
  CHECK (role IN ('owner', 'moderator', 'support', 'finance', 'analyst', 'sales'));

-- 2. Commission plans. Rates are snapshotted onto each commission row when it
-- is generated, so editing a plan never rewrites what was already earned.
CREATE TABLE IF NOT EXISTS sales_commission_plans (
  id                 BIGSERIAL PRIMARY KEY,
  name               TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  currency           TEXT NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  -- Paid once per agent whose phone is verified after the rep's credit date.
  onboarding_bonus   NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (onboarding_bonus >= 0),
  -- Percent of each recorded, non-trial membership payment.
  subscription_rate  NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (subscription_rate BETWEEN 0 AND 100),
  -- Paid subscriptions in a Kinshasa calendar month that earn target_bonus.
  monthly_target     INTEGER NOT NULL DEFAULT 0 CHECK (monthly_target >= 0),
  target_bonus       NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (target_bonus >= 0),
  active             BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sales_reps (
  id             BIGSERIAL PRIMARY KEY,
  full_name      TEXT NOT NULL CHECK (char_length(full_name) BETWEEN 1 AND 120),
  phone          TEXT CHECK (phone IS NULL OR phone ~ '^[0-9]{7,15}$'),
  email          TEXT CHECK (email IS NULL OR char_length(email) <= 200),
  -- The console account the rep signs in with (role `sales`). Optional: a
  -- field rep without a login is still paid.
  admin_user_id  BIGINT UNIQUE REFERENCES console_admin_users (id) ON DELETE SET NULL,
  plan_id        BIGINT REFERENCES sales_commission_plans (id) ON DELETE SET NULL,
  -- Reps are deactivated, never deleted: commissions and payouts point at them.
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by     BIGINT REFERENCES console_admin_users (id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Which rep looks after which agent. One active assignment per agent; ended
-- rows are the history. Nothing earned before `credit_from` is credited.
CREATE TABLE IF NOT EXISTS sales_account_assignments (
  id           BIGSERIAL PRIMARY KEY,
  rep_id       BIGINT NOT NULL REFERENCES sales_reps (id),
  agent_id     BIGINT NOT NULL REFERENCES agents (id) ON DELETE CASCADE,
  credit_from  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assigned_by  BIGINT REFERENCES console_admin_users (id) ON DELETE SET NULL,
  assigned_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at     TIMESTAMPTZ,
  ended_by     BIGINT REFERENCES console_admin_users (id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS sales_assignments_one_active_idx
  ON sales_account_assignments (agent_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS sales_assignments_rep_idx
  ON sales_account_assignments (rep_id, assigned_at DESC) WHERE ended_at IS NULL;

CREATE TABLE IF NOT EXISTS sales_payouts (
  id           BIGSERIAL PRIMARY KEY,
  rep_id       BIGINT NOT NULL REFERENCES sales_reps (id),
  currency     TEXT NOT NULL,
  total        NUMERIC(12, 2) NOT NULL CHECK (total > 0),
  method       TEXT NOT NULL CHECK (char_length(method) BETWEEN 1 AND 60),
  reference    TEXT CHECK (reference IS NULL OR char_length(reference) <= 120),
  note         TEXT CHECK (note IS NULL OR char_length(note) <= 500),
  paid_at      DATE NOT NULL,
  recorded_by  BIGINT REFERENCES console_admin_users (id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sales_payouts_rep_idx ON sales_payouts (rep_id, paid_at DESC, id DESC);

-- The commission ledger. UNIQUE (source_type, source_id) is what makes
-- regeneration idempotent: one membership, one agent onboarding, one rep-month
-- target can each be credited once, to one rep, ever.
CREATE TABLE IF NOT EXISTS sales_commissions (
  id             BIGSERIAL PRIMARY KEY,
  rep_id         BIGINT NOT NULL REFERENCES sales_reps (id),
  source_type    TEXT NOT NULL CHECK (source_type IN ('subscription', 'onboarding', 'target', 'adjustment')),
  source_id      TEXT NOT NULL,
  -- No foreign keys on these two: the ledger must outlive a deleted agent or membership.
  agent_id       BIGINT,
  membership_id  BIGINT,
  basis_amount   NUMERIC(12, 2),
  rate           NUMERIC(5, 2),
  amount         NUMERIC(12, 2) NOT NULL,
  currency       TEXT NOT NULL CHECK (char_length(currency) BETWEEN 1 AND 10),
  earned_at      TIMESTAMPTZ NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'paid', 'void')),
  note           TEXT CHECK (note IS NULL OR char_length(note) <= 500),
  plan_id        BIGINT REFERENCES sales_commission_plans (id) ON DELETE SET NULL,
  approved_at    TIMESTAMPTZ,
  approved_by    BIGINT REFERENCES console_admin_users (id) ON DELETE SET NULL,
  payout_id      BIGINT REFERENCES sales_payouts (id),
  voided_at      TIMESTAMPTZ,
  void_reason    TEXT CHECK (void_reason IS NULL OR char_length(void_reason) <= 500),
  created_by     BIGINT REFERENCES console_admin_users (id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sales_commissions_source_key UNIQUE (source_type, source_id),
  CONSTRAINT sales_commissions_paid_has_payout CHECK ((status = 'paid') = (payout_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS sales_commissions_rep_status_idx ON sales_commissions (rep_id, status, earned_at DESC);
CREATE INDEX IF NOT EXISTS sales_commissions_rep_earned_idx ON sales_commissions (rep_id, earned_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS sales_commissions_membership_idx ON sales_commissions (membership_id) WHERE membership_id IS NOT NULL;

-- 3. "View as" sessions. The cookie carries id + nonce; this row is what makes
-- an exit, an admin logout or an access reset end the session server-side.
CREATE TABLE IF NOT EXISTS console_impersonation_sessions (
  id             BIGSERIAL PRIMARY KEY,
  token_nonce    TEXT NOT NULL UNIQUE,
  admin_user_id  BIGINT NOT NULL REFERENCES console_admin_users (id),
  target_type    TEXT NOT NULL CHECK (target_type IN ('agent', 'customer')),
  target_id      BIGINT NOT NULL,
  target_label   TEXT,
  reason         TEXT NOT NULL CHECK (char_length(reason) BETWEEN 10 AND 500),
  ip             TEXT,
  user_agent     TEXT,
  started_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at     TIMESTAMPTZ NOT NULL,
  ended_at       TIMESTAMPTZ,
  end_reason     TEXT CHECK (end_reason IS NULL OR end_reason IN ('exit', 'expired', 'replaced', 'admin_logout'))
);
CREATE INDEX IF NOT EXISTS console_impersonation_started_idx ON console_impersonation_sessions (started_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS console_impersonation_admin_idx ON console_impersonation_sessions (admin_user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS console_impersonation_target_idx ON console_impersonation_sessions (target_type, target_id, started_at DESC);

-- Same rule as 20260915_agency_branches.sql: nothing here is read over
-- Supabase's REST API, so the default anon/authenticated grants are exposure.
DO $$
DECLARE
  role_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'REVOKE ALL ON sales_commission_plans, sales_reps, sales_account_assignments, sales_payouts, '
        'sales_commissions, console_impersonation_sessions FROM %I',
        role_name
      );
      EXECUTE format(
        'REVOKE ALL ON SEQUENCE sales_commission_plans_id_seq, sales_reps_id_seq, sales_account_assignments_id_seq, '
        'sales_payouts_id_seq, sales_commissions_id_seq, console_impersonation_sessions_id_seq FROM %I',
        role_name
      );
    END IF;
  END LOOP;
END $$;

COMMIT;
