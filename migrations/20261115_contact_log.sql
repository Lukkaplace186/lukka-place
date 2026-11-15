-- Contacts log (owner, 2026-11-15): /admin/contacts lists every customer →
-- agent contact. Since WhatsApp goes straight to the agent again (same day),
-- a tap is the only record of most contacts, so:
--
--   1. a tap by a SIGNED-IN customer keeps who they are (`customer_id`) on
--      whatsapp_clicks and listing_events (call taps). An anonymous visitor
--      stays anonymous: nothing is asked of them before WhatsApp opens.
--   2. agent_contact_taps holds the direct WhatsApp / call taps that are not
--      on a listing page — the agent profile, the agents directory, a project
--      page, the Espace Client's visit cards — which recorded nothing at all.
--      A table of its own: whatsapp_clicks is divided by listing views for
--      the conversion rate, and a profile tap has no listing.
--
-- No FK on customer_id / agent_id: a deleted account leaves the tap counted
-- (the console shows it as no longer known). Idempotent.

BEGIN;

ALTER TABLE whatsapp_clicks ADD COLUMN IF NOT EXISTS customer_id bigint;
ALTER TABLE listing_events ADD COLUMN IF NOT EXISTS customer_id bigint;

CREATE TABLE IF NOT EXISTS agent_contact_taps (
  id          bigserial   PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now(),
  agent_id    bigint      NOT NULL,
  channel     text        NOT NULL CHECK (channel IN ('whatsapp', 'call')),
  surface     text        NOT NULL CHECK (surface IN ('profile', 'directory', 'project', 'client_visit', 'client_inquiry')),
  listing_id  bigint,
  project_slug text       CHECK (project_slug IS NULL OR char_length(project_slug) <= 160),
  visitor_id  text        CHECK (visitor_id IS NULL OR char_length(visitor_id) <= 80),
  customer_id bigint,
  viewer_kind text,
  device      text
);

CREATE INDEX IF NOT EXISTS agent_contact_taps_created_idx ON agent_contact_taps (created_at);
CREATE INDEX IF NOT EXISTS agent_contact_taps_agent_created_idx ON agent_contact_taps (agent_id, created_at);
CREATE INDEX IF NOT EXISTS whatsapp_clicks_customer_idx ON whatsapp_clicks (customer_id) WHERE customer_id IS NOT NULL;

ALTER TABLE agent_contact_taps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON agent_contact_taps FROM anon, authenticated;
REVOKE ALL ON SEQUENCE agent_contact_taps_id_seq FROM anon, authenticated;

COMMIT;
