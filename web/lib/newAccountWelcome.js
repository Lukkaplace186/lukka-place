/**
 * "Votre compte est créé" after a name and a number opened an account
 * (owner, 2026-11-24: "let them know we created their account"). Pure, shared
 * by the server (lib/newCustomerSession.js sets the cookie, app/(site)/layout.js
 * reads it) and the card (components/NewAccountWelcome.js clears it).
 */

export const WELCOME_COOKIE = 'lukka_welcome';
// Long enough for the redirect, or for coming back from WhatsApp; short
// enough that a later visit never says it again.
export const WELCOME_MAX_AGE = 10 * 60;

/** The first word of the name, at most 30 characters; '' when there is none. */
export function welcomeName(fullName) {
  const first = String(fullName || '').trim().split(/\s+/)[0] || '';
  return first.slice(0, 30);
}

/**
 * The cookie's value as the card shows it: the first name, or '' for "no
 * name" ('-') — null when there is nothing to welcome.
 *
 * @param {string|undefined} raw
 * @returns {string|null}
 */
export function welcomeFromCookie(raw) {
  if (!raw) return null;
  let value = '';
  try {
    value = decodeURIComponent(String(raw));
  } catch {
    value = '';
  }
  return value === '-' ? '' : welcomeName(value);
}
