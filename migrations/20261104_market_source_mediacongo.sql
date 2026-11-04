-- MediaCongo joins the collected market sources (2026-11-04, owner request).
-- services/marketSources/mediacongo.js. Only the source CHECK changes;
-- re-runnable: the constraint is dropped and re-added with the full list.
BEGIN;
ALTER TABLE market_observations DROP CONSTRAINT IF EXISTS market_observations_source_check;
ALTER TABLE market_observations ADD CONSTRAINT market_observations_source_check CHECK (source IN (
  'whatsapp_group', 'immo24', 'imcongo', 'alain_realty', 'smartimmo', 'mediacongo',
  'facebook', 'zwandako', 'other'
));
COMMIT;
