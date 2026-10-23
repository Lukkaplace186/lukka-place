/**
 * Full listing rows for the phone map's cards, by id, for the tab.
 *
 * Shared by ListingsMap (which already fetches the tapped listing, or has it
 * among the list page's cards) and MapCardCarousel (which used to fetch every
 * listing in view, 20 at a time, and draw nothing until the LAST batch was
 * back — on a Kinshasa link that is three round trips before the tapped
 * card's photo was even asked for, reported 2026-10-23 as "too slow"). Now
 * the tapped card draws from here at once, and the others fill in batch by
 * batch.
 */
const cache = new Map();
const FETCH_BATCH = 20;

/** Rows with photos only: a map marker has none and must not stand in for one. */
export function rememberListings(rows) {
  for (const row of rows || []) {
    if (row && row.id != null && ('featured_image' in row || 'gallery' in row)) cache.set(String(row.id), row);
  }
}

export function cachedListings(ids) {
  return ids.map((id) => cache.get(String(id))).filter(Boolean);
}

/**
 * Fetches what is not cached yet, `first` (the tapped card) and its
 * neighbours ahead of the rest, calling `onBatch(rows)` after each batch with
 * every cached row for `ids`. An id the API no longer returns was unpublished
 * since the pins were fetched: remembered as null, so it is never re-asked.
 */
export async function loadListings(ids, { first = null, onBatch } = {}) {
  const keys = ids.map(String);
  let missing = keys.filter((id) => !cache.has(id));
  if (first != null) {
    const at = keys.indexOf(String(first));
    if (at >= 0) {
      const near = new Set(keys.slice(Math.max(0, at - 2), at + 3));
      missing = [...missing.filter((id) => near.has(id)), ...missing.filter((id) => !near.has(id))];
    }
  }
  for (let i = 0; i < missing.length; i += FETCH_BATCH) {
    const batch = missing.slice(i, i + FETCH_BATCH);
    const response = await fetch(`/api/listings?ids=${batch.map(encodeURIComponent).join(',')}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    const found = new Map((body.data || []).map((row) => [String(row.id), row]));
    for (const id of batch) cache.set(id, found.get(id) || null);
    onBatch?.(cachedListings(keys));
  }
  return cachedListings(keys);
}
