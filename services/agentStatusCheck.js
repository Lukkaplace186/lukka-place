'use strict';

/**
 * services/agentStatusCheck.js
 *
 * "Faites le point sur vos annonces" — ONE WhatsApp per agent every
 * REQUEST_INTERVAL_DAYS, replacing the per-listing "Toujours disponible ?"
 * question (services/availabilityCheck.js, whose answer handlers still serve
 * questions already sent). Owner decision 2026-11-09: the per-listing check
 * asked an agent with 49 listings something every day, and its multi-step
 * chat lost the closing price.
 *
 * The message carries a private link (web /point/<token>) where the agent
 * answers for every listing on one page — Disponible / Sous offre / Loué ou
 * vendu (price optional) / Retiré — and a quick reply "Rien n'a changé" that
 * confirms every live listing in one tap, here.
 *
 * WHO, WHEN
 * An agent with a verified phone, active and not deleted, who has at least one
 * public listing (active or under offer, not a project unit) whose last
 * confirmation — or, never confirmed, last change — is older than
 * REQUEST_INTERVAL_DAYS, and who was not sent a request in that time
 * (`agent_status_requests`). Confirming everything puts the whole portfolio
 * on one clock, so an agent hears from us once per cycle whatever the size of
 * their portfolio. No reminder is ever sent; silence is answered by the next
 * cycle.
 *
 * DELIVERY
 * The template (LISTING_STATUS_TEMPLATE, read at call time) reaches anyone.
 * Without it, a session message only arrives inside the 24 h window, so an
 * agent outside it is skipped WITHOUT claiming the cycle — they are tried
 * again the next day instead of being marked as asked by a message that
 * could not arrive.
 *
 * THE LINK
 * 24 random bytes, base64url; only its SHA-256 is stored. Valid LINK_TTL_DAYS.
 * Web resolves it (web/lib/statusCheck.js) and lets it change only the
 * status of that agent's own listings — never text, photos or the account.
 */

const crypto = require('crypto');
const chakra = require('./chakra');
const pg = require('./postgres');
const dbService = require('./db');
const availability = require('./availabilityCheck');

const JOB_NAME = availability.JOB_NAME; // 'listing-availability-check' — same slot, same history
const HEADER_BRAND = '🏠 [Lukka Place]';
const SITE_URL = (process.env.PUBLIC_SITE_URL || process.env.SITE_URL || 'https://lukkaplace.com').replace(/\/+$/, '');

/** One request per agent per this many days. = availability.CONFIRM_AFTER_DAYS = web CONFIRM_AFTER_DAYS. */
const REQUEST_INTERVAL_DAYS = availability.CONFIRM_AFTER_DAYS;
/** How long the link in a request works. web/lib/statusCheck.js reads expires_at, not this. */
const LINK_TTL_DAYS = 7;
const MAX_AGENTS_PER_RUN = 300;
const SEND_GAP_MS = Number.parseInt(process.env.AVAILABILITY_CHECK_GAP_MS, 10) || 250;

/** Meta-approved UTILITY template: link button first, then the "Rien n'a changé" quick reply. */
function templateName() {
  return process.env.LISTING_STATUS_TEMPLATE || null;
}
function templateLanguage() {
  return process.env.LISTING_STATUS_TEMPLATE_LANG || 'fr';
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for scripts/verify-pipeline.js)
// ---------------------------------------------------------------------------

function newToken() {
  return crypto.randomBytes(24).toString('base64url');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function linkUrl(token) {
  return `${SITE_URL}/point/${token}`;
}

/** `status_ok:42` -> { requestId: 42 }, anything else null. */
function parseStatusButtonId(replyId) {
  const match = /^status_ok:(\d{1,18})$/.exec(String(replyId || '').trim());
  return match ? { requestId: Number(match[1]) } : null;
}

function okButtonId(requestId) {
  return `status_ok:${requestId}`;
}

function firstNameOf(agent) {
  return String(agent?.first_name || '').trim() || 'partenaire';
}

/** "12 annonces" / "1 annonce" — the template reads "vos {{2}} sur Lukka Place". No newline: Meta refuses one in a parameter. */
function countPhrase(n) {
  const count = Number(n) || 0;
  return `${count} annonce${count > 1 ? 's' : ''}`;
}

/** The two template variables, {{1}} first name, {{2}} the count phrase. */
function templateParams(agent) {
  return [firstNameOf(agent), countPhrase(agent.listings_count)];
}

/** The session-message version of the template, link in the body. */
function requestText(agent, token) {
  return [
    `${HEADER_BRAND} Faites le point sur vos annonces`,
    '',
    `Bonjour ${firstNameOf(agent)}, faites le point sur vos ${countPhrase(agent.listings_count)} sur Lukka Place.`,
    'Indiquez en un écran ce qui est toujours disponible, sous offre, loué ou vendu — vos annonces confirmées apparaissent en premier.',
    '',
    `👉 ${linkUrl(token)}`,
    '',
    'Rien n\'a changé ? Touchez le bouton ci-dessous.',
  ].join('\n');
}

function allConfirmedText(confirmed, underOffer) {
  const lines = [`${HEADER_BRAND} Merci ! ✅ ${confirmed} annonce${confirmed > 1 ? 's' : ''} confirmée${confirmed > 1 ? 's' : ''}.`];
  if (underOffer > 0) lines.push(`(dont ${underOffer} toujours sous offre)`);
  lines.push('', 'Si l\'une d\'elles est louée ou vendue entre-temps, touchez « Mettre à jour » dans le message précédent : un tap suffit.');
  return lines.join('\n');
}

const EXPIRED_TEXT = `${HEADER_BRAND} Ce message a expiré — rien n'a été modifié. Vous recevrez le prochain point bientôt, ou mettez vos annonces à jour depuis votre espace : ${SITE_URL}/compte/agent/point`;
const NOTHING_LIVE_TEXT = `${HEADER_BRAND} Vous n'avez plus d'annonce en ligne — rien à confirmer. Merci !`;

// ---------------------------------------------------------------------------
// Postgres
// ---------------------------------------------------------------------------

/** Public and still on the market: what "Rien n'a changé" confirms. */
const LIVE_SQL = `p.status = 1 AND p.approve_status = 1
     AND COALESCE(p.listing_status, 'active') IN ('active', 'under_offer')
     AND (to_jsonb(p) ->> 'development_id') IS NULL`;

/**
 * LIVE_SQL plus a listing the (dormant) auto-pause hid
 * (services/listingAutoPause.js): its agent is still asked, so the page can
 * offer "Réactiver". to_jsonb so the query runs before the column exists.
 */
const ASKABLE_SQL = `(p.status = 1 OR (to_jsonb(p) ->> 'auto_paused_at') IS NOT NULL) AND p.approve_status = 1
     AND COALESCE(p.listing_status, 'active') IN ('active', 'under_offer')
     AND (to_jsonb(p) ->> 'development_id') IS NULL`;

const BASELINE_SQL = `COALESCE(NULLIF(to_jsonb(p) ->> 'availability_confirmed_at', '')::timestamptz,
                  GREATEST(p.created_at, COALESCE(p.updated_at, p.created_at)))`;

const DUE_AGENTS_SQL = `
  SELECT a.id AS agent_id, a.phone,
         (SELECT ai.first_name FROM agent_infos ai
           WHERE ai.agent_id = a.id AND ai.language_id = 20 AND COALESCE(ai.first_name, '') <> ''
           LIMIT 1) AS first_name,
         COUNT(*)::int AS listings_count,
         MIN(${BASELINE_SQL}) AS oldest_baseline
    FROM agents a
    JOIN properties p ON p.agent_id = a.id
   WHERE ${ASKABLE_SQL}
     AND a.status = 1 AND a.phone_verified_at IS NOT NULL AND COALESCE(a.phone, '') <> ''
     AND (to_jsonb(a) ->> 'deleted_at') IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM agent_status_requests r
        WHERE r.agent_id = a.id AND r.created_at > NOW() - ($1 || ' days')::interval
     )
   GROUP BY a.id, a.phone
  HAVING MIN(${BASELINE_SQL}) < NOW() - ($1 || ' days')::interval
   ORDER BY oldest_baseline
   LIMIT $2
`;

const INSERT_REQUEST_SQL = `
  INSERT INTO agent_status_requests (agent_id, token_hash, expires_at, listings_count)
  VALUES ($1, $2, NOW() + ($3 || ' days')::interval, $4)
  RETURNING id
`;

const REQUEST_SQL = `
  SELECT r.id, r.agent_id, r.created_at, r.expires_at, r.all_confirmed_at,
         a.phone AS agent_phone, a.phone_verified_at
    FROM agent_status_requests r
    JOIN agents a ON a.id = r.agent_id
   WHERE r.id = $1
`;

/** Every live listing of the agent, stamped — the one-tap "Rien n'a changé". */
const STAMP_ALL_SQL = `
  UPDATE properties p SET availability_confirmed_at = NOW()
   WHERE p.agent_id = $1 AND ${LIVE_SQL}
  RETURNING p.id, COALESCE(p.listing_status, 'active') AS listing_status, p.price
`;

const RECORD_ALL_SQL = `
  INSERT INTO listing_availability_checks
    (property_id, agent_id, channel, asked_at, answered_at, answer, previous_price, request_id)
  SELECT x.id, $1, 'WHATSAPP', $2, NOW(), x.answer, x.price, $3
    FROM UNNEST($4::bigint[], $5::text[], $6::numeric[]) AS x(id, answer, price)
`;

const MARK_ALL_CONFIRMED_SQL = `
  UPDATE agent_status_requests
     SET all_confirmed_at = COALESCE(all_confirmed_at, NOW()), last_answer_at = NOW(),
         answers_count = answers_count + $2
   WHERE id = $1
`;

async function tableExists(pool, name) {
  const { rows } = await pool.query('SELECT to_regclass($1) AS t', [`public.${name}`]);
  return Boolean(rows[0]?.t);
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

/**
 * The request itself: template when approved; otherwise a session message
 * (with the one-tap button when interactive buttons go through), and only to
 * an agent inside the 24 h window. Returns the delivery, 'outside-window', or
 * null when nothing could be sent.
 */
async function sendRequest(agent, token, requestId) {
  const to = digits(agent.phone);
  const template = templateName();
  if (chakra.templateConfigured(template)) {
    try {
      await chakra.sendTemplate(to, template, {
        languageCode: templateLanguage(),
        bodyParams: templateParams(agent),
        urlButton: token,
        buttons: [{ id: okButtonId(requestId) }],
      });
      return 'template';
    } catch (err) {
      console.warn(`[status-check] template '${template}' failed for agent #${agent.agent_id}: ${err.message} — session message instead`);
    }
  }
  // eslint-disable-next-line global-require
  const { insideSessionWindow } = require('./sessionWindow');
  if (!insideSessionWindow(to)) return 'outside-window';
  const text = requestText(agent, token);
  try {
    await chakra.sendInteractiveButtons(to, text, [{ id: okButtonId(requestId), title: 'Rien n\'a changé' }]);
    return 'session-link';
  } catch (err) {
    console.warn(`[status-check] buttons refused for agent #${agent.agent_id} (${err.message}) — plain text`);
  }
  try {
    await chakra.sendWhatsAppMessage(to, text.split('\n').slice(0, -2).join('\n'), { previewUrl: false });
    return 'session-link';
  } catch (err) {
    console.error(`[status-check] request to agent #${agent.agent_id} failed: ${err.message}`);
    return null;
  }
}

async function trySend(to, text, label) {
  try {
    await chakra.sendWhatsAppMessage(digits(to), text, { previewUrl: false });
    return true;
  } catch (err) {
    console.error(`[status-check] ${label} to ${to} failed: ${err.message}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// "Rien n'a changé"
// ---------------------------------------------------------------------------

/**
 * The quick reply. Only the request's own agent, from their verified number,
 * and only while the request's link is still valid — a tap weeks later is not
 * a statement about today. `{ handled: false }` for any other button id.
 */
async function handleStatusButtonReply({ from, replyId, now = new Date() }) {
  const parsed = parseStatusButtonId(replyId);
  if (!parsed) return { handled: false };
  if (!pg.isConfigured()) return { handled: true, ignored: 'no-postgres' };
  const pool = pg.getPool();

  const { rows } = await pool.query(REQUEST_SQL, [parsed.requestId]);
  const request = rows[0];
  if (!request || !request.phone_verified_at || digits(request.agent_phone) !== digits(from)) {
    // Silently: answering a stranger would confirm the request id is real.
    console.warn(`[status-check] '${replyId}' from ${from} refused — ${request ? 'not this request\'s agent' : 'unknown request'}`);
    return { handled: true, ignored: request ? 'not-authorised' : 'unknown-request' };
  }
  if (new Date(request.expires_at).getTime() < now.getTime()) {
    await trySend(from, EXPIRED_TEXT, 'expired');
    return { handled: true, action: 'expired' };
  }

  const { rows: stamped } = await pool.query(STAMP_ALL_SQL, [request.agent_id]);
  if (!stamped.length) {
    await trySend(from, NOTHING_LIVE_TEXT, 'nothing live');
    return { handled: true, action: 'nothing-live' };
  }
  const underOffer = stamped.filter((row) => row.listing_status === 'under_offer').length;

  try {
    await pool.query(RECORD_ALL_SQL, [
      request.agent_id,
      request.created_at,
      request.id,
      stamped.map((row) => row.id),
      stamped.map((row) => (row.listing_status === 'under_offer' ? 'STILL_UNDER_OFFER' : 'AVAILABLE')),
      stamped.map((row) => (row.price != null && Number(row.price) >= 0 ? row.price : null)),
    ]);
  } catch (err) {
    // The listings are confirmed either way; only the history row is lost
    // (e.g. before migrations/20261109_agent_status_requests.sql widens the CHECKs).
    console.error(`[status-check] recording request #${request.id}'s answers failed: ${err.message}`);
  }
  await pool.query(MARK_ALL_CONFIRMED_SQL, [request.id, stamped.length]).catch((err) => {
    console.error(`[status-check] marking request #${request.id} answered failed: ${err.message}`);
  });

  await trySend(from, allConfirmedText(stamped.length, underOffer), 'all confirmed');
  console.log(`[status-check] request #${request.id}: ${stamped.length} listing(s) confirmed in one tap by ${from} (${underOffer} under offer)`);
  return { handled: true, action: 'all-confirmed', confirmed: stamped.length, underOffer };
}

// ---------------------------------------------------------------------------
// The job
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * One daily pass. Throws only when it cannot start (the request table is
 * missing), so the scheduler records a failure instead of the job silently
 * asking every day.
 */
async function runStatusCheck({ pool = pg.getPool(), gapMs = SEND_GAP_MS } = {}) {
  const swept = dbService.sweepStalePendingListingActions(Date.now());
  if (!(await tableExists(pool, 'agent_status_requests'))) {
    throw new Error('agent_status_requests is missing — run migrations/20261109_agent_status_requests.sql first');
  }

  const { rows: due } = await pool.query(DUE_AGENTS_SQL, [String(REQUEST_INTERVAL_DAYS), MAX_AGENTS_PER_RUN]);
  const tally = { due: due.length, sent: 0, template: 0, session: 0, outsideWindow: 0, skippedOpenQuestion: 0, failed: 0, swept };

  for (const agent of due) {
    const phone = digits(agent.phone);
    if (dbService.hasOpenAgentQuestion(phone)) {
      // They still owe an answer to another question; a new message would
      // replace theirs. Tomorrow.
      tally.skippedOpenQuestion += 1;
      continue;
    }
    const token = newToken();
    // Claimed before the send, so a crash between the two never re-sends;
    // a send that does not go out releases the claim.
    const { rows } = await pool.query(INSERT_REQUEST_SQL, [agent.agent_id, hashToken(token), String(LINK_TTL_DAYS), agent.listings_count]);
    const requestId = rows[0]?.id;
    let delivery = null;
    try {
      delivery = await sendRequest(agent, token, requestId);
    } catch (err) {
      console.error(`[status-check] agent #${agent.agent_id}: ${err.message}`);
    }
    if (!delivery || delivery === 'outside-window') {
      await pool.query('DELETE FROM agent_status_requests WHERE id = $1', [requestId]).catch(() => {});
      if (delivery === 'outside-window') tally.outsideWindow += 1;
      else tally.failed += 1;
      continue;
    }
    await pool.query('UPDATE agent_status_requests SET delivery = $2 WHERE id = $1', [requestId, delivery]).catch(() => {});
    tally.sent += 1;
    if (delivery === 'template') tally.template += 1;
    else tally.session += 1;
    console.log(`[status-check] request #${requestId} to agent #${agent.agent_id} (${agent.listings_count} listing(s)) via ${delivery}`);
    if (gapMs > 0) await sleep(gapMs);
  }

  console.log(
    `[scheduler] ${JOB_NAME} — ${tally.sent} request(s) sent (${tally.template} template, ${tally.session} session), ${tally.due} due, `
      + `${tally.outsideWindow} outside the 24h window without a template, ${tally.skippedOpenQuestion} with an open question, ${tally.failed} failed`,
  );
  return tally;
}

/**
 * Same name, hour and AVAILABILITY_CHECK=off switch as the per-listing check
 * it replaces (availability.checkDue), so production stays paused until that
 * line is deleted from the engine .env.
 */
const statusCheckJob = { name: JOB_NAME, shouldRun: availability.checkDue, run: () => runStatusCheck() };

module.exports = {
  JOB_NAME,
  REQUEST_INTERVAL_DAYS,
  LINK_TTL_DAYS,
  DUE_AGENTS_SQL,
  STAMP_ALL_SQL,
  newToken,
  hashToken,
  linkUrl,
  parseStatusButtonId,
  okButtonId,
  countPhrase,
  templateParams,
  requestText,
  allConfirmedText,
  sendRequest,
  handleStatusButtonReply,
  runStatusCheck,
  statusCheckJob,
};
