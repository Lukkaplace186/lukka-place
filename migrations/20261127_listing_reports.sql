-- "Signaler cette annonce" (2026-11-27): a visitor flags a listing as a
-- scam, no longer available, wrongly priced or wrongly described. The team
-- reads them on /admin/signalements (web/lib/listingReports.js).
--
-- No FK to properties: agents hard-delete listings, and a report must outlive
-- the listing it was about. One OPEN report per visitor and listing (the
-- partial unique index): a second tap is not a second voice. `visitor_hash`
-- is a SHA-256, never the visitor cookie or the IP itself.
--
-- Idempotent; run with node scripts/run-sql-migration.js <file> [--write].

CREATE TABLE IF NOT EXISTS listing_reports (
  id bigserial PRIMARY KEY,
  property_id bigint NOT NULL,
  reason text NOT NULL CHECK (reason IN ('scam', 'unavailable', 'wrong_price', 'wrong_info', 'duplicate', 'other')),
  note text CHECK (note IS NULL OR char_length(note) <= 500),
  customer_id bigint,
  visitor_hash text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  handled_at timestamptz,
  handled_by text
);

CREATE INDEX IF NOT EXISTS listing_reports_status_created_idx ON listing_reports (status, created_at DESC);
CREATE INDEX IF NOT EXISTS listing_reports_property_idx ON listing_reports (property_id);
CREATE UNIQUE INDEX IF NOT EXISTS listing_reports_one_open_per_visitor
  ON listing_reports (property_id, visitor_hash)
  WHERE status = 'open' AND visitor_hash IS NOT NULL;

-- Closed to PostgREST like every table since 20261015_rls_lockdown.sql.
ALTER TABLE listing_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON listing_reports FROM anon, authenticated;
REVOKE ALL ON SEQUENCE listing_reports_id_seq FROM anon, authenticated;
