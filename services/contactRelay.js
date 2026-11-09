/**
 * "Contacter sur WhatsApp" from an agent's profile, the agent directory or a
 * project page now opens the Lukka Place number with a pre-typed message
 * carrying the page's link (2026-11-09, owner decision — the listing button's
 * twin is services/listingEnquiry.js). This module recognises those messages:
 *
 *   https://lukkaplace.com/agents/<id>      → a lead assigned to that agent
 *                                             (source 'agent-profile-whatsapp'),
 *                                             the agent alerted, the customer
 *                                             handed the agent's WhatsApp
 *   https://lukkaplace.com/projets/<slug>   → services/projectEnquiry.js (the
 *                                             form's path: lead, developer
 *                                             alert, desk copy), then the
 *                                             developer's WhatsApp
 *
 * Same posture as the listing enquiry: deterministic (no model call), host-
 * anchored, no media, and a link that does not resolve to a public, routable
 * page falls through to ordinary processing (`handled: false`). A repeat from
 * the same customer within 24 h is one lead and one alert.
 */

const chakra = require('./chakra');
const db = require('./db');
const propertyRepository = require('./propertyRepository');
const agentEnquiryAlert = require('./agentEnquiryAlert');
const deskAlert = require('./deskAlert');
const { agentHandoffReply } = require('./contactHandoff');

const HOST = String.raw`https?:\/\/(?:www\.)?(?:lukkaplace\.com|localhost(?::\d+)?|127\.0\.0\.1(?::\d+)?)`;
const AGENT_URL = new RegExp(`${HOST}\\/agents\\/(\\d+)\\b`, 'i');
const PROJECT_URL = new RegExp(`${HOST}\\/projets\\/([a-z0-9][a-z0-9-]{0,120})`, 'i');
const SITE_URL = (process.env.PUBLIC_SITE_URL || 'https://lukkaplace.com').replace(/\/+$/, '');
const opsNumber = () => require('./opsDesk').opsNumber();

function displayPhone(waId) {
  const digits = String(waId || '').replace(/\D/g, '');
  return digits ? `+${digits}` : 'numéro inconnu';
}

/** @returns {{kind: 'agent', agentId: number}|{kind: 'project', slug: string}|null} */
function parseContactLink(text) {
  if (!text || typeof text !== 'string') return null;
  const agent = text.match(AGENT_URL);
  if (agent) {
    const agentId = Number.parseInt(agent[1], 10);
    return Number.isFinite(agentId) && agentId > 0 ? { kind: 'agent', agentId } : null;
  }
  const project = text.match(PROJECT_URL);
  return project ? { kind: 'project', slug: project[1].toLowerCase() } : null;
}

async function reply(from, text, primaryWamid) {
  try {
    await chakra.sendWhatsAppMessage(from, text, { replyToMessageId: primaryWamid || undefined, previewUrl: true });
    return true;
  } catch (err) {
    console.error(`[contact-relay] reply to ${from} failed: ${err.message}`);
    return false;
  }
}

async function handleAgentLink({ from, agentId, primaryWamid }) {
  const contact = await propertyRepository.getAgentContactById(agentId);
  if (!contact || contact.deleted) return { handled: false };
  const blocker = propertyRepository.directRoutingBlocker(contact);
  const agentName = contact.agent_name || `l'agent #${agentId}`;

  const recent = db.findRecentLeadFor({ waId: from, agentId });
  if (recent) {
    console.log(`[contact-relay] agent #${agentId} from ${from} — repeat of lead #${recent.id}, no new alert`);
    if (!blocker) await reply(from, agentHandoffReply({ agentName, agentPhone: contact.agent_phone, repeat: true }), primaryWamid);
    else await reply(from, 'Bonjour à nouveau ! Votre demande est bien enregistrée : notre équipe revient vers vous rapidement.', primaryWamid);
    return { handled: true, leadId: recent.id, repeat: true };
  }

  const lead = db.createLead({
    wa_id: from,
    source: 'agent-profile-whatsapp',
    requirements_summary: `Contact WhatsApp depuis le profil de ${agentName}`,
    status: 'NEW',
  });
  db.assignLead(lead.id, { agentId, assignedAgent: contact.agent_name || null });

  let agentNotified = false;
  if (!blocker) {
    try {
      await agentEnquiryAlert.sendAgentEnquiryAlert(
        String(contact.agent_phone),
        [
          '📩 [Lukka Place] Un client vous contacte depuis votre profil',
          `👤 Client : ${displayPhone(from)}`,
          '',
          'Le client a reçu votre numéro WhatsApp : écrivez-lui vite, il attend votre réponse.',
          `${SITE_URL}/compte/agent/demandes`,
        ].join('\n'),
        {
          agentName: contact.agent_name,
          subject: 'votre profil Lukka Place',
          client: displayPhone(from),
          message: 'Le client souhaite vous parler.',
          leadId: lead.id,
          label: `profile WhatsApp lead #${lead.id}`,
        },
      );
      agentNotified = true;
    } catch (err) {
      console.error(`[contact-relay] alert to agent #${agentId} for lead #${lead.id} failed: ${err.message}`);
    }
  }

  let opsNotified = false;
  const desk = opsNumber();
  if (desk) {
    try {
      await deskAlert.sendDeskAlert(desk, [
        '📩 [Lukka Place] Contact WhatsApp depuis un profil d’agent',
        '',
        `• Agent : ${agentName} (#${agentId})`,
        `• Client : ${displayPhone(from)}`,
        '',
        agentNotified ? 'Agent prévenu ; le client a reçu son numéro.' : `⚠️ Agent NON prévenu (${blocker || "échec de l'envoi"}) — à traiter.`,
        `${SITE_URL}/admin/leads/${lead.id}`,
      ].join('\n'), { label: 'profile WhatsApp contact' });
      opsNotified = true;
    } catch (err) {
      console.error(`[contact-relay] desk copy for lead #${lead.id} failed: ${err.message}`);
    }
  }

  const text = agentNotified
    ? agentHandoffReply({ agentName, agentPhone: contact.agent_phone })
    : opsNotified
      ? `Bonjour ! Merci pour votre message. Nous n'avons pas pu joindre ${agentName} dans l'immédiat : notre équipe vous recontacte rapidement.`
      : `Bonjour ! Merci pour votre message. Nous n'avons pas pu joindre ${agentName} dans l'immédiat. Décrivez-nous ce que vous cherchez ici et nous vous aiderons.`;
  await reply(from, text, primaryWamid);
  console.log(`[contact-relay] agent #${agentId} from ${from} — lead #${lead.id} (agent=${agentNotified}, ops=${opsNotified})`);
  return { handled: true, leadId: lead.id, agentNotified };
}

async function handleProjectLink({ from, slug, primaryWamid }) {
  // eslint-disable-next-line global-require
  const projectEnquiry = require('./projectEnquiry');
  const project = await projectEnquiry.findPublicProjectBySlug(slug);
  if (!project) return { handled: false };

  const recent = db.findRecentLeadFor({ waId: from, developmentId: project.id });
  const contact = project.agent_id ? await propertyRepository.getAgentContactById(project.agent_id) : null;
  const routable = contact && !contact.deleted && !propertyRepository.directRoutingBlocker(contact);
  const developerName = contact?.agent_name || project.developer_name || 'Le promoteur';
  const about = `le projet « ${project.name} »`;

  if (recent) {
    console.log(`[contact-relay] project #${project.id} from ${from} — repeat of lead #${recent.id}, no new alert`);
    await reply(
      from,
      routable
        ? agentHandoffReply({ agentName: developerName, agentPhone: contact.agent_phone, about, repeat: true })
        : 'Bonjour à nouveau ! Votre demande est bien enregistrée : notre équipe revient vers vous rapidement.',
      primaryWamid,
    );
    return { handled: true, leadId: recent.id, repeat: true };
  }

  const result = await projectEnquiry.handleProjectEnquiry({
    developmentId: project.id, waId: from, message: 'Contact WhatsApp depuis la page du projet',
  });
  if (!result.ok) return { handled: false };
  const text = result.developerNotified && routable
    ? agentHandoffReply({ agentName: developerName, agentPhone: contact.agent_phone, about })
    : `Bonjour ! Merci pour votre intérêt pour ${about}. Notre équipe vous recontacte rapidement avec les informations.`;
  await reply(from, text, primaryWamid);
  console.log(`[contact-relay] project #${project.id} from ${from} — lead #${result.lead?.id} (developer=${result.developerNotified})`);
  return { handled: true, leadId: result.lead?.id ?? null, agentNotified: result.developerNotified };
}

/**
 * @returns {Promise<{handled: boolean, leadId?: number}>} `handled: false` →
 *   not ours (or not a live page); the caller carries on as before.
 */
async function handleContactLink({ from, text, primaryWamid } = {}) {
  const parsed = parseContactLink(text);
  if (!parsed) return { handled: false };
  try {
    return parsed.kind === 'agent'
      ? await handleAgentLink({ from, agentId: parsed.agentId, primaryWamid })
      : await handleProjectLink({ from, slug: parsed.slug, primaryWamid });
  } catch (err) {
    console.error(`[contact-relay] ${parsed.kind} link from ${from} failed: ${err.message}`);
    return { handled: false };
  }
}

module.exports = { handleContactLink, parseContactLink };
