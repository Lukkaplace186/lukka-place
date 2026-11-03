-- One row per (customer, saved listing, price cut) we have WhatsApped about.
--
-- Run with:  node scripts/run-sql-migration.js migrations/20261103_favorite_price_drop_notifications.sql --write
--
-- ADDITIVE AND IDEMPOTENT. Written by web's lib/favoritePriceDrops.js from
-- the daily search-alerts cron, only after the send was accepted. The key is
-- the cut's own date (property_price_history.changed_at), so a second cut on
-- the same listing is a new message and the same cut never is.
--
-- No FK to properties: an agent can delete a listing, and the record of what
-- a customer was told should not vanish with it. Customers cascade (an
-- account deleted is its data deleted).

BEGIN;

CREATE TABLE IF NOT EXISTS customer_price_drop_notifications (
  customer_id     bigint      NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  property_id     bigint      NOT NULL,
  price_drop_at   timestamptz NOT NULL,
  price_from      numeric,
  price_to        numeric,
  notified_at     timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (customer_id, property_id, price_drop_at)
);

ALTER TABLE customer_price_drop_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_price_drop_notifications FROM anon, authenticated;

COMMIT;
