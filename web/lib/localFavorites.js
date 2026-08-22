'use client';

/**
 * Local-only favorites + saved searches — the anonymous-visitor path.
 * Moved verbatim out of favorites.js (byte-identical behavior) when that
 * file became a logged-in/anonymous dispatcher — see favorites.js and
 * accountFavorites.js.
 *
 * Cross-component sync within a tab: `localStorage` doesn't fire a
 * `storage` event in the tab that made the change, only in *other* tabs, so
 * every write here also dispatches a same-window CustomEvent that
 * components can subscribe to (see FavoriteButton.js / SaveSearchButton.js).
 */

const FAVORITES_KEY = 'lukka_favorites';
const SAVED_SEARCHES_KEY = 'lukka_saved_searches';
const FAVORITES_EVENT = 'lukka:favorites-changed';
const SAVED_SEARCHES_EVENT = 'lukka:saved-searches-changed';

const EMPTY_LIST = [];

// `useSyncExternalStore` (see FavorisPage) requires getSnapshot to return a
// *stable* reference when nothing changed — re-parsing JSON on every call
// would return a new array each time and trigger React's "getSnapshot
// should be cached" infinite-loop guard. Each key gets its own tiny cache,
// keyed off the raw string so a real write still invalidates it.
function createCachedReader(key) {
  let cachedRaw;
  let cachedValue = EMPTY_LIST;
  return () => {
    if (typeof window === 'undefined') return EMPTY_LIST;
    const raw = window.localStorage.getItem(key);
    if (raw !== cachedRaw) {
      cachedRaw = raw;
      try {
        const parsed = raw ? JSON.parse(raw) : [];
        cachedValue = Array.isArray(parsed) ? parsed : EMPTY_LIST;
      } catch {
        cachedValue = EMPTY_LIST;
      }
    }
    return cachedValue;
  };
}

function writeList(key, list, eventName) {
  window.localStorage.setItem(key, JSON.stringify(list));
  window.dispatchEvent(new CustomEvent(eventName));
}

export const getFavoriteIds = createCachedReader(FAVORITES_KEY);

export function isFavorite(id) {
  return getFavoriteIds().includes(String(id));
}

export function toggleFavorite(id) {
  const key = String(id);
  const current = getFavoriteIds();
  const next = current.includes(key) ? current.filter((f) => f !== key) : [...current, key];
  writeList(FAVORITES_KEY, next, FAVORITES_EVENT);
  return next.includes(key);
}

export function subscribeFavorites(callback) {
  window.addEventListener(FAVORITES_EVENT, callback);
  window.addEventListener('storage', callback);
  return () => {
    window.removeEventListener(FAVORITES_EVENT, callback);
    window.removeEventListener('storage', callback);
  };
}

export const getSavedSearches = createCachedReader(SAVED_SEARCHES_KEY);

export function isSearchSaved(queryString) {
  return getSavedSearches().some((s) => s.query === queryString);
}

/** @param {{ query: string, label: string }} search */
export function saveSearch(search) {
  const current = getSavedSearches();
  if (current.some((s) => s.query === search.query)) return current;
  const next = [{ ...search, savedAt: new Date().toISOString() }, ...current];
  writeList(SAVED_SEARCHES_KEY, next, SAVED_SEARCHES_EVENT);
  return next;
}

export function removeSavedSearch(queryString) {
  const next = getSavedSearches().filter((s) => s.query !== queryString);
  writeList(SAVED_SEARCHES_KEY, next, SAVED_SEARCHES_EVENT);
  return next;
}

export function subscribeSavedSearches(callback) {
  window.addEventListener(SAVED_SEARCHES_EVENT, callback);
  window.addEventListener('storage', callback);
  return () => {
    window.removeEventListener(SAVED_SEARCHES_EVENT, callback);
    window.removeEventListener('storage', callback);
  };
}
