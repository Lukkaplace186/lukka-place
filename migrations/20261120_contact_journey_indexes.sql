-- 2026-11-20 — /admin/contacts shows each contact's journey (web
-- lib/contactLogLoader.js loadJourneys): the device's latest search, its saves
-- and the customer account created on it, all read BY visitor id for every
-- contact on the page. None of these tables had an index on visitor_id, so
-- each read was a full scan; at a few thousand contacts per 90-day window it
-- would grow with every search ever made.
--
-- Additive and idempotent. Partial (visitor_id IS NOT NULL) because rows
-- written before visitor ids existed carry none and are never looked up.
-- Run: node scripts/run-sql-migration.js migrations/20261120_contact_journey_indexes.sql [--write]

BEGIN;

CREATE INDEX IF NOT EXISTS search_events_visitor_created_idx
  ON search_events (visitor_id, created_at) WHERE visitor_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS listing_events_visitor_event_idx
  ON listing_events (visitor_id, event) WHERE visitor_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS account_acquisitions_visitor_idx
  ON account_acquisitions (visitor_id) WHERE visitor_id IS NOT NULL;

COMMIT;
