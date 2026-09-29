import { toTime } from './visitAgenda';

/**
 * The agent's "Visite effectuée" (bon de visite) — when it can be declared.
 * Same rule as the engine's services/visitReceipt.js: a CONFIRMED visit whose
 * agreed slot has started, answered once.
 */
export const VISIT_OUTCOMES = ['DONE', 'NOT_DONE'];

export function canDeclareVisitOutcome(visit, now = new Date()) {
  if (visit?.status !== 'CONFIRMED' || visit.agent_visit_outcome) return false;
  const at = toTime(visit.scheduled_at);
  return at != null && at <= now.getTime();
}

/** The receipt sent from the agent's own WhatsApp — wa.me to the customer. */
export function receiptWhatsAppHref(customerWaId, text) {
  const digits = String(customerWaId || '').replace(/\D/g, '');
  return digits && text ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : null;
}
