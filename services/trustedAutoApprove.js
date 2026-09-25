/**
 * services/trustedAutoApprove.js
 *
 * Auto-approval for TRUSTED agents — the moderation lever for 30k agents.
 * A human reading every listing does not scale; a human reading the listings
 * of agents who have not earned trust yet, plus anything flagged, does.
 *
 * One scheduler job, every 5 minutes, over pending listings. Not a change to
 * either write path (engine sync, web agent form): both still create
 * `approve_status = 0`, the invariant web's write-path-parity test pins, and
 * this sweep is the one place that may promote one — so the rule lives once.
 *
 * TRUSTED (all of it, read live every sweep):
 *   - the agent is active, phone-verified, and holds the verification tier a
 *     human granted from /admin/verifications ('verified' / 'agency_partner');
 *   - at least MIN_APPROVED of their listings were approved by a human, and
 *     none rejected in the last REJECTION_LOOKBACK_DAYS.
 *
 * THE LISTING must also pass what a moderator's approve button checks
 * (web/app/admin/listings/actions.js publishProblem): title and description,
 * a price above 0, no extraction-failure text — plus a real photo and a
 * commune tag, and it must have sat SETTLE_MINUTES so a burst of photos has
 * landed. Anything short of that stays in the human queue.
 *
 * The decision is recorded as a moderation like any other
 * (`moderated_at`, `moderation_note = 'auto:trusted-agent'`, `moderated_by`
 * NULL — no person decided), and the agent gets the same "votre annonce est
 * en ligne" message a human approval sends.
 */

const pg = require('./postgres');
const chakra = require('./chakra');
const { db } = require('./db');

const JOB_NAME = 'trusted-auto-approve';
const TRUSTED_LEVELS = ['verified', 'agency_partner'];
const MIN_APPROVED = Number.parseInt(process.env.AUTO_APPROVE_MIN_APPROVED, 10) || 5;
const REJECTION_LOOKBACK_DAYS = 90;
const SETTLE_MINUTES = 10;
const BATCH = 50;
const EVERY_MS = 5 * 60 * 1000;
const AUTO_NOTE = 'auto:trusted-agent';
const EXTRACTION_FAILURE_MARKERS = ['ne contient', 'uniquement une image', 'sans information', 'aucune information'];
const SITE_URL = (process.env.PUBLIC_SITE_URL || 'https://lukkaplace.com').replace(/\/+$/, '');

let lastRunAt = 0;

function autoApproveDue(now = new Date()) {
  if (process.env.AUTO_APPROVE_TRUSTED === 'off') return false;
  return now.getTime() - lastRunAt >= EVERY_MS;
}

/**
 * Pending listings of trusted agents that pass every publish check. The
 * whole rule is this one statement, so what the admin page describes and
 * what the sweep does cannot drift.
 */
const CANDIDATES_SQL = `
  WITH trusted AS (
    SELECT a.id
      FROM agents a
     WHERE a.status = 1 AND a.phone_verified_at IS NOT NULL
       AND to_jsonb(a) ->> 'verification_level' = ANY($1::text[])
       AND (SELECT COUNT(*) FROM properties q
             WHERE q.agent_id = a.id AND q.approve_status = 1
               AND COALESCE(q.moderation_note, '') <> '${AUTO_NOTE}') >= $2
       AND NOT EXISTS (SELECT 1 FROM properties r
             WHERE r.agent_id = a.id AND r.approve_status = 2
               AND COALESCE(r.moderated_at, r.updated_at, r.created_at) > NOW() - ($3 || ' days')::interval)
  )
  SELECT p.id, p.agent_id
    FROM properties p
    JOIN trusted t ON t.id = p.agent_id
    JOIN property_contents pc ON pc.property_id = p.id AND pc.language_id = 20
   WHERE p.status = 1 AND p.approve_status = 0
     -- A developer's unit is approved with its project (web /admin/projets), never on its own.
     AND p.development_id IS NULL
     AND p.created_at < NOW() - ($4 || ' minutes')::interval
     AND p.price > 0
     AND COALESCE(pc.title, '') <> '' AND COALESCE(pc.description, '') <> ''
     AND NOT (LOWER(pc.description) LIKE ANY($5::text[]))
     AND COALESCE(p.featured_image, '') <> '' AND p.featured_image NOT ILIKE '%noimage%'
     AND EXISTS (SELECT 1 FROM property_amenities pa WHERE pa.property_id = p.id AND pa.amenity_id BETWEEN 21 AND 44)
   ORDER BY p.created_at
   LIMIT $6`;

async function runTrustedAutoApprove({ notify = true } = {}) {
  lastRunAt = Date.now();
  if (!pg.isConfigured()) return { approved: 0, skipped: 'postgres not configured' };

  const pool = pg.getPool();
  const { rows } = await pool.query(CANDIDATES_SQL, [
    TRUSTED_LEVELS,
    MIN_APPROVED,
    String(REJECTION_LOOKBACK_DAYS),
    String(SETTLE_MINUTES),
    EXTRACTION_FAILURE_MARKERS.map((m) => `%${m}%`),
    BATCH,
  ]);

  const approved = [];
  for (const row of rows) {
    // Guarded on approve_status = 0: a moderator who acted in the meantime wins.
    const { rowCount } = await pool.query(
      `UPDATE properties
          SET approve_status = 1, moderation_note = $2, moderation_reason_code = NULL,
              moderated_at = NOW(), moderated_by = NULL, updated_at = NOW()
        WHERE id = $1 AND approve_status = 0`,
      [row.id, AUTO_NOTE],
    );
    if (!rowCount) continue;
    approved.push(Number(row.id));

    if (notify) {
      const listing = db.getListingByRemotePropertyId(Number(row.id));
      if (listing?.wa_id) {
        chakra
          .sendWhatsAppMessage(listing.wa_id, `Bonjour, bonne nouvelle ! Votre annonce est maintenant en ligne : ${SITE_URL}/listings/${row.id}`)
          .catch((err) => console.warn(`[auto-approve] notify for #${row.id} failed: ${err.message}`));
      }
    }
  }

  if (approved.length) console.log(`[auto-approve] ${approved.length} listing(s) from trusted agents published: ${approved.map((id) => `#${id}`).join(', ')}`);
  return { approved: approved.length, ids: approved };
}

const trustedAutoApproveJob = { name: JOB_NAME, shouldRun: autoApproveDue, run: () => runTrustedAutoApprove() };

module.exports = {
  trustedAutoApproveJob,
  runTrustedAutoApprove,
  CANDIDATES_SQL,
  AUTO_NOTE,
  TRUSTED_LEVELS,
  MIN_APPROVED,
};
