/**
 * Edge caching of anonymous public HTML (2026-11-21) — the decision, pure, so
 * middleware.js applies it and tests/unit/edge-cache.test.js pins it.
 *
 * Every public page is rendered per request (the locale cookie makes every
 * route dynamic), and was sent `private, no-store`, so Cloudflare fetched each
 * one from Paris: ~330 ms of round trip from Kinshasa before the first byte,
 * on top of the render. A page rendered for a visitor with no account, no
 * staff/demo/"view as" session and the default language is the same for
 * every such visitor, so Cloudflare may keep it for a minute.
 *
 * WHO MAY BE CACHED — only a request that is ALL of:
 *   - GET or HEAD, for a path in CACHEABLE_PATH (home, search, a listing,
 *     the /location and /vente landing pages, /combien-coute, /guides);
 *   - a document request, not a React Server Components fetch (an `rsc`,
 *     `next-router-*`, `next-url` or `next-action` header, or `_rsc=` in the
 *     query — those vary on headers Cloudflare does not key on);
 *   - free of every cookie that changes what the server renders: any
 *     `lukka_*` cookie (customer / agent / admin sessions and their
 *     signed-in flags, "view as", demo), `lp_staff`, and a NEXT_LOCALE other
 *     than French (English renders English under the same URL);
 *   - not from the Lukka Place store app: no `lp_app` cookie and no
 *     "LukkaPlaceApp" in the user agent (lib/appModeRules.js on the app
 *     branch: the app gets its own top bar and tab bar under the same URL);
 *   - without the `x-lukka-url-locale` header (middleware sets it on /en/…
 *     rewrites, which are never cached; a client sending it on a French URL
 *     gets English for itself, uncached — it cannot poison the French page).
 * Anything else stays `private, no-store`, as before.
 *
 * WHAT THE PERSONALISED PAGES READ (checked 2026-11-21): the home page's
 * "Biens enregistrés" shelf (lib/savedHome.js, customer session), the listing
 * page's ProjectFitLine (customer session), DemoBanner / ImpersonationBanner
 * (their cookies) and the locale. Signed-in state in the header, favourites,
 * the visit cart and currency are read in the browser, after load.
 * A NEW SERVER-SIDE READ OF A COOKIE OR HEADER ON THESE ROUTES MUST BE ADDED
 * HERE (or be a `lukka_*` cookie) — otherwise one visitor's page is served to
 * the next. Name any new personal cookie `lukka_…`: the Cloudflare rule
 * bypasses on that prefix.
 *
 * The browser still revalidates every time (`max-age=0, must-revalidate`):
 * only Cloudflare keeps the page, through CDN-Cache-Control, which browsers
 * ignore. A browser-side stale-while-revalidate would show a visitor who just
 * signed in the anonymous page they had before.
 */

export const CACHEABLE_PATH = /^\/(?:listings(?:\/[^/]+)?|location(?:\/.*)?|vente(?:\/.*)?|combien-coute(?:\/.*)?|guides(?:\/.*)?)?$/;

export const EDGE_CACHE_SECONDS = 60;
export const EDGE_STALE_SECONDS = 300;

/** What Cloudflare reads (RFC 9213 targeted field); browsers ignore it. */
export const CDN_CACHE_CONTROL = `public, max-age=${EDGE_CACHE_SECONDS}, stale-while-revalidate=${EDGE_STALE_SECONDS}`;
/** What the browser reads: keep nothing without asking. */
export const BROWSER_CACHE_CONTROL = 'public, max-age=0, must-revalidate';

/** Headers of a client-side navigation or prefetch, never a document. */
const RSC_HEADERS = ['rsc', 'next-router-prefetch', 'next-router-state-tree', 'next-router-segment-prefetch', 'next-url', 'next-action', 'x-middleware-prefetch'];

/**
 * The app's two markers (lib/appModeRules.js, APP_MODE_COOKIE and
 * APP_USER_AGENT_MARK, on the app branch production runs). Written out here
 * because this module must also build without that file. Keep them equal.
 */
export const APP_MODE_COOKIE_NAME = 'lp_app';
export const APP_USER_AGENT_MARK = 'LukkaPlaceApp';

/** The locale header middleware sets on /en/… rewrites (lib/i18n/urlLocale.js). */
export const URL_LOCALE_REQUEST_HEADER = 'x-lukka-url-locale';

/**
 * Whether one cookie (name, value) changes what the server renders.
 * Mirrored by the Cloudflare rule in web/CLAUDE.md ("Edge caching").
 */
export function isPersonalCookie(name, value) {
  if (!name) return false;
  if (name.startsWith('lukka_')) return true;
  if (name === 'lp_staff') return true;
  if (name === APP_MODE_COOKIE_NAME) return true;
  if (name === 'NEXT_LOCALE') return value !== 'fr';
  return false;
}

/**
 * @param {{ method: string, pathname: string, search?: string,
 *   headers: { has(name: string): boolean },
 *   cookies: Array<{ name: string, value: string }> }} request
 * @returns {boolean} true when the anonymous HTML may be kept by Cloudflare
 */
export function edgeCacheable({ method, pathname, search = '', headers, cookies }) {
  if (method !== 'GET' && method !== 'HEAD') return false;
  if (!CACHEABLE_PATH.test(pathname || '')) return false;
  if (/(?:^|[?&])_rsc=/.test(search || '')) return false;
  for (const name of RSC_HEADERS) if (headers.has(name)) return false;
  if (headers.has(URL_LOCALE_REQUEST_HEADER)) return false;
  const userAgent = typeof headers.get === 'function' ? headers.get('user-agent') : null;
  if (typeof userAgent === 'string' && userAgent.includes(APP_USER_AGENT_MARK)) return false;
  for (const { name, value } of cookies || []) if (isPersonalCookie(name, value)) return false;
  return true;
}
