/**
 * App mode (2026-11-11): the site knows it is inside the Lukka Place store
 * app and draws an app layout — a bottom tab bar instead of the footer.
 *
 * Two signals, either is enough:
 * - the `lp_app` cookie, set by GET /app (where the app always starts,
 *   mobile/capacitor.config.json `server.url`). It also lets a browser preview
 *   the app: open /app once. /app?web=1 removes it.
 * - the user agent mark the app appends (`appendUserAgent` in the same
 *   config), from the build that carries it — survives a cleared cookie.
 *
 * Pure: no Next imports, shared by lib/appMode.js, app/app/route.js and the tests.
 */

export const APP_MODE_COOKIE = 'lp_app';
export const APP_USER_AGENT_MARK = 'LukkaPlaceApp';
export const APP_MODE_MAX_AGE = 365 * 24 * 60 * 60;

export function isAppUserAgent(userAgent) {
  return typeof userAgent === 'string' && userAgent.includes(APP_USER_AGENT_MARK);
}

export function isAppMode({ cookieValue, userAgent } = {}) {
  return cookieValue === '1' || isAppUserAgent(userAgent);
}

/**
 * The tab bar's three tabs (the app design, 2026-11-11: Search, Saved,
 * Account; notifications are the bell in the top bar), as French paths —
 * localizeHref turns them into the reader's language. Keys, not text: see
 * components/navItems.js.
 */
export const APP_TABS = [
  { key: 'search', href: '/', labelKey: 'appShell.tabs.search' },
  { key: 'saved', href: '/favoris', labelKey: 'appShell.tabs.saved' },
  { key: 'account', href: '/compte/menu', labelKey: 'appShell.tabs.account' },
];

/** The account menu (app/(site)/compte/menu): public, it offers sign-in when signed out. */
export const APP_ACCOUNT_PATH = '/compte/menu';

/** Which tab a (French) path belongs to, or null. */
export function activeAppTab(pathname) {
  const path = String(pathname || '/').split(/[?#]/)[0];
  if (path === '/' || path === '/listings' || path.startsWith('/listings/')) return 'search';
  if (path === '/favoris' || path.startsWith('/compte/client/favoris') || path.startsWith('/compte/client/alertes')) return 'saved';
  if (path.startsWith('/compte')) return 'account';
  return null;
}

/**
 * A listing's own page has its own bottom bar (MobileListingBar: contact,
 * visit), so the tabs step aside there, as in most apps' detail screens.
 */
export function hidesAppTabs(pathname) {
  const path = String(pathname || '').split(/[?#]/)[0];
  return /^\/listings\/[^/]+/.test(path);
}
