/**
 * Pure rules for opening a customer account from a form that already asked
 * for a name and a WhatsApp number (2026-11-24, owner: "as easy as possible
 * for customers to sign up"): "Trouver pour moi" and "Demander une visite".
 * lib/guestAccount.js applies them; nothing here touches the database.
 *
 * The account is opened with no password ('!whatsapp' marker, see
 * lib/whatsappSignInRules.js) and NO session: the person proves the number
 * by sending a code from that WhatsApp, the same step as "Continuer avec
 * WhatsApp". So typing someone else's number opens nothing anyone can use.
 */

import { isDemoPhone } from './demoPhone';
import { cleanFullName } from './whatsappSignInRules';

/** The checkbox each form carries, ticked by default; unticked = no account. */
export const OPEN_ACCOUNT_FIELD = 'openAccount';

/**
 * Whether the form asked for an account. The form posts a hidden "0" and,
 * when the box is ticked, a "1" after it — pass `formData.getAll(field)`.
 * A form without the field at all (a page cached before it) counts as yes,
 * the box's default.
 *
 * @param {string|string[]|null|undefined} values
 */
export function accountRequested(values) {
  const list = (Array.isArray(values) ? values : [values]).filter((v) => v != null).map(String);
  if (list.length === 0) return true;
  return list.includes('1');
}

/**
 * What to do with this person, before any database read.
 *
 * @param {{phone: string|null, name?: string|null, requested: boolean, signedIn: boolean}} input
 * @returns {{action: 'skip', reason: string} | {action: 'lookup', fullName: string|null}}
 */
export function guestAccountPlan({ phone, name, requested, signedIn }) {
  if (!requested) return { action: 'skip', reason: 'declined' };
  if (signedIn) return { action: 'skip', reason: 'signed_in' };
  if (!phone) return { action: 'skip', reason: 'no_phone' };
  // Demo numbers never become real accounts (root CLAUDE.md, "Demo accounts").
  if (isDemoPhone(phone)) return { action: 'skip', reason: 'demo' };
  return { action: 'lookup', fullName: cleanFullName(name) };
}

/**
 * Where the confirmation sends the person to prove the number: the code
 * screen of "Continuer avec WhatsApp", which reads the signed attempt cookie
 * lib/guestAccount.js set. `nouveau=1` says "votre compte est créé".
 */
export function proveAccountHref(status, next = '/compte/client') {
  const query = new URLSearchParams({ next });
  if (status === 'created') query.set('nouveau', '1');
  if (status === 'existing') query.set('compte', 'existant');
  return `/compte/connexion/whatsapp?${query.toString()}`;
}

/** The two outcomes a confirmation screen has something to say about. */
export function accountStatusParam(status) {
  return status === 'created' || status === 'existing' ? status : null;
}
