/**
 * services/leadClaims.js
 *
 * An agency's answer to a request alert (2026-11-10, owner decisions):
 *
 *   "Je m'en occupe"  the agency takes the request. Up to MAX_CLAIMS (3)
 *                     agencies may; claiming is free (only proposing a
 *                     listing uses the monthly quota) and gives the agency
 *                     the customer's number at once. The customer is told
 *                     who is handling it.
 *   "Pas dispo"       recorded; when every agency of the current wave said
 *                     so, the next wave goes at once instead of waiting.
 *
 * Both arrive as WhatsApp quick-reply buttons (`lead_claim:<matchId>`,
 * `lead_pass:<matchId>`) or from the agent dashboard (POST
 * /admin/leads/:id/claim). Only the agency the alert went to may answer:
 * on WhatsApp the sender must be the number it was sent to, on the dashboard
 * the signed-in agent must be that match's agent. A stranger's tap is
 * ignored silently (an answer would confirm the id is real).
 *
 * Messages to people run after the write, never throw, and log what was sent.
 */

const db = require('./db');
const { leadCommunes } = require('./leadCommunes');
const dispatch = require('./leadDispatch');

const SITE_URL = (process.env.PUBLIC_SITE_URL || 'https://lukkaplace.com').replace(/\/+$/, '');

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

/** `lead_claim:12` -> { answer: 'claim', matchId: 12 }; anything else null. */
function parseLeadButtonId(replyId) {
  const match = /^lead_(claim|pass):(\d+)$/.exec(String(replyId || '').trim());
  if (!match) return null;
  return { answer: match[1], matchId: Number.parseInt(match[2], 10) };
}

function whereLabel(lead) {
  const communes = leadCommunes(lead);
  return communes.length ? communes.join(', ') : 'Kinshasa';
}

/** wa.me link with an opening line the agency can send as is. */
function customerChatLink(lead) {
  const text = `Bonjour, je vous contacte de la part de Lukka Place au sujet de votre recherche à ${whereLabel(lead)}.`;
  return `https://wa.me/${digits(lead.wa_id)}?text=${encodeURIComponent(text)}`;
}

function claimedText(lead, claims) {
  const number = digits(lead.wa_id);
  return [
    `✅ C’est noté : vous vous occupez de cette demande (${claims}ᵉ agence sur ${dispatch.MAX_CLAIMS} au plus).`,
    '',
    `• Client : ${lead.name || 'Nom non précisé'}`,
    `• WhatsApp : +${number}`,
    `• Recherche : ${whereLabel(lead)}${lead.bedrooms != null ? `, ${lead.bedrooms} chambre(s)` : ''}${dispatch.budgetLabel(lead) ? `, ${dispatch.budgetLabel(lead)}` : ''}`,
    '',
    'Écrivez-lui maintenant :',
    customerChatLink(lead),
    '',
    'Proposez-lui un de vos biens depuis votre espace :',
    dispatch.agentLink(lead.id),
  ].join('\n');
}

const FULL_TEXT = `Merci ! ${dispatch.MAX_CLAIMS} agences s’occupent déjà de cette demande. Vous serez prévenu de la prochaine.`;
const PASS_TEXT = 'C’est noté, merci. Répondre aux demandes, même par « Pas dispo », vous garde en tête de liste pour les prochaines.';

function customerText(lead, agencyName) {
  return [
    `Bonne nouvelle : ${agencyName ? `l’agence *${agencyName}*` : 'une agence partenaire'} s’occupe de votre recherche à ${whereLabel(lead)}.`,
    'Elle va vous contacter sur ce numéro WhatsApp.',
    '',
    '— Lukka Place',
  ].join('\n');
}

async function send(to, text, label) {
  try {
    // eslint-disable-next-line global-require
    await require('./chakra').sendWhatsAppMessage(digits(to), text, { previewUrl: false });
    console.log(`[lead-claims] ${label}: sent`);
    return true;
  } catch (err) {
    console.error(`[lead-claims] ${label}: NOT sent — ${err.message}`);
    return false;
  }
}

async function agencyName(agentId) {
  try {
    // eslint-disable-next-line global-require
    const contact = await require('./propertyRepository').getAgentContactById(agentId);
    return contact?.agent_name || null;
  } catch {
    return null;
  }
}

/** When every agency of the current wave said "Pas dispo", send the next wave now. */
function advanceIfWaveDeclined(leadId) {
  const lead = db.getLead(leadId);
  if (!lead || lead.dispatch_closed_at || !lead.dispatch_wave) return false;
  const current = db.getLeadMatches(leadId).filter((m) => Number(m.wave) === Number(lead.dispatch_wave));
  if (current.length === 0 || current.some((m) => !m.declined_at)) return false;
  setImmediate(() => {
    dispatch.dispatchNextWave(lead).catch((err) => console.error(`[lead-claims] early wave for lead #${leadId}: ${err.message}`));
  });
  return true;
}

/**
 * Claim or decline one match. `notify` sends the WhatsApp replies (the
 * dashboard shows the result itself, so it only tells the customer).
 *
 * @returns {Promise<{ok: boolean, outcome: string, claims?: number, customer?: {name: string|null, wa_id: string}}>}
 */
async function answerMatch(match, answer, { channel, replyTo = null } = {}) {
  const lead = db.getLead(match.lead_id);
  if (!lead) return { ok: false, outcome: 'missing' };

  if (answer === 'pass') {
    const recorded = db.declineLeadMatch({ matchId: match.id, channel });
    if (replyTo) await send(replyTo, PASS_TEXT, `pass on lead #${lead.id} by agent #${match.agent_id}`);
    const advanced = recorded ? advanceIfWaveDeclined(lead.id) : false;
    console.log(`[lead-claims] lead #${lead.id}: agent #${match.agent_id} passed (recorded: ${recorded}, next wave now: ${advanced})`);
    return { ok: true, outcome: recorded ? 'declined' : (match.claimed_at ? 'already-claimed' : 'already-declined') };
  }

  const result = db.claimLeadMatch({ matchId: match.id, maxClaims: dispatch.MAX_CLAIMS, channel });
  console.log(`[lead-claims] lead #${lead.id}: agent #${match.agent_id} claim -> ${result.outcome} (${result.claims} claim(s))`);
  if (result.outcome === 'full') {
    if (replyTo) await send(replyTo, FULL_TEXT, `claim refused (full) on lead #${lead.id}`);
    return { ok: false, outcome: 'full', claims: result.claims };
  }
  if (result.outcome !== 'claimed' && result.outcome !== 'already-claimed') {
    return { ok: false, outcome: result.outcome };
  }
  const customer = { name: lead.name || null, wa_id: digits(lead.wa_id) };
  if (replyTo) await send(replyTo, claimedText(lead, result.claims), `customer details to agent #${match.agent_id} for lead #${lead.id}`);
  if (result.outcome === 'claimed' && customer.wa_id) {
    // The customer may be outside the 24 h window (a web form): the send is
    // accepted and may not arrive. Logged either way; the agency calls them.
    const name = await agencyName(match.agent_id);
    await send(customer.wa_id, customerText(lead, name), `customer told about agent #${match.agent_id} on lead #${lead.id}`);
  }
  return { ok: true, outcome: result.outcome, claims: result.claims, customer };
}

/** WhatsApp quick-reply. Returns { handled: false } for ids that are not ours. */
async function handleLeadButtonReply({ from, replyId }) {
  const parsed = parseLeadButtonId(replyId);
  if (!parsed) return { handled: false };
  const match = db.getLeadMatchById(parsed.matchId);
  if (!match) return { handled: true, ignored: 'unknown-match' };
  if (!digits(from) || digits(from) !== digits(match.agent_phone)) {
    console.warn(`[lead-claims] '${replyId}' from ${from} refused — not the agency it was sent to`);
    return { handled: true, ignored: 'not-this-agent' };
  }
  const out = await answerMatch(match, parsed.answer, { channel: 'whatsapp', replyTo: from });
  return { handled: true, ...out };
}

/**
 * From the agent dashboard: the signed-in agent answers its own match.
 * @returns {Promise<{ok: boolean, outcome: string, status?: number, customer?: Object}>}
 */
async function answerFromDashboard({ leadId, agentId, answer }) {
  if (!['claim', 'pass'].includes(answer)) return { ok: false, outcome: 'invalid-answer', status: 400 };
  const match = db.getLeadMatchForAgent(leadId, agentId);
  if (!match) return { ok: false, outcome: 'not-matched', status: 404 };
  return answerMatch(match, answer, { channel: 'dashboard' });
}

/**
 * A proposal from an agency that had not claimed counts as its claim (when a
 * place is left). Never throws.
 */
function claimOnProposal({ leadId, agentId }) {
  try {
    const match = db.getLeadMatchForAgent(leadId, agentId);
    if (!match || match.claimed_at) return null;
    return db.claimLeadMatch({ matchId: match.id, maxClaims: dispatch.MAX_CLAIMS, channel: 'proposal' });
  } catch (err) {
    console.error(`[lead-claims] claim on proposal (lead #${leadId}, agent #${agentId}): ${err.message}`);
    return null;
  }
}

/**
 * What the agent dashboard may show of a request reached through the
 * matching: the customer's name and number only once this agency claimed it
 * (owner decision 2026-11-10: the number comes with "Je m'en occupe").
 * `match` is this agency's row; ownedOtherwise = the request is also theirs
 * by listing, assignment or agent id, which shows the customer as before.
 */
function redactForMatchedAgency(lead, match, { ownedOtherwise = false, claims = 0 } = {}) {
  if (!match) return lead;
  const view = {
    ...lead,
    my_match: {
      id: match.id,
      wave: match.wave,
      claimed_at: match.claimed_at || null,
      declined_at: match.declined_at || null,
      neighbour_of: match.neighbour_of || null,
      claims,
      max_claims: dispatch.MAX_CLAIMS,
      full: !match.claimed_at && claims >= dispatch.MAX_CLAIMS,
    },
  };
  if (ownedOtherwise || match.claimed_at) return view;
  return { ...view, wa_id: null, name: null, customer_hidden: true };
}

module.exports = {
  parseLeadButtonId,
  handleLeadButtonReply,
  answerFromDashboard,
  answerMatch,
  claimOnProposal,
  redactForMatchedAgency,
  advanceIfWaveDeclined,
  claimedText,
  customerText,
  customerChatLink,
  FULL_TEXT,
  PASS_TEXT,
};
