/**
 * services/visitMode.js
 *
 * "Visite par appel vidéo" (2026-11-16, owner): a customer abroad — the
 * diaspora buying or renting in Kinshasa from Paris, Brussels, Washington —
 * asks to visit by WhatsApp video call. The agent calls them from the
 * property at the booked time. Everything else about the visit is the same
 * request: the same slot, the same Accepter / Autre créneau / Décliner loop,
 * the same check-in and bon de visite.
 *
 *   viewing_requests.visit_mode   'in_person' | 'video'
 *                                 NULL on every row written before this —
 *                                 read as in person, never rewritten.
 *
 * The mode is a separate column, never folded into `requested_time`: that
 * phrase is replaced by the agent's proposal when they move the time, and the
 * mode must survive the move. Messages append it where they print the slot
 * (`withVisitMode`), which is also how the approved `demande_visite_agent_v3`
 * template carries it without a new template: its date/time variable reads
 * « mardi 18 nov. à 10h00 · par appel vidéo ».
 *
 * Pure module: no database, no network.
 */

const VISIT_MODES = Object.freeze(['in_person', 'video']);

/** Printed after the slot wherever a message shows it. */
const VIDEO_SUFFIX = 'par appel vidéo';

/** What the agent must do, in the alert and their confirmation. */
const VIDEO_AGENT_LINE = "📹 Visite par appel vidéo : appelez le client en vidéo sur WhatsApp à l'heure prévue.";

/** What the customer is told once the agent confirmed. */
const VIDEO_CUSTOMER_LINE = "📹 Visite par appel vidéo : l'agent vous appellera en vidéo sur WhatsApp à l'heure prévue.";

/** The warning every video booking carries (owner's wording, 2026-11-16). */
const VIDEO_PAYMENT_WARNING = "⚠️ Ne versez aucun argent sur la seule base d'une vidéo.";

/**
 * The `visit_mode` a route accepts: absent → null (in person, as before);
 * 'in_person' or 'video' → itself; anything else is refused, never coerced.
 * @returns {{value: ('in_person'|'video'|null)}|{error: string}}
 */
function resolveVisitModeInput(raw) {
  if (raw === undefined || raw === null || raw === '') return { value: null };
  const text = String(raw).trim();
  if (VISIT_MODES.includes(text)) return { value: text };
  return { error: `visit_mode must be one of ${VISIT_MODES.join(', ')}.` };
}

function isVideoVisit(row) {
  return row?.visit_mode === 'video';
}

/** « mardi 18 nov. à 10h00 » → « mardi 18 nov. à 10h00 · par appel vidéo » for a video visit. */
function withVisitMode(slotText, row) {
  if (!isVideoVisit(row)) return slotText;
  const text = String(slotText || '').trim();
  return text ? `${text} · ${VIDEO_SUFFIX}` : `Visite ${VIDEO_SUFFIX}`;
}

module.exports = {
  VISIT_MODES,
  VIDEO_SUFFIX,
  VIDEO_AGENT_LINE,
  VIDEO_CUSTOMER_LINE,
  VIDEO_PAYMENT_WARNING,
  resolveVisitModeInput,
  isVideoVisit,
  withVisitMode,
};
