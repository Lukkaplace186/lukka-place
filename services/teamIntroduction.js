/**
 * services/teamIntroduction.js
 *
 * "Mise en relation" — the desk put a customer in touch with an agent outside
 * the website. Measured 2026-11-04: a customer reached a commissionnaire from
 * the site, the team phoned the commissionnaire, and he WhatsApped the
 * customer from his own phone. Nothing about it existed on our side: a
 * conversation between two personal numbers is invisible to this system by
 * construction, so the only way it is ever counted is somebody recording it.
 *
 * Stored as a `leads` row (source 'team-introduction'), not a table of its
 * own, because a lead is already everything this needs to be:
 *
 *   - `agent_id` puts it in that agent's Demandes inbox, where the agent can
 *     mark it CONTACTED (the same status their own enquiries use), so the
 *     agent's side of the interaction is recorded too;
 *   - it shows on /admin/leads and is counted by GET /admin/interaction-counts
 *     beside every other customer → agent channel.
 *
 * It names no commune, so services/leadDispatch.js never pushes it to the
 * seven ranked agencies (the customer is already with one agent), and this
 * module sends nothing at all: the team has just spoken to the agent.
 *
 * The caller (web's console) resolves the agent id against Postgres and
 * sends its display name with it, like assignLeadAction does — the engine's
 * leads table has no Postgres access of its own.
 */

const db = require('./db');

const SOURCE = 'team-introduction';

/** How the desk put them in touch. */
const CHANNELS = ['phone', 'whatsapp', 'in_person', 'other'];

const MAX_NOTE = 1000;

function positiveInt(value) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 && String(n) === String(value).trim() ? n : null;
}

function cleanText(value, max) {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, max) : null;
}

/**
 * Check and shape one introduction. Pure; throws nothing.
 *
 * @returns {{ok: true, value: Object} | {ok: false, error: string}}
 */
function validateIntroduction(input = {}) {
  const waId = String(input.wa_id ?? '').replace(/\D/g, '');
  if (!/^\d{7,15}$/.test(waId)) return { ok: false, error: 'invalid-phone' };

  const agentId = positiveInt(input.agent_id);
  if (!agentId) return { ok: false, error: 'agent-required' };

  let propertyId = null;
  if (input.property_id !== undefined && input.property_id !== null && String(input.property_id).trim() !== '') {
    propertyId = positiveInt(input.property_id);
    if (!propertyId) return { ok: false, error: 'invalid-property' };
  }

  const channel = CHANNELS.includes(input.channel) ? input.channel : null;
  if (!channel) return { ok: false, error: 'invalid-channel' };

  return {
    ok: true,
    value: {
      waId,
      agentId,
      propertyId,
      channel,
      name: cleanText(input.name, 120),
      assignedAgent: cleanText(input.assigned_agent, 160),
      note: cleanText(input.note, MAX_NOTE),
      recordedBy: cleanText(input.recorded_by, 160),
      // The team knows the agent already reached the customer (the case that
      // started this). Otherwise the lead waits at NEW for the agent to mark it.
      agentContacted: input.agent_contacted === true || input.agent_contacted === 'true',
    },
  };
}

/**
 * Record one introduction.
 *
 * @returns {{ok: true, lead: Object} | {ok: false, error: string}}
 */
function recordIntroduction(input) {
  const checked = validateIntroduction(input);
  if (!checked.ok) return checked;
  const v = checked.value;

  const lead = db.recordTeamIntroductionLead({
    wa_id: v.waId,
    name: v.name,
    source: SOURCE,
    property_id: v.propertyId,
    requirements_summary: v.note,
    status: v.agentContacted ? 'CONTACTED' : 'NEW',
    contact_channel: v.channel,
    recorded_by: v.recordedBy,
    agentId: v.agentId,
    assignedAgent: v.assignedAgent,
  });
  console.log(
    `[team-introduction] lead #${lead.id}: customer ${v.waId} -> agent #${v.agentId} via ${v.channel}`
      + `${v.propertyId ? ` (listing #${v.propertyId})` : ''}${v.agentContacted ? ', already contacted' : ''}`,
  );
  return { ok: true, lead };
}

module.exports = {
  SOURCE,
  CHANNELS,
  validateIntroduction,
  recordIntroduction,
};
