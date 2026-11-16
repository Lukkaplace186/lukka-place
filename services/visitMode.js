/**
 * services/visitMode.js
 *
 * Video visits, in the messages. A customer abroad — the diaspora renting or
 * buying in Kinshasa from Paris, Brussels, Washington — asks to see the home
 * on a WhatsApp video call; the agent calls them from the property at the
 * booked time. Everything else is the ordinary visit loop.
 *
 *   viewing_requests.visit_mode   'video', or NULL = on site
 *                                 (services/db.js normalizeVisitMode — the
 *                                 app's "En vidéo", 2026-11-13; the website
 *                                 and the WhatsApp chooser since 2026-11-16)
 *
 * The web adds VIDEO_PHRASE to the time it sends (web lib/visitModeRules.js
 * requestedTimeWithMode), so `requested_time` already says it. A time the
 * engine formats itself — the agreed instant, the desk's copy — does not, and
 * `withVisitMode` adds the same phrase there, never twice. That is also how the
 * approved `demande_visite_agent_v3` carries it without a new template: its
 * date/time variable reads « mardi 18 novembre à 10h00 (appel vidéo WhatsApp) ».
 *
 * Pure module: no database, no network.
 */

/** The words after the time — the same as web lib/visitModeRules.js VIDEO_PHRASE. */
const VIDEO_PHRASE = '(appel vidéo WhatsApp)';

/** What the agent must do, in the alert and their confirmation. */
const VIDEO_AGENT_LINE = "📹 Visite par appel vidéo : appelez le client en vidéo sur WhatsApp à l'heure prévue.";

/** What the customer is told once the agent confirmed. */
const VIDEO_CUSTOMER_LINE = "📹 Visite par appel vidéo : l'agent vous appellera en vidéo sur WhatsApp à l'heure prévue.";

/** The warning every video booking carries (owner's wording, 2026-11-16). */
const VIDEO_PAYMENT_WARNING = "⚠️ Ne versez aucun argent sur la seule base d'une vidéo.";

function isVideoVisit(row) {
  return row?.visit_mode === 'video';
}

/** « mardi 18 novembre à 10h00 » → « … (appel vidéo WhatsApp) » for a video visit, once. */
function withVisitMode(slotText, row) {
  const text = String(slotText || '').trim();
  if (!isVideoVisit(row)) return slotText;
  if (!text) return `Visite ${VIDEO_PHRASE}`;
  return text.includes(VIDEO_PHRASE) ? text : `${text} ${VIDEO_PHRASE}`;
}

module.exports = {
  VIDEO_PHRASE,
  VIDEO_AGENT_LINE,
  VIDEO_CUSTOMER_LINE,
  VIDEO_PAYMENT_WARNING,
  isVideoVisit,
  withVisitMode,
};
