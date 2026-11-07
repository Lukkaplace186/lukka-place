-- "Mon déménagement": where a move stands, and how it ended (2026-11-07).
--
-- Run with:  node scripts/run-sql-migration.js migrations/20261107_move_project_journey.sql --write
--
-- ADDITIVE AND IDEMPOTENT. Set only by the customer's own taps (web
-- app/(site)/compte/client/projet/actions.js), never guessed:
--   status          'active' | 'paused' | 'found' ("C'est le bon !")
--   found_at        when they said they found their home
--   paused_at       when they paused the search
--   settled_at      when they answered the "Bien installés ?" check-in (30 days after found_at)
--   settled_answer  'settled' | 'not_yet'
--   story_text      their own words, optional
--   story_consent_at  set only if they ticked "J'accepte que Lukka Place partage
--                   mon histoire"; without it the story is never used outside the account
-- Web reads every one of these as NULL until this runs.

BEGIN;

ALTER TABLE customer_move_projects ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
ALTER TABLE customer_move_projects ADD COLUMN IF NOT EXISTS found_at timestamptz;
ALTER TABLE customer_move_projects ADD COLUMN IF NOT EXISTS paused_at timestamptz;
ALTER TABLE customer_move_projects ADD COLUMN IF NOT EXISTS settled_at timestamptz;
ALTER TABLE customer_move_projects ADD COLUMN IF NOT EXISTS settled_answer text;
ALTER TABLE customer_move_projects ADD COLUMN IF NOT EXISTS story_text text;
ALTER TABLE customer_move_projects ADD COLUMN IF NOT EXISTS story_consent_at timestamptz;

COMMIT;
