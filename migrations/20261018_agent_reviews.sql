-- Customer ratings of agents after a visit ("Notez l'agent", 1 to 5 stars).
--
-- Run with:  node scripts/run-sql-migration.js migrations/20261018_agent_reviews.sql --write
--
-- ADDITIVE AND IDEMPOTENT. One new table. The engine answers "rating not
-- available yet" on 42P01 and web shows no rating, so either side can deploy
-- first.
--
-- A review rates the AGENT, never the property (product decision 2026-10-18):
-- what the customer thought of the house is the check-in's 👍/👎 and the
-- customer's fall-through reason (viewing_requests.decline_reason_code), which
-- stay where they are.
--
-- VERIFIED BY CONSTRUCTION. A row exists only for a real viewing request whose
-- customer answered the post-visit check-in with 👍 or 👎 (the visit happened),
-- written by services/agentReviews.js after matching the sender against the
-- lead's own wa_id. `viewing_request_id` is the engine's SQLite id and is
-- UNIQUE: one rating per visit, never edited afterwards.
--
-- `customer_hash` is SHA-256 of the customer's digits, never the number: it is
-- enough to spot one number rating the same agent again and again (the monthly
-- contest's anti-fraud rule) and useless to anybody reading this table.
--
-- The comment is optional and is shown publicly only once a moderator sets
-- comment_status = 'APPROVED' (/admin/agent-reviews). The stars count at once.

BEGIN;

CREATE TABLE IF NOT EXISTS agent_reviews (
  id                  bigserial   PRIMARY KEY,
  agent_id            bigint      NOT NULL REFERENCES agents (id) ON DELETE CASCADE,
  viewing_request_id  bigint      NOT NULL UNIQUE,
  property_id         bigint      REFERENCES properties (id) ON DELETE SET NULL,
  customer_hash       text        NOT NULL,
  stars               smallint    NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment             text        CHECK (comment IS NULL OR char_length(comment) <= 500),
  comment_status      text        NOT NULL DEFAULT 'NONE'
                      CHECK (comment_status IN ('NONE', 'PENDING', 'APPROVED', 'REJECTED')),
  channel             text        NOT NULL CHECK (channel IN ('WHATSAPP', 'WEB')),
  created_at          timestamptz NOT NULL DEFAULT NOW(),
  comment_at          timestamptz,
  moderated_at        timestamptz
);

CREATE INDEX IF NOT EXISTS agent_reviews_agent_created_idx ON agent_reviews (agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_reviews_comment_pending_idx ON agent_reviews (created_at)
  WHERE comment_status = 'PENDING';

ALTER TABLE agent_reviews ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  role_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON agent_reviews FROM %I', role_name);
      EXECUTE format('REVOKE ALL ON SEQUENCE agent_reviews_id_seq FROM %I', role_name);
    END IF;
  END LOOP;
END $$;

COMMIT;
