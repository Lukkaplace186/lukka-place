/**
 * Kinshasa utility tags — the fixed codes for what decides whether a place is
 * livable here: SNEL power (and its backups), water, security and access.
 *
 * Stored as `properties.utilities` (text[]) and SQLite `listings.utilities`
 * (JSON text). Set by the extraction (services/openai.js — only what the
 * agent's own message states), by the agent's editor, and by
 * scripts/backfill-listing-utilities.js. The storefront shows them as
 * "Déclaré par l'agent", never "vérifié".
 *
 * DUPLICATED in web/lib/utilityTags.js (this engine is CommonJS, outside the
 * app's module graph) — change one, change the other; the web test compares
 * the two lists.
 */

const UTILITY_CODES = Object.freeze([
  'snel_stable',
  'groupe',
  'solaire',
  'regideso',
  'citerne',
  'forage',
  'gardiennage',
  'cloture',
  'route_asphaltee',
  'acces_facile',
]);

/** Known codes only, each once, in UTILITY_CODES order. Anything else is dropped. */
function normaliseUtilities(value) {
  const list = Array.isArray(value) ? value : [];
  const wanted = new Set(list.map((code) => String(code || '').trim().toLowerCase()));
  return UTILITY_CODES.filter((code) => wanted.has(code));
}

module.exports = { UTILITY_CODES, normaliseUtilities };
