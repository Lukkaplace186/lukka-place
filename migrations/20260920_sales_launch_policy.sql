-- Launch sales-rep commission policy (Kinshasa): referral codes, permanent
-- agent attribution, confirmed-listing credits, milestone commission lines.
--
-- Run with:  node scripts/run-sql-migration.js migrations/20260920_sales_launch_policy.sql --write
--
-- ADDITIVE AND IDEMPOTENT. Builds on 20260919_sales_and_impersonation.sql:
-- two columns on existing sales tables, one widened CHECK, new tables.
-- Nothing touches Laravel's tables beyond foreign keys pointing at `agents`.

BEGIN;

-- 1. A plan is either the subscription model (existing) or the launch model.
ALTER TABLE sales_commission_plans ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'subscription';
ALTER TABLE sales_commission_plans DROP CONSTRAINT IF EXISTS sales_commission_plans_kind_check;
ALTER TABLE sales_commission_plans ADD CONSTRAINT sales_commission_plans_kind_check
  CHECK (kind IN ('subscription', 'launch_milestones'));

-- 2. One referral code per rep. Stored uppercase (the CHECK enforces it), so a
-- plain unique index is a case-insensitive one.
ALTER TABLE sales_reps ADD COLUMN IF NOT EXISTS referral_code TEXT;
ALTER TABLE sales_reps DROP CONSTRAINT IF EXISTS sales_reps_referral_code_format;
ALTER TABLE sales_reps ADD CONSTRAINT sales_reps_referral_code_format
  CHECK (referral_code IS NULL OR referral_code ~ '^[A-Z]{3,10}[0-9]{2}$');
CREATE UNIQUE INDEX IF NOT EXISTS sales_reps_referral_code_idx ON sales_reps (referral_code) WHERE referral_code IS NOT NULL;

-- 3. Clicks on /r/<code>. The IP is only ever stored hashed.
CREATE TABLE IF NOT EXISTS sales_referral_clicks (
  id             BIGSERIAL PRIMARY KEY,
  rep_id         BIGINT NOT NULL REFERENCES sales_reps (id),
  referral_code  TEXT NOT NULL,
  source         TEXT NOT NULL CHECK (source IN ('link', 'qr')),
  ip_hash        TEXT,
  user_agent     TEXT CHECK (user_agent IS NULL OR char_length(user_agent) <= 300),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sales_referral_clicks_rep_idx ON sales_referral_clicks (rep_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sales_referral_clicks_dedupe_idx ON sales_referral_clicks (rep_id, ip_hash, created_at DESC);

-- 4. The permanent record of who brought an agent in. One row per agent: the
-- first valid referral wins, and only an audited override changes rep_id.
CREATE TABLE IF NOT EXISTS sales_agent_attributions (
  id                   BIGSERIAL PRIMARY KEY,
  agent_id             BIGINT NOT NULL UNIQUE REFERENCES agents (id) ON DELETE CASCADE,
  rep_id               BIGINT NOT NULL REFERENCES sales_reps (id),
  referral_code        TEXT,
  source               TEXT NOT NULL CHECK (source IN ('link', 'qr', 'form_code', 'whatsapp_code', 'admin_override')),
  attributed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Listings created before this instant are never credited to the rep.
  credit_from          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  agent_registered_at  TIMESTAMPTZ,
  -- Hashed signup IP (web signups only): lets the disputes view spot many
  -- accounts from one connection. Never the raw address.
  ip_hash              TEXT,
  validation_status    TEXT NOT NULL DEFAULT 'pending' CHECK (validation_status IN ('pending', 'validated', 'rejected')),
  validated_at         TIMESTAMPTZ,
  validated_by         BIGINT REFERENCES console_admin_users (id) ON DELETE SET NULL,
  rejection_reason     TEXT CHECK (rejection_reason IS NULL OR char_length(rejection_reason) BETWEEN 3 AND 500),
  qualified_at         TIMESTAMPTZ,
  created_by           BIGINT REFERENCES console_admin_users (id) ON DELETE SET NULL,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sales_attributions_rep_idx ON sales_agent_attributions (rep_id, attributed_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS sales_attributions_ip_idx ON sales_agent_attributions (ip_hash) WHERE ip_hash IS NOT NULL;

-- 5. Referrals that were NOT credited, and why. Facts for the disputes view.
CREATE TABLE IF NOT EXISTS sales_referral_refusals (
  id             BIGSERIAL PRIMARY KEY,
  rep_id         BIGINT REFERENCES sales_reps (id),
  referral_code  TEXT CHECK (referral_code IS NULL OR char_length(referral_code) <= 40),
  agent_id       BIGINT,
  channel        TEXT NOT NULL CHECK (channel IN ('web', 'whatsapp')),
  reason         TEXT NOT NULL CHECK (reason IN ('unknown_code', 'inactive_rep', 'self_referral', 'existing_agent', 'malformed')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sales_referral_refusals_created_idx ON sales_referral_refusals (created_at DESC, id DESC);

-- 6. Every attribution override, with its reason. Append-only.
CREATE TABLE IF NOT EXISTS sales_attribution_changes (
  id           BIGSERIAL PRIMARY KEY,
  agent_id     BIGINT NOT NULL,
  from_rep_id  BIGINT REFERENCES sales_reps (id),
  to_rep_id    BIGINT NOT NULL REFERENCES sales_reps (id),
  reason       TEXT NOT NULL CHECK (char_length(reason) BETWEEN 20 AND 1000),
  evidence     TEXT CHECK (evidence IS NULL OR char_length(evidence) <= 1000),
  changed_by   BIGINT REFERENCES console_admin_users (id) ON DELETE SET NULL,
  changed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sales_attribution_changes_agent_idx ON sales_attribution_changes (agent_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS sales_attribution_changes_changed_idx ON sales_attribution_changes (changed_at DESC, id DESC);

-- 7. A confirmed listing, frozen the first time the commission run saw it.
-- NO foreign key to properties: agents hard-delete listings, and the 30-day
-- quality test has to remember that a deleted listing existed.
CREATE TABLE IF NOT EXISTS sales_listing_credits (
  id                BIGSERIAL PRIMARY KEY,
  property_id       BIGINT NOT NULL UNIQUE,
  agent_id          BIGINT NOT NULL,
  rep_id            BIGINT NOT NULL REFERENCES sales_reps (id),
  confirmed_at      TIMESTAMPTZ NOT NULL,
  credited_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  day30_checked_at  TIMESTAMPTZ,
  day30_valid       BOOLEAN,
  day30_state       TEXT CHECK (day30_state IS NULL OR day30_state IN ('live', 'closed', 'rejected', 'deleted', 'offline', 'excluded')),
  excluded_at       TIMESTAMPTZ,
  excluded_reason   TEXT CHECK (excluded_reason IS NULL OR char_length(excluded_reason) BETWEEN 3 AND 500),
  excluded_by       BIGINT REFERENCES console_admin_users (id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS sales_listing_credits_rep_idx ON sales_listing_credits (rep_id, confirmed_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS sales_listing_credits_agent_idx ON sales_listing_credits (agent_id);
CREATE INDEX IF NOT EXISTS sales_listing_credits_day30_idx ON sales_listing_credits (confirmed_at) WHERE day30_checked_at IS NULL;

-- 8. The ledger learns the launch sources. A milestone line holds one tier's
-- DELTA, so the sum of a rep's lines is always the cumulative tier amount.
ALTER TABLE sales_commissions DROP CONSTRAINT IF EXISTS sales_commissions_source_type_check;
ALTER TABLE sales_commissions ADD CONSTRAINT sales_commissions_source_type_check
  CHECK (source_type IN ('subscription', 'onboarding', 'target', 'adjustment', 'milestone', 'listing_bonus', 'quality'));
-- Set by the run on a PAID milestone line whose threshold is no longer met.
ALTER TABLE sales_commissions ADD COLUMN IF NOT EXISTS clawback_flagged_at TIMESTAMPTZ;

DO $$
DECLARE
  role_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'REVOKE ALL ON sales_referral_clicks, sales_agent_attributions, sales_referral_refusals, '
        'sales_attribution_changes, sales_listing_credits FROM %I',
        role_name
      );
      EXECUTE format(
        'REVOKE ALL ON SEQUENCE sales_referral_clicks_id_seq, sales_agent_attributions_id_seq, '
        'sales_referral_refusals_id_seq, sales_attribution_changes_id_seq, sales_listing_credits_id_seq FROM %I',
        role_name
      );
    END IF;
  END LOOP;
END $$;

COMMIT;
