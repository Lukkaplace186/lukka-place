import 'server-only';
import { canContinueNearby, getListings, getNearbyContinuation } from './listings';
import { feedCursor, FEED_PAGE_SIZE } from './listingsFeedCursor';

/**
 * The endless /listings feed (owner decision 2026-11-14: endless scroll, no
 * "Page 1 / 32"). Two parts, never mixed:
 *
 *   1. the exact answer to the search, in getListings' order (lib/listings.js
 *      orderByFor: exact bedroom count, up to date, photo, most recent);
 *   2. once that runs out, and only for a place search, the same search in the
 *      nearby communes, nearest commune first (getNearbyContinuation) — a
 *      "2 chambres à Kintambo" lists every Kintambo match before Ma Campagne.
 *
 * Batches of FEED_PAGE_SIZE; the cursor says where the next one starts
 * (lib/listingsFeedCursor.js). The page renders the first batch on the server
 * and the browser asks GET /api/listings/feed for the rest.
 */

/**
 * After a batch of exact results: fill the batch with the first nearby
 * listings when the exact ones ran out in it, and say where the next batch
 * starts.
 *
 * @returns {Promise<{similar: {listings: Object[], places: Array}|null, next: string|null}>}
 */
export async function completeExactBatch(filters, result, offset, limit = FEED_PAGE_SIZE) {
  const shown = offset + result.count;
  if (shown < result.total && result.count > 0) return { similar: null, next: feedCursor('e', shown) };
  if (!canContinueNearby(filters, result)) return { similar: null, next: null };

  const room = limit - result.count;
  if (room <= 0) return { similar: null, next: feedCursor('s', 0) };
  const cont = await getNearbyContinuation(filters, { offset: 0, limit: room });
  if (cont.data.length === 0) return { similar: null, next: null };
  return {
    similar: { listings: cont.data, places: cont.places },
    next: cont.data.length < cont.total ? feedCursor('s', cont.data.length) : null,
  };
}

/**
 * One batch from a cursor, for GET /api/listings/feed.
 *
 * @returns {Promise<{listings: Object[], similar: {listings: Object[], places: Array}|null, next: string|null}>}
 */
export async function loadFeedBatch(filters, cursor, limit = FEED_PAGE_SIZE) {
  if (cursor.phase === 'e') {
    const result = await getListings({ ...filters, limit, offset: cursor.offset, allowRelax: true });
    const { similar, next } = await completeExactBatch(filters, result, cursor.offset, limit);
    return { listings: result.data, similar, next };
  }
  if (!canContinueNearby(filters, {})) return { listings: [], similar: null, next: null };
  const cont = await getNearbyContinuation(filters, { offset: cursor.offset, limit });
  const end = cursor.offset + cont.data.length;
  return {
    listings: [],
    similar: cont.data.length ? { listings: cont.data, places: cont.places } : null,
    next: cont.data.length > 0 && end < cont.total ? feedCursor('s', end) : null,
  };
}
