-- Reverse phone verification ("Vérifier via WhatsApp").
--
-- The verify screen shows a 6-digit code and a wa.me link that sends it FROM
-- the person's own WhatsApp TO the Lukka Place number. The engine
-- (services/phoneChallenges.js) marks the challenge verified when a message
-- carrying that code arrives from that exact number; web then runs the same
-- consumeAgentOtp / consumeCustomerOtp a typed code would.
--
-- Why: outbound OTP needs an approved Meta template, which does not exist,
-- and AUTH_OTP_BYPASS skipped proof entirely — anyone could register an
-- agency's number and claim its WhatsApp listings. An inbound message needs no
-- template, and only the holder of the number can send it.
--
-- `code` is stored in clear: its secrecy is not what protects anything (the
-- person verifying sees it on screen); what matters is WHICH number sends it.
-- It binds the message to this attempt, so an agent's ordinary messages can
-- never verify an account someone else opened on their number.
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS phone_verification_challenges (
  id bigserial PRIMARY KEY,
  role text NOT NULL CHECK (role IN ('agent', 'customer')),
  account_id bigint NOT NULL,
  phone text NOT NULL,
  code text NOT NULL CHECK (code ~ '^[0-9]{6}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  verified_at timestamptz,
  consumed_at timestamptz
);

CREATE INDEX IF NOT EXISTS phone_verification_challenges_lookup
  ON phone_verification_challenges (phone, code);
CREATE INDEX IF NOT EXISTS phone_verification_challenges_account
  ON phone_verification_challenges (role, account_id, created_at DESC);

DO $$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON phone_verification_challenges FROM %I', role_name);
    END IF;
  END LOOP;
END $$;
