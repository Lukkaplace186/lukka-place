-- Messagerie: in-app conversations between a customer and an agent.
--
-- Run with:  node scripts/run-sql-migration.js migrations/20261105_chat.sql --write
--
-- ADDITIVE AND IDEMPOTENT. Three new tables, nothing else changes. web reads
-- and writes them (web/lib/chat.js); every web read degrades to "no messages"
-- on 42P01, so web may deploy before this runs, but nobody can send until it
-- has.
--
-- WHY POSTGRES AND NOT THE ENGINE'S SQLITE. Both account types live here
-- (customers, agents), web already reads and writes Postgres directly, and
-- a message must not wait on the engine (an extra hop from Kinshasa). The
-- engine joins in later only to send WhatsApp alerts for unread messages.
--
-- ONE THREAD PER customer × agent × listing. `property_id` is a soft
-- reference, deliberately NOT a foreign key: agents hard-delete their own
-- listings from the dashboard, and the conversation about a deleted listing
-- must survive it (web shows "annonce plus en ligne"). Every read of the
-- listing itself still goes through lib/listings.js's public filter. A thread
-- with no listing (from an agent's profile) has property_id NULL; the unique
-- index folds NULL to 0 so there is one such thread per pair.
--
-- `lead_id` is the engine's SQLite leads.id, also soft: a chat is recorded
-- there as a `listing-chat` lead so it counts in Demandes and interactions.
--
-- READ STATE is one message id per side (`*_last_read_id`): unread = messages
-- from the other side with a larger id. No per-message receipts table.
--
-- `client_id` makes a send idempotent: a phone on a weak link that retries
-- the same message gets the stored one back, never a duplicate.

BEGIN;

CREATE TABLE IF NOT EXISTS chat_threads (
  id                     bigserial   PRIMARY KEY,
  customer_id            bigint      NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  agent_id               bigint      NOT NULL REFERENCES agents (id) ON DELETE CASCADE,
  property_id            bigint,
  lead_id                bigint,
  customer_last_read_id  bigint      NOT NULL DEFAULT 0,
  agent_last_read_id     bigint      NOT NULL DEFAULT 0,
  customer_archived_at   timestamptz,
  agent_archived_at      timestamptz,
  blocked_at             timestamptz,
  blocked_by             text        CHECK (blocked_by IS NULL OR blocked_by IN ('customer', 'agent', 'admin')),
  last_message_id        bigint,
  last_message_at        timestamptz,
  last_message_preview   text        CHECK (last_message_preview IS NULL OR char_length(last_message_preview) <= 160),
  last_sender_role       text        CHECK (last_sender_role IS NULL OR last_sender_role IN ('customer', 'agent', 'system')),
  agent_first_reply_at   timestamptz,
  customer_notified_at   timestamptz,
  agent_notified_at      timestamptz,
  created_at             timestamptz NOT NULL DEFAULT NOW(),
  updated_at             timestamptz NOT NULL DEFAULT NOW(),
  CHECK ((blocked_at IS NULL) = (blocked_by IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS chat_threads_pair_listing_uidx
  ON chat_threads (customer_id, agent_id, (COALESCE(property_id, 0)));
CREATE INDEX IF NOT EXISTS chat_threads_agent_recent_idx
  ON chat_threads (agent_id, last_message_at DESC NULLS LAST, id DESC);
CREATE INDEX IF NOT EXISTS chat_threads_customer_recent_idx
  ON chat_threads (customer_id, last_message_at DESC NULLS LAST, id DESC);
CREATE INDEX IF NOT EXISTS chat_threads_customer_created_idx
  ON chat_threads (customer_id, created_at);

CREATE TABLE IF NOT EXISTS chat_messages (
  id           bigserial   PRIMARY KEY,
  thread_id    bigint      NOT NULL REFERENCES chat_threads (id) ON DELETE CASCADE,
  sender_role  text        NOT NULL CHECK (sender_role IN ('customer', 'agent', 'system')),
  kind         text        NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'listing', 'visit', 'system')),
  body         text        CHECK (body IS NULL OR char_length(body) BETWEEN 1 AND 2000),
  property_id  bigint,
  payload      jsonb,
  client_id    uuid,
  created_at   timestamptz NOT NULL DEFAULT NOW(),
  deleted_at   timestamptz,
  CHECK (kind <> 'text' OR body IS NOT NULL),
  CHECK (kind <> 'listing' OR property_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS chat_messages_thread_id_idx ON chat_messages (thread_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS chat_messages_client_uidx ON chat_messages (thread_id, client_id)
  WHERE client_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS chat_reports (
  id             bigserial   PRIMARY KEY,
  thread_id      bigint      NOT NULL REFERENCES chat_threads (id) ON DELETE CASCADE,
  message_id     bigint      REFERENCES chat_messages (id) ON DELETE SET NULL,
  reporter_role  text        NOT NULL CHECK (reporter_role IN ('customer', 'agent')),
  reason         text        NOT NULL CHECK (reason IN ('scam', 'harassment', 'spam', 'other')),
  note           text        CHECK (note IS NULL OR char_length(note) <= 500),
  status         text        NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'REVIEWED', 'DISMISSED')),
  created_at     timestamptz NOT NULL DEFAULT NOW(),
  reviewed_at    timestamptz
);

-- One open report per side of a thread; a second tap updates nothing.
CREATE UNIQUE INDEX IF NOT EXISTS chat_reports_open_uidx
  ON chat_reports (thread_id, reporter_role) WHERE status = 'OPEN';
CREATE INDEX IF NOT EXISTS chat_reports_open_idx ON chat_reports (created_at) WHERE status = 'OPEN';

ALTER TABLE chat_threads  ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_reports  ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  role_name TEXT;
  tbl TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      FOREACH tbl IN ARRAY ARRAY['chat_threads', 'chat_messages', 'chat_reports'] LOOP
        EXECUTE format('REVOKE ALL ON %I FROM %I', tbl, role_name);
        EXECUTE format('REVOKE ALL ON SEQUENCE %I FROM %I', tbl || '_id_seq', role_name);
      END LOOP;
    END IF;
  END LOOP;
END $$;

COMMIT;
