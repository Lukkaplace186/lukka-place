-- "Mon déménagement": what a customer told us about their move.
--
-- Run with:  node scripts/run-sql-migration.js migrations/20261107_customer_move_projects.sql --write
--
-- ADDITIVE AND IDEMPOTENT. Written by web's lib/moveProjects.js from the
-- card-by-card signup (/compte/inscription) and from "Mon projet"
-- (/compte/client/projet). One row per customer: the project they are living
-- now. Every column but the key is optional — NULL / empty means the customer
-- skipped that card ("not said"), never a default.
--
-- Values are codes from web's lib/moveProjectRules.js (allow-lists checked
-- there); communes are keys from lib/cities.js. No CHECK constraints on the
-- code lists, so adding an answer is a code change, not a migration.
--
-- Customers cascade: an account deleted is its project deleted.

BEGIN;

CREATE TABLE IF NOT EXISTS customer_move_projects (
  customer_id       bigint      PRIMARY KEY REFERENCES customers (id) ON DELETE CASCADE,
  reasons           text[]      NOT NULL DEFAULT '{}',
  reason_other      text,
  transaction_type  text,
  lease_term        text,
  household         text,
  bedrooms_min      smallint,
  anchor_kind       text,
  anchor_commune    text,
  anchor_note       text,
  city              text,
  communes          text[]      NOT NULL DEFAULT '{}',
  priorities        text[]      NOT NULL DEFAULT '{}',
  budget_max        integer,
  timeline          text,
  current_home_type text,
  current_commune   text,
  -- Which cards the customer answered or skipped, in order (for "Mon projet"
  -- to say what is still open; never shown to agents).
  answered_steps    text[]      NOT NULL DEFAULT '{}',
  -- Set when "Envoyer ma demande aux agences" created a lead from this
  -- project; the engine's leads id (SQLite), no FK across databases.
  last_lead_id      bigint,
  last_lead_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT NOW(),
  updated_at        timestamptz NOT NULL DEFAULT NOW()
);

ALTER TABLE customer_move_projects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_move_projects FROM anon, authenticated;

COMMIT;
