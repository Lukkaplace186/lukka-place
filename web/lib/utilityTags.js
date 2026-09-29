/**
 * Kinshasa utility tags — power, water, security, access — the four things a
 * Kinshasa tenant asks before anything else. Pure; shared by the server
 * (lib/listings.js filters, the listing page) and the browser (filter chips,
 * the agent editor).
 *
 * `properties.utilities` (text[], migrations/20260929_listing_utilities.sql)
 * holds the codes the agent stated — from the WhatsApp extraction, the agent's
 * editor, or the backfill. Shown to visitors as "Déclaré par l'agent", never
 * "vérifié" (that word belongs to verified_at).
 *
 * UTILITY_CODES is DUPLICATED in the engine's services/utilities.js and in the
 * migration's CHECK — change all three together (tests/unit/utility-tags.test.js
 * compares them).
 */

export const UTILITY_CODES = Object.freeze([
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

/**
 * The four filter chips. A listing matches a chip when its structured codes
 * include ANY of `codes`, OR — for the many listings nobody has tagged yet —
 * its title/description matches ANY of `keywords` (the same word-boundary
 * match as the "Plus de filtres" amenities). Keys ride in the existing
 * `amenities` URL param, so saved searches, alerts, labels, the map and
 * search_events carry them with no new plumbing.
 */
export const UTILITY_FILTERS = Object.freeze({
  electricite: {
    labelKey: 'listings.utilityFilters.electricite',
    icon: 'zap',
    codes: ['snel_stable', 'groupe', 'solaire'],
    keywords: ['snel', 'courant 24', 'courant stable', 'électricité 24', 'electricite 24', 'départ unique', 'depart unique',
      'groupe électrogène', 'groupe electrogene', 'générateur', 'generateur', 'panneau solaire', 'panneaux solaires', 'onduleur', 'inverseur'],
  },
  eau: {
    labelKey: 'listings.utilityFilters.eau',
    icon: 'droplets',
    codes: ['regideso', 'citerne', 'forage'],
    keywords: ['regideso', 'eau courante', 'eau 24', 'eau 5/5', 'citerne', 'forage', 'puits', 'réservoir', 'reservoir'],
  },
  securite: {
    labelKey: 'listings.utilityFilters.securite',
    icon: 'shield',
    codes: ['gardiennage', 'cloture'],
    keywords: ['gardien', 'gardiennage', 'sentinelle', 'clôture', 'cloture', 'clôturé', 'cloture', 'sécurisé', 'securise'],
  },
  acces: {
    labelKey: 'listings.utilityFilters.acces',
    icon: 'route',
    codes: ['route_asphaltee', 'acces_facile'],
    keywords: ['route asphaltée', 'route asphaltee', 'asphalté', 'asphalte', 'bitumé', 'bitume', 'goudronné', 'goudronne',
      'accès facile', 'acces facile', 'bord de la route'],
  },
});

export const UTILITY_FILTER_KEYS = Object.freeze(Object.keys(UTILITY_FILTERS));

/** Which chip a code belongs to. */
export function utilityGroupOf(code) {
  return UTILITY_FILTER_KEYS.find((key) => UTILITY_FILTERS[key].codes.includes(code)) || null;
}

/** Known codes only, each once, in UTILITY_CODES order. */
export function normaliseUtilities(value) {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  const wanted = new Set(list.map((code) => String(code || '').trim().toLowerCase()));
  return UTILITY_CODES.filter((code) => wanted.has(code));
}

/** i18n key for one code's label. */
export const utilityLabelKey = (code) => `listings.utilities.${code}`;
