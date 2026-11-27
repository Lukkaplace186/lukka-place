import 'server-only';
import { createHash } from 'node:crypto';
import { getPool } from './db';
import { REPORT_STATUSES } from './listingReportRules';

/**
 * "Signaler cette annonce" storage (2026-11-27), table `listing_reports`
 * (migrations/20261127_listing_reports.sql). Every read checks the table
 * exists first, so the code is safe before the migration runs: the form then
 * answers "unavailable" and the console page says the table is missing.
 */

async function tableReady(pool) {
  const { rows } = await pool.query("SELECT to_regclass('public.listing_reports') IS NOT NULL AS ok");
  return Boolean(rows[0]?.ok);
}

/** SHA-256 of the visitor cookie (or the address when there is none): never the value itself. */
export function visitorHash(value) {
  const text = String(value || '').trim();
  return text ? createHash('sha256').update(`listing-report:${text}`).digest('hex') : null;
}

/**
 * One report. `{ ok: true }` when stored, `{ ok: true, duplicate: true }` when
 * this visitor already has an open report on the listing (the partial unique
 * index), `{ ok: false, reason: 'not_ready' }` before the migration.
 */
export async function createListingReport({ propertyId, reason, note = null, customerId = null, visitor = null }) {
  const pool = getPool();
  if (!(await tableReady(pool))) return { ok: false, reason: 'not_ready' };
  const { rowCount } = await pool.query(
    `INSERT INTO listing_reports (property_id, reason, note, customer_id, visitor_hash)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (property_id, visitor_hash) WHERE status = 'open' AND visitor_hash IS NOT NULL DO NOTHING`,
    [propertyId, reason, note, customerId, visitor],
  );
  return rowCount ? { ok: true } : { ok: true, duplicate: true };
}

/**
 * The console list, newest first, with the listing's title, place and agent.
 * The listing is read whatever its state (a reported listing may already be
 * suspended or gone): LEFT JOIN, and the page says when it no longer exists.
 */
export async function listListingReports({ status = 'open', limit = 100 } = {}) {
  const pool = getPool();
  if (!(await tableReady(pool))) return { ready: false, rows: [], counts: {} };
  const wanted = REPORT_STATUSES.includes(status) ? status : 'open';
  const [{ rows }, { rows: countRows }] = await Promise.all([
    pool.query(
      `SELECT r.id, r.property_id, r.reason, r.note, r.status, r.created_at, r.handled_at, r.handled_by,
              (r.customer_id IS NOT NULL) AS from_customer,
              p.title AS listing_title, p.status AS listing_visible, p.approve_status AS listing_approved,
              p.agent_id,
              (SELECT COUNT(*)::int FROM listing_reports o WHERE o.property_id = r.property_id AND o.status = 'open') AS open_on_listing
         FROM listing_reports r
         LEFT JOIN properties p ON p.id = r.property_id
        WHERE r.status = $1
        ORDER BY r.created_at DESC
        LIMIT $2`,
      [wanted, Math.min(Math.max(Number(limit) || 100, 1), 200)],
    ),
    pool.query('SELECT status, COUNT(*)::int AS n FROM listing_reports GROUP BY status'),
  ]);
  const counts = Object.fromEntries(countRows.map((row) => [row.status, row.n]));
  return { ready: true, rows, counts };
}

/** Marks one report handled (`resolved`) or not acted on (`dismissed`). */
export async function setListingReportStatus(id, status, handledBy) {
  if (!['resolved', 'dismissed', 'open'].includes(status)) throw new Error('unknown status');
  const pool = getPool();
  const { rowCount } = await pool.query(
    `UPDATE listing_reports
        SET status = $2,
            handled_at = CASE WHEN $2 = 'open' THEN NULL ELSE now() END,
            handled_by = CASE WHEN $2 = 'open' THEN NULL ELSE $3 END
      WHERE id = $1`,
    [id, status, handledBy],
  );
  return rowCount > 0;
}
