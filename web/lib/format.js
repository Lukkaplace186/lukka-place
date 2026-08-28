// Canonical price formatter — was copy-pasted identically across
// ListingCard.js, ListingCardVertical.js, FeaturedListingCard.js, and
// PropertyMap.js's InfoWindow. Consolidated here so lib/whatsapp.js can
// reuse the exact same real-price text the visitor already sees on the
// card/detail page, instead of a second, possibly-drifting implementation.
//
// `pricePeriod` (real data, once a listing has it — see
// services/db.js/openai.js in the engine repo, 'mois'|'an'|'total'|null)
// is optional and only refines a `rent`-purpose listing's suffix: absent,
// it defaults to the previous "/ mois" assumption (every rent listing
// synced before this field existed); 'an' renders "/ an" instead; 'total'
// or 'mois' both render the existing "/ mois" text (a one-time total rent
// figure is still effectively described the same way here).
export function formatPrice(price, purpose, pricePeriod) {
  const amount = Number(price).toLocaleString('fr-FR');
  if (purpose !== 'rent') return `${amount} $`;
  return pricePeriod === 'an' ? `${amount} $ / an` : `${amount} $ / mois`;
}

const RELATIVE_FR = new Intl.RelativeTimeFormat('fr-FR', { numeric: 'auto' });
const RELATIVE_STEPS = [
  { unit: 'year', ms: 365 * 24 * 60 * 60 * 1000 },
  { unit: 'month', ms: 30 * 24 * 60 * 60 * 1000 },
  { unit: 'day', ms: 24 * 60 * 60 * 1000 },
  { unit: 'hour', ms: 60 * 60 * 1000 },
  { unit: 'minute', ms: 60 * 1000 },
];

/**
 * "il y a 2 h" / "hier" — the design's own relative-time phrasing for lead
 * rows, computed from the real timestamp rather than stored as prose.
 *
 * The engine's SQLite timestamps come back as `YYYY-MM-DD HH:MM:SS` in UTC
 * with no zone marker, which `new Date()` would otherwise read as *local*
 * time — an hours-wide error that reads as "dans 2 heures" for a lead that
 * just arrived. The `.replace(' ', 'T') + 'Z'` normalisation below is what
 * every other lead-rendering call site in this app already does; it lives
 * here now so there is one copy of it.
 */
export function formatRelativeFr(value) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(`${String(value).replace(' ', 'T')}Z`);
  if (Number.isNaN(date.getTime())) return '—';

  const diff = date.getTime() - Date.now();
  const abs = Math.abs(diff);
  for (const { unit, ms } of RELATIVE_STEPS) {
    if (abs >= ms) return RELATIVE_FR.format(Math.round(diff / ms), unit);
  }
  return "à l'instant";
}
