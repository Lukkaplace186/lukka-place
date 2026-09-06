/**
 * Locale configuration — the single source of truth for what "a locale" is
 * in this app. Imported by server code, client code and middleware alike,
 * so it must stay free of `next/headers`, `server-only` and React.
 *
 * French is the default and is NOT a fallback language chosen for
 * convenience: Lukka Place is a Kinshasa marketplace and its listings,
 * communes and agents are French-first. English exists for the diaspora
 * audience — the same audience the USD/FC currency toggle was built for
 * (see lib/currencyPreference.js) — not as the "real" source language.
 *
 * Locale is carried in a cookie rather than a `/fr` `/en` route segment.
 * That is a deliberate trade-off, recorded here because it is the one
 * decision everything else in this folder follows from:
 *   + no restructuring of ~100 route files into app/[locale]/, and no
 *     rewrite of every internal <Link href> in the codebase;
 *   + one canonical URL per page, so existing links and shares keep working
 *     and nothing needs redirecting;
 *   - reading the cookie opts a route into dynamic rendering, which costs
 *     the handful of public routes that were statically prerendered
 *     (/, /a-propos, /contact, /favoris, /agents, /messages, /plan). Every
 *     other route in the app was already dynamic.
 * If per-locale static prerendering ever matters more than the above, the
 * migration is to app/[locale]/ — not to reading the cookie in fewer places.
 */

export const LOCALES = ['fr', 'en'];

export const DEFAULT_LOCALE = 'fr';

/**
 * `NEXT_LOCALE` is Next.js's own conventional name for this cookie. Nothing
 * in this app's setup reads it automatically (that behaviour belonged to the
 * Pages Router's built-in i18n routing, which the App Router dropped), but
 * keeping the conventional name means tooling, proxies and any future move to
 * built-in routing agree with us rather than fighting us.
 *
 * Deliberately NOT httpOnly: LanguageToggle writes it from the browser, and a
 * display preference carries nothing worth protecting. Contrast the session
 * cookies in lib/adminAuth.js / lib/customerAuth.js, which are httpOnly for
 * real reasons.
 */
export const LOCALE_COOKIE = 'NEXT_LOCALE';

/** Mirrors the cookie, same pattern as lib/currencyPreference.js's key. */
export const LOCALE_STORAGE_KEY = 'lukka_locale';

/** Same-window notification channel as lib/currencyPreference.js. */
export const LOCALE_EVENT = 'lukka:locale-changed';

/** One year, in seconds. A language preference should outlive a session. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** What the switcher renders, and what <html lang> gets. */
export const LOCALE_LABELS = {
  fr: { short: 'FR', long: 'Français' },
  en: { short: 'EN', long: 'English' },
};

/**
 * Coerces anything (a cookie value, a localStorage read, a URL param) to a
 * real supported locale. Never throws and never returns undefined — every
 * caller in this app treats "no preference expressed" and "nonsense value"
 * identically, as French.
 */
export function normalizeLocale(value) {
  return LOCALES.includes(value) ? value : DEFAULT_LOCALE;
}
