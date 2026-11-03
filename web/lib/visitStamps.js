/**
 * The "since your last visit" bookkeeping for components/NewSinceLastVisit.js.
 * A gap of more than SESSION_GAP_MS since the last page starts a new visit;
 * "since your last visit" is then the previous visit's last page.
 */
export const SESSION_GAP_MS = 30 * 60 * 1000;

/** Pure: given the stored stamps (ms or null) and now. */
export function nextVisitStamps({ last, prev, now }) {
  const newSession = last != null && now - last > SESSION_GAP_MS;
  return { since: newSession ? last : prev, prev: newSession ? last : prev, last: now };
}
