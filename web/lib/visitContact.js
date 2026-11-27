/**
 * The customer's optional name and WhatsApp number on « Je veux le visiter »
 * (2026-11-20, owner: "get the customer's number for visits … optional to
 * give name and phone number"). Pure — used by the sheet
 * (components/WhatsAppIntentSheet.js) and by /api/telemetry/lead-click, which
 * passes it to the engine's agent alert and never stores it in an analytics
 * table.
 */

/** Visit intents — the only taps that may carry a number. */
export const VISIT_INTENTS = Object.freeze(['visit', 'video_visit']);

export function isVisitIntent(intent) {
  return VISIT_INTENTS.includes(intent);
}

/** Per-device prefill of what the customer typed last time (never shared, never read by us). */
export const VISIT_CONTACT_STORAGE_KEY = 'lukka_visit_contact';

/** « Votre message est parti ? » shows when the customer is back 3 s – 30 min after WhatsApp opened. */
export const RETURN_PROMPT_MIN_MS = 3_000;
export const RETURN_PROMPT_MAX_MS = 30 * 60_000;

/*
 * The app branch's account offer (feat/agent-app-push d8adb9c, live since
 * 2026-11-18: components/ContactSignupPrompt.js, lib/contactSignupPrompt.js)
 * opens a sheet when a GUEST comes back from WhatsApp, unless they said
 * « Non merci » in the last 30 days. « Votre message est parti ? » must not
 * open on top of it: when that offer will show, ours stays quiet. Same
 * storage key and snooze as that module — change them together.
 */
export const ACCOUNT_OFFER_STORAGE_KEY = 'lkp_contact_signup';
export const ACCOUNT_OFFER_SNOOZE_DAYS = 30;

/**
 * @param {{signedIn: boolean, stored: {dismissedAt?: number}|null, now?: number}} state
 * @returns {boolean} whether the account offer will open on this return
 */
export function accountOfferWillShow({ signedIn, stored, now = Date.now() }) {
  if (signedIn) return false;
  const at = Number(stored?.dismissedAt);
  if (!Number.isFinite(at) || at <= 0) return true;
  return now - at >= ACCOUNT_OFFER_SNOOZE_DAYS * 24 * 60 * 60 * 1000;
}

export function cleanVisitName(value) {
  const name = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
  return name || null;
}

/**
 * What the lead-click route forwards to the engine: a visit intent, and a
 * number that is already E.164 digits (the sheet normalises it with the
 * picked country) of 7–15 digits — the platform's rule (lib/phone.js).
 * Anything else is no contact, never a guess.
 *
 * @returns {{name: string|null, phone: string}|null}
 */
export function visitContactFromBody(body, intent) {
  if (!isVisitIntent(intent)) return null;
  const raw = body?.contact;
  if (!raw || typeof raw !== 'object') return null;
  const phone = String(raw.phone ?? '').replace(/\D/g, '');
  if (phone.length < 7 || phone.length > 15) return null;
  return { name: cleanVisitName(raw.name), phone };
}
