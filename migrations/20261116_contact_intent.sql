-- What the customer wants when they tap WhatsApp (owner, 2026-11-16: "we want
-- to know if the customer is simply enquiring or requested an appointment").
--
-- WhatsApp goes straight to the agent, so the tap is the only moment we see.
-- The storefront now asks before WhatsApp opens — visit, "toujours
-- disponible ?", or another question (web components/WhatsAppIntentSheet.js)
-- — and pre-types the matching message. The answer is kept on the tap.
--
--   whatsapp_clicks.intent  'visit' | 'availability' | 'question', NULL when
--                           not asked (taps before this, the chooser off).
--
-- Never inferred. The CHECK keeps the vocabulary closed; web validates the
-- same list (lib/whatsappIntent.js) and, before this runs, keeps the tap
-- without it (lib/leadClicks.js retries on 42703). Idempotent.

BEGIN;

ALTER TABLE whatsapp_clicks ADD COLUMN IF NOT EXISTS intent text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_clicks_intent_check'
  ) THEN
    ALTER TABLE whatsapp_clicks
      ADD CONSTRAINT whatsapp_clicks_intent_check
      CHECK (intent IS NULL OR intent IN ('visit', 'availability', 'question'));
  END IF;
END $$;

COMMIT;
