/**
 * Where the next batch of the endless /listings feed starts: "e:24" (the 25th
 * exact result) or "s:12" (the 13th nearby one). Pure, shared by the server
 * (lib/listingsFeed.js) and the browser (components/ListingsFeed.js).
 */
export const FEED_PAGE_SIZE = 12;

/** Past this, a cursor is refused: nobody scrolls 4,000 cards. */
const MAX_OFFSET = 4000;

export function feedCursor(phase, offset) {
  return `${phase}:${offset}`;
}

/** @returns {{phase: 'e'|'s', offset: number}|null} */
export function parseFeedCursor(value) {
  const match = /^([es]):(\d{1,5})$/.exec(String(value || ''));
  if (!match) return null;
  const offset = Number.parseInt(match[2], 10);
  if (offset > MAX_OFFSET) return null;
  return { phase: match[1], offset };
}

/** The ?page= link a crawler or a browser without JavaScript follows instead. */
export function pageForCursor(value) {
  const cursor = parseFeedCursor(value);
  if (!cursor || cursor.phase !== 'e' || cursor.offset % FEED_PAGE_SIZE !== 0) return null;
  return cursor.offset / FEED_PAGE_SIZE + 1;
}
