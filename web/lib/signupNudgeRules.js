/**
 * When the storefront suggests creating an account (growth plan item 24).
 * Pure; components/SignupNudge.js applies it.
 *
 *  - a second saved listing (favourites live in this browser until signup),
 *  - a second listing opened ("Récemment consultés" holds them),
 *  - a search with no exact result.
 *
 * At most once per tab session, never for a signed-in customer or agent, and
 * never on the pages where a phone's bottom edge is already taken (a listing
 * page's contact bar, the map) or where signing up is already the subject.
 */

export const NUDGE_EVENT = 'lp:nudge';
export const NUDGE_SESSION_KEY = 'lp_nudge_shown';
export const NUDGE_REASONS = ['favorites', 'listing_viewed', 'no_results'];

export const FAVORITES_THRESHOLD = 2;
// 2 since 2026-11-24 (3 until then): 81 % of visitors see one page, so a
// third listing opened was a moment almost nobody reached.
export const VIEWED_THRESHOLD = 2;

const QUIET_PREFIXES = ['/compte', '/i/', '/go/', '/admin', '/rapport'];

/** Whether this page may show the prompt at all. */
export function nudgeAllowedOn(pathname, search = '') {
  const path = String(pathname || '');
  if (QUIET_PREFIXES.some((prefix) => path.startsWith(prefix))) return false;
  if (/^\/listings\/\d+/.test(path)) return false;
  if (/(^|[?&])view=map(&|$)/.test(String(search || ''))) return false;
  return true;
}

/**
 * @param {{reason: string, favorites: number, viewed: number}} signal
 * @returns {boolean}
 */
export function shouldNudge({ reason, favorites = 0, viewed = 0 }) {
  if (reason === 'favorites') return favorites >= FAVORITES_THRESHOLD;
  if (reason === 'listing_viewed') return viewed >= VIEWED_THRESHOLD;
  return reason === 'no_results';
}
