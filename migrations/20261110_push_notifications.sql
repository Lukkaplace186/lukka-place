-- Push notifications for the Lukka Place app (Google Play + App Store).
--
-- Run with:  node scripts/run-sql-migration.js migrations/20261110_push_notifications.sql --write
--
-- ADDITIVE AND IDEMPOTENT. Five new tables, nothing else changes.
--
-- WHY. WhatsApp only reaches someone who wrote to us in the last 24 h unless a
-- Meta template is approved, and several are missing or paused. The app gets
-- its alerts as push notifications (Firebase Cloud Messaging, which also
-- carries iPhone pushes through Apple's service). WhatsApp stays as the
-- fallback: no app, a failed push, or an urgent alert still unread after
-- PUSH_FALLBACK_MIN minutes (services/pushNotify.js).
--
-- push_devices — one row per phone where someone is logged in to the app.
--   The FCM token is the address; it is unique, and a token that moves to
--   another account (a shared phone) is re-pointed, not duplicated.
--   `revoked_at` is set on logout and when FCM says the token is dead.
--
-- notifications — every alert sent through the app layer, whether a phone
--   received it or not: it is the agent's in-app inbox (the bell) and the
--   record of what reached whom. `fallback` holds what the WhatsApp copy
--   needs when it has to go later (urgent and unread); `fallback_due_at` is
--   when. `whatsapp_fallback_at` is claimed before the send, so it happens
--   once. user_type covers customers and admins now so they can follow
--   without another migration; only agents are sent to today.
--
-- The engine (services/pushNotify.js) checks to_regclass before touching
-- either table, so it runs unchanged before this migration: every alert then
-- goes over WhatsApp exactly as before.

BEGIN;

CREATE TABLE IF NOT EXISTS push_devices (
  id             bigserial   PRIMARY KEY,
  user_type      text        NOT NULL CHECK (user_type IN ('agent', 'customer', 'admin')),
  user_id        bigint      NOT NULL,
  platform       text        NOT NULL CHECK (platform IN ('android', 'ios')),
  fcm_token      text        NOT NULL CHECK (char_length(fcm_token) BETWEEN 20 AND 4096),
  app_version    text        CHECK (app_version IS NULL OR char_length(app_version) <= 40),
  created_at     timestamptz NOT NULL DEFAULT NOW(),
  last_seen_at   timestamptz NOT NULL DEFAULT NOW(),
  revoked_at     timestamptz,
  revoked_reason text        CHECK (revoked_reason IS NULL OR char_length(revoked_reason) <= 120)
);

CREATE UNIQUE INDEX IF NOT EXISTS push_devices_token_uidx ON push_devices (fcm_token);
CREATE INDEX IF NOT EXISTS push_devices_user_live_idx
  ON push_devices (user_type, user_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS notifications (
  id                    bigserial   PRIMARY KEY,
  user_type             text        NOT NULL CHECK (user_type IN ('agent', 'customer', 'admin')),
  user_id               bigint      NOT NULL,
  kind                  text        NOT NULL CHECK (char_length(kind) BETWEEN 1 AND 60),
  ref_id                text        CHECK (ref_id IS NULL OR char_length(ref_id) <= 60),
  title                 text        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  body                  text        NOT NULL CHECK (char_length(body) <= 500),
  url                   text        CHECK (url IS NULL OR (char_length(url) <= 500 AND url LIKE '/%')),
  urgent                boolean     NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT NOW(),
  push_sent_at          timestamptz,
  push_result           text        CHECK (push_result IS NULL OR char_length(push_result) <= 200),
  read_at               timestamptz,
  fallback              jsonb,
  fallback_due_at       timestamptz,
  whatsapp_fallback_at  timestamptz,
  whatsapp_result       text        CHECK (whatsapp_result IS NULL OR char_length(whatsapp_result) <= 200)
);

CREATE INDEX IF NOT EXISTS notifications_user_recent_idx
  ON notifications (user_type, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
  ON notifications (user_type, user_id) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS notifications_fallback_due_idx
  ON notifications (fallback_due_at)
  WHERE fallback_due_at IS NOT NULL AND whatsapp_fallback_at IS NULL AND read_at IS NULL;

-- notification_preferences — per person, per kind of alert, whether the app
--   may push it. No row = on. A kind turned off is never pushed (WhatsApp
--   stays as it was; its own opt-out is customers.whatsapp_alerts_opted_out_at).
--   Categories (web/lib/pushRules.js NOTIFICATION_CATEGORIES): visits,
--   requests, messages, search_alerts, saved_listings, suggestions, news.
CREATE TABLE IF NOT EXISTS notification_preferences (
  user_type     text        NOT NULL CHECK (user_type IN ('agent', 'customer', 'admin')),
  user_id       bigint      NOT NULL,
  category      text        NOT NULL CHECK (category ~ '^[a-z_]{1,40}$'),
  push_enabled  boolean     NOT NULL DEFAULT true,
  updated_at    timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_type, user_id, category)
);

-- favorite_status_notices — the last market state a customer was told about
--   for each listing they saved (services/favoriteStatus.js: let / sold,
--   under offer, offline, back on the market). No FK to properties: agents
--   hard-delete listings, and the row must not block that.
CREATE TABLE IF NOT EXISTS favorite_status_notices (
  customer_id  bigint      NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  property_id  bigint      NOT NULL,
  state        text        NOT NULL CHECK (state IN ('active', 'under_offer', 'closed', 'withdrawn')),
  -- Photos on the listing when last told: more later is "Nouvelles photos".
  photo_count  integer     NOT NULL DEFAULT 0,
  told_at      timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (customer_id, property_id)
);

-- customer_follows — "Suivre" an agency (web lib/customerFollows.js): the app
--   pushes each new listing it publishes (web lib/portalDigests.js).
CREATE TABLE IF NOT EXISTS customer_follows (
  customer_id  bigint      NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  agent_id     bigint      NOT NULL REFERENCES agents (id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (customer_id, agent_id)
);
CREATE INDEX IF NOT EXISTS customer_follows_agent_idx ON customer_follows (agent_id);

ALTER TABLE push_devices  ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE favorite_status_notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_follows ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  role_name TEXT;
  tbl TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      FOREACH tbl IN ARRAY ARRAY['push_devices', 'notifications'] LOOP
        EXECUTE format('REVOKE ALL ON %I FROM %I', tbl, role_name);
        EXECUTE format('REVOKE ALL ON SEQUENCE %I FROM %I', tbl || '_id_seq', role_name);
      END LOOP;
      -- No sequence: its key is (user_type, user_id, category).
      EXECUTE format('REVOKE ALL ON notification_preferences FROM %I', role_name);
      EXECUTE format('REVOKE ALL ON favorite_status_notices FROM %I', role_name);
      EXECUTE format('REVOKE ALL ON customer_follows FROM %I', role_name);
    END IF;
  END LOOP;
END $$;

COMMIT;
