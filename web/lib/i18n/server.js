import 'server-only';
import { cookies } from 'next/headers';

import fr from './fr.json';
import en from './en.json';
import { DEFAULT_LOCALE, LOCALE_COOKIE, normalizeLocale } from './config';
import { createTranslator } from './translate';

/**
 * Server-side locale access.
 *
 * `server-only` is imported for the same reason lib/db.js imports it: this
 * module reaches for `next/headers`, and an accidental import from a
 * `'use client'` file should be a build error rather than a confusing runtime
 * one. Client components get their locale from ./client.js instead.
 *
 * Both dictionaries are imported here because on the server there is no
 * bundle to keep small, and holding French alongside the active locale is
 * what makes the missing-key fallback in ./translate.js real.
 */
const DICTIONARIES = { fr, en };

/**
 * The visitor's locale for this request.
 *
 * Awaiting `cookies()` is what makes the calling route dynamic — see the
 * trade-off recorded in ./config.js. `cookies()` is async in Next 16; it is
 * not the synchronous call older examples show.
 */
export async function getLocale() {
  const store = await cookies();
  return normalizeLocale(store.get(LOCALE_COOKIE)?.value);
}

/** The whole dictionary for a locale — used to seed the client provider. */
export function getDictionary(locale) {
  return DICTIONARIES[normalizeLocale(locale)] ?? DICTIONARIES[DEFAULT_LOCALE];
}

/**
 * Picks whole top-level namespaces out of a dictionary.
 *
 * Every layout hands the client only the namespaces its own subtree renders
 * (see ./client.js), so admin copy never ships to a public visitor and the
 * public site's listing vocabulary never ships to /admin.
 */
export function getMessages(locale, namespaces) {
  const dictionary = getDictionary(locale);
  if (!namespaces) return dictionary;
  const picked = {};
  for (const namespace of namespaces) {
    if (dictionary[namespace] !== undefined) picked[namespace] = dictionary[namespace];
  }
  return picked;
}

/**
 * The server-side `t`. Call it in any Server Component:
 *   const t = await getT();
 *   <h1>{t('nav.rent')}</h1>
 */
export async function getT() {
  const locale = await getLocale();
  return createTranslator({
    locale,
    messages: getDictionary(locale),
    fallbackMessages: DICTIONARIES[DEFAULT_LOCALE],
  });
}

/** Both at once, for layouts that need the locale for <html lang> too. */
export async function getI18n(namespaces) {
  const locale = await getLocale();
  return {
    locale,
    messages: getMessages(locale, namespaces),
    t: createTranslator({
      locale,
      messages: getDictionary(locale),
      fallbackMessages: DICTIONARIES[DEFAULT_LOCALE],
    }),
  };
}
