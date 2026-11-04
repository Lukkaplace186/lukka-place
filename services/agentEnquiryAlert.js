/**
 * services/agentEnquiryAlert.js
 *
 * How an agent hears about a customer enquiry: a listing enquiry that came in
 * through our number (listingEnquiry.js), a request from their public profile
 * (agentProfileEnquiry.js) or a project enquiry (projectEnquiry.js).
 *
 * All three used to be session messages only, which WhatsApp drops for an
 * agent who has not written to us in 24 h. `AGENT_ENQUIRY_TEMPLATE`
 * (`nouvelle_demande_agent`, UTILITY, fr, intake account, approved
 * 2026-11-03) carries the alert outside that window:
 *
 *   Bonjour {{1}}, un client vous contacte via Lukka Place au sujet de : {{2}}.
 *   Client : {{3}}
 *   Message : {{4}}
 *   Répondez-lui rapidement depuis votre espace Lukka Place.
 *   [Voir la demande] → https://lukkaplace.com/compte/agent/demandes?lead={{1}}
 *
 * Inside the window the old text is sent, as the moderation verdict does
 * (owner's preference: the text carries its own link and reads as a message,
 * not as "[template]" in Chakra's inbox). Outside it, the template; when the
 * template is unset, has no lead id for its button, or is refused, the text
 * goes anyway — nothing that used to arrive can be lost.
 */

const chakra = require('./chakra');
const { insideSessionWindow } = require('./sessionWindow');

/** Meta caps a body variable at 1024 characters; ours stay far shorter. */
const PARAM_LIMITS = { agent: 60, subject: 160, client: 120, message: 300 };

function templateName() {
  return String(process.env.AGENT_ENQUIRY_TEMPLATE || '').trim();
}

function templateLanguage() {
  return String(process.env.AGENT_ENQUIRY_TEMPLATE_LANG || 'fr').trim() || 'fr';
}

/** Meta refuses a variable with a newline, a tab or four spaces in a row, and an empty one. */
function oneLine(value, max, fallback) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return fallback;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** The four body variables, in the order the approved template declares them. */
function templateParams({ agentName, subject, client, message }) {
  return [
    oneLine(agentName, PARAM_LIMITS.agent, 'cher partenaire'),
    oneLine(subject, PARAM_LIMITS.subject, 'un de vos biens'),
    oneLine(client, PARAM_LIMITS.client, 'numéro inconnu'),
    oneLine(message, PARAM_LIMITS.message, 'demande de renseignements'),
  ];
}

/**
 * Send one enquiry alert. Throws only when the session text itself fails,
 * exactly as the chakra.sendWhatsAppMessage call it replaces did.
 *
 * @param {string} phone  The agent's number (digits).
 * @param {string} text   The session message (used inside the window, and as the fallback).
 * @param {{agentName?: string, subject?: string, client?: string, message?: string, leadId?: number|string, label?: string, now?: Date}} details
 * @returns {Promise<{via: 'template'|'session', outsideWindow: boolean}>}
 */
async function sendAgentEnquiryAlert(phone, text, details = {}) {
  const to = String(phone || '').replace(/\D/g, '');
  const outsideWindow = !insideSessionWindow(to, details.now || new Date());
  const name = templateName();
  const label = details.label || 'enquiry';

  if (outsideWindow && chakra.templateConfigured(name) && details.leadId != null) {
    try {
      await chakra.sendTemplate(to, name, {
        languageCode: templateLanguage(),
        bodyParams: templateParams(details),
        urlButton: String(details.leadId),
      });
      console.log(`[enquiry-alert] ${label}: template '${name}' accepted for …${to.slice(-4)}`);
      return { via: 'template', outsideWindow };
    } catch (err) {
      console.warn(`[enquiry-alert] ${label}: template '${name}' failed for …${to.slice(-4)}, sending text: ${err.message}`);
    }
  }

  await chakra.sendWhatsAppMessage(to, text, { previewUrl: true });
  return { via: 'session', outsideWindow };
}

module.exports = {
  templateName,
  templateParams,
  sendAgentEnquiryAlert,
};
