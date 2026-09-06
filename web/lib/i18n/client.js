'use client';

import { createContext, useContext, useMemo } from 'react';

import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_EVENT,
  LOCALE_STORAGE_KEY,
  normalizeLocale,
} from './config';
import { createTranslator } from './translate';

/**
 * Client-side locale access.
 *
 * The provider is handed its messages by a Server Component rather than
 * importing the dictionaries itself. That is the whole point: only the active
 * locale crosses into the browser, and only the namespaces the surface below
 * actually renders (each layout picks its own — see getMessages in
 * ./server.js). Importing fr.json + en.json here instead would ship every
 * string of both languages, admin copy included, to every public visitor.
 */
const I18nContext = createContext(null);

/**
 * Nested providers MERGE rather than replace, one level deep, at the
 * namespace boundary. app/layout.js supplies the chrome namespaces to the
 * whole app; app/admin/layout.js then adds `admin` for its own subtree
 * without having to restate them. Replacing would mean the root's chrome
 * strings vanishing the moment a nested provider mounted.
 */
export function I18nProvider({ locale, messages, children }) {
  const parent = useContext(I18nContext);

  const value = useMemo(() => {
    const activeLocale = normalizeLocale(locale ?? parent?.locale);
    const merged = { ...(parent?.messages ?? {}), ...(messages ?? {}) };
    return { locale: activeLocale, messages: merged };
  }, [locale, messages, parent]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/**
 * A component rendered outside any provider is a bug, but it must not be a
 * blank screen: fall back to French with no messages, which makes `t` return
 * its own keys and the mistake obvious in QA rather than invisible.
 */
function useI18nContext() {
  return useContext(I18nContext) ?? { locale: DEFAULT_LOCALE, messages: {} };
}

/** `const t = useT();` — the client mirror of `await getT()`. */
export function useT() {
  const { locale, messages } = useI18nContext();
  return useMemo(() => createTranslator({ locale, messages }), [locale, messages]);
}

/** For the few call sites that need the locale itself (Intl, <html lang>). */
export function useLocale() {
  return useI18nContext().locale;
}

/**
 * Persists the choice to both stores the brief calls for, and to both for
 * real reasons rather than redundancy:
 *
 *   - the cookie is what the SERVER reads (./server.js), so Server
 *     Components, Server Actions and route handlers render in the chosen
 *     language on the very next request;
 *   - localStorage is what survives a cookie being dropped by a privacy
 *     setting, and is the same convention lib/currencyPreference.js already
 *     uses for the currency toggle.
 *
 * `SameSite=Lax` so a visitor arriving from a WhatsApp link still carries
 * their preference; no `Secure` flag hardcoded, so local http:// dev works —
 * the value is a display preference, not a credential.
 */
export function persistLocale(locale) {
  const next = normalizeLocale(locale);
  if (typeof document === 'undefined') return next;

  document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`;
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, next);
  } catch {
    // Safari private mode throws on setItem. The cookie above already
    // carries the preference, so this is genuinely optional.
  }
  window.dispatchEvent(new CustomEvent(LOCALE_EVENT, { detail: next }));
  return next;
}

/**
 * Reads the localStorage mirror, or null when nothing was ever stored.
 *
 * Returning null for "never chosen" is the point — it is what lets
 * LocaleSync tell an unset preference apart from a deliberate choice of the
 * default language, and so avoid rewriting a cookie nobody asked for.
 */
export function readStoredLocale() {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return stored ? normalizeLocale(stored) : null;
  } catch {
    return null;
  }
}
