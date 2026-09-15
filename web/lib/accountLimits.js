/**
 * Per-account ceilings on what a customer can save. Plain module (no
 * server-only) because both the SQL guards in lib/customers.js and the
 * browser-side notice (components/AccountLimitNotice.js) state the number.
 *
 * Why there are ceilings at all:
 *  - every saved search is re-run through getListings() when its owner opens
 *    the Alertes tab, and again by the alert sweep; an unbounded list made
 *    one tab tap an unbounded number of queries.
 *  - every favourite is fetched as a full listing row on the Favoris tab and
 *    on the homepage shelf.
 *
 * Both are far above what a real search looks like. Enforced in SQL with a
 * COUNT guard on the INSERT, so two simultaneous saves can at worst land one
 * over — a soft ceiling, which is all these need to be.
 */
export const MAX_FAVORITES = 200;
export const MAX_SAVED_SEARCHES = 20;

/** A private note on a saved listing. The database CHECK holds the same number. */
export const MAX_FAVORITE_NOTE_LENGTH = 500;

/** Browser event lib/accountFavorites.js raises when a save hits a ceiling. */
export const ACCOUNT_LIMIT_EVENT = 'lukka:account-limit';
