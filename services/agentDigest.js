/**
 * services/agentDigest.js
 *
 * The agent's morning WhatsApp: what needs them today, and on Mondays how
 * their listings did last week. Agents live in WhatsApp, not in a dashboard —
 * this brings the dashboard's "À faire aujourd'hui" to where they already are,
 * and the weekly views are the number that makes an agent come back.
 *
 * - **Only real counts, only when there is something to say.** An agent with
 *   nothing pending and no views gets nothing: a daily "rien aujourd'hui" is
 *   how a sender gets muted, and then the day it matters goes unread.
 * - **Sources.** Visit requests and customer requests pushed to the agent are
 *   the engine's own SQLite (viewing_requests, lead_matches); live listings,
 *   stale availability and views are Postgres (properties,
 *   listing_stats_daily — the same rollup the dashboard reads).
 * - **Once per agent per Kinshasa day**, claimed in `agent_digest_sends`
 *   BEFORE the send, so a restart mid-run never sends twice. A failed send is
 *   recorded, not retried the same day.
 * - **"STOP RÉSUMÉ"** opts an agent out (`agent_digest_optouts`, handled in
 *   routes/webhook.js before anything else reads the message).
 * - **Delivery.** A session message: without an approved template
 *   (AGENT_DIGEST_TEMPLATE, unset) it reaches agents who messaged the business
 *   number in the last 24 hours — the same rule as every other outbound
 *   message (root CLAUDE.md, "Outbound WhatsApp"). The log counts refusals.
 */

const pg = require('./postgres');
const chakra = require('./chakra');
const { db } = require('./db');

const CONTENT_LANGUAGE_ID = 20;
const SITE_URL = (process.env.PUBLIC_SITE_URL || process.env.SITE_URL || 'https://lukkaplace.com').replace(/\/+$/, '');
const CONFIGURED_HOUR = Number.parseInt(process.env.AGENT_DIGEST_HOUR, 10);
/** Kinshasa hour (UTC+1) the digest goes out. 8h: before the day's visits. */
const DIGEST_HOUR_KINSHASA = Number.isFinite(CONFIGURED_HOUR) ? CONFIGURED_HOUR : 8;
const SEND_GAP_MS = Number.parseInt(process.env.AGENT_DIGEST_GAP_MS, 10) || 250;
const STALE_DAYS = 7;
const JOB_NAME = 'agent-daily-digest';

db.exec(`
  CREATE TABLE IF NOT EXISTS agent_digest_sends (
    agent_id  INTEGER NOT NULL,
    day       TEXT    NOT NULL,
    weekly    INTEGER NOT NULL DEFAULT 0,
    status    TEXT    NOT NULL DEFAULT 'CLAIMED',
    error     TEXT,
    sent_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (agent_id, day)
  );
  CREATE TABLE IF NOT EXISTS agent_digest_runs (
    day       TEXT PRIMARY KEY,
    finished_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS agent_digest_optouts (
    phone     TEXT PRIMARY KEY,
    opted_out_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

/** YYYY-MM-DD of `now` in Kinshasa (UTC+1, no DST). */
function kinshasaDay(now = new Date()) {
  return new Date(now.getTime() + 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Monday in Kinshasa — the day the weekly numbers ride along. */
function isKinshasaMonday(now = new Date()) {
  return new Date(now.getTime() + 60 * 60 * 1000).getUTCDay() === 1;
}

/** [start, end) of the Kinshasa day as UTC `Z` strings — how scheduled_at is stored. */
function kinshasaDayBoundsUtc(now = new Date()) {
  const start = new Date(`${kinshasaDay(now)}T00:00:00+01:00`);
  return [start.toISOString(), new Date(start.getTime() + 24 * 60 * 60 * 1000).toISOString()];
}

function digestDue(now = new Date()) {
  if (now.getUTCHours() !== (DIGEST_HOUR_KINSHASA + 23) % 24) return false;
  return !db.prepare('SELECT 1 FROM agent_digest_runs WHERE day = ?').get(kinshasaDay(now));
}

/** Counts the engine owns, keyed by Postgres agents.id. */
function engineCounts(now = new Date()) {
  const [dayStart, dayEnd] = kinshasaDayBoundsUtc(now);
  const byAgent = new Map();
  const bump = (agentId, key, value) => {
    const id = Number(agentId);
    if (!Number.isFinite(id)) return;
    const entry = byAgent.get(id) || { pendingVisits: 0, visitsToday: [], newRequests: 0 };
    if (key === 'visitsToday') entry.visitsToday.push(value);
    else entry[key] += value;
    byAgent.set(id, entry);
  };

  for (const row of db.prepare(
    `SELECT agent_id, COUNT(*) AS n FROM viewing_requests
      WHERE agent_id IS NOT NULL AND status IN ('PENDING', 'RESCHEDULED')
      GROUP BY agent_id`,
  ).all()) bump(row.agent_id, 'pendingVisits', row.n);

  for (const row of db.prepare(
    `SELECT agent_id, scheduled_at FROM viewing_requests
      WHERE agent_id IS NOT NULL AND status = 'CONFIRMED'
        AND scheduled_at >= ? AND scheduled_at < ?
      ORDER BY scheduled_at`,
  ).all(dayStart, dayEnd)) bump(row.agent_id, 'visitsToday', row.scheduled_at);

  for (const row of db.prepare(
    `SELECT agent_id, COUNT(*) AS n FROM lead_matches
      WHERE status = 'NOTIFIED' AND created_at >= datetime('now', '-1 day')
      GROUP BY agent_id`,
  ).all()) bump(row.agent_id, 'newRequests', row.n);

  return byAgent;
}

/** Verified, active agents with their listing counts. */
async function loadAgents() {
  const { rows } = await pg.getPool().query(
    `SELECT a.id, a.phone,
            (SELECT ai.first_name FROM agent_infos ai
              WHERE ai.agent_id = a.id AND ai.language_id = $1 AND COALESCE(ai.first_name, '') <> ''
              LIMIT 1) AS first_name,
            COUNT(p.id) FILTER (
              WHERE p.status = 1 AND p.approve_status = 1 AND COALESCE(p.listing_status, 'active') = 'active'
            ) AS live,
            COUNT(p.id) FILTER (
              WHERE p.status = 1 AND p.approve_status = 1 AND COALESCE(p.listing_status, 'active') = 'active'
                AND COALESCE(NULLIF(to_jsonb(p) ->> 'availability_confirmed_at', '')::timestamptz,
                             GREATEST(p.created_at, COALESCE(p.updated_at, p.created_at)))
                    < NOW() - ($2 || ' days')::interval
            ) AS to_confirm,
            COUNT(p.id) FILTER (WHERE p.status = 1 AND p.approve_status = 0) AS in_review
       FROM agents a
       LEFT JOIN properties p ON p.agent_id = a.id
      WHERE a.status = 1 AND a.phone_verified_at IS NOT NULL AND COALESCE(a.phone, '') <> ''
      GROUP BY a.id, a.phone`,
    [CONTENT_LANGUAGE_ID, String(STALE_DAYS)],
  );
  return rows;
}

/** Last 7 whole days of views and WhatsApp taps, per agent, with their best listing. */
async function weeklyStats(agentIds) {
  if (!agentIds.length) return new Map();
  const { rows } = await pg.getPool().query(
    `SELECT p.agent_id, p.id, pc.title,
            SUM(s.views)::int AS views, SUM(s.whatsapp_clicks)::int AS clicks
       FROM listing_stats_daily s
       JOIN properties p ON p.id = s.listing_id
       LEFT JOIN property_contents pc ON pc.property_id = p.id AND pc.language_id = $2
      WHERE s.day >= CURRENT_DATE - 7 AND s.day < CURRENT_DATE AND p.agent_id = ANY($1::bigint[])
      GROUP BY p.agent_id, p.id, pc.title`,
    [agentIds, CONTENT_LANGUAGE_ID],
  );
  const byAgent = new Map();
  for (const row of rows) {
    const id = Number(row.agent_id);
    const entry = byAgent.get(id) || { views: 0, clicks: 0, top: null };
    entry.views += row.views || 0;
    entry.clicks += row.clicks || 0;
    if (!entry.top || (row.views || 0) > entry.top.views) entry.top = { id: Number(row.id), title: row.title, views: row.views || 0 };
    byAgent.set(id, entry);
  }
  return byAgent;
}

/**
 * Mondays only: the developer's public off-plan projects with no dated
 * construction photo for PROJECT_STALE_DAYS (or none since approval) — the
 * public page starts warning buyers at 90 days (web developmentRules
 * STALE_UPDATE_DAYS), so this asks a month earlier. A missing developments
 * table (migration not run) is "no projects", never a failed digest.
 */
const PROJECT_STALE_DAYS = 60;

async function staleProjects(agentIds) {
  if (!agentIds.length) return new Map();
  try {
    const { rows } = await pg.getPool().query(
      `SELECT d.agent_id, d.name
         FROM developments d
        WHERE d.agent_id = ANY($1::bigint[])
          AND d.status = 1 AND d.approve_status = 1
          AND d.kind = 'building' AND d.stage <> 'delivered'
          AND COALESCE((SELECT MAX(u.taken_on) FROM development_updates u WHERE u.development_id = d.id)::timestamptz,
                       d.approved_at, d.created_at) < NOW() - ($2 || ' days')::interval
        ORDER BY d.name`,
      [agentIds, String(PROJECT_STALE_DAYS)],
    );
    const byAgent = new Map();
    for (const row of rows) {
      const id = Number(row.agent_id);
      byAgent.set(id, [...(byAgent.get(id) || []), row.name]);
    }
    return byAgent;
  } catch (err) {
    if (err.code === '42P01' || err.code === '42703') return new Map();
    console.warn(`[digest] stale-project lookup failed, skipped: ${err.message}`);
    return new Map();
  }
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

function kinshasaTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const local = new Date(date.getTime() + 60 * 60 * 1000);
  return `${String(local.getUTCHours()).padStart(2, '0')}h${String(local.getUTCMinutes()).padStart(2, '0')}`;
}

/**
 * The message, or null when there is nothing worth sending.
 *
 * @param {{first_name?: string, live?: number, to_confirm?: number, in_review?: number}} agent
 * @param {{pendingVisits?: number, visitsToday?: string[], newRequests?: number}} counts
 * @param {{views: number, clicks: number, top: {title: string, views: number}|null}|null} weekly
 */
function composeDigest(agent, counts = {}, weekly = null, stale = []) {
  const lines = [];
  const pending = counts.pendingVisits || 0;
  const today = counts.visitsToday || [];
  const requests = counts.newRequests || 0;
  const toConfirm = Number(agent.to_confirm) || 0;
  const inReview = Number(agent.in_review) || 0;

  if (pending) lines.push(`• ${plural(pending, 'demande de visite attend', 'demandes de visite attendent')} votre réponse`);
  if (today.length) {
    const times = today.map(kinshasaTime).filter(Boolean);
    lines.push(`• ${plural(today.length, 'visite', 'visites')} aujourd'hui${times.length ? ` (${times.join(', ')})` : ''}`);
  }
  if (requests) lines.push(`• ${plural(requests, 'nouvelle demande client', 'nouvelles demandes clients')} dans vos communes`);
  if (toConfirm) lines.push(`• ${plural(toConfirm, 'bien à confirmer', 'biens à confirmer')} (« toujours disponible ? »)`);
  if (inReview) lines.push(`• ${plural(inReview, 'annonce en cours de relecture', 'annonces en cours de relecture')} par notre équipe`);
  for (const name of (stale || []).slice(0, 3)) {
    lines.push(`• ${name} : aucune photo de chantier depuis ${PROJECT_STALE_DAYS} jours — ajoutez-en une pour rassurer les acheteurs`);
  }

  const weeklyLines = [];
  if (weekly && weekly.views > 0) {
    weeklyLines.push(`📈 La semaine dernière : ${plural(weekly.views, 'vue', 'vues')} de vos annonces, ${plural(weekly.clicks, 'clic', 'clics')} WhatsApp.`);
    if (weekly.top?.title && weekly.top.views > 0) weeklyLines.push(`La plus vue : ${weekly.top.title} (${plural(weekly.top.views, 'vue', 'vues')}).`);
  }

  if (!lines.length && !weeklyLines.length) return null;

  const name = agent.first_name ? ` ${String(agent.first_name).trim()}` : '';
  return [
    `Bonjour${name} ☀️ Votre journée sur Lukka Place :`,
    lines.length ? lines.join('\n') : null,
    weeklyLines.length ? weeklyLines.join('\n') : null,
    `👉 ${SITE_URL}/compte/agent`,
    '_Répondez STOP RÉSUMÉ pour ne plus recevoir ce message._',
  ].filter(Boolean).join('\n\n');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runAgentDigest({ now = new Date(), send = chakra.sendWhatsAppMessage } = {}) {
  if (!pg.isConfigured()) return { skipped: 'postgres not configured' };
  const day = kinshasaDay(now);
  const weeklyDay = isKinshasaMonday(now);

  const agents = await loadAgents();
  const counts = engineCounts(now);
  const weekly = weeklyDay ? await weeklyStats(agents.map((a) => Number(a.id))) : new Map();
  const stale = weeklyDay ? await staleProjects(agents.map((a) => Number(a.id))) : new Map();
  const optedOut = new Set(db.prepare('SELECT phone FROM agent_digest_optouts').all().map((r) => r.phone));
  const claim = db.prepare('INSERT OR IGNORE INTO agent_digest_sends (agent_id, day, weekly) VALUES (?, ?, ?)');
  const settle = db.prepare('UPDATE agent_digest_sends SET status = ?, error = ? WHERE agent_id = ? AND day = ?');

  let sent = 0;
  let failed = 0;
  let quiet = 0;
  for (const agent of agents) {
    const id = Number(agent.id);
    const phone = digits(agent.phone);
    if (!phone || optedOut.has(phone)) continue;
    const message = composeDigest(agent, counts.get(id), weekly.get(id) || null, stale.get(id) || []);
    if (!message) {
      quiet += 1;
      continue;
    }
    if (claim.run(id, day, weeklyDay ? 1 : 0).changes === 0) continue;
    try {
      await send(phone, message);
      settle.run('SENT', null, id, day);
      sent += 1;
    } catch (err) {
      settle.run('FAILED', String(err.message || err).slice(0, 300), id, day);
      failed += 1;
    }
    await sleep(SEND_GAP_MS);
  }

  db.prepare('INSERT OR IGNORE INTO agent_digest_runs (day) VALUES (?)').run(day);
  console.log(`[digest] ${day}: ${sent} sent, ${failed} refused, ${quiet} with nothing to say${weeklyDay ? ' (weekly)' : ''}`);
  return { sent, failed, quiet, weekly: weeklyDay };
}

/** "STOP RÉSUMÉ" / "stop resume" / "stop digest" — the opt-out. */
function isDigestOptOut(text) {
  const normalised = String(text || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return /^stop\s*(resume|digest|resumes)[\s!.]*$/.test(normalised);
}

function optOut(phone) {
  db.prepare('INSERT OR IGNORE INTO agent_digest_optouts (phone) VALUES (?)').run(digits(phone));
}

const OPT_OUT_REPLY =
  "C'est noté : vous ne recevrez plus le résumé du matin. Votre tableau de bord reste sur lukkaplace.com/compte/agent.";

const agentDigestJob = { name: JOB_NAME, shouldRun: digestDue, run: () => runAgentDigest() };

module.exports = {
  agentDigestJob,
  loadAgents,
  weeklyStats,
  engineCounts,
  runAgentDigest,
  composeDigest,
  digestDue,
  kinshasaDay,
  isKinshasaMonday,
  isDigestOptOut,
  optOut,
  OPT_OUT_REPLY,
};
