/**
 * "Retrouvez ce bien et l'agent plus tard" — the account offer shown AFTER a
 * guest's WhatsApp tap, when they come back to the page (2026-11-18, owner:
 * contacts were all anonymous because WhatsApp goes straight to the agent).
 * Pure and client-safe; components/ContactSignupPrompt.js renders it.
 *
 * Rules:
 * - only after WhatsApp actually opened (the tap), never in front of it;
 * - only when the visitor comes back (the page was hidden, then shown);
 * - signing in is "Continuer avec WhatsApp" (a code from their own WhatsApp,
 *   no password), the same as the ♥ and alert prompts;
 * - once: "Non merci" (or closing it) hides it for SNOOZE_DAYS, and a
 *   visitor who created an account or signed in is never asked again here.
 */

/** Fired on window by lib/analyticsClient.js trackLeadClick. */
export const WHATSAPP_TAP_EVENT = 'lkp:whatsapp-tap';

export const CONTACT_SIGNUP_STORAGE_KEY = 'lkp_contact_signup';
export const SNOOZE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @param {{dismissedAt?: number}|null} stored what localStorage holds
 * @param {number} now
 * @returns {boolean} whether the offer may be shown now
 */
export function contactSignupAllowed(stored, now = Date.now()) {
  const at = Number(stored?.dismissedAt);
  if (!Number.isFinite(at) || at <= 0) return true;
  return now - at >= SNOOZE_DAYS * DAY_MS;
}

export function readContactSignupState() {
  try {
    const raw = window.localStorage.getItem(CONTACT_SIGNUP_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function snoozeContactSignup(now = Date.now()) {
  try {
    window.localStorage.setItem(CONTACT_SIGNUP_STORAGE_KEY, JSON.stringify({ dismissedAt: now }));
  } catch {
    // Private mode: the offer may come back on the next tap. Harmless.
  }
}

/** A positive listing id from the tap event, or null. */
export function tappedListingId(detail) {
  const id = Number.parseInt(detail?.listingId, 10);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** The page to come back to after the account is made: this one, never another site. */
export function returnPath(location) {
  const path = String(location?.pathname || '/');
  if (!path.startsWith('/') || path.startsWith('//')) return '/';
  return `${path}${location?.search || ''}`;
}

/** components/FavoriteResumeHandler.js's marker: saves that listing once signed in. */
export const FAV_RETURN_PARAM = 'lkp_fav_return';

/**
 * Where to land after signing in from the offer: this page, with the
 * favourite-resume marker so the contacted listing is saved there (whichever
 * way they signed in — WhatsApp code or password). No listing → just the page.
 */
export function keepListingNext(location, listingId) {
  const back = returnPath(location);
  const id = tappedListingId({ listingId });
  if (!id) return back;
  const [path, query = ''] = back.split('?');
  const params = new URLSearchParams(query);
  params.set(FAV_RETURN_PARAM, String(id));
  return `${path}?${params.toString()}`;
}
