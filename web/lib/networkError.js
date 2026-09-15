/**
 * A failure that means "the network is gone", as opposed to a server verdict.
 * A Server Action that cannot reach the server rejects with a TypeError
 * ("Failed to fetch" / "Load failed" / "NetworkError…"), and navigator.onLine
 * is the browser's own, if optimistic, opinion.
 *
 * The distinction is what decides the message: "no connection — retry" is
 * something a visitor on a dropping 3G link can act on; "something went
 * wrong" is not. Same rule as lib/offlineDrafts.js's `looksOffline`.
 */
export function isNetworkError(err) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  return err instanceof TypeError && /fetch|network|load failed/i.test(String(err.message));
}
