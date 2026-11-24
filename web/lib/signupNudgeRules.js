/**
 * When the storefront suggests creating an account (growth plan item 24).
 * Pure; components/SignupNudge.js applies it.
 *
 *  - a second saved listing (favourites live in this browser until signup),
 *  - a first listing opened ("Récemment consultés" holds them),
 *  - a search with no exact result.
 *
 * At most once per tab session, never for a signed-in customer or agent, and
 * never on the pages where a phone's bottom edge is already taken (a listing
 * page's contact bar, the map) or where signing up is already the subject.
 */

import { feedAlertReady, isNotACriterion } from './feedAlertRules';

export const NUDGE_EVENT = 'lp:nudge';
export const NUDGE_SESSION_KEY = 'lp_nudge_shown';

export const NUDGE_REASONS = ['favorites', 'listing_viewed', 'no_results'];

export const FAVORITES_THRESHOLD = 2;
// 1 since 2026-11-24 (2 that morning, 3 before): 81 % of visitors see one
// page, so a third listing opened was a moment almost nobody reached. The
// listing page itself stays quiet; the next page after it shows the card.
export const VIEWED_THRESHOLD = 1;

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
 * Where signing in from the card lands, and whether it saves an alert
 * (2026-11-24: the card promises "les nouveaux biens sur WhatsApp", so on a
 * results page that names a commune — or another city — signing in saves that
 * search as an alert, via SaveSearchButton's `lkp_auth_return=alert` resume,
 * as the "Créer une alerte" button does). Elsewhere: back to the page.
 *
 * @param {string} pathname
 * @param {string} search the page's `location.search`
 * @returns {{next: string, alert: boolean}}
 */
export function nudgeNext(pathname, search = '') {
  const path = String(pathname || '/') || '/';
  const params = new URLSearchParams(String(search || ''));
  const criteria = {};
  for (const [key, value] of params) {
    if (!isNotACriterion(key)) criteria[key] = value;
  }
  if (path === '/listings' && feedAlertReady(criteria)) {
    params.set('lkp_auth_return', 'alert');
    return { next: `${path}?${params.toString()}`, alert: true };
  }
  const query = params.toString();
  return { next: query ? `${path}?${query}` : path, alert: false };
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
