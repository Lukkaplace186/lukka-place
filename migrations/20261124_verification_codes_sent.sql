-- Every verification code the website sends, readable by the team for a short
-- while (owner, 2026-11-24: "add the codes" to an admin page — when a code
-- does not arrive, support can read it out to the customer or agent).
--
-- Chakra confirms no delivery, so a WhatsApp code can be "sent" and never
-- reach the phone. The website's one sending point (web lib/otpDelivery.js)
-- writes a row per send; /admin/codes (owner, support) shows the last hour.
--
--   phone    digits-only wa_id the code went to
--   code     the 6-digit code in clear — only the hash is on the account
--   purpose  the sender's label: customer-auth, agent-auth, reset-password,
--            phone-change
--   status   'sent' (Chakra accepted it) | 'failed' (both channels refused)
--   channel  'template' | 'session' | NULL when failed
--
-- Rows older than 24 h are deleted by the writer itself, so codes do not pile
-- up in clear. RLS on with no policy and anon/authenticated revoked: nothing
-- reads this but the console. The web code checks to_regclass first, so it
-- runs (and simply records nothing) before this migration. Idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS verification_codes_sent (
  id bigserial PRIMARY KEY,
  phone text NOT NULL,
  code text NOT NULL,
  purpose text NOT NULL,
  status text NOT NULL,
  channel text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'verification_codes_sent_status_check') THEN
    ALTER TABLE verification_codes_sent
      ADD CONSTRAINT verification_codes_sent_status_check CHECK (status IN ('sent', 'failed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS verification_codes_sent_created_idx ON verification_codes_sent (created_at DESC);

ALTER TABLE verification_codes_sent ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON verification_codes_sent FROM anon, authenticated;
REVOKE ALL ON SEQUENCE verification_codes_sent_id_seq FROM anon, authenticated;

COMMIT;
