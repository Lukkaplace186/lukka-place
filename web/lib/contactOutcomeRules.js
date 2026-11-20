/**
 * « Vos contacts de la semaine » on "Faites le point" (2026-11-20, owner):
 * each customer who tapped the agent's WhatsApp / Appeler button in the last
 * 7 days, and one tap to say what came of it. Pure — the page, the action and
 * the tests share it. French only, like the rest of the page.
 *
 * The answer lands on the engine's contact_tap_alerts row
 * (POST /admin/contact-taps/:id/outcome); « Visite prévue » and « Visite
 * faite » also create the visit (engine services/directVisit.js), so it
 * reaches /admin/viewings and the visit follow-ups.
 */

export const CONTACT_OUTCOMES = Object.freeze(['VISIT_PLANNED', 'VISITED', 'TALKING', 'NOT_INTERESTED', 'CLOSED']);

export const CONTACT_OUTCOME_LABELS_FR = Object.freeze({
  VISIT_PLANNED: 'Visite prévue',
  VISITED: 'Visite faite',
  TALKING: 'En discussion',
  NOT_INTERESTED: 'Pas intéressé',
  CLOSED: 'Bien loué / vendu',
});

/** What the customer asked for, as the agent reads it. */
export const CONTACT_INTENT_LABELS_FR = Object.freeze({
  visit: 'Le client veut visiter',
  video_visit: 'Le client veut visiter par appel vidéo',
  availability: 'Le client demande si le bien est disponible',
  question: 'Le client a une question',
});

export const CONTACT_WINDOW_DAYS = 7;

export function isContactOutcome(value) {
  return CONTACT_OUTCOMES.includes(value);
}

/** "mar. 18 nov., 13:40" in Kinshasa time, or '' for a bad date. */
export function contactWhenFr(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Kinshasa',
  }).format(date);
}

/**
 * The engine's alert rows → what the section shows. Call taps say "a appelé";
 * a customer's number appears only when they left it.
 *
 * @param {Object[]} alerts engine rows (id, property_id, kind, intent, created_at, answer, customer_name, customer_phone, outcome)
 * @param {Map<number, {title?: string, reference?: string}>} labels listing labels
 */
export function contactOutcomeItems(alerts, labels = new Map()) {
  return (alerts || []).map((alert) => {
    const listingId = Number(alert.property_id);
    const label = labels.get(listingId) || {};
    const phone = String(alert.customer_phone || '').replace(/\D/g, '');
    return {
      id: Number(alert.id),
      when: contactWhenFr(alert.created_at),
      listingId,
      listingTitle: label.title || `Annonce n° ${listingId}`,
      what: alert.kind === 'call'
        ? 'Le client a appuyé sur « Appeler »'
        : CONTACT_INTENT_LABELS_FR[alert.intent] || 'Le client a appuyé sur « WhatsApp »',
      customer: phone ? `${alert.customer_name ? `${alert.customer_name} · ` : ''}+${phone}` : null,
      customerPhone: phone || null,
      outcome: isContactOutcome(alert.outcome) ? alert.outcome : null,
      saidNothing: alert.answer === 'NOTHING',
    };
  });
}
