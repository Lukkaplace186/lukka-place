import { DEFAULT_LOCALE, normalizeLocale } from './config';

/**
 * The pure translation core: dot-path lookup, plural selection and
 * `{placeholder}` interpolation. No React, no `next/headers`, no dictionary
 * imports — callers supply the messages. That is what lets the same function
 * serve Server Components (which hold every locale, see ./server.js) and the
 * browser (which is handed only the active locale, see ./client.js) without
 * two implementations that could drift apart.
 */

/** Walks `a.b.c` without letting a missing branch throw. */
function lookup(messages, key) {
  if (!messages || typeof key !== 'string') return undefined;
  let node = messages;
  for (const segment of key.split('.')) {
    if (node === null || typeof node !== 'object') return undefined;
    node = node[segment];
  }
  return node;
}

/**
 * Picks a plural form when the entry is `{ one, other }` and a `count` was
 * passed. French and English disagree on the boundary — French treats 0 as
 * singular ("0 bien"), English as plural ("0 properties") — so the rule is
 * per-locale rather than a shared `count === 1`.
 *
 * `zero` is optional and wins outright when present: several strings here
 * read better as "Aucun bien" than as "0 bien".
 */
function selectPluralForm(entry, count, locale) {
  if (typeof count !== 'number' || Number.isNaN(count)) return entry.other ?? entry.one;
  if (count === 0 && typeof entry.zero === 'string') return entry.zero;
  const singular = locale === 'fr' ? Math.abs(count) < 2 : Math.abs(count) === 1;
  return singular ? entry.one ?? entry.other : entry.other ?? entry.one;
}

/**
 * Replaces `{name}` with `vars.name`. A placeholder with no matching var is
 * left verbatim rather than blanked, so a mistake shows up as a visible
 * `{name}` in QA instead of silently producing "Bonjour  !".
 */
function interpolate(template, vars) {
  if (!vars || typeof template !== 'string') return template;
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
  );
}

const warned = new Set();

/** Dev-only, deduped — a missing key in a loop must not flood the console. */
function warnMissing(locale, key) {
  if (process.env.NODE_ENV === 'production') return;
  const id = `${locale}:${key}`;
  if (warned.has(id)) return;
  warned.add(id);
  console.warn(`[i18n] missing translation for "${key}" (${locale})`);
}

/**
 * Resolves one key.
 *
 * `fallbackMessages` is the French dictionary when the caller has it (server
 * side). The three-step resolution — active locale, then French, then the key
 * itself — means a gap in en.json degrades to real French text rather than to
 * a blank element or a raw `admin.leads.title` string in the UI.
 * tests/unit/i18n-parity.test.js exists so that safety net stays a safety net
 * and not the mechanism.
 */
export function translate(key, { messages, fallbackMessages, locale = DEFAULT_LOCALE, vars } = {}) {
  let entry = lookup(messages, key);
  if (entry === undefined || entry === null) entry = lookup(fallbackMessages, key);

  if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
    entry = selectPluralForm(entry, vars?.count, locale);
  }

  if (typeof entry !== 'string') {
    warnMissing(locale, key);
    return key;
  }

  return interpolate(entry, vars);
}

/**
 * Binds a locale + messages into the `t(key, vars)` signature every component
 * in this app calls. `t.locale` is exposed because a handful of call sites
 * need the locale itself (date/number formatting via lib/format.js, `<html
 * lang>`, an Intl.NumberFormat currency label) rather than a string lookup.
 */
export function createTranslator({ locale, messages, fallbackMessages }) {
  const active = normalizeLocale(locale);
  const t = (key, vars) => translate(key, { messages, fallbackMessages, locale: active, vars });
  t.locale = active;
  t.has = (key) => typeof lookup(messages, key) === 'string' || typeof lookup(messages, key) === 'object';
  return t;
}

export { lookup as lookupMessage };
