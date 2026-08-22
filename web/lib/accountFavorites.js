'use client';

/**
 * Server-synced favorites + saved searches — the logged-in-visitor path.
 * Same exported function names as localFavorites.js, so favorites.js's
 * dispatcher can pick either module without call sites (FavoriteButton.js,
 * SaveSearchButton.js) needing to change at all.
 *
 * Reads are an in-memory cache populated from GET /api/account/* on first
 * call (getFavoriteIds/getSavedSearches must stay synchronous — they're
 * useSyncExternalStore getSnapshot functions). Writes are optimistic: the
 * cache updates immediately and dispatches the same CustomEvent names
 * localFavorites.js uses, so existing subscribers re-render unchanged; a
 * failed request reverts the optimistic change silently, matching the
 * existing silent-fail-on-clipboard-denial precedent already in this app
 * (favoris/page.js's share button).
 */

const FAVORITES_EVENT = 'lukka:favorites-changed';
const SAVED_SEARCHES_EVENT = 'lukka:saved-searches-changed';
const EMPTY_LIST = [];

let favoritesCache = null; // null = not yet loaded
let favoritesLoading = false;

let savedSearchesCache = null;
let savedSearchesLoading = false;

function dispatch(eventName) {
  window.dispatchEvent(new CustomEvent(eventName));
}

function ensureFavoritesLoaded() {
  if (favoritesCache !== null || favoritesLoading) return;
  favoritesLoading = true;
  fetch('/api/account/favorites')
    .then((res) => (res.ok ? res.json() : { ids: [] }))
    .then((json) => {
      favoritesCache = (json.ids || []).map(String);
    })
    .catch(() => {
      favoritesCache = EMPTY_LIST;
    })
    .finally(() => {
      favoritesLoading = false;
      dispatch(FAVORITES_EVENT);
    });
}

export function getFavoriteIds() {
  if (typeof window === 'undefined') return EMPTY_LIST;
  ensureFavoritesLoaded();
  return favoritesCache ?? EMPTY_LIST;
}

export function isFavorite(id) {
  return getFavoriteIds().includes(String(id));
}

export function toggleFavorite(id) {
  const key = String(id);
  const current = getFavoriteIds();
  const wasFavorite = current.includes(key);
  const next = wasFavorite ? current.filter((f) => f !== key) : [...current, key];

  favoritesCache = next;
  dispatch(FAVORITES_EVENT);

  const request = wasFavorite
    ? fetch(`/api/account/favorites?propertyId=${encodeURIComponent(key)}`, { method: 'DELETE' })
    : fetch('/api/account/favorites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId: key }),
      });

  request
    .then((res) => {
      if (!res.ok) {
        favoritesCache = current;
        dispatch(FAVORITES_EVENT);
      }
    })
    .catch(() => {
      favoritesCache = current;
      dispatch(FAVORITES_EVENT);
    });

  return !wasFavorite;
}

export function subscribeFavorites(callback) {
  window.addEventListener(FAVORITES_EVENT, callback);
  return () => window.removeEventListener(FAVORITES_EVENT, callback);
}

function ensureSavedSearchesLoaded() {
  if (savedSearchesCache !== null || savedSearchesLoading) return;
  savedSearchesLoading = true;
  fetch('/api/account/saved-searches')
    .then((res) => (res.ok ? res.json() : { searches: [] }))
    .then((json) => {
      savedSearchesCache = json.searches || [];
    })
    .catch(() => {
      savedSearchesCache = EMPTY_LIST;
    })
    .finally(() => {
      savedSearchesLoading = false;
      dispatch(SAVED_SEARCHES_EVENT);
    });
}

export function getSavedSearches() {
  if (typeof window === 'undefined') return EMPTY_LIST;
  ensureSavedSearchesLoaded();
  return savedSearchesCache ?? EMPTY_LIST;
}

export function isSearchSaved(queryString) {
  return getSavedSearches().some((s) => s.query === queryString);
}

/** @param {{ query: string, label: string, href?: string }} search */
export function saveSearch(search) {
  const current = getSavedSearches();
  if (current.some((s) => s.query === search.query)) return current;

  const optimisticEntry = { query: search.query, label: search.label, href: search.href || `/listings?${search.query}`, savedAt: new Date().toISOString() };
  const next = [optimisticEntry, ...current];
  savedSearchesCache = next;
  dispatch(SAVED_SEARCHES_EVENT);

  fetch('/api/account/saved-searches', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: search.query, label: search.label }),
  }).then((res) => {
    if (!res.ok) {
      savedSearchesCache = current;
      dispatch(SAVED_SEARCHES_EVENT);
    }
  }).catch(() => {
    savedSearchesCache = current;
    dispatch(SAVED_SEARCHES_EVENT);
  });

  return next;
}

export function removeSavedSearch(queryString) {
  const current = getSavedSearches();
  const next = current.filter((s) => s.query !== queryString);
  savedSearchesCache = next;
  dispatch(SAVED_SEARCHES_EVENT);

  fetch(`/api/account/saved-searches?query=${encodeURIComponent(queryString)}`, { method: 'DELETE' })
    .then((res) => {
      if (!res.ok) {
        savedSearchesCache = current;
        dispatch(SAVED_SEARCHES_EVENT);
      }
    })
    .catch(() => {
      savedSearchesCache = current;
      dispatch(SAVED_SEARCHES_EVENT);
    });

  return next;
}

export function subscribeSavedSearches(callback) {
  window.addEventListener(SAVED_SEARCHES_EVENT, callback);
  return () => window.removeEventListener(SAVED_SEARCHES_EVENT, callback);
}
