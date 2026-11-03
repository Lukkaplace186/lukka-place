-- How each referral programme announcement went out (web/lib/referralAnnouncement.js,
-- engine services/referralAnnounce.js). Idempotent.
--
-- channel: 'session' (plain text from the console button), 'template' (the approved
--   REFERRAL_ANNOUNCEMENT_TEMPLATE), 'on_write' (plain text sent while the agent had just
--   written to us). NULL on rows written before this column = 'session'.
-- resent_at: set the one time an earlier announcement is sent again (by the template, or
--   when the agent writes in and the first one provably could not have landed). A row with
--   it set is never sent again.

BEGIN;

ALTER TABLE partner_program_announcements ADD COLUMN IF NOT EXISTS channel text;
ALTER TABLE partner_program_announcements ADD COLUMN IF NOT EXISTS resent_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'partner_program_announcements_channel_check') THEN
    ALTER TABLE partner_program_announcements
      ADD CONSTRAINT partner_program_announcements_channel_check
      CHECK (channel IS NULL OR channel IN ('session', 'template', 'on_write'));
  END IF;
END $$;

COMMIT;
