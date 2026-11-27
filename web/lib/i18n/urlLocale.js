/**
 * The request header middleware.js sets on an /en/… URL it rewrites onto the
 * French route (lib/localePaths.js). lib/i18n/server.js reads it before the
 * cookie, so the page renders in English and its canonical is the /en URL.
 *
 * Only middleware sets it, and only on /en paths. A client sending it on a
 * French URL gets that page in English for itself — the same thing the
 * language cookie does. Since 2026-11-21 Cloudflare may keep anonymous
 * public pages (lib/edgeCache.js), and a request carrying this header is
 * never one of them, so there is still nothing to poison.
 */
export const URL_LOCALE_HEADER = 'x-lukka-url-locale';
