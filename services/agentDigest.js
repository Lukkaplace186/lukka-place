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
 * - **Delivery.** A session message, which reaches only agents who messaged
 *   the business number in the last 24 hours (root CLAUDE.md, "Outbound
 *   WhatsApp"), except where a template is configured: AGENT_DAY_TEMPLATE for
 *   a day with visits, AGENT_WEEKLY_TEMPLATE for Monday's numbers. The log
 *   counts refusals by Chakra, not by Meta.
 */

const pg = require('./postgres');
const chakra = require('./chakra');
const { db } = require('./db');
const { utcOffsetForCommune } = require('./cities');

const CONTENT_LANGUAGE_ID = 20;
const SITE_URL = (process.env.PUBLIC_SITE_URL || process.env.SITE_URL || 'https://lukkaplace.com').replace(/\/+$/, '');
const CONFIGURED_HOUR = Number.parseInt(process.env.AGENT_DIGEST_HOUR, 10);
/** Kinshasa hour (UTC+1) the digest goes out. 8h: before the day's visits. */
const DIGEST_HOUR_KINSHASA = Number.isFinite(CONFIGURED_HOUR) ? CONFIGURED_HOUR : 8;
const SEND_GAP_MS = Number.parseInt(process.env.AGENT_DIGEST_GAP_MS, 10) || 250;
// "À confirmer" is the same threshold the WhatsApp check asks on
// (services/availabilityCheck.js, web/lib/listingAvailability.js).
const STALE_DAYS = 14;
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
    const entry = byAgent.get(id) || { pendingVisits: 0, visitsToday: [], visitOffsets: [], newRequests: 0 };
    if (key === 'visitsToday') {
      entry.visitsToday.push(value.at);
      entry.visitOffsets.push(utcOffsetForCommune(value.commune));
    }
    else entry[key] += value;
    byAgent.set(id, entry);
  };

  for (const row of db.prepare(
    `SELECT agent_id, COUNT(*) AS n FROM viewing_requests
      WHERE agent_id IS NOT NULL AND status IN ('PENDING', 'RESCHEDULED')
      GROUP BY agent_id`,
  ).all()) bump(row.agent_id, 'pendingVisits', row.n);

  for (const row of db.prepare(
    `SELECT agent_id, scheduled_at, commune FROM viewing_requests
      WHERE agent_id IS NOT NULL AND status = 'CONFIRMED'
        AND scheduled_at >= ? AND scheduled_at < ?
      ORDER BY scheduled_at`,
  ).all(dayStart, dayEnd)) bump(row.agent_id, 'visitsToday', { at: row.scheduled_at, commune: row.commune });

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

const WEEKLY_SQL = (withFunnel) => `
  SELECT p.agent_id, p.id, pc.title,
         SUM(s.views)::int AS views, SUM(s.whatsapp_clicks)::int AS clicks
         ${withFunnel ? ', SUM(s.calls)::int AS calls, SUM(s.visit_requests)::int AS visits' : ''}
    FROM listing_stats_daily s
    JOIN properties p ON p.id = s.listing_id
    LEFT JOIN property_contents pc ON pc.property_id = p.id AND pc.language_id = $2
   WHERE s.day >= CURRENT_DATE - 7 AND s.day < CURRENT_DATE AND p.agent_id = ANY($1::bigint[])
   GROUP BY p.agent_id, p.id, pc.title`;

/**
 * Last 7 whole days per agent: totals, the best listing, and each listing's
 * own line (views, WhatsApp, calls, visit requests) for the Monday per-listing
 * report. Calls and visit requests come from the engagement migration's rollup
 * columns; before it runs they are simply left out (null), never shown as 0.
 */
async function weeklyStats(agentIds) {
  if (!agentIds.length) return new Map();
  let rows;
  try {
    ({ rows } = await pg.getPool().query(WEEKLY_SQL(true), [agentIds, CONTENT_LANGUAGE_ID]));
  } catch (err) {
    if (err.code !== '42703') throw err;
    ({ rows } = await pg.getPool().query(WEEKLY_SQL(false), [agentIds, CONTENT_LANGUAGE_ID]));
  }
  const byAgent = new Map();
  for (const row of rows) {
    const id = Number(row.agent_id);
    const entry = byAgent.get(id) || { views: 0, clicks: 0, top: null, listings: [] };
    entry.views += row.views || 0;
    entry.clicks += row.clicks || 0;
    if (!entry.top || (row.views || 0) > entry.top.views) entry.top = { id: Number(row.id), title: row.title, views: row.views || 0 };
    entry.listings.push({
      id: Number(row.id),
      title: row.title,
      views: row.views || 0,
      clicks: row.clicks || 0,
      calls: row.calls == null ? null : Number(row.calls),
      visits: row.visits == null ? null : Number(row.visits),
    });
    byAgent.set(id, entry);
  }
  return byAgent;
}

/** How many listings get their own line on Monday — WhatsApp truncates long messages behind "Lire la suite". */
const WEEKLY_LISTING_LINES = 3;

/**
 * "• Appartement à Kintambo : 120 vues · 9 WhatsApp · 3 appels · 1 visite"
 * then the link to that listing's page, where the owner's live report is.
 * A count we do not have is left out, not printed as 0.
 */
function listingLine(listing) {
  const parts = [plural(listing.views, 'vue', 'vues'), `${listing.clicks} WhatsApp`];
  if (listing.calls != null) parts.push(plural(listing.calls, 'appel', 'appels'));
  if (listing.visits != null) parts.push(plural(listing.visits, 'demande de visite', 'demandes de visite'));
  const title = String(listing.title || `Annonce n° ${listing.id}`).slice(0, 60);
  return `• ${title} : ${parts.join(' · ')}\n  Rapport propriétaire : ${SITE_URL}/compte/agent/biens/${listing.id}`;
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

/** "14h30" on the visit's own clock — Kinshasa's +1 unless the visit is in a +2 city. */
function kinshasaTime(iso, utcOffset = 1) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const local = new Date(date.getTime() + utcOffset * 60 * 60 * 1000);
  return `${String(local.getUTCHours()).padStart(2, '0')}h${String(local.getUTCMinutes()).padStart(2, '0')}`;
}

/**
 * The message, or null when there is nothing worth sending.
 *
 * @param {{first_name?: string, live?: number, to_confirm?: number, in_review?: number}} agent
 * @param {{pendingVisits?: number, visitsToday?: string[], newRequests?: number}} counts
 * @param {{views: number, clicks: number, top: {title: string, views: number}|null}|null} weekly
 */
/** The day's to-do items, without bullets — shared by the text and the weekly template. */
function todoItems(agent, counts = {}, stale = []) {
  const items = [];
  const pending = counts.pendingVisits || 0;
  const today = counts.visitsToday || [];
  const requests = counts.newRequests || 0;
  const toConfirm = Number(agent.to_confirm) || 0;
  const inReview = Number(agent.in_review) || 0;

  if (pending) items.push(`${plural(pending, 'demande de visite attend', 'demandes de visite attendent')} votre réponse`);
  if (today.length) {
    const times = today.map((iso, i) => kinshasaTime(iso, counts.visitOffsets?.[i])).filter(Boolean);
    items.push(`${plural(today.length, 'visite', 'visites')} aujourd'hui${times.length ? ` (${times.join(', ')})` : ''}`);
  }
  if (requests) items.push(`${plural(requests, 'nouvelle demande client', 'nouvelles demandes clients')} dans vos communes`);
  if (toConfirm) items.push(`${plural(toConfirm, 'bien à confirmer', 'biens à confirmer')} (« toujours disponible ? »)`);
  if (inReview) items.push(`${plural(inReview, 'annonce en cours de relecture', 'annonces en cours de relecture')} par notre équipe`);
  for (const name of (stale || []).slice(0, 3)) {
    items.push(`${name} : aucune photo de chantier depuis ${PROJECT_STALE_DAYS} jours — ajoutez-en une pour rassurer les acheteurs`);
  }
  return items;
}

function composeDigest(agent, counts = {}, weekly = null, stale = []) {
  const lines = todoItems(agent, counts, stale).map((item) => `• ${item}`);

  const weeklyLines = [];
  if (weekly && weekly.views > 0) {
    weeklyLines.push(`📈 La semaine dernière : ${plural(weekly.views, 'vue', 'vues')} de vos annonces, ${plural(weekly.clicks, 'clic', 'clics')} WhatsApp.`);
    const perListing = (weekly.listings || [])
      .filter((l) => l.views > 0)
      .sort((a, b) => b.views - a.views)
      .slice(0, WEEKLY_LISTING_LINES);
    if (perListing.length) weeklyLines.push(perListing.map(listingLine).join('\n'));
    else if (weekly.top?.title && weekly.top.views > 0) weeklyLines.push(`La plus vue : ${weekly.top.title} (${plural(weekly.top.views, 'vue', 'vues')}).`);
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

// The day's visits as a TEMPLATE (2026-10-14), so an agent with visits today
// hears about them even when they have not written to us in 24h. Approved as
// `visites_programme_agent` (UTILITY, fr): "Bonjour {{1}}, voici votre
// récapitulatif de visites pour aujourd'hui. Total prévus : {{2}} Première
// visite : {{3}} …". Unset by default; read at call time. It carries the
// visits only, so the rest of the digest still follows as the session text —
// and is skipped when the visits were all it had to say.
const dayTemplateName = () => (process.env.AGENT_DAY_TEMPLATE || '').trim() || null;

/** Body values for the day template, or null when the agent has no visit today. */
function dayTemplateParams(agent, counts = {}) {
  const today = counts.visitsToday || [];
  if (!today.length) return null;
  const { templateValue } = require('./viewingNotifications');
  return [
    templateValue(agent.first_name, 'partenaire'),
    String(today.length),
    templateValue(kinshasaTime(today[0], counts.visitOffsets?.[0]), 'à confirmer'),
  ];
}

async function sendDayTemplate(phone, name, bodyParams) {
  const { templateOptions } = require('./viewingNotifications');
  return chakra.sendTemplate(phone, name, {
    languageCode: process.env.VIEWING_REQUEST_TEMPLATE_LANG || 'fr',
    bodyParams,
    ...templateOptions(name),
  });
}

// The Monday report as a TEMPLATE (2026-10-26), for the same reason: the
// weekly numbers reached only agents who had written to us in 24h (14
// "sent" on 2026-10-26, most of them refused by Meta). Submitted as
// `bilan_hebdo_agent` (UTILITY, fr, no header, footer "Répondez STOP RÉSUMÉ
// pour ne plus recevoir ce message.", STATIC URL button "Voir mon espace" →
// /compte/agent):
//   "Bonjour {{1}}, voici le bilan de vos annonces sur Lukka Place pour la
//    semaine du {{2}} :\n\nVues : {{3}}\nClics WhatsApp : {{4}}\nAnnonce la
//    plus vue : {{5}}\n\nÀ faire : {{6}}\n\nOuvrez votre espace agent pour le
//    détail de chaque annonce."
// When accepted it IS the Monday message: the to-do list rides in {{6}} and
// the per-listing lines are behind the button. Unset by default, read at call
// time; unset or refused → the day template / text exactly as before.
const weeklyTemplateName = () => (process.env.AGENT_WEEKLY_TEMPLATE || '').trim() || null;

const FRENCH_MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** "19 octobre" / "1er décembre" — the first day of the 7 counted (weeklyStats: CURRENT_DATE - 7). */
function weekStartLabel(now = new Date()) {
  const start = new Date(`${kinshasaDay(now)}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 7);
  const day = start.getUTCDate();
  return `${day === 1 ? '1er' : day} ${FRENCH_MONTHS[start.getUTCMonth()]}`;
}

/** A Meta variable holds 200 characters: keep whole items, mark what was left out. */
const TODO_MAX = 200;
function todoSummary(items) {
  if (!items.length) return 'rien en attente';
  const kept = [];
  for (const item of items) {
    const next = [...kept, item].join(' · ');
    if (next.length > TODO_MAX - 4) break;
    kept.push(item);
  }
  if (!kept.length) return `${items[0].slice(0, TODO_MAX - 1)}…`;
  return kept.length < items.length ? `${kept.join(' · ')} · …` : kept.join(' · ');
}

/** Body values for the weekly template, or null when there were no views to report. */
function weeklyTemplateParams(agent, counts = {}, weekly = null, stale = [], now = new Date()) {
  if (!weekly || !(weekly.views > 0)) return null;
  const { templateValue } = require('./viewingNotifications');
  const top = weekly.top && weekly.top.views > 0
    ? `${String(weekly.top.title || `Annonce n° ${weekly.top.id}`).trim()} (${plural(weekly.top.views, 'vue', 'vues')})`
    : null;
  return [
    templateValue(agent.first_name, 'partenaire'),
    weekStartLabel(now),
    String(weekly.views),
    String(weekly.clicks || 0),
    templateValue(top, 'aucune cette semaine'),
    templateValue(todoSummary(todoItems(agent, counts, stale)), 'rien en attente'),
  ];
}

async function sendWeeklyTemplate(phone, name, bodyParams) {
  const { templateOptions } = require('./viewingNotifications');
  return chakra.sendTemplate(phone, name, {
    languageCode: process.env.AGENT_WEEKLY_TEMPLATE_LANG || 'fr',
    bodyParams,
    ...templateOptions(name),
  });
}

/**
 * Send one agent their morning. Monday with views: the weekly template when
 * one is configured, and nothing else. Otherwise the day template when there
 * are visits today and one is configured, then the text when it says anything
 * more. Throws when nothing at all was accepted.
 */
async function deliverDigest(phone, agent, counts = {}, weekly = null, stale = [], {
  send = chakra.sendWhatsAppMessage,
  sendTemplate = sendDayTemplate,
  sendWeekly = sendWeeklyTemplate,
  now = new Date(),
} = {}) {
  const weeklyName = weeklyTemplateName();
  const weeklyParams = weeklyName ? weeklyTemplateParams(agent, counts, weekly, stale, now) : null;
  if (weeklyParams) {
    try {
      await sendWeekly(phone, weeklyName, weeklyParams);
      return 'weekly-template';
    } catch (err) {
      console.warn(`[digest] weekly template '${weeklyName}' failed for ${phone}, sending the usual digest: ${err.message}`);
    }
  }

  const message = composeDigest(agent, counts, weekly, stale);
  const name = dayTemplateName();
  const params = name ? dayTemplateParams(agent, counts) : null;
  if (params) {
    let templated = false;
    try {
      await sendTemplate(phone, name, params);
      templated = true;
    } catch (err) {
      console.warn(`[digest] template '${name}' failed for ${phone}, sending the text: ${err.message}`);
    }
    if (templated) {
      const rest = composeDigest(agent, { ...counts, visitsToday: [] }, weekly, stale);
      if (rest) await send(phone, rest).catch((err) => console.warn(`[digest] text after the template failed for ${phone}: ${err.message}`));
      return 'template';
    }
  }
  await send(phone, message);
  return 'session';
}

async function runAgentDigest({
  now = new Date(),
  send = chakra.sendWhatsAppMessage,
  sendTemplate = sendDayTemplate,
  sendWeekly = sendWeeklyTemplate,
} = {}) {
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
      await deliverDigest(phone, agent, counts.get(id) || {}, weekly.get(id) || null, stale.get(id) || [], { send, sendTemplate, sendWeekly, now });
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
  deliverDigest,
  dayTemplateParams,
  weeklyTemplateParams,
  weekStartLabel,
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
