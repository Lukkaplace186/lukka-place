// Pull-to-refresh rules for the app (components/app/AppPullToRefresh.js),
// kept pure so the thresholds are tested without a touch screen.

/** How far the disc must come down before letting go refreshes (px). */
export const PULL_THRESHOLD = 72;
/** The disc never comes down further than this (px). */
export const PULL_MAX = 110;

// The screens a customer expects to refresh: the home, the results, saved,
// messages and the customer space. Not a listing (its bar and gallery own the
// gestures there), not the booking steps, not the agent dashboard's forms.
const REFRESH_PREFIXES = ['/listings', '/favoris', '/messages', '/compte/client'];

export function pullsToRefresh(pathname) {
  if (typeof pathname !== 'string') return false;
  if (pathname === '/') return true;
  if (/^\/listings\/[^/]+/.test(pathname)) return false;
  if (/^\/messages\/[^/]+/.test(pathname)) return false;
  return REFRESH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`) || pathname.startsWith(`${prefix}?`));
}

/**
 * What a finger movement means while a pull is being tracked.
 * Returns null when it is not a pull (the page has scrolled, the finger went
 * up, or the move is more sideways than down) — tracking stops; otherwise the
 * distance the disc shows, eased so it resists and capped at PULL_MAX.
 */
export function pullDecision({ dx = 0, dy = 0, scrollY = 0 } = {}) {
  if (scrollY > 0) return null;
  if (dy <= 0) return dy < -4 ? null : 0;
  if (Math.abs(dx) > dy * 0.7 && Math.abs(dx) > 8) return null;
  return Math.min(PULL_MAX, Math.round(dy * 0.5));
}
