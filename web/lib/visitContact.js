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
