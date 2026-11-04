/**
 * services/agentProfileEnquiry.js
 *
 * "Demandez ce bien à cet agent" — the enquiry form on an agent's public
 * profile (web/app/(portfolio)/agents/[id]). Before this module the request
 * was written to `leads` and nothing else happened: it names no commune, so
 * services/leadDispatch.js skips it ("no commune — not dispatched"), and no
 * other path told anybody. Lead #21 (2026-10-25) sat unseen for nine days.
 *
 * Same shape as services/projectEnquiry.js, and the same rules bind:
 *
 *   - Recipients are the NAMED agent plus Lukka Place's desk, never the
 *     seven ranked agencies: the customer chose this agent.
 *   - The agent is alerted only when their number passes
 *     propertyRepository.directRoutingBlocker (verified, routing not switched
 *     off) and the account is not deleted.
 *   - `leads.agent_id` is stamped with the agent, one of the ownership
 *     signals db.listLeads ORs, so the request is in their Demandes inbox.
 *
 * The alert goes through services/agentEnquiryAlert.js: the session text
 * inside the 24 h window, the `nouvelle_demande_agent` template outside it.
 * The desk copy warns only when it still had to go as a session message
 * outside the window (no template configured, or refused), because
 * "prévenu" would otherwise read as delivered when it almost certainly was
 * not.
 */

const agentEnquiryAlert = require('./agentEnquiryAlert');
const deskAlert = require('./deskAlert');
const db = require('./db');
const propertyRepository = require('./propertyRepository');

const SITE_URL = (process.env.PUBLIC_SITE_URL || 'https://lukkaplace.com').replace(/\/+$/, '');

const SOURCE = 'agent-profile-inquiry';

function opsNumber() {
  return require('./opsDesk').opsNumber();
}

function displayPhone(waId) {
  const digits = String(waId || '').replace(/\D/g, '');
  return digits ? `+${digits}` : 'numéro inconnu';
}

/** The visitor's own answers, as the web form folded them into requirements_summary. */
function summaryLines(lead) {
  return String(lead.requirements_summary || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 6)
    .map((line) => line.slice(0, 300));
}

function agentMessage({ lead, contact }) {
  const lines = [
    '📩 [Lukka Place] Nouvelle demande client sur votre profil',
    `👤 Client : ${lead.name ? `${lead.name} — ` : ''}${displayPhone(lead.wa_id)}`,
  ];
  for (const line of summaryLines(lead)) lines.push(`💬 ${line}`);
  lines.push(
    '',
    `Bonjour ${contact.agent_name || ''}`.trim() + ', merci de recontacter ce client rapidement.',
    `${SITE_URL}/compte/agent/demandes?lead=${lead.id}`,
  );
  return lines.join('\n');
}

function opsMessage({ lead, contact, agentId, agentNotified, skipReason, outsideWindow }) {
  const lines = [
    '📩 [Lukka Place] Demande via le profil d’un agent',
    '',
    `• Agent : ${contact?.agent_name || `#${agentId}`} (#${agentId})`,
    `• Client : ${lead.name ? `${lead.name} — ` : ''}${displayPhone(lead.wa_id)}`,
  ];
  for (const line of summaryLines(lead)) lines.push(`• ${line}`);
  lines.push('');
  if (!agentNotified) {
    lines.push(`⚠️ Agent NON prévenu (${skipReason}) — à traiter manuellement.`);
  } else if (outsideWindow) {
    lines.push('⚠️ Message envoyé à l’agent, mais il ne nous a pas écrit depuis 24 h : WhatsApp ne le lui livrera probablement pas. Appelez-le.');
  } else {
    lines.push('Agent prévenu sur WhatsApp.');
  }
  lines.push(`${SITE_URL}/admin/leads/${lead.id}`);
  return lines.join('\n');
}

/**
 * Assign the lead to the named agent and tell them and the desk.
 * Never throws: the lead is already saved and the visitor already answered.
 *
 * @param {{lead: Object, agentId: number}} input
 * @returns {Promise<{agentNotified: boolean, opsNotified: boolean, skipReason: string|null, outsideWindow: boolean}>}
 */
async function notifyAgentProfileEnquiry({ lead, agentId }) {
  const contact = await propertyRepository.getAgentContactById(agentId);
  if (contact && !contact.deleted) {
    db.assignLead(lead.id, { agentId: Number(agentId), assignedAgent: contact.agent_name || lead.assigned_agent || null });
  }

  let skipReason = !contact
    ? 'agent introuvable'
    : contact.deleted
      ? 'compte agent supprimé'
      : propertyRepository.directRoutingBlocker(contact);
  let agentNotified = false;
  let outsideWindow = false;
  if (!skipReason) {
    try {
      const sent = await agentEnquiryAlert.sendAgentEnquiryAlert(contact.agent_phone, agentMessage({ lead, contact }), {
        agentName: contact.agent_name,
        subject: 'votre profil Lukka Place',
        client: `${lead.name ? `${lead.name}, ` : ''}${displayPhone(lead.wa_id)}`,
        message: summaryLines(lead).join(' · '),
        leadId: lead.id,
        label: `profile enquiry lead #${lead.id}`,
      });
      // Only a session message sent outside the window is likely lost; a
      // template reaches the agent whenever they last wrote.
      outsideWindow = sent.outsideWindow && sent.via === 'session';
      agentNotified = true;
    } catch (err) {
      skipReason = `échec de l'envoi : ${err.message}`;
      console.error(`[profile-enquiry] agent alert for lead #${lead.id} failed: ${err.message}`);
    }
  }

  let opsNotified = false;
  const ops = opsNumber();
  if (ops) {
    try {
      await deskAlert.sendDeskAlert(
        ops,
        opsMessage({ lead, contact, agentId, agentNotified, skipReason, outsideWindow }),
        { label: 'profile enquiry' },
      );
      opsNotified = true;
    } catch (err) {
      console.error(`[profile-enquiry] ops copy for lead #${lead.id} failed: ${err.message}`);
    }
  } else if (!agentNotified) {
    console.error(`[profile-enquiry] lead #${lead.id} reached NOBODY — ${skipReason}, and OPS_WHATSAPP_NUMBER is unset`);
  }

  console.log(
    `[profile-enquiry] lead #${lead.id} -> agent #${agentId}: `
      + `${agentNotified ? (outsideWindow ? 'sent (outside 24 h window)' : 'sent') : `not sent (${skipReason})`}, `
      + `desk ${opsNotified ? 'told' : 'not told'}`,
  );
  return { agentNotified, opsNotified, skipReason, outsideWindow };
}

function notifyAgentProfileEnquiryInBackground(input) {
  setImmediate(() => {
    notifyAgentProfileEnquiry(input).catch((err) => {
      console.error(`[profile-enquiry] unhandled failure for lead #${input?.lead?.id}: ${err.message}`);
    });
  });
}

module.exports = {
  SOURCE,
  notifyAgentProfileEnquiry,
  notifyAgentProfileEnquiryInBackground,
  // Exposed for scripts/verify-pipeline.js.
  agentMessage,
  opsMessage,
};
