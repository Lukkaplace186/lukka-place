/**
 * The query string a page view landed with, as stored in `page_views.query`
 * (2026-11-21, migrations/20261121_page_views_query.sql in the engine repo).
 *
 * Why: `page_views.path` drops the query, so a Facebook ad landing on
 * `/listings?ville=toutes&transaction_type=location` and a visitor typing
 * `/listings` were the same row — nobody could see which filtered page an ad
 * actually opened.
 *
 * Pure and shared: the browser cleans before sending (components/
 * SitePageViewTracker.js, ListingViewTracker.js) and the server cleans again
 * (lib/trackIngest.js recordPageView), because a beacon body is a claim.
 *
 * WHITELIST, never a blacklist: only /listings search filters
 * (lib/searchQuery.js) and campaign tags are kept. Anything else — a phone,
 * a name, a token, an OTP or activation code, a free-text search (`q`), a
 * click id, the map's own coordinates (`near`, bounds) — is dropped, because
 * a key we never thought about is a key that may carry personal data.
 */

export const LANDING_QUERY_KEYS = Object.freeze([
  // lib/searchQuery.js filters
  'transaction_type', 'property_type', 'parcelle_subtype', 'ville', 'commune', 'communes', 'quartier',
  'radius', 'price_min', 'price_max', 'beds_min', 'beds_max', 'bath_min', 'deposit_max', 'deposit_range',
  'lease_term', 'plot_min', 'plot_max', 'amenities', 'sort',
  // campaign tags
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id',
]);

const KEY_SET = new Set(LANDING_QUERY_KEYS);

/** Longest value kept per key, and longest stored string. */
export const LANDING_VALUE_MAX = 80;
export const LANDING_QUERY_MAX = 400;

// A run of 7+ digits is phone-shaped (wa_id is 7–15 digits): never stored,
// even under a whitelisted key (utm_content=243812345678 is not a filter).
const PHONE_SHAPED = /\d[\d\s.+-]{5,}\d/;

/**
 * @param {string|URLSearchParams|null|undefined} search `?a=b`, `a=b` or a full URL.
 * @returns {string|null} `key=value&…` in the order received, or null when nothing is kept.
 */
export function cleanLandingQuery(search) {
  let params;
  try {
    if (search instanceof URLSearchParams) params = search;
    else {
      const text = String(search ?? '');
      const at = text.indexOf('?');
      const raw = (at >= 0 ? text.slice(at + 1) : text).split('#')[0];
      if (!raw) return null;
      params = new URLSearchParams(raw);
    }
  } catch {
    return null;
  }

  const kept = new URLSearchParams();
  const seen = new Set();
  for (const [key, value] of params) {
    if (!KEY_SET.has(key) || seen.has(key)) continue;
    const v = String(value).trim();
    if (!v || v.length > LANDING_VALUE_MAX || PHONE_SHAPED.test(v)) continue;
    seen.add(key);
    kept.append(key, v);
  }
  let out = kept.toString();
  if (!out) return null;
  while (out.length > LANDING_QUERY_MAX) {
    // Drop whole pairs from the end rather than cutting a value in half.
    const cut = out.lastIndexOf('&');
    if (cut <= 0) return null;
    out = out.slice(0, cut);
  }
  return out;
}
