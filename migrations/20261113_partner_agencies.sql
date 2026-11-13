-- Partner agencies (owner, 2026-11-13): agencies we have a partnership with —
-- JOKER AGENCY first — marked in the console so the approval queue can show
-- their listings apart (/admin/listings?partner=only) and badge them.
--
-- One row per agency (vendors.id). A new table rather than a vendors column:
-- vendors belongs to the Laravel back-office too and the console never alters
-- its columns (web/lib/adminAgencies.js). No FK, same as agency_branches'
-- reads: an agency soft-deleted later simply stops matching any listing.
-- Idempotent: re-running is a no-op.

BEGIN;

CREATE TABLE IF NOT EXISTS partner_agencies (
  vendor_id  bigint PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- console_admin_users.id; NULL when marked under the shared password.
  created_by bigint NULL
);

ALTER TABLE partner_agencies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON partner_agencies FROM anon, authenticated;

COMMIT;
