/**
 * Pure numbers and text for "Changer de numéro" (lib/customerPhoneChange.js),
 * kept apart so the page, the action and the tests share them.
 */

/** Codes a customer can ask for in one hour: each one is a WhatsApp to a number nobody has proved yet. */
export const PHONE_CHANGE_MAX_SENDS_PER_HOUR = 5;

/** Wrong codes before the change has to be started again (a new code). */
export const PHONE_CHANGE_MAX_ATTEMPTS = 5;

/** The session-message body when the code template is unavailable. French: the customer's WhatsApp reads it. */
export function phoneChangeCodeText(code) {
  return `Votre code Lukka Place pour utiliser ce numéro sur votre compte : ${code} (valable 10 minutes). Si vous n'avez rien demandé, ignorez ce message.`;
}
