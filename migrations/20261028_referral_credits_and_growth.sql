-- Growth plan items 13–31 (2026-10-27). web/CLAUDE.md, "Referral credits,
-- ad tracking and the launch pages", has the model.
--
-- Run with:  node scripts/run-sql-migration.js migrations/20261028_referral_credits_and_growth.sql --write
-- AFTER migrations/20261027_growth_attribution.sql (partner_credits names partners).
--
-- IDEMPOTENT and additive. Nothing is backfilled. Web reads every new table
-- defensively (42P01 = "not switched on yet"), so the deploy order does not
-- matter for anything but the agents' money, which only exists once it runs.
--
-- 1. partner_credits / partner_payouts — $1 per activated customer an AGENT
--    brought (web lib/referralRules.js), pending → approved → paid, never a
--    second credit for the same number.
-- 2. partner_program_announcements — who was told about the programme.
-- 3. partner_social_stats — a creator's weekly TikTok figures, typed in.
-- 4. ad_spend_weekly — paid spend per channel and week, typed in.
-- 5. customers.activation_* — account created on WhatsApp sets its password
--    through a single-use link (engine services/customerOnboarding.js).
-- 6. featured_listing_days — the team's "Bien du jour" picks.

BEGIN;

-- 1 -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS partner_payouts (
  id            bigserial PRIMARY KEY,
  partner_id    bigint NOT NULL REFERENCES partners(id) ON DELETE RESTRICT,
  amount        numeric(12, 2) NOT NULL CHECK (amount > 0),
  currency      text NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD', 'CDF')),
  method        text NOT NULL DEFAULT 'mobile_money' CHECK (method IN ('mobile_money', 'cash', 'bank')),
  reference     text CHECK (reference IS NULL OR char_length(reference) <= 120),
  paid_by       text,
  created_at    timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS partner_payouts_partner_idx ON partner_payouts (partner_id, created_at);

CREATE TABLE IF NOT EXISTS partner_credits (
  id                   bigserial PRIMARY KEY,
  partner_id           bigint NOT NULL REFERENCES partners(id) ON DELETE RESTRICT,
  conversion_id        bigint NOT NULL UNIQUE,
  account_type         text NOT NULL DEFAULT 'customer' CHECK (account_type = 'customer'),
  account_id           bigint NOT NULL,
  phone_hash           text NOT NULL,
  amount               numeric(12, 2) NOT NULL CHECK (amount >= 0),
  currency             text NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD', 'CDF')),
  status               text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'paid', 'void')),
  qualified_at         timestamptz NOT NULL,
  approvable_at        timestamptz NOT NULL,
  activation           text,
  approved_at          timestamptz,
  approved_by          text,
  paid_at              timestamptz,
  payout_id            bigint REFERENCES partner_payouts(id) ON DELETE SET NULL,
  void_reason          text CHECK (void_reason IS NULL OR char_length(void_reason) <= 300),
  voided_at            timestamptz,
  voided_by            text,
  clawback_flagged_at  timestamptz,
  created_at           timestamptz NOT NULL DEFAULT NOW()
);
-- One live credit per phone number, ever: an account deleted and opened again
-- on the same number is not a second customer.
CREATE UNIQUE INDEX IF NOT EXISTS partner_credits_phone_live_idx ON partner_credits (phone_hash) WHERE status <> 'void';
CREATE INDEX IF NOT EXISTS partner_credits_partner_status_idx ON partner_credits (partner_id, status);

-- 2 -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS partner_program_announcements (
  agent_id   bigint PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
  sent_at    timestamptz NOT NULL DEFAULT NOW(),
  accepted   boolean NOT NULL,
  error      text
);

-- 3 -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS partner_social_stats (
  id                bigserial PRIMARY KEY,
  partner_id        bigint NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  week_start        date NOT NULL,
  posts             integer CHECK (posts IS NULL OR posts >= 0),
  views             integer CHECK (views IS NULL OR views >= 0),
  likes             integer CHECK (likes IS NULL OR likes >= 0),
  followers_gained  integer,
  notes             text CHECK (notes IS NULL OR char_length(notes) <= 500),
  entered_by        text,
  updated_at        timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (partner_id, week_start)
);

-- 4 -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ad_spend_weekly (
  id          bigserial PRIMARY KEY,
  week_start  date NOT NULL,
  channel     text NOT NULL CHECK (channel IN ('meta_ads', 'tiktok_ads', 'google_ads', 'other_paid')),
  amount      numeric(12, 2) NOT NULL CHECK (amount >= 0),
  currency    text NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD', 'CDF')),
  entered_by  text,
  updated_at  timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (week_start, channel, currency)
);

-- 5 -------------------------------------------------------------------------
ALTER TABLE customers ADD COLUMN IF NOT EXISTS activation_token_hash text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS activation_expires_at timestamptz;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS signup_channel text;

-- 6 -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS featured_listing_days (
  day          date PRIMARY KEY,
  property_id  bigint NOT NULL,
  picked_by    text,
  created_at   timestamptz NOT NULL DEFAULT NOW()
);

-- Closed to PostgREST, like every table since the RLS lockdown.
ALTER TABLE partner_payouts               ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_credits               ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_program_announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_social_stats          ENABLE ROW LEVEL SECURITY;
ALTER TABLE ad_spend_weekly               ENABLE ROW LEVEL SECURITY;
ALTER TABLE featured_listing_days         ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON partner_payouts, partner_credits, partner_program_announcements, partner_social_stats,
              ad_spend_weekly, featured_listing_days FROM anon, authenticated;
REVOKE ALL ON SEQUENCE partner_payouts_id_seq, partner_credits_id_seq, partner_social_stats_id_seq,
                       ad_spend_weekly_id_seq FROM anon, authenticated;

COMMIT;
