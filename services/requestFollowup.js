/**
 * services/requestFollowup.js
 *
 * "Un agent vous a-t-il contacté ?" — the 24 h customer follow-up (owner
 * decision 2026-11-09; customer alert B6 of the app plan, 2026-11-10).
 *
 * About a day after a request reached an agent — an enquiry on a listing,
 * a profile or a project, or an open request an agency took — the customer
 * is asked whether anyone got in touch, with three answers:
 *
 *   YES        "Oui, c'est fait"      → the request is marked CONTACTED.
 *   NOT_YET    "Pas encore"           → the desk is alerted and the agent
 *                                       relaunched (an open request goes to
 *                                       its next wave of agencies).
 *   NO_LONGER  "Je ne cherche plus"   → the request is closed (LOST).
 *
 * How it reaches the customer:
 *   - the Lukka Place app: a push (category `requests`) opening
 *     /compte/client/suivi/<lead id>, where the three answers are buttons;
 *   - else WhatsApp: SUIVI_DEMANDE_TEMPLATE (`suivi_demande_client`, three
 *     quick replies) when set, reaching anyone; without it a numbered text,
 *     only to a customer inside the 24 h window (the only case it arrives).
 * Typed answers ("1", "oui", "pas encore") and template buttons
 * (`suivi:<id>:yes|wait|stop`) come back through routes/webhook.js; the web
 * page answers through POST /admin/leads/:id/followup-answer.
 *
 * Asked once per request (`contact_followup_sent_at` claimed before the
 * send), at most one per customer per day, 9–19 h Kinshasa, for requests
 * 24–72 h old still NEW / CONTACTED / QUALIFIED with an agent attached.
 * Visit requests are left out: they have their own loop. REQUEST_FOLLOWUP=off
 * stops the job (answers to questions already sent are still handled).
 */

const db = require('./db');
const pushNotify = require('./pushNotify');
const { insideSessionWindow } = require('./sessionWindow');

const ANSWERS = Object.freeze(['YES', 'NOT_YET', 'NO_LONGER']);
const BUTTON_CODES = Object.freeze({ yes: 'YES', wait: 'NOT_YET', stop: 'NO_LONGER' });
const ASK_AFTER_MS = 24 * 60 * 60 * 1000;
const ASK_UNTIL_MS = 72 * 60 * 60 * 1000;
/** A typed answer counts for this long after the question. */
const ANSWER_WINDOW_MS = 48 * 60 * 60 * 1000;
const FROM_H = 9;
const TO_H = 19;
const EXCLUDED_SOURCES = ['listing-visit-request', 'team-introduction', 'admin'];
const BRAND = '🏠 [Lukka Place]';

function enabled() {
  return String(process.env.REQUEST_FOLLOWUP || '').trim().toLowerCase() !== 'off';
}

function templateName() {
  return String(process.env.SUIVI_DEMANDE_TEMPLATE || '').trim();
}

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

/** SQLite's CURRENT_TIMESTAMP shape, UTC: '2026-11-10 08:00:00'. */
function sqliteTime(date) {
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

function kinshasaHour(now) {
  return (now.getUTCHours() + 1) % 24;
}

function suiviPath(leadId) {
  return `/compte/client/suivi/${leadId}`;
}

/** What the request was about, for the question: "votre demande pour …". */
function subjectOf(lead) {
  const summary = String(lead.requirements_summary || '').replace(/\s+/g, ' ').trim();
  if (summary) return summary.length > 90 ? `${summary.slice(0, 89)}…` : summary;
  if (lead.commune) return `votre recherche à ${lead.commune}`;
  return 'votre demande';
}

function questionText(lead) {
  return [
    `${BRAND} Bonjour${lead.name ? ` ${String(lead.name).split(/\s+/)[0]}` : ''} !`,
    `Hier, nous avons transmis votre demande à un agent : ${subjectOf(lead)}.`,
    'Un agent vous a-t-il contacté ?',
    '',
    '1. Oui, c’est fait',
    '2. Pas encore',
    '3. Je ne cherche plus',
    '',
    'Répondez simplement 1, 2 ou 3.',
  ].join('\n');
}

const THANKS = {
  YES: `${BRAND} Merci ! Bonne suite dans votre recherche. Nous restons disponibles sur ce numéro.`,
  NOT_YET: `${BRAND} C’est noté. Notre équipe relance l’agent et vous recontacte rapidement.`,
  NO_LONGER: `${BRAND} C’est noté, nous clôturons votre demande. Merci d’avoir utilisé Lukka Place !`,
};

// ---------------------------------------------------------------------------
// Asking
// ---------------------------------------------------------------------------

function dueLeads(now = new Date()) {
  const placeholders = EXCLUDED_SOURCES.map(() => '?').join(', ');
  return db.db
    .prepare(
      `SELECT * FROM leads
        WHERE contact_followup_sent_at IS NULL
          AND status IN ('NEW', 'CONTACTED', 'QUALIFIED')
          AND created_at <= ? AND created_at > ?
          AND COALESCE(source, '') NOT IN (${placeholders})
          AND (agent_id IS NOT NULL OR assigned_agent IS NOT NULL)
          AND wa_id IS NOT NULL AND wa_id <> ''
        ORDER BY created_at
        LIMIT 50`,
    )
    .all(sqliteTime(new Date(now.getTime() - ASK_AFTER_MS)), sqliteTime(new Date(now.getTime() - ASK_UNTIL_MS)), ...EXCLUDED_SOURCES);
}

function askedTodayFor(waId, now) {
  const row = db.db
    .prepare('SELECT 1 FROM leads WHERE wa_id = ? AND contact_followup_sent_at > ? LIMIT 1')
    .get(String(waId), new Date(now.getTime() - 24 * 3600 * 1000).toISOString());
  return Boolean(row);
}

async function sendWhatsAppQuestion(lead, now) {
  const to = digits(lead.wa_id);
  // eslint-disable-next-line global-require
  const chakra = require('./chakra');
  const name = templateName();
  if (chakra.templateConfigured(name)) {
    try {
      await chakra.sendTemplate(to, name, {
        languageCode: String(process.env.SUIVI_DEMANDE_TEMPLATE_LANG || 'fr'),
        bodyParams: [subjectOf(lead)],
        buttons: ['yes', 'wait', 'stop'].map((code) => ({ id: `suivi:${lead.id}:${code}` })),
      });
      return 'template';
    } catch (err) {
      console.warn(`[request-followup] lead #${lead.id}: template '${name}' failed (${err.message}) — text inside the window only`);
    }
  }
  if (!insideSessionWindow(to, now)) return 'none';
  await chakra.sendWhatsAppMessage(to, questionText(lead), { previewUrl: false });
  return 'text';
}

async function askOne(lead, now) {
  const claimed = db.db
    .prepare('UPDATE leads SET contact_followup_sent_at = ? WHERE id = ? AND contact_followup_sent_at IS NULL')
    .run(now.toISOString(), lead.id);
  if (!claimed.changes) return 'skipped';
  let channel = 'none';
  try {
    const outcome = await pushNotify.pushFirst({
      userType: 'customer',
      phone: digits(lead.wa_id),
      kind: 'request_followup',
      category: 'requests',
      refId: lead.id,
      title: 'Un agent vous a-t-il contacté ?',
      body: `À propos de ${subjectOf(lead)}. Répondez en un geste : nous relançons l’agent si besoin.`,
      url: suiviPath(lead.id),
      urgent: false,
      sendWhatsApp: () => sendWhatsAppQuestion(lead, now),
    });
    channel = outcome.pushed ? 'push' : outcome.whatsapp;
  } catch (err) {
    console.error(`[request-followup] lead #${lead.id}: ${err.message}`);
    channel = 'failed';
  }
  db.db.prepare('UPDATE leads SET contact_followup_channel = ? WHERE id = ?').run(String(channel), lead.id);
  console.log(`[request-followup] lead #${lead.id} asked via ${channel}`);
  return channel;
}

async function runRequestFollowups(now = new Date(), { hours = [FROM_H, TO_H] } = {}) {
  const summary = { due: 0, asked: 0, none: 0, deferred: 0 };
  if (!enabled()) return { ...summary, off: true };
  const hour = kinshasaHour(now);
  if (hour < hours[0] || hour >= hours[1]) return { ...summary, quiet: true };
  const leads = dueLeads(now);
  summary.due = leads.length;
  const askedNow = new Set();
  for (const lead of leads) {
    const waId = digits(lead.wa_id);
    if (askedNow.has(waId) || askedTodayFor(waId, now)) {
      summary.deferred += 1;
      continue;
    }
    const channel = await askOne(lead, now);
    if (channel === 'skipped') continue;
    askedNow.add(waId);
    if (channel === 'none' || channel === 'failed') summary.none += 1;
    else summary.asked += 1;
  }
  return summary;
}

const requestFollowupJob = {
  name: 'request-followup',
  shouldRun: (now = new Date()) => enabled() && now.getUTCMinutes() % 10 === 0,
  run: () => runRequestFollowups(),
};

// ---------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------

function deskText(lead, answer) {
  return [
    `${BRAND} Suivi client : « Pas encore » — aucun agent n’a contacté le client`,
    `• Demande n° ${lead.id} (${lead.source || 'demande'}) : ${subjectOf(lead)}`,
    `• Client : ${lead.name || 'Non précisé'} (+${digits(lead.wa_id)})`,
    `• Agent : ${lead.assigned_agent || (lead.agent_id ? `#${lead.agent_id}` : 'aucun')}`,
    answer === 'NOT_YET' ? 'L’agent a été relancé ; merci de vérifier que le client est rappelé.' : '',
  ].filter(Boolean).join('\n');
}

/** "Pas encore": the desk, then the agent or the next wave. Never throws. */
async function relaunch(lead) {
  const result = { desk: false, relaunched: null };
  try {
    // eslint-disable-next-line global-require
    const deskAlert = require('./deskAlert');
    const desk = digits(process.env.OPS_WHATSAPP_NUMBER);
    if (desk) {
      await deskAlert.sendDeskAlert(desk, deskText(lead, 'NOT_YET'), { label: `request follow-up #${lead.id}` });
      result.desk = true;
    } else {
      console.error(`[request-followup] lead #${lead.id}: "pas encore" and OPS_WHATSAPP_NUMBER is unset — desk not told`);
    }
  } catch (err) {
    console.error(`[request-followup] lead #${lead.id}: desk alert failed — ${err.message}`);
  }
  try {
    if (db.isOpenRequestSource(lead.source)) {
      // eslint-disable-next-line global-require
      const dispatch = await require('./leadDispatch').dispatchNextWave(lead, { force: false });
      result.relaunched = dispatch.skipped ? `wave: ${dispatch.skipped}` : `wave: ${dispatch.notified} agency(ies)`;
    } else if (lead.agent_id) {
      const contact = await require('./propertyRepository').getAgentContactById(lead.agent_id); // eslint-disable-line global-require
      if (contact?.agent_phone && !require('./propertyRepository').directRoutingBlocker(contact)) { // eslint-disable-line global-require
        // eslint-disable-next-line global-require
        await require('./agentEnquiryAlert').sendAgentEnquiryAlert(
          contact.agent_phone,
          `${BRAND} Relance : le client ${lead.name || ''} (+${digits(lead.wa_id)}) dit ne pas avoir été contacté pour ${subjectOf(lead)}. Merci de le rappeler aujourd’hui.`,
          {
            agentId: lead.agent_id,
            agentName: contact.agent_name,
            subject: subjectOf(lead),
            client: `${lead.name ? `${lead.name}, ` : ''}+${digits(lead.wa_id)}`,
            message: 'Relance : le client attend toujours votre appel.',
            leadId: lead.id,
            label: `follow-up relaunch lead #${lead.id}`,
          },
        );
        result.relaunched = 'agent';
      } else {
        result.relaunched = 'agent unreachable';
      }
    }
  } catch (err) {
    console.error(`[request-followup] lead #${lead.id}: relaunch failed — ${err.message}`);
    result.relaunched = `failed: ${err.message}`;
  }
  return result;
}

/**
 * Record an answer, once. `waIds` are the numbers allowed to answer (the
 * lead's own number, or the customer's account numbers from web).
 * @returns {Promise<{ok: boolean, reason?: string, answer?: string, unchanged?: boolean}>}
 */
async function recordAnswer({ leadId, answer, waIds, channel }) {
  if (!ANSWERS.includes(answer)) return { ok: false, reason: 'invalid-answer' };
  const lead = db.getLead(Number(leadId));
  const allowed = new Set((waIds || []).map(digits).filter(Boolean));
  if (!lead || !allowed.has(digits(lead.wa_id))) return { ok: false, reason: 'unknown-request' };
  if (lead.contact_followup_answer) return { ok: true, answer: lead.contact_followup_answer, unchanged: true };

  const taken = db.db
    .prepare(
      `UPDATE leads SET contact_followup_answer = ?, contact_followup_answered_at = ?, contact_followup_answer_via = ?
        WHERE id = ? AND contact_followup_answer IS NULL`,
    )
    .run(answer, new Date().toISOString(), String(channel || 'unknown'), lead.id);
  if (!taken.changes) return { ok: true, answer: db.getLead(lead.id).contact_followup_answer, unchanged: true };

  if (answer === 'YES' && lead.status === 'NEW') db.updateLeadStatus(lead.id, 'CONTACTED');
  if (answer === 'NO_LONGER') db.updateLeadStatus(lead.id, 'LOST');
  const relaunched = answer === 'NOT_YET' ? await relaunch(lead) : null;
  console.log(`[request-followup] lead #${lead.id} answered ${answer} via ${channel}${relaunched ? ` — ${JSON.stringify(relaunched)}` : ''}`);
  return { ok: true, answer, relaunched };
}

/** `suivi:<id>:yes|wait|stop` → {leadId, answer}, else null. */
function parseFollowupButtonId(replyId) {
  const m = /^suivi:(\d{1,12}):(yes|wait|stop)$/.exec(String(replyId || ''));
  return m ? { leadId: Number(m[1]), answer: BUTTON_CODES[m[2]] } : null;
}

function fold(text) {
  return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’']/g, ' ').replace(/\s+/g, ' ').trim();
}

/** A typed answer: "1"/"2"/"3" or the words; anything else is not one. */
function parseFollowupText(text) {
  const t = fold(text).replace(/[.!]+$/, '');
  if (/^1$|^oui\b|^c est fait|^deja contacte/.test(t)) return 'YES';
  // Not a bare "non": too common an answer to anything else to read as this one.
  if (/^2$|^pas encore|^personne/.test(t)) return 'NOT_YET';
  if (/^3$|ne cherche plus|plus besoin|^j ai trouve/.test(t)) return 'NO_LONGER';
  return null;
}

/** The latest question this number was asked and has not answered, within 48 h. */
function openQuestionFor(waId, now = new Date()) {
  return db.db
    .prepare(
      `SELECT * FROM leads
        WHERE wa_id = ? AND contact_followup_sent_at > ? AND contact_followup_answer IS NULL
          AND COALESCE(contact_followup_channel, '') IN ('template', 'text')
        ORDER BY contact_followup_sent_at DESC LIMIT 1`,
    )
    .get(digits(waId), new Date(now.getTime() - ANSWER_WINDOW_MS).toISOString());
}

async function reply(to, answer) {
  try {
    // eslint-disable-next-line global-require
    await require('./chakra').sendWhatsAppMessage(digits(to), THANKS[answer], { previewUrl: false });
  } catch (err) {
    console.error(`[request-followup] thanks to …${digits(to).slice(-4)} failed: ${err.message}`);
  }
}

/** routes/webhook.js: a template quick reply. */
async function handleFollowupButtonReply({ from, replyId }) {
  const parsed = parseFollowupButtonId(replyId);
  if (!parsed) return { handled: false };
  const result = await recordAnswer({ ...parsed, waIds: [from], channel: 'whatsapp-button' });
  if (result.ok && !result.unchanged) await reply(from, result.answer);
  return { handled: true, ...result };
}

/** routes/webhook.js: "1", "oui", "pas encore"… — only with an open question; anything else falls through. */
async function handleFollowupTextReply({ from, text, hasMedia = false }) {
  if (hasMedia || !text || String(text).length > 60) return { handled: false };
  const answer = parseFollowupText(text);
  if (!answer) return { handled: false };
  const lead = openQuestionFor(from);
  if (!lead) return { handled: false };
  const result = await recordAnswer({ leadId: lead.id, answer, waIds: [from], channel: 'whatsapp-text' });
  if (result.ok && !result.unchanged) await reply(from, result.answer);
  return { handled: true, ...result };
}

module.exports = {
  runRequestFollowups,
  requestFollowupJob,
  recordAnswer,
  handleFollowupButtonReply,
  handleFollowupTextReply,
  // Exposed for scripts/verify-pipeline.js.
  ANSWERS,
  parseFollowupButtonId,
  parseFollowupText,
  questionText,
  dueLeads,
  openQuestionFor,
};
