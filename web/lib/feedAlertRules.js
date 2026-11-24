/**
 * The alert card inside the /listings feed (components/FeedAlertCard.js,
 * 2026-11-24). Pure: which search the alert saves, whether it still needs a
 * commune, and where the card sits.
 *
 * Why it exists: 76 % of visitors land on /listings from an ad and 81 % see
 * one page; the nudge card waits for a third listing opened, so almost none
 * of them were ever offered an account (sign-up baseline of 2026-11-24).
 */

/** Params that say how the page was reached or laid out, never what is searched. */
const NOT_A_CRITERION = /^(page|view|cursor|sort|ref|entree|fbclid|gclid|ttclid|msclkid|utm_.+|lkp_.+)$/;

/** Whether a /listings param is plumbing (paging, ad tags, resume markers), not a search criterion. */
export function isNotACriterion(key) {
  return NOT_A_CRITERION.test(String(key));
}

/**
 * The search the alert saves: the URL's criteria without paging, sort, ad
 * tags or internal markers, so the alert is the search and not the visit.
 *
 * @param {Record<string, string|string[]>} params the page's searchParams
 * @returns {string}
 */
export function feedAlertQuery(params = {}) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (NOT_A_CRITERION.test(key)) continue;
    for (const v of Array.isArray(value) ? value : [value]) {
      if (typeof v === 'string' && v.trim() !== '') qs.append(key, v.trim());
    }
  }
  return qs.toString();
}

/** Kinshasa is the default city; `toutes` is every city. */
function cityOf(params) {
  const raw = Array.isArray(params?.ville) ? params.ville[0] : params?.ville;
  const city = String(raw || '').trim().toLowerCase();
  return city || 'kinshasa';
}

/**
 * Whether the search is narrow enough to be an alert as it stands. Every
 * rental of Kinshasa is the feed itself, not an alert (lib/homeAlert.js says
 * the same): without a commune or a quartier, the card asks for a commune
 * first. Another city than Kinshasa is narrow enough on its own.
 */
export function feedAlertReady(params = {}) {
  const has = (key) => {
    const v = Array.isArray(params[key]) ? params[key][0] : params[key];
    return typeof v === 'string' && v.trim() !== '';
  };
  if (has('commune') || has('quartier')) return true;
  const city = cityOf(params);
  return city !== 'kinshasa' && city !== 'toutes';
}

/** Whether the card can offer Kinshasa's communes (it cannot elsewhere). */
export function feedAlertOffersCommunes(params = {}) {
  const city = cityOf(params);
  return city === 'kinshasa' || city === 'toutes';
}

/** The card follows the 3rd result, or the last of a shorter first page. */
export const FEED_ALERT_AFTER = 3;
export function feedAlertIndex(firstPageCount) {
  const n = Number(firstPageCount) || 0;
  if (n <= 0) return -1;
  return Math.min(FEED_ALERT_AFTER, n) - 1;
}
