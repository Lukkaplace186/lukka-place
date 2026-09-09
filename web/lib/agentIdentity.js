/**
 * Client-safe agent identity helpers — shared by AgencyLogo, AgentMonogram
 * and EnquiryCard. Deliberately NOT in lib/agencies.js: that module is
 * `server-only` (it opens a pg pool), and every consumer here is a
 * `'use client'` component.
 *
 * Pure string logic, no data access. The authoritative name resolution
 * happens in SQL (lib/listings.js's AGENCY_NAME_EXPR); this is the second
 * line of defence for the paths that do not go through it — lib/adminListings.js
 * and lib/subscriptions.js still select `a.username` raw, and a future query
 * may too. A phone number must never be rendered as though it were a name,
 * whichever query produced it.
 */

/**
 * True when a string is a bare phone number rather than a name.
 *
 * 7..15 digits is E.164's real range — a 3-digit country code plus a 4-digit
 * subscriber number at the low end — matching lib/phone.js and the engine's
 * routes/admin.js. An optional leading `+` is accepted because `agents.phone`
 * is stored digits-only but nothing stops a display string carrying one.
 *
 * @param {string|null|undefined} value
 * @returns {boolean}
 */
export function isPhoneLikeName(value) {
  return /^\+?\d{7,15}$/.test(String(value ?? '').trim());
}

/**
 * The name to actually print, or null when there is nothing honest to print.
 *
 * Returning null rather than the phone digits is the point: the caller's
 * no-name branch (Lukka Place's own mark) is a true statement about a
 * listing the platform handles directly, whereas a phone number in the
 * agency slot is just a leaked identifier.
 *
 * @param {string|null|undefined} name
 * @returns {string|null}
 */
export function displayableAgencyName(name) {
  const trimmed = String(name ?? '').trim();
  if (!trimmed || isPhoneLikeName(trimmed)) return null;
  return trimmed;
}

/**
 * Monogram for an agent with no uploaded logo: up to two initials.
 *
 * Only real letters survive. A digit-leading fallback ("3" for
 * "33766517388") is exactly what the phone-as-name bug rendered inside the
 * detail page's avatar circle, and it reads as a stray number, not a mark —
 * so a name with no letter in it yields null and the caller shows the Lukka
 * Place monogram instead. Accented Latin initials are kept ("Édouard" -> "É").
 *
 * @param {string|null|undefined} name
 * @returns {string|null}
 */
export function agencyInitials(name) {
  const displayable = displayableAgencyName(name);
  if (!displayable) return null;

  const initials = displayable
    .split(/[\s.'’-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0))
    .filter((char) => /\p{L}/u.test(char))
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return initials || null;
}
