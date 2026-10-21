/**
 * Drafts nobody said "OK" to go to moderation anyway.
 *
 * A WhatsApp listing waits as `pending_confirmation` until its sender answers
 * "OK". Agents who post many listings a day often never answer, and a draft
 * nobody confirms never reaches Postgres — so the back office never sees it.
 * Publishing here only means "into the approval queue": every listing still
 * lands with `approve_status = 0`, and a human (or trustedAutoApprove's narrow
 * rule) decides whether it goes live. The OK is a courtesy, not the gate.
 *
 * Scheduler job `draft-auto-submit`. A draft is submitted DRAFT_AUTO_SUBMIT_HOURS
 * (default 3; 0 or "off" disables) after it was created, and only when:
 *  - it has at least one photo — the mandatory-photo rule holds on every
 *    publish path (CLAUDE.md), so a text-only draft stays pending;
 *  - the sender's plan has room for it (services/listingQuota.js, the same
 *    check the "OK" path makes; unknown sender or Postgres down → allowed).
 * Nothing is sent to the agent: the owners' "annonce à valider" alert fires on
 * the first sync like for any other listing. The row is stamped
 * `parsed_json.auto_submitted_at` so the console can tell it from a confirmed one.
 */

'use strict';

const db = require('./db');
const listingQuota = require('./listingQuota');

const JOB_NAME = 'draft-auto-submit';
const BATCH = 50;

function autoSubmitHours() {
  const raw = String(process.env.DRAFT_AUTO_SUBMIT_HOURS ?? '').trim().toLowerCase();
  if (raw === 'off') return 0;
  const hours = Number.parseFloat(raw);
  return Number.isFinite(hours) && hours >= 0 ? hours : 3;
}

/** SQLite's CURRENT_TIMESTAMP shape, UTC. */
function sqliteTime(date) {
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

function cutoff(now) {
  return sqliteTime(new Date(now.getTime() - autoSubmitHours() * 60 * 60 * 1000));
}

/** An over-quota draft is asked about again a day later, not every minute. */
const BLOCKED_RETRY_HOURS = 24;

// Photo-less drafts are filtered here, not after: left in the batch they
// would occupy its first slots forever and nothing behind them would move.
const DUE_SQL = `
  SELECT id FROM listings
  WHERE status = 'pending_confirmation'
    AND datetime(created_at) <= datetime(@cutoff)
    AND photos IS NOT NULL AND TRIM(photos) NOT IN ('', '[]', 'null')
    AND (NOT json_valid(parsed_json) OR json_extract(parsed_json, '$.auto_submit_blocked_at') IS NULL
         OR datetime(json_extract(parsed_json, '$.auto_submit_blocked_at')) <= datetime(@retry))
  ORDER BY id
  LIMIT @limit`;

function dueDrafts(now = new Date(), limit = BATCH) {
  const retry = sqliteTime(new Date(now.getTime() - BLOCKED_RETRY_HOURS * 60 * 60 * 1000));
  return db.db
    .prepare(DUE_SQL)
    .all({ cutoff: cutoff(now), retry, limit })
    .map(({ id }) => db.getListing(id))
    .filter((row) => row && Array.isArray(row.photos) && row.photos.length > 0);
}

/** Cheap: runs every minute. Only says yes when a submittable draft is waiting. */
function autoSubmitDue(now = new Date()) {
  if (autoSubmitHours() <= 0) return false;
  return dueDrafts(now, 1).length > 0;
}

function stamp(id, key, value) {
  db.db
    .prepare(`UPDATE listings SET parsed_json = json_set(COALESCE(parsed_json, '{}'), '$.' || @key, @value) WHERE id = @id`)
    .run({ id, key, value });
}

async function runDraftAutoSubmit({ now = new Date(), checkQuota = listingQuota.checkQuotaForSender } = {}) {
  const result = { submitted: [], overQuota: [] };
  if (autoSubmitHours() <= 0) return result;

  for (const row of dueDrafts(now)) {
    let quota = null;
    try {
      quota = await checkQuota(row.wa_id, listingQuota.listingsToPublish(row));
    } catch (err) {
      console.warn(`[draft-auto-submit] quota check failed for #${row.id}: ${err.message}`);
    }
    if (quota?.blocked) {
      stamp(row.id, 'auto_submit_blocked_at', sqliteTime(now));
      result.overQuota.push(row.id);
      console.log(`[draft-auto-submit] listing #${row.id} left pending — plan full (${quota.used}/${quota.limit})`);
      continue;
    }
    // Read again: an "OK" that landed while the quota call was in flight has
    // already published it.
    const still = db.getListing(row.id);
    if (!still || still.status !== 'pending_confirmation') continue;

    stamp(row.id, 'auto_submitted_at', now.toISOString());
    const { ids } = db.expandAndPublishListing(row.id);
    result.submitted.push(...ids);
    console.log(`[draft-auto-submit] listing #${row.id} from ${row.wa_id} sent to moderation without an OK (${ids.length} row(s))`);
  }

  return result;
}

const draftAutoSubmitJob = { name: JOB_NAME, shouldRun: autoSubmitDue, run: () => runDraftAutoSubmit() };

module.exports = {
  draftAutoSubmitJob,
  runDraftAutoSubmit,
  autoSubmitDue,
  autoSubmitHours,
  JOB_NAME,
};
