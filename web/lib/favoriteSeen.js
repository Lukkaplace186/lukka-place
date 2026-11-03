/**
 * When this device last opened the Espace Client's Enregistrés tab — the dot
 * on that tab means "a saved listing dropped in price since"
 * (lib/favoritePriceDrops.js countUnseenFavoritePriceDrops). Per device, like
 * the agent inbox's lp_inbox_seen: there is no read-state column, and a
 * customer who looked on their phone has seen it.
 */
export const FAVORITES_SEEN_COOKIE = 'lp_fav_seen';

/** The stamp the Enregistrés page hands its seen marker: the server's clock, now. */
export function favoritesSeenStamp() {
  return Date.now();
}

/** The cookie's value (ms since epoch) as a Date, or null. */
export function favoritesSeenAt(value) {
  const ms = Number(value);
  return Number.isFinite(ms) && ms > 0 ? new Date(ms) : null;
}
