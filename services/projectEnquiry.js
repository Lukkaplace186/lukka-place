/**
 * services/projectEnquiry.js
 *
 * An enquiry from a /projets page (web/app/(site)/projets/[slug]) — a
 * customer interested in a developer's building, a unit type in it, or a lot
 * of land.
 *
 * Same shape as services/listingEnquiry.js, and the same two rules bind:
 *
 *   - Recipients are the PROJECT'S OWN developer plus Lukka Place's desk,
 *     never services/leadDispatch.js's seven ranked agencies. The customer
 *     named one project; broadcasting it to competing agencies is the wrong
 *     message to the wrong people. The lead is created with no commune, which
 *     is also what keeps dispatchLead from ever picking it up.
 *   - The developer is alerted only when their number passes
 *     propertyRepository.directRoutingBlocker (verified, routing not switched
 *     off). An unverified number is somebody's claim.
 *
 * The project itself is re-read here under the public gate
 * (status = 1 AND approve_status = 1): the web form is a public POST, and an
 * enquiry must never be accepted for — or leak the existence of — an
 * unpublished project.
 *
 * `leads.agent_id` is stamped with the developer's account, which is one of
 * the ownership signals db.listLeads already ORs, so the enquiry appears in
 * the developer's own Demandes inbox with no new plumbing.
 */

const chakra = require('./chakra');
const db = require('./db');
const propertyRepository = require('./propertyRepository');
const { getPool, isConfigured } = require('./postgres');

const SITE_URL = (process.env.PUBLIC_SITE_URL || 'https://lukkaplace.com').replace(/\/+$/, '');

/** Read at call time, like viewingNotifications.opsNumber(): ops can be repointed without a restart. */
function opsNumber() {
  return (process.env.OPS_WHATSAPP_NUMBER || '').replace(/\D/g, '') || null;
}

function displayPhone(waId) {
  const digits = String(waId || '').replace(/\D/g, '');
  return digits ? `+${digits}` : 'numéro inconnu';
}

const INTEREST_LIMIT = 160;
const MESSAGE_LIMIT = 800;

/**
 * The public project plus the one unit type or lot the customer picked.
 * `interest` is "unit:<id>" / "lot:<id>" / anything else = the project in
 * general; an id that does not belong to THIS project is ignored rather than
 * trusted.
 */
async function loadProject(developmentId, interest) {
  if (!isConfigured()) return null;
  const id = Number.parseInt(developmentId, 10);
  if (!Number.isFinite(id) || id <= 0) return null;

  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT d.id, d.slug, d.name, d.kind, d.commune, d.agent_id, d.developer_name
       FROM developments d
      WHERE d.id = $1 AND d.status = 1 AND d.approve_status = 1`,
    [id],
  );
  const project = rows[0];
  if (!project) return null;

  let picked = null;
  const match = /^(unit|lot):(\d+)$/.exec(String(interest || ''));
  if (match) {
    const table = match[1] === 'unit' ? 'development_unit_types' : 'development_lots';
    const { rows: childRows } = await pool.query(
      `SELECT id, label FROM ${table} WHERE id = $1 AND development_id = $2`,
      [Number(match[2]), project.id],
    );
    if (childRows[0]) picked = { kind: match[1], ...childRows[0] };
  }
  return { project, picked };
}

function projectLink(project) {
  return `${SITE_URL}/projets/${project.slug}`;
}

function interestLabel(picked) {
  if (!picked) return 'le projet en général';
  return picked.kind === 'unit' ? `type « ${picked.label} »` : `lot « ${picked.label} »`;
}

function developerMessage({ project, picked, from, name, message }) {
  const lines = [
    '🏗️ [Lukka Place] Nouvelle demande sur votre projet',
    `📍 Projet : ${project.name}`,
    `🔎 Intérêt : ${interestLabel(picked)}`,
    `👤 Client : ${name ? `${name} — ` : ''}${displayPhone(from)}`,
  ];
  if (message) lines.push(`💬 « ${message} »`);
  lines.push('', 'Merci de recontacter ce client rapidement.', projectLink(project));
  return lines.join('\n');
}

function opsMessage({ project, picked, from, name, message, developerNotified, skipReason }) {
  const lines = [
    '🏗️ [Lukka Place] Demande sur un projet',
    '',
    `• Projet : ${project.name} (#${project.id})`,
    `• Intérêt : ${interestLabel(picked)}`,
    `• Client : ${name ? `${name} — ` : ''}${displayPhone(from)}`,
  ];
  if (project.commune) lines.push(`• Commune : ${project.commune}`);
  if (message) lines.push(`• Message : « ${message} »`);
  lines.push(
    '',
    developerNotified
      ? `Promoteur prévenu : ${project.developer_name || `agent #${project.agent_id}`}`
      : `⚠️ Promoteur NON prévenu (${skipReason}) — à traiter manuellement.`,
    projectLink(project),
  );
  return lines.join('\n');
}

/**
 * Record and route one project enquiry.
 *
 * @param {{developmentId: number|string, waId: string, name?: string, interest?: string, message?: string}} input
 * @returns {Promise<{ok: true, lead: Object, developerNotified: boolean, opsNotified: boolean} | {ok: false, error: string}>}
 */
async function handleProjectEnquiry({ developmentId, waId, name, interest, message } = {}) {
  const from = String(waId || '').replace(/\D/g, '');
  if (!/^\d{7,15}$/.test(from)) return { ok: false, error: 'wa_id is required.' };

  const loaded = await loadProject(developmentId, interest);
  if (!loaded) return { ok: false, error: 'Project not found.' };
  const { project, picked } = loaded;

  const cleanName = String(name || '').trim().slice(0, 120) || null;
  const cleanMessage = String(message || '').replace(/\s+/g, ' ').trim().slice(0, MESSAGE_LIMIT) || null;

  const summary = [`Projet « ${project.name} » — ${interestLabel(picked)}`.slice(0, INTEREST_LIMIT)];
  if (cleanMessage) summary.push(cleanMessage);

  const lead = db.createLead({
    wa_id: from,
    name: cleanName,
    source: 'project-enquiry',
    development_id: project.id,
    requirements_summary: summary.join('\n'),
    status: 'NEW',
  });

  const contact = project.agent_id ? await propertyRepository.getAgentContactById(project.agent_id) : null;
  if (project.agent_id) {
    db.assignLead(lead.id, {
      agentId: project.agent_id,
      assignedAgent: contact?.agent_name || project.developer_name || null,
    });
  }

  let skipReason = contact ? propertyRepository.directRoutingBlocker(contact) : 'aucun promoteur rattaché au projet';
  let developerNotified = false;
  if (!skipReason) {
    try {
      await chakra.sendWhatsAppMessage(
        String(contact.agent_phone).replace(/\D/g, ''),
        developerMessage({ project, picked, from, name: cleanName, message: cleanMessage }),
        { previewUrl: true },
      );
      developerNotified = true;
    } catch (err) {
      skipReason = `échec de l'envoi : ${err.message}`;
      console.error(`[project-enquiry] developer alert for project #${project.id} failed: ${err.message}`);
    }
  }

  let opsNotified = false;
  const ops = opsNumber();
  if (ops) {
    try {
      await chakra.sendWhatsAppMessage(
        ops,
        opsMessage({ project, picked, from, name: cleanName, message: cleanMessage, developerNotified, skipReason }),
        { previewUrl: true },
      );
      opsNotified = true;
    } catch (err) {
      console.error(`[project-enquiry] ops copy for project #${project.id} failed: ${err.message}`);
    }
  } else if (!developerNotified) {
    console.error(
      `[project-enquiry] project #${project.id} enquiry from ${from} reached NOBODY — `
        + `no developer (${skipReason}) and OPS_WHATSAPP_NUMBER is unset`,
    );
  }

  return { ok: true, lead: db.getLead(lead.id), developerNotified, opsNotified };
}

module.exports = {
  handleProjectEnquiry,
  // Exposed for scripts/verify-pipeline.js.
  developerMessage,
  opsMessage,
  interestLabel,
};
