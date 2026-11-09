/**
 * The reply a customer gets when they wrote to Lukka Place from a listing,
 * an agent profile, the agent directory or a project page (2026-11-09, owner
 * decision: "the WhatsApp button goes through the Lukka Place number first").
 *
 * WHY
 * The button used to open the agent's personal WhatsApp directly: 102 taps in
 * 30 days, and after each one we never learned who the customer was or what
 * happened. Now the customer's first message reaches us, so we record them
 * and a lead and alert the agent — and this reply hands the customer the
 * agent's own WhatsApp at once, so going through us costs them one tap, not a
 * wait.
 *
 * Only for an agent who passed the shared gate (verified number, not deleted,
 * routing on): the same agent whose number the page shows. The customer's
 * conversation with the agent afterwards is between two personal phones and
 * invisible to us, which the owner accepted; the lead, the alert and the
 * 24 h follow-up are what we keep.
 */

/** wa.me link to the agent with a short pre-typed greeting naming the subject. */
function agentWhatsAppLink(agentPhone, about) {
  const digits = String(agentPhone || '').replace(/\D/g, '');
  if (!digits) return null;
  const text = `Bonjour, je vous contacte via Lukka Place${about ? ` au sujet de ${about}` : ''}.`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

/**
 * @param {Object} p
 * @param {string} p.agentName     who will answer ("Prince Immo Tout Kin")
 * @param {string} p.agentPhone    their verified number (digits)
 * @param {string} [p.about]       what the customer asked about, as a phrase
 *                                 ("le bien « Boutique à louer à Limete »")
 * @param {boolean} [p.repeat]     the customer already wrote about this today:
 *                                 no second "il a reçu votre demande"
 */
function agentHandoffReply({ agentName, agentPhone, about = null, repeat = false }) {
  const name = String(agentName || '').trim() || "L'agent";
  const link = agentWhatsAppLink(agentPhone, about);
  const lines = [repeat ? 'Bonjour à nouveau !' : 'Bonjour ! Merci pour votre message.'];
  lines.push('');
  lines.push(
    repeat
      ? `${name} a déjà reçu votre demande${about ? ` pour ${about}` : ''} avec votre numéro.`
      : `${name} a reçu votre demande${about ? ` pour ${about}` : ''} avec votre numéro et va vous répondre.`,
  );
  if (link) {
    lines.push('', `Vous pouvez aussi lui écrire directement sur WhatsApp : ${link}`);
    lines.push(`Son numéro : +${String(agentPhone).replace(/\D/g, '')}`);
  }
  lines.push('', 'Lukka Place reste disponible ici si vous avez besoin d\'aide.');
  return lines.join('\n');
}

module.exports = { agentHandoffReply, agentWhatsAppLink };
