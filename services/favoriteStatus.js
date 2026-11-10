/**
 * services/favoriteStatus.js
 *
 * "Un bien que vous avez enregistré…" — let or sold, under offer, taken
 * offline, back on the market (customer alerts B9–B11, part 2 phase 2,
 * 2026-11-10). A daily job compares each saved listing's market state with
 * the last state the customer was told, kept in favorite_status_notices
 * (migrations/20261110_push_notifications.sql).
 *
 * - The first time a saved listing is seen, its state is recorded and
 *   nothing is sent: a change from before this existed is not news.
 * - App only (category `saved_listings`), never WhatsApp: no template
 *   covers it, and the owner chose app-only for this kind of alert. A
 *   customer without the app still finds it in their inbox and on Favoris.
 * - At most MAX_PER_CUSTOMER notices per customer per run; the rest are
 *   recorded as told (a burst of five is already a lot).
 * - FAVORITE_STATUS=off stops the job. Missing table → the job does nothing.
 *
 * States (the public gate is status = 1 AND approve_status = 1; a closed
 * listing has status = 0; listing_status is NULL on legacy rows):
 *   closed       approve_status = 1, listing_status = 'closed'
 *   under_offer  public, listing_status = 'under_offer'
 *   active       public, anything else
 *   withdrawn    everything else (archived, suspended, pending, rejected)
 */

const postgres = require('./postgres');
const pushNotify = require('./pushNotify');

const JOB_NAME = 'favorite-status';
const MIN_GAP_MS = 20 * 60 * 60 * 1000;
const MAX_PER_CUSTOMER = 5;
const BATCH = 2000;

function enabled() {
  return String(process.env.FAVORITE_STATUS || '').trim().toLowerCase() !== 'off';
}

function hourKinshasa() {
  const configured = Number.parseInt(process.env.FAVORITE_STATUS_HOUR, 10);
  return Number.isFinite(configured) && configured >= 0 && configured <= 23 ? configured : 11;
}

const STATE_SQL = `
  CASE
    WHEN p.id IS NULL THEN 'withdrawn'
    WHEN p.approve_status = 1 AND p.listing_status = 'closed' THEN 'closed'
    WHEN p.status = 1 AND p.approve_status = 1 AND p.listing_status = 'under_offer' THEN 'under_offer'
    WHEN p.status = 1 AND p.approve_status = 1 THEN 'active'
    ELSE 'withdrawn'
  END`;

const ROWS_SQL = `
  SELECT cf.customer_id, cf.property_id, p.purpose,
         (SELECT pc.title FROM property_contents pc WHERE pc.property_id = cf.property_id AND pc.language_id = 20 LIMIT 1) AS title,
         ${STATE_SQL} AS state,
         n.state AS told_state
    FROM customer_favorites cf
    LEFT JOIN properties p ON p.id = cf.property_id
    LEFT JOIN favorite_status_notices n ON n.customer_id = cf.customer_id AND n.property_id = cf.property_id
   WHERE n.state IS NULL OR n.state <> ${STATE_SQL}
   ORDER BY cf.customer_id, cf.property_id
   LIMIT ${BATCH}`;

const UPSERT_SQL = `
  INSERT INTO favorite_status_notices (customer_id, property_id, state, told_at)
  VALUES ($1, $2, $3, NOW())
  ON CONFLICT (customer_id, property_id) DO UPDATE SET state = EXCLUDED.state, told_at = NOW()`;

/** What to tell for a change, or null when the change is not worth a notice. */
function noticeFor(row) {
  const name = row.title ? `« ${String(row.title).slice(0, 80)} »` : `L'annonce n° ${row.property_id}`;
  const listingPath = `/listings/${row.property_id}`;
  switch (row.state) {
    case 'closed':
      return {
        title: row.purpose === 'sale' ? 'Un bien enregistré a été vendu' : 'Un bien enregistré a été loué',
        body: `${name} n'est plus disponible. Découvrez des biens similaires.`,
        url: '/compte/client/favoris',
      };
    case 'under_offer':
      return { title: 'Offre en cours sur un bien enregistré', body: `${name} est sous offre. Contactez l'agent vite si vous êtes intéressé.`, url: listingPath };
    case 'withdrawn':
      // Withdrawn after being told it was closed is the same news twice.
      return row.told_state === 'closed' ? null : { title: 'Un bien enregistré n’est plus en ligne', body: `${name} a été retiré par l'agent.`, url: '/compte/client/favoris' };
    case 'active':
      return { title: 'De nouveau disponible', body: `${name} est de nouveau disponible.`, url: listingPath };
    default:
      return null;
  }
}

/**
 * One run. Injectable for verify-pipeline: `pool`, `push` (pushNotify.pushOnly).
 * @returns {Promise<{seen: number, baseline: number, told: number, pushed: number, capped: number, skipped?: string}>}
 */
async function runFavoriteStatus({ pool, push = pushNotify.pushOnly } = {}) {
  const summary = { seen: 0, baseline: 0, told: 0, pushed: 0, capped: 0 };
  if (!enabled()) return { ...summary, skipped: 'off' };
  const db = pool || (postgres.isConfigured() ? postgres.getPool() : null);
  if (!db) return { ...summary, skipped: 'no-postgres' };
  let rows;
  try {
    ({ rows } = await db.query(ROWS_SQL));
  } catch (err) {
    if (err?.code === '42P01') return { ...summary, skipped: 'no-table' };
    throw err;
  }
  summary.seen = rows.length;
  const perCustomer = new Map();
  for (const row of rows) {
    const first = row.told_state == null;
    const notice = first ? null : noticeFor(row);
    if (notice) {
      const count = perCustomer.get(row.customer_id) || 0;
      if (count >= MAX_PER_CUSTOMER) {
        summary.capped += 1;
      } else {
        perCustomer.set(row.customer_id, count + 1);
        const outcome = await push({
          userType: 'customer',
          customerId: row.customer_id,
          kind: 'saved_listing_status',
          category: 'saved_listings',
          refId: row.property_id,
          ...notice,
        });
        summary.told += 1;
        if (outcome?.pushed) summary.pushed += 1;
      }
    } else if (first) {
      summary.baseline += 1;
    }
    await db.query(UPSERT_SQL, [row.customer_id, row.property_id, row.state]);
  }
  if (summary.told) console.log(`[favorite-status] ${summary.told} change(s) told, ${summary.pushed} pushed, ${summary.capped} capped`);
  return summary;
}

function due(now = new Date()) {
  if (!enabled()) return false;
  if (now.getUTCHours() !== (hourKinshasa() + 23) % 24) return false;
  // eslint-disable-next-line global-require
  const last = require('./db').getLastJobRun(JOB_NAME);
  if (!last?.succeeded_at) return true;
  return Date.now() - new Date(last.succeeded_at).getTime() >= MIN_GAP_MS;
}

const favoriteStatusJob = { name: JOB_NAME, shouldRun: due, run: () => runFavoriteStatus() };

module.exports = { runFavoriteStatus, favoriteStatusJob, noticeFor, JOB_NAME, ROWS_SQL };
