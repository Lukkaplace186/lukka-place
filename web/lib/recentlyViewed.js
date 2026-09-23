/**
 * Listings this browser opened recently, newest first — the "Récemment
 * consultés" rail. Per-visitor convenience only, so localStorage is the right
 * home: nobody else needs it and losing it costs nothing. Every access is
 * wrapped, because private windows and blocked site data make the accessor
 * throw, and the page must render the same without it.
 */

const KEY = 'lukka:recently-viewed';
export const RECENT_LIMIT = 12;
const EMPTY = [];
const listeners = new Set();

let cachedRaw;
let cachedIds = EMPTY;

function readRaw() {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** Stable snapshot for useSyncExternalStore: same array until storage changes. */
export function getRecentIds() {
  if (typeof window === 'undefined') return EMPTY;
  const raw = readRaw();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    try {
      const parsed = JSON.parse(raw || '[]');
      cachedIds = Array.isArray(parsed) ? parsed.map(String).filter((id) => /^\d+$/.test(id)).slice(0, RECENT_LIMIT) : EMPTY;
    } catch {
      cachedIds = EMPTY;
    }
  }
  return cachedIds;
}

export function getServerRecentIds() {
  return EMPTY;
}

export function subscribeRecent(callback) {
  listeners.add(callback);
  const onStorage = (event) => {
    if (event.key === KEY) callback();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(callback);
    window.removeEventListener('storage', onStorage);
  };
}

export function rememberViewed(id) {
  const value = String(id ?? '');
  if (!/^\d+$/.test(value)) return;
  const next = [value, ...getRecentIds().filter((existing) => existing !== value)].slice(0, RECENT_LIMIT);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    return;
  }
  listeners.forEach((listener) => listener());
}
