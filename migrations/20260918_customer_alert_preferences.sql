-- Customer saved-search alert preferences: per-search frequency, the last time
-- a search was alerted, and an account-wide WhatsApp opt-out.
--
-- Run with:  node scripts/run-sql-migration.js migrations/20260918_customer_alert_preferences.sql --write
--
-- RUN BEFORE the web deploy that lets customers change these. Reads are safe
-- either way: web/ reads every column below through `to_jsonb(row) ->> '...'`
-- (lib/searchAlerts.js, lib/customers.js), so a page never 500s on a missing
-- column. Writes are not: changing an alert's frequency, opting out, and
-- stamping last_alerted_at all fail (and say so) until this has run. Until
-- then the daily sweep still never repeats a listing — saved_search_notifications
-- dedupes per listing — but a "weekly" search can hear about new listings on
-- consecutive days.
--
-- ADDITIVE AND IDEMPOTENT. No backfill is needed: 'weekly' is the cadence every
-- existing search has always had, and NULL last_alerted_at / opted_out_at are
-- true statements ("never alerted by this mechanism", "never opted out").
--
-- WHY A TIMESTAMP FOR THE OPT-OUT, NOT A BOOLEAN
-- Same reason as every comparable flag on this schema (phone_verified_at,
-- verified_at): "since when" is the first question when a customer says they
-- asked us to stop.

BEGIN;

ALTER TABLE customer_saved_searches
  ADD COLUMN IF NOT EXISTS alert_frequency varchar(10) NOT NULL DEFAULT 'weekly';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customer_saved_searches_alert_frequency_check'
  ) THEN
    ALTER TABLE customer_saved_searches
      ADD CONSTRAINT customer_saved_searches_alert_frequency_check
      CHECK (alert_frequency IN ('daily', 'weekly', 'off'));
  END IF;
END $$;

ALTER TABLE customer_saved_searches
  ADD COLUMN IF NOT EXISTS last_alerted_at timestamptz;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS whatsapp_alerts_opted_out_at timestamptz;

-- A customer's private note on a saved listing ("toiture à vérifier") — the
-- "Ma note" block the Espace Client design always had and the page left out
-- because no column existed. Private to the customer: never shown to agents,
-- never exported. Read through to_jsonb too; saving a note fails until this runs.
ALTER TABLE customer_favorites
  ADD COLUMN IF NOT EXISTS note text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customer_favorites_note_length_check'
  ) THEN
    ALTER TABLE customer_favorites
      ADD CONSTRAINT customer_favorites_note_length_check CHECK (note IS NULL OR char_length(note) <= 500);
  END IF;
END $$;

COMMIT;
