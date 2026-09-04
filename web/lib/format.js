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
/**
 * What every price formatter here renders when there is no real figure to
 * show. The standard French property-listing phrase for exactly this, so it
 * reads as an intentional state rather than a broken one.
 *
 * Before this existed, `Number(price).toLocaleString()` ran unguarded and the
 * two bad inputs failed differently — the quieter one being much worse:
 *   Number(undefined) === NaN -> "NaN $"  visibly broken
 *   Number(null)      === 0   -> "0 $"    reads as free
 * `properties.price` is nullable and one live listing is genuinely priced 0,
 * so both were reachable, and both propagated into the WhatsApp share text
 * via lib/whatsapp.js.
 */
export const PRICE_ON_REQUEST = 'Prix sur demande';

/**
 * A price is renderable only when it is a real, finite, positive number.
 *
 * Zero is deliberately excluded: no listing on this site is free, so a 0 is
 * always missing data wearing a number's clothes.
 */
export function usablePrice(price) {
  if (price === null || price === undefined || price === '') return null;
  const amount = Number(price);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

export function formatPrice(price, purpose, pricePeriod) {
  const usable = usablePrice(price);
  if (usable === null) return PRICE_ON_REQUEST;
  const amount = usable.toLocaleString('fr-FR');
  if (purpose !== 'rent') return `${amount} $`;
  return pricePeriod === 'an' ? `${amount} $ / an` : `${amount} $ / mois`;
}

/**
 * The same suffix logic as formatPrice above, for a price genuinely stored
 * in francs congolais (`properties.currency = 'CDF'`, with the authored
 * figure in `price_original`).
 *
 * Deliberately separate from formatPrice rather than a `currency` parameter
 * bolted onto it: formatPrice has ~20 call sites that all mean "the
 * canonical USD price", and every one of them should keep meaning exactly
 * that. This is for the one case where the number being rendered is the
 * agent's own authored FC figure — which is exact, not a conversion, and so
 * is never marked with the "≈" that a converted estimate carries.
 *
 * Full digits, not formatCdfCompact: compact notation is reserved for
 * *converted* estimates (see that function's own note). An authored price is
 * a real figure someone may need to read exactly.
 */
export function formatPriceCdf(price, purpose, pricePeriod) {
  const usable = usablePrice(price);
  if (usable === null) return PRICE_ON_REQUEST;
  const amount = usable.toLocaleString('fr-FR');
  if (purpose !== 'rent') return `${amount} FC`;
  return pricePeriod === 'an' ? `${amount} FC / an` : `${amount} FC / mois`;
}

/** USD amount for a price authored in CDF, at the given dated rate. */
export function convertCdfToUsd(cdfAmount, cdfPerUsd) {
  // `Number.isFinite(Number(null))` is true — Number(null) is 0 — so the
  // original guard let a null amount through and returned 0 rather than
  // null, converting an unknown price into a free one. usablePrice() rejects
  // null/''/0 before the arithmetic.
  const amount = usablePrice(cdfAmount);
  const rate = Number(cdfPerUsd);
  if (amount === null || !Number.isFinite(rate) || rate <= 0) return null;
  return Math.round((amount / rate) * 100) / 100;
}

// Real Intl compact notation, not a hand-rolled "/1000 + k" — French uses a
// comma decimal separator and a space before the unit ("916,8 k"), which
// Intl gets right for free. Only ever applied to a *converted* CDF amount
// (Price.js, PropertyMap's InfoWindow) — never to the exchange rate itself
// (PricePanel.js, CurrencyBridge.js, parametres/page.js all print "1 USD =
// 2 292 FC" in full): a rate is a single reference figure someone might
// want to read exactly, not a price a visitor scans down a list of.
const CDF_COMPACT_FORMATTER = new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 });

export function formatCdfCompact(cdf) {
  const amount = Number(cdf);
  return Number.isFinite(amount) ? CDF_COMPACT_FORMATTER.format(amount) : null;
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
