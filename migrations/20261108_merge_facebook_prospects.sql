-- One agent-prospect list (2026-11-08, owner: "when we paste, the asking price
-- goes into the median and the agent's information is collected on the table").
--
-- Run with:  node scripts/run-sql-migration.js migrations/20261108_merge_facebook_prospects.sql --write
--
-- DATA ONLY, IDEMPOTENT. Copies every number of the older Facebook list
-- (facebook_prospects, "Coller une publication", 2026-10-23) into
-- market_prospects, the list "Coller des annonces" fills together with the
-- price guide. From this migration on, every writer uses market_prospects:
-- the paste page, POST /api/ingest/facebook-lead, the engine's
-- import-market-observations.js. facebook_prospects is kept, unwritten, as
-- the record of what was there.
--
-- A number already in market_prospects is left exactly as the team has it
-- (ON CONFLICT DO NOTHING), so running this twice changes nothing.
--
-- Status: pending_invite → todo, invited → noanswer (an invitation went out,
-- no answer recorded), registered → signed, declined → declined.
-- adverts_count stays 0: it counts the PRICES saved for a prospect, and these
-- posts were never read for a price. How many posts the number was seen in
-- and its group go into the note instead, as facts from the old list.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.facebook_prospects') IS NULL OR to_regclass('public.market_prospects') IS NULL THEN
    RAISE NOTICE 'facebook_prospects or market_prospects missing — nothing to merge';
    RETURN;
  END IF;

  INSERT INTO market_prospects (phone, name, sources, first_url, adverts_count, status, notes, created_at, updated_at)
  SELECT fp.phone,
         NULLIF(left(btrim(fp.author_name), 120), ''),
         ARRAY['facebook'],
         fp.post_url,
         0,
         CASE fp.status
           WHEN 'pending_invite' THEN 'todo'
           WHEN 'invited'        THEN 'noanswer'
           WHEN 'registered'     THEN 'signed'
           WHEN 'declined'       THEN 'declined'
           ELSE 'todo'
         END,
         left(
           concat_ws(E'\n',
             'Ancienne liste « Coller une publication »'
               || CASE WHEN fp.status = 'invited' THEN ' : invitation envoyée' ELSE '' END || '.',
             CASE WHEN NULLIF(btrim(fp.group_name), '') IS NOT NULL THEN 'Groupe Facebook : ' || btrim(fp.group_name) END,
             'Vu dans ' || fp.seen_count || ' publication' || CASE WHEN fp.seen_count > 1 THEN 's' ELSE '' END
               || ' (dernière le ' || to_char(fp.last_seen_at AT TIME ZONE 'Africa/Kinshasa', 'DD/MM/YYYY') || ').'
           ),
           2000),
         fp.created_at,
         NOW()
    FROM facebook_prospects fp
   WHERE fp.phone ~ '^[0-9]{7,15}$'
  ON CONFLICT (phone) DO NOTHING;
END $$;

COMMIT;
