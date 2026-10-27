-- Growth attribution and partner referrals (2026-10-27). web/CLAUDE.md,
-- "Where visitors and accounts come from", has the model.
--
-- Run with:  node scripts/run-sql-migration.js migrations/20261027_growth_attribution.sql --write
--
-- IDEMPOTENT and additive. Nothing is backfilled: rows written before this
-- carry no campaign, and no account's source is guessed after the fact.
-- Web writes correctly before it runs (each INSERT falls back on 42703 /
-- 42P01), so the deploy order does not matter.
--
-- 1. page_views: the full campaign of the visit, beside `source`.
-- 2. visitor_touches: per visitor id (lp_vid), the FIRST source ever seen and
--    the LAST tagged one.
-- 3. partners / partner_clicks / partner_conversions: codes for agents,
--    creators and campaigns, the clicks on their links and the accounts they
--    brought. One code namespace with sales_reps.referral_code, enforced by
--    triggers on both tables.
-- 4. account_acquisitions: where each customer and agent account came from,
--    written once when the account is created.
-- 5. partners.fee_*: what a creator or campaign costs; funnel indexes.

BEGIN;

-- 1 -------------------------------------------------------------------------
ALTER TABLE page_views ADD COLUMN IF NOT EXISTS utm_medium text;
ALTER TABLE page_views ADD COLUMN IF NOT EXISTS utm_campaign text;
ALTER TABLE page_views ADD COLUMN IF NOT EXISTS utm_content text;
ALTER TABLE page_views ADD COLUMN IF NOT EXISTS utm_term text;
ALTER TABLE page_views ADD COLUMN IF NOT EXISTS click_id_type text;
ALTER TABLE page_views ADD COLUMN IF NOT EXISTS referrer_host text;
ALTER TABLE page_views ADD COLUMN IF NOT EXISTS ref_code text;

CREATE INDEX IF NOT EXISTS page_views_campaign_created_idx
  ON page_views (utm_campaign, created_at) WHERE utm_campaign IS NOT NULL;

-- 2 -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS visitor_touches (
  visitor_id           text PRIMARY KEY CHECK (visitor_id ~ '^[A-Za-z0-9_-]{8,64}$'),
  first_source         text NOT NULL,
  first_medium         text,
  first_campaign       text,
  first_content        text,
  first_term           text,
  first_click_id       text,
  first_click_id_type  text,
  first_referrer_host  text,
  first_landing_path   text,
  first_ref_code       text,
  first_seen_at        timestamptz NOT NULL DEFAULT NOW(),
  last_source          text NOT NULL,
  last_medium          text,
  last_campaign        text,
  last_content         text,
  last_term            text,
  last_click_id        text,
  last_click_id_type   text,
  last_referrer_host   text,
  last_landing_path    text,
  last_ref_code        text,
  last_touch_at        timestamptz NOT NULL DEFAULT NOW(),
  last_seen_at         timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS visitor_touches_first_source_idx ON visitor_touches (first_source, first_seen_at);
CREATE INDEX IF NOT EXISTS visitor_touches_last_ref_idx ON visitor_touches (last_ref_code) WHERE last_ref_code IS NOT NULL;

-- 3 -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS partners (
  id          bigserial PRIMARY KEY,
  kind        text NOT NULL CHECK (kind IN ('agent', 'creator', 'campaign')),
  code        text NOT NULL CHECK (code ~ '^[A-Z]{3,10}[0-9]{2}$'),
  name        text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
  agent_id    bigint REFERENCES agents(id) ON DELETE CASCADE,
  handle      text CHECK (handle IS NULL OR char_length(handle) <= 120),
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  notes       text CHECK (notes IS NULL OR char_length(notes) <= 2000),
  created_at  timestamptz NOT NULL DEFAULT NOW(),
  updated_at  timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT partners_agent_kind CHECK ((kind = 'agent') = (agent_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS partners_code_idx ON partners (code);
CREATE UNIQUE INDEX IF NOT EXISTS partners_agent_idx ON partners (agent_id) WHERE agent_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS partner_clicks (
  id            bigserial PRIMARY KEY,
  partner_id    bigint NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  via           text NOT NULL CHECK (via IN ('link', 'qr', 'param')),
  visitor_id    text,
  landing_path  text CHECK (landing_path IS NULL OR char_length(landing_path) <= 1000),
  ip_hash       text,
  user_agent    text CHECK (user_agent IS NULL OR char_length(user_agent) <= 300),
  created_at    timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS partner_clicks_partner_created_idx ON partner_clicks (partner_id, created_at);

CREATE TABLE IF NOT EXISTS partner_conversions (
  id            bigserial PRIMARY KEY,
  partner_id    bigint NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  account_type  text NOT NULL CHECK (account_type IN ('customer', 'agent')),
  account_id    bigint NOT NULL,
  event         text NOT NULL DEFAULT 'signup' CHECK (event IN ('signup')),
  via           text CHECK (via IS NULL OR via IN ('link', 'qr', 'param', 'form_code')),
  visitor_id    text,
  ip_hash       text,
  created_at    timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (account_type, account_id, event)
);
CREATE INDEX IF NOT EXISTS partner_conversions_partner_created_idx ON partner_conversions (partner_id, created_at);

-- One namespace: a partner code may not be a rep's code, and the reverse.
CREATE OR REPLACE FUNCTION partners_code_not_rep() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM sales_reps WHERE referral_code = NEW.code) THEN
    RAISE EXCEPTION 'code % belongs to a sales rep', NEW.code USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS partners_code_not_rep ON partners;
CREATE TRIGGER partners_code_not_rep BEFORE INSERT OR UPDATE OF code ON partners
  FOR EACH ROW EXECUTE FUNCTION partners_code_not_rep();

CREATE OR REPLACE FUNCTION sales_reps_code_not_partner() RETURNS trigger AS $$
BEGIN
  IF NEW.referral_code IS NOT NULL AND EXISTS (SELECT 1 FROM partners WHERE code = NEW.referral_code) THEN
    RAISE EXCEPTION 'code % belongs to a partner', NEW.referral_code USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sales_reps_code_not_partner ON sales_reps;
CREATE TRIGGER sales_reps_code_not_partner BEFORE INSERT OR UPDATE OF referral_code ON sales_reps
  FOR EACH ROW EXECUTE FUNCTION sales_reps_code_not_partner();

-- 4 -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS account_acquisitions (
  id                   bigserial PRIMARY KEY,
  account_type         text NOT NULL CHECK (account_type IN ('customer', 'agent')),
  account_id           bigint NOT NULL,
  channel              text NOT NULL CHECK (channel IN ('web', 'whatsapp', 'admin')),
  visitor_id           text,
  first_source         text,
  first_medium         text,
  first_campaign       text,
  first_content        text,
  first_click_id_type  text,
  first_referrer_host  text,
  first_landing_path   text,
  first_seen_at        timestamptz,
  last_source          text,
  last_medium          text,
  last_campaign        text,
  last_content         text,
  last_click_id_type   text,
  last_referrer_host   text,
  last_landing_path    text,
  last_touch_at        timestamptz,
  ref_code             text,
  partner_id           bigint REFERENCES partners(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (account_type, account_id)
);
CREATE INDEX IF NOT EXISTS account_acquisitions_created_idx ON account_acquisitions (created_at);
CREATE INDEX IF NOT EXISTS account_acquisitions_partner_idx ON account_acquisitions (partner_id) WHERE partner_id IS NOT NULL;

-- 5 (2026-10-28) ---------------------------------------------------------------
-- What a creator or campaign costs, for /admin/partenaires' cost per account:
-- a flat fee for the deal, or an amount per account. NULL = not recorded.
ALTER TABLE partners ADD COLUMN IF NOT EXISTS fee_amount numeric(12, 2) CHECK (fee_amount IS NULL OR fee_amount >= 0);
ALTER TABLE partners ADD COLUMN IF NOT EXISTS fee_currency text CHECK (fee_currency IS NULL OR fee_currency IN ('USD', 'CDF'));
ALTER TABLE partners ADD COLUMN IF NOT EXISTS fee_basis text CHECK (fee_basis IS NULL OR fee_basis IN ('flat', 'per_signup'));

-- The partner funnel follows each clicked visitor into their later views and
-- taps; without these it would scan both tables whole.
CREATE INDEX IF NOT EXISTS page_views_visitor_created_idx ON page_views (visitor_id, created_at) WHERE visitor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS whatsapp_clicks_visitor_created_idx ON whatsapp_clicks (visitor_id, created_at) WHERE visitor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS partner_clicks_visitor_idx ON partner_clicks (partner_id, visitor_id) WHERE visitor_id IS NOT NULL;

-- Closed to PostgREST, like every table since the RLS lockdown.
ALTER TABLE visitor_touches      ENABLE ROW LEVEL SECURITY;
ALTER TABLE partners             ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_clicks       ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_conversions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_acquisitions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON visitor_touches, partners, partner_clicks, partner_conversions, account_acquisitions FROM anon, authenticated;
REVOKE ALL ON SEQUENCE partners_id_seq, partner_clicks_id_seq, partner_conversions_id_seq, account_acquisitions_id_seq FROM anon, authenticated;

COMMIT;
