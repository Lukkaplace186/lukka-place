/**
 * One way out for every message addressed to Lukka Place's own people — the
 * desk phone (OPS_WHATSAPP_NUMBER) and the owners' phones
 * (ADMIN_ALERT_NUMBERS, as the fallback of an "annonce à valider").
 *
 * Those used to be session messages only, which Meta delivers solely to a
 * number that messaged the business in the last 24 hours — hence the daily
 * "répondez OK" keep-alive. With DESK_ALERT_TEMPLATE set, every such message
 * goes out as that template instead and arrives whatever the window says.
 *
 * Template (UTILITY, fr — the exact text is in CLAUDE.md, "Desk alerts"):
 *   body {{1}} subject — the message's first line
 *        {{2}} details — every other line, joined on one line
 *   a STATIC "Ouvrir la console" URL button, which needs nothing at send time.
 *
 * Unset → the session message it always was. A template that fails falls
 * back to that same session message, so switching it on can never lose a
 * message that used to arrive. Read at call time, like every template name.
 */

const chakra = require('./chakra');

/** Meta refuses an empty variable, a newline or a tab in one, and a body over 1 024 characters. */
const SUBJECT_MAX = 80;
const DETAILS_MAX = 700;

function templateName() {
  return String(process.env.DESK_ALERT_TEMPLATE || '').trim();
}

function enabled() {
  return chakra.templateConfigured(templateName());
}

function oneLine(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function clip(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * The two body variables for a message written for a session send: its first
 * line (leading emoji and punctuation dropped) as the subject, the rest on one
 * line separated by " · ".
 */
function deskAlertParams(text) {
  const lines = String(text || '').split(/\r?\n/).map(oneLine).filter(Boolean);
  const first = (lines.shift() || '').replace(/^[^\p{L}\p{N}]+/u, '').trim();
  const subject = clip(first || 'Notification', SUBJECT_MAX);
  const details = clip(lines.join(' · ') || 'Voir la console Lukka Place.', DETAILS_MAX);
  return [subject, details];
}

/**
 * Send `text` to one of our own numbers: template when configured, session
 * message otherwise or when the template fails. Throws only when the session
 * send itself fails — the same contract as chakra.sendWhatsAppMessage, so a
 * caller swaps one for the other without changing its error handling.
 *
 * @returns {Promise<'template'|'session'>}
 */
async function sendDeskAlert(to, text, { previewUrl = true, label = 'desk alert' } = {}) {
  const phone = String(to || '').replace(/\D/g, '');
  const name = templateName();
  if (chakra.templateConfigured(name)) {
    try {
      await chakra.sendTemplate(phone, name, {
        languageCode: String(process.env.DESK_ALERT_TEMPLATE_LANG || 'fr').trim() || 'fr',
        bodyParams: deskAlertParams(text),
      });
      return 'template';
    } catch (err) {
      console.warn(`[desk-alert] ${label}: template '${name}' failed for …${phone.slice(-4)}, sending text: ${err.message}`);
    }
  }
  await chakra.sendWhatsAppMessage(phone, text, { previewUrl });
  return 'session';
}

module.exports = {
  enabled,
  templateName,
  deskAlertParams,
  sendDeskAlert,
  SUBJECT_MAX,
  DETAILS_MAX,
};
