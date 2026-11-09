'use strict';

/**
 * services/listingAutoPause.js
 *
 * Auto-pause — BUILT BUT OFF (owner, 2026-11-09: "turn it on in a month, we
 * are still building the portal"). Runs only with LISTING_AUTO_PAUSE=on
 * (read at call time); unset or anything else does nothing.
 *
 * When on, once a day: a public listing (active or under offer, not a project
 * unit) whose last confirmation — or, never confirmed, last change — is older
 * than PAUSE_AFTER_DAYS is hidden (status = 0) with
 * properties.auto_paused_at stamped, BUT ONLY when its agent was sent a
 * "Faites le point" request (services/agentStatusCheck.js) after that
 * baseline and at least GRACE_DAYS ago, and did not answer for it. An agent
 * we never reached never loses a listing to this.
 *
 * Nothing is deleted and no message is sent here: the next request lists the
 * paused listing first with "Réactiver" (web lib/statusCheck.js), and
 * auto_paused_at keeps it apart from the agent's own "Archiver".
 */

const pg = require('./postgres');
const dbService = require('./db');

const JOB_NAME = 'listing-auto-pause';
const PAUSE_AFTER_DAYS = 30;
const GRACE_DAYS = 3;
/** Kinshasa hour (UTC+1): 6h, before the 10h status-check run that lists what it paused. */
const PAUSE_HOUR_KINSHASA = 6;
const MIN_GAP_MS = 20 * 60 * 60 * 1000;

function autoPauseEnabled() {
  return String(process.env.LISTING_AUTO_PAUSE || '').trim().toLowerCase() === 'on';
}

const BASELINE_SQL = `COALESCE(NULLIF(to_jsonb(p) ->> 'availability_confirmed_at', '')::timestamptz,
                  GREATEST(p.created_at, COALESCE(p.updated_at, p.created_at)))`;

const PAUSE_SQL = `
  UPDATE properties p SET status = 0, auto_paused_at = NOW()
   WHERE p.status = 1 AND p.approve_status = 1
     AND COALESCE(p.listing_status, 'active') IN ('active', 'under_offer')
     AND (to_jsonb(p) ->> 'development_id') IS NULL
     AND ${BASELINE_SQL} < NOW() - ($1 || ' days')::interval
     AND EXISTS (
       SELECT 1 FROM agent_status_requests r
        WHERE r.agent_id = p.agent_id
          AND r.delivery IS NOT NULL
          AND r.created_at > ${BASELINE_SQL}
          AND r.created_at < NOW() - ($2 || ' days')::interval
     )
  RETURNING p.id, p.agent_id
`;

function pauseDue(now = new Date()) {
  if (!autoPauseEnabled()) return false;
  if (!pg.isConfigured()) return false;
  if (now.getUTCHours() !== (PAUSE_HOUR_KINSHASA + 23) % 24) return false;
  const last = dbService.getLastJobRun(JOB_NAME);
  if (!last?.succeeded_at) return true;
  const at = Date.parse(`${String(last.succeeded_at).replace(' ', 'T')}Z`);
  return !Number.isFinite(at) || now.getTime() - at >= MIN_GAP_MS;
}

async function runAutoPause({ pool = pg.getPool() } = {}) {
  if (!autoPauseEnabled()) return { paused: 0, skipped: 'off' };
  let rows;
  try {
    ({ rows } = await pool.query(PAUSE_SQL, [String(PAUSE_AFTER_DAYS), String(GRACE_DAYS)]));
  } catch (err) {
    if (err.code === '42703' || err.code === '42P01') {
      throw new Error('auto-pause needs migrations/20261109_agent_status_requests.sql (auto_paused_at, agent_status_requests)');
    }
    throw err;
  }
  const agents = new Set(rows.map((row) => Number(row.agent_id)));
  console.log(`[scheduler] ${JOB_NAME} — ${rows.length} listing(s) paused for ${agents.size} agent(s)${rows.length ? `: #${rows.map((r) => r.id).join(', #')}` : ''}`);
  return { paused: rows.length, agents: agents.size, ids: rows.map((row) => Number(row.id)) };
}

const autoPauseJob = { name: JOB_NAME, shouldRun: pauseDue, run: () => runAutoPause() };

module.exports = {
  JOB_NAME,
  PAUSE_AFTER_DAYS,
  GRACE_DAYS,
  PAUSE_SQL,
  autoPauseEnabled,
  pauseDue,
  runAutoPause,
  autoPauseJob,
};
