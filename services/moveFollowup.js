/**
 * "Mon déménagement" 24-hour follow-up (2026-11-07). The project page tells
 * the customer: "Si aucune agence ne vous a écrit sous 24 h, l'équipe Lukka
 * Place vous contacte." This job keeps that promise: a `move-project` lead
 * that, 24 hours after it was sent, still has no proposal from an agency is
 * put in front of the ops desk (OPS_WHATSAPP_NUMBER) with the customer's
 * story, so a person calls them. The customer is not messaged by the engine
 * (a cold customer is outside the 24 h window); the desk reaches them.
 *
 * Per-lead idempotence on the row: `leads.followup_alerted_at` is stamped
 * after the attempt, whoever was reached, so nobody is told twice and a desk
 * outage never turns into a loop. What happened is always logged.
 *
 * MOVE_FOLLOWUP=off disables (read at call time).
 */

const dbService = require('./db');
const deskAlert = require('./deskAlert');

const SOURCE = 'move-project';
const FOLLOWUP_AFTER_MS = 24 * 60 * 60 * 1000;
/** Older requests than this are not chased (the feature began 2026-11-07). */
const FOLLOWUP_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const SITE_URL = (process.env.PUBLIC_SITE_URL || 'https://lukkaplace.com').replace(/\/+$/, '');

function enabled() {
  return String(process.env.MOVE_FOLLOWUP || '').trim().toLowerCase() !== 'off';
}

/** SQLite's CURRENT_TIMESTAMP shape (UTC, no T/Z), so text comparison sorts right. */
function sqliteTs(ms) {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

/** Leads due a follow-up at `now`: sent 24 h–7 days ago, no agency proposal, not already followed up. */
function dueLeads(now = Date.now()) {
  return dbService.db
    .prepare(
      `SELECT l.id, l.wa_id, l.name, l.commune, l.communes, l.requirements_summary, l.move_story, l.created_at
         FROM leads l
        WHERE l.source = ?
          AND l.followup_alerted_at IS NULL
          AND l.dispatch_desk_alerted_at IS NULL
          AND l.created_at <= ?
          AND l.created_at >= ?
          AND l.status IN ('NEW', 'CONTACTED', 'QUALIFIED')
          AND NOT EXISTS (SELECT 1 FROM lead_proposals p WHERE p.lead_id = l.id)
        ORDER BY l.created_at
        LIMIT 20`,
    )
    .all(SOURCE, sqliteTs(now - FOLLOWUP_AFTER_MS), sqliteTs(now - FOLLOWUP_MAX_AGE_MS));
}

function followupText(lead) {
  const digits = String(lead.wa_id || '').replace(/\D/g, '');
  return [
    '📞 Projet sans réponse d’agence depuis 24 h',
    '',
    `• Client : ${lead.name || 'Nom non précisé'} (+${digits})`,
    lead.move_story ? `• ${lead.move_story}` : null,
    lead.requirements_summary ? `• ${String(lead.requirements_summary).split('\n').filter((l) => l !== lead.move_story).join(' · ')}` : null,
    '',
    'Nous lui avons promis un appel de l’équipe. Demande :',
    `${SITE_URL}/admin/leads/${lead.id}`,
  ].filter((line) => line !== null).join('\n');
}

function markFollowedUp(leadId) {
  dbService.db.prepare(`UPDATE leads SET followup_alerted_at = CURRENT_TIMESTAMP WHERE id = ?`).run(leadId);
}

/**
 * One pass. Never throws into the scheduler; each lead is handled on its own.
 * @returns {Promise<{due: number, sent: number, nobody: number}>}
 */
async function runMoveFollowups({ now = Date.now(), send = deskAlert.sendDeskAlert } = {}) {
  const result = { due: 0, sent: 0, nobody: 0 };
  if (!enabled()) return result;
  let leads = [];
  try {
    leads = dueLeads(now);
  } catch (err) {
    console.error(`[move-followup] could not read due leads: ${err.message}`);
    return result;
  }
  result.due = leads.length;
  const desk = String(process.env.OPS_WHATSAPP_NUMBER || '').replace(/\D/g, '');
  for (const lead of leads) {
    if (!desk) {
      console.error(`[move-followup] lead #${lead.id}: 24 h without an agency answer and OPS_WHATSAPP_NUMBER is unset — nobody told`);
      result.nobody += 1;
    } else {
      try {
        const via = await send(desk, followupText(lead), { label: `move follow-up #${lead.id}` });
        console.log(`[move-followup] lead #${lead.id}: desk told (${via})`);
        result.sent += 1;
      } catch (err) {
        console.error(`[move-followup] lead #${lead.id}: desk alert failed — ${err.message}`);
        result.nobody += 1;
      }
    }
    try {
      markFollowedUp(lead.id);
    } catch (err) {
      console.error(`[move-followup] lead #${lead.id}: could not stamp followup_alerted_at — ${err.message}`);
    }
  }
  return result;
}

/** Every 15 minutes is plenty for a 24-hour promise, and costs one indexed read. */
const moveFollowupJob = {
  name: 'move-request-followup',
  shouldRun: (now) => now.getUTCMinutes() % 15 === 0,
  run: () => runMoveFollowups(),
};

module.exports = {
  SOURCE,
  FOLLOWUP_AFTER_MS,
  dueLeads,
  followupText,
  runMoveFollowups,
  moveFollowupJob,
  sqliteTs,
};
