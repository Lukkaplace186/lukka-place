/**
 * What the customer wants when they tap a listing's WhatsApp button
 * (2026-11-16, owner: WhatsApp goes straight to the agent, "even if it means
 * us not knowing exactly what happened — we want to know if the customer is
 * simply enquiring or requested an appointment").
 *
 * The tap is the only moment we see, so we ask then: a small sheet with three
 * answers (components/WhatsAppIntentSheet.js), each of which pre-types its
 * own question in the message the customer sends — the same pattern
 * classifieds apps use for "quick messages", so the choice saves typing
 * rather than adding a step for nothing.
 *
 *   visit         « Je veux le visiter »   → an appointment asked for
 *   availability  « Est-il disponible ? »   → an enquiry
 *   question      « Autre question »        → an enquiry, the customer types it
 *
 * The choice is stored on the tap (`whatsapp_clicks.intent`), sent to the
 * engine with the agent alert (services/contactTapAlert.js leads with it),
 * and shown on /admin/contacts. NULL = not asked (a call, a tap before this,
 * or the chooser switched off) — never inferred.
 *
 * `NEXT_PUBLIC_WHATSAPP_INTENT=off` (build time) goes back to one tap with
 * the old combined question. Pure module: shared by the client sheet, the
 * tap route and the tests.
 */

export const WHATSAPP_INTENTS = Object.freeze(['visit', 'availability', 'question']);

/** @returns {'visit'|'availability'|'question'|null} */
export function cleanWhatsAppIntent(value) {
  return WHATSAPP_INTENTS.includes(value) ? value : null;
}

/** Whether the chooser opens before WhatsApp (default on). */
export function whatsappIntentEnabled() {
  return String(process.env.NEXT_PUBLIC_WHATSAPP_INTENT || '').trim().toLowerCase() !== 'off';
}

/**
 * The question line of the pre-typed message, in the customer's voice, by
 * intent. No intent → the line every message carried before the chooser.
 * French on purpose: it is what the agent reads.
 */
export const INTENT_QUESTION_FR = Object.freeze({
  visit: 'Je souhaite visiter ce bien. Quand seriez-vous disponible ?',
  availability: 'Est-il toujours disponible ?',
  question: 'J’ai une question sur ce bien :',
  default: 'Est-il toujours disponible ? Si oui, quand serait-il possible de le visiter ?',
});

export function intentQuestionFr(intent) {
  return INTENT_QUESTION_FR[cleanWhatsAppIntent(intent) || 'default'];
}

/**
 * The console's reading of a contact (lib/contactLog.js): an appointment
 * asked for, an enquiry, or not known.
 * @returns {'visit'|'enquiry'|'unknown'}
 */
export function contactIntentGroup(intent) {
  if (intent === 'visit') return 'visit';
  if (intent === 'availability' || intent === 'question') return 'enquiry';
  return 'unknown';
}
