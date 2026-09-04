'use client';

/**
 * Recent /listings searches — local-only (no accounts-backed search log
 * exists), same honesty principle as lib/localFavorites.js, and the same
 * useSyncExternalStore-compatible shape (cached-reader + CustomEvent) that
 * file already established — this is a distinct store, not a duplicate of
 * it: `lukka_favorites`/`lukka_saved_searches` are explicit user actions,
 * this is an implicit, automatic history of whatever was actually searched.
 *
 * Also distinct from LocationAutocomplete.js's own AI-mode-only search
 * history (`lukka_search_history`): that one holds raw typed sentences for
 * the homepage's free-text hero box, this one holds `{label, href}`
 * summaries of whatever filter combination was actually applied on
 * /listings (FilterBar.js) — different shape, different surface, no shared
 * meaning to merge.
 */

const KEY = 'lukka_recent_listings_searches';
const EVENT = 'lukka:recent-searches-changed';
const MAX = 5;
// Exported so a getServerSnapshot can return this exact reference.
// useSyncExternalStore compares snapshots by identity: a server snapshot
// that builds a fresh [] on every call never settles, and React reports
// "The result of getServerSnapshot should be cached to avoid an infinite
// loop" — which FilterBar.js did, on every page carrying the search bar.
export const EMPTY_LIST = [];

/** Stable getServerSnapshot for useSyncExternalStore — same reference every call. */
export function getEmptyRecentSearches() {
  return EMPTY_LIST;
}

// useSyncExternalStore requires getSnapshot to return a *stable* reference
// when nothing changed — re-parsing JSON on every call would return a new
// array each time and trip React's "getSnapshot should be cached" guard.
let cachedRaw;
let cachedValue = EMPTY_LIST;

export function readRecentSearches() {
  if (typeof window === 'undefined') return EMPTY_LIST;
  const raw = window.localStorage.getItem(KEY);
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    try {
      const parsed = raw ? JSON.parse(raw) : [];
      cachedValue = Array.isArray(parsed)
        ? parsed.filter((entry) => entry && typeof entry.label === 'string' && typeof entry.href === 'string')
        : EMPTY_LIST;
    } catch {
      cachedValue = EMPTY_LIST;
    }
  }
  return cachedValue;
}

/** Most-recent-first, deduped by href (re-running the same exact search
 *  just moves it back to the front rather than listing it twice). */
export function pushRecentSearch(entry) {
  if (typeof window === 'undefined' || !entry?.label || !entry?.href) return readRecentSearches();
  const next = [entry, ...readRecentSearches().filter((e) => e.href !== entry.href)].slice(0, MAX);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch {
    // Storage full/disabled — history just doesn't persist this time, not
    // worth failing the actual search over.
  }
  return next;
}

export function subscribeRecentSearches(callback) {
  window.addEventListener(EVENT, callback);
  window.addEventListener('storage', callback);
  return () => {
    window.removeEventListener(EVENT, callback);
    window.removeEventListener('storage', callback);
  };
}
