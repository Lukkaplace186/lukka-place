-- Agency referral codes (owner, 2026-11-16): JOKER AGENCY's partnership pays
-- $1 per customer its people bring, counted for the AGENCY as a whole — the
-- owner and every agent of the agency share one code (JOKER01) and one total,
-- paid as one payout. A partner of kind 'agency' names the agency
-- (vendors.id); only an agency marked on its page (partner_agencies) has a live
-- code, whatever the agents' campaign switch says (web lib/partners.js).
--
-- No FK to vendors: vendors is Laravel's, and a soft-deleted agency simply
-- stops matching (same as partner_agencies). Idempotent: re-running is a no-op.

BEGIN;

ALTER TABLE partners ADD COLUMN IF NOT EXISTS vendor_id bigint;

ALTER TABLE partners DROP CONSTRAINT IF EXISTS partners_kind_check;
ALTER TABLE partners ADD CONSTRAINT partners_kind_check
  CHECK (kind IN ('agent', 'creator', 'campaign', 'agency'));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'partners_agency_kind' AND conrelid = 'public.partners'::regclass) THEN
    ALTER TABLE partners ADD CONSTRAINT partners_agency_kind CHECK ((kind = 'agency') = (vendor_id IS NOT NULL));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS partners_vendor_idx ON partners (vendor_id) WHERE vendor_id IS NOT NULL;

COMMIT;
