import 'server-only';

/**
 * A tiny time-boxed memo for server reads that change on the scale of "a
 * listing got approved", not per request: commune counts, property-type
 * facets, the price ceiling, the homepage's featured cards.
 *
 * In process memory, deliberately — not `unstable_cache`, which serialises to
 * JSON and would turn every row's Date into a string under the components
 * that format them. This app runs as ONE PM2 fork (ecosystem.config.js), so a
 * per-process cache is the whole cache; a restart simply starts cold.
 *
 * Concurrent callers share one in-flight promise, so a burst of visitors
 * after expiry costs one query, not one each. A rejected read is not kept:
 * the next caller tries again.
 *
 * Measured before adding it (2026-09-23, on the VPS): whole pages already
 * render in 50-95 ms, so this is about database load per visitor at scale
 * more than about any one page's speed. Keep TTLs short — the approval gate
 * still applies inside every wrapped read, so the only staleness is a count
 * or a featured card up to `ttlMs` old.
 */
const store = new Map();
const MAX_ENTRIES = 200;

/**
 * @template T
 * @param {string} key
 * @param {number} ttlMs
 * @param {() => Promise<T>} load
 * @returns {Promise<T>}
 */
export function memo(key, ttlMs, load) {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expires > now) return hit.promise;

  const promise = Promise.resolve()
    .then(load)
    .catch((err) => {
      if (store.get(key)?.promise === promise) store.delete(key);
      throw err;
    });
  if (store.size >= MAX_ENTRIES) store.delete(store.keys().next().value);
  store.set(key, { promise, expires: now + ttlMs });
  return promise;
}

/** Drop every entry whose key starts with `prefix` (after a write the page must show). */
export function forget(prefix) {
  for (const key of store.keys()) if (key.startsWith(prefix)) store.delete(key);
}
