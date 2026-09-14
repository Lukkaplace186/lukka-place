-- Admin console platform: individual accounts, roles, audit trail, notes,
-- saved views, moderation reasons, and the indexes a 30k-agent console needs.
--
-- Run with:  node scripts/run-sql-migration.js migrations/20260914_admin_console_platform.sql --write
--
-- ADDITIVE AND IDEMPOTENT. Every statement is IF NOT EXISTS or a guarded DO
-- block, so re-running an applied migration is a no-op. Nothing existing is
-- altered or dropped except ADD COLUMN IF NOT EXISTS on `properties`.
--
-- Deliberately NOT Laravel's `admins` / `role_permissions` tables: those belong
-- to the external Laravel back-office (CLAUDE.md, "System Architecture"), and a
-- second writer on another application's auth table is how its logins break.
-- The `console_` prefix keeps this console's identity model visibly separate.

BEGIN;

CREATE TABLE IF NOT EXISTS console_admin_users (
  id                     BIGSERIAL PRIMARY KEY,
  email                  TEXT NOT NULL,
  full_name              TEXT NOT NULL,
  role                   TEXT NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'invited',
  password_hash          TEXT,
  -- Bumped on every access reset / disable: every outstanding session token
  -- carries the version it was issued at and dies when this moves.
  token_version          INTEGER NOT NULL DEFAULT 0,
  -- SHA-256 of a single-use activation token; the token itself is never stored.
  activation_token_hash  TEXT,
  activation_expires_at  TIMESTAMPTZ,
  failed_login_count     INTEGER NOT NULL DEFAULT 0,
  locked_until           TIMESTAMPTZ,
  last_login_at          TIMESTAMPTZ,
  invited_by             BIGINT REFERENCES console_admin_users (id) ON DELETE SET NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT console_admin_users_role_check
    CHECK (role IN ('owner', 'moderator', 'support', 'finance', 'analyst')),
  CONSTRAINT console_admin_users_status_check
    CHECK (status IN ('invited', 'active', 'disabled'))
);
CREATE UNIQUE INDEX IF NOT EXISTS console_admin_users_email_key ON console_admin_users (LOWER(email));
CREATE INDEX IF NOT EXISTS console_admin_users_activation_idx
  ON console_admin_users (activation_token_hash) WHERE activation_token_hash IS NOT NULL;

-- Append-only record of every mutating console action. `admin_user_id` is NULL
-- for an action taken under the legacy shared password; `actor_label` still
-- says so ("shared-password"), so no row ever reads as anonymous.
CREATE TABLE IF NOT EXISTS console_admin_audit_log (
  id             BIGSERIAL PRIMARY KEY,
  admin_user_id  BIGINT REFERENCES console_admin_users (id) ON DELETE SET NULL,
  actor_label    TEXT NOT NULL,
  action         TEXT NOT NULL,
  entity_type    TEXT,
  entity_id      TEXT,
  details        JSONB,
  ip             TEXT,
  user_agent     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS console_admin_audit_created_idx ON console_admin_audit_log (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS console_admin_audit_entity_idx ON console_admin_audit_log (entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS console_admin_audit_actor_idx ON console_admin_audit_log (admin_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS console_admin_audit_action_idx ON console_admin_audit_log (action, created_at DESC);

-- Login throttling: per account (failed_login_count/locked_until above) AND
-- per IP, so one address cannot walk through every email.
CREATE TABLE IF NOT EXISTS console_admin_login_attempts (
  id          BIGSERIAL PRIMARY KEY,
  email       TEXT,
  ip          TEXT,
  succeeded   BOOLEAN NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS console_admin_login_attempts_ip_idx ON console_admin_login_attempts (ip, created_at DESC);
CREATE INDEX IF NOT EXISTS console_admin_login_attempts_email_idx ON console_admin_login_attempts (LOWER(email), created_at DESC);

-- Internal notes on an agent, customer, listing or agency — the timeline on
-- their detail pages. Never shown to the person the note is about.
CREATE TABLE IF NOT EXISTS console_admin_notes (
  id             BIGSERIAL PRIMARY KEY,
  entity_type    TEXT NOT NULL,
  entity_id      TEXT NOT NULL,
  admin_user_id  BIGINT REFERENCES console_admin_users (id) ON DELETE SET NULL,
  actor_label    TEXT NOT NULL,
  body           TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT console_admin_notes_entity_check CHECK (entity_type IN ('agent', 'customer', 'listing', 'agency')),
  CONSTRAINT console_admin_notes_body_check CHECK (char_length(body) BETWEEN 1 AND 4000)
);
CREATE INDEX IF NOT EXISTS console_admin_notes_entity_idx ON console_admin_notes (entity_type, entity_id, created_at DESC);

-- A named filter set on one admin page, owned by one admin.
CREATE TABLE IF NOT EXISTS console_admin_saved_views (
  id             BIGSERIAL PRIMARY KEY,
  admin_user_id  BIGINT NOT NULL REFERENCES console_admin_users (id) ON DELETE CASCADE,
  path           TEXT NOT NULL,
  name           TEXT NOT NULL,
  query          TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT console_admin_saved_views_unique UNIQUE (admin_user_id, path, name)
);

-- Why a listing was rejected, and who decided. Before this a rejection carried
-- no reason at all and the agent was told only "needs adjustments".
ALTER TABLE properties ADD COLUMN IF NOT EXISTS moderation_reason_code TEXT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS moderation_note TEXT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS moderated_at TIMESTAMPTZ;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS moderated_by BIGINT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'properties_moderation_reason_code_check') THEN
    ALTER TABLE properties ADD CONSTRAINT properties_moderation_reason_code_check CHECK (
      moderation_reason_code IS NULL OR moderation_reason_code IN (
        'MISSING_INFO', 'BAD_PHOTOS', 'WRONG_PRICE', 'DUPLICATE', 'SUSPECTED_FRAUD', 'NOT_REAL_ESTATE', 'OTHER'
      )
    );
  END IF;
END $$;

-- Moderation queue: filter by approve_status, sort by age.
CREATE INDEX IF NOT EXISTS properties_approve_status_created_idx ON properties (approve_status, created_at);
CREATE INDEX IF NOT EXISTS properties_status_approve_idx ON properties (status, approve_status);
CREATE INDEX IF NOT EXISTS properties_agent_id_idx ON properties (agent_id);
CREATE INDEX IF NOT EXISTS properties_featured_image_idx ON properties (featured_image);
CREATE INDEX IF NOT EXISTS property_slider_images_property_idx ON property_slider_images (property_id);
CREATE INDEX IF NOT EXISTS property_slider_images_image_idx ON property_slider_images (image);
CREATE INDEX IF NOT EXISTS property_amenities_property_amenity_idx ON property_amenities (property_id, amenity_id);
CREATE INDEX IF NOT EXISTS property_contents_property_lang_idx ON property_contents (property_id, language_id);
-- Duplicate-listing flag: same title (case-insensitive) at the same price.
CREATE INDEX IF NOT EXISTS property_contents_title_lower_idx ON property_contents (LOWER(title));
CREATE INDEX IF NOT EXISTS agent_infos_agent_idx ON agent_infos (agent_id);
CREATE INDEX IF NOT EXISTS memberships_vendor_expire_idx ON memberships (vendor_id, expire_date);
CREATE INDEX IF NOT EXISTS agent_performance_logs_agent_idx ON agent_performance_logs (agent_id, lead_timestamp DESC);

-- Substring search ("%term%") that stays an index scan at 30k agents and
-- hundreds of thousands of listings. pg_trgm ships with Postgres and is
-- available on Supabase.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS agents_email_trgm_idx ON agents USING gin (email gin_trgm_ops);
CREATE INDEX IF NOT EXISTS agents_phone_trgm_idx ON agents USING gin (phone gin_trgm_ops);
CREATE INDEX IF NOT EXISTS agent_infos_first_name_trgm_idx ON agent_infos USING gin (first_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS agent_infos_last_name_trgm_idx ON agent_infos USING gin (last_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS vendors_username_trgm_idx ON vendors USING gin (username gin_trgm_ops);
CREATE INDEX IF NOT EXISTS customers_phone_trgm_idx ON customers USING gin (phone gin_trgm_ops);
CREATE INDEX IF NOT EXISTS customers_full_name_trgm_idx ON customers USING gin (full_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS property_contents_title_trgm_idx ON property_contents USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS properties_reference_trgm_idx ON properties USING gin (reference gin_trgm_ops);

COMMIT;
