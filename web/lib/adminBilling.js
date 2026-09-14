import 'server-only';
import { getPool } from './db';

/**
 * Plans and payments for the admin console, over `memberships` — which is this
 * platform's manual payment ledger (one row per assignment or renewal; there is
 * no payment gateway by product decision, see app/admin/subscriptions).
 *
 * "Revenue" here is therefore RECORDED revenue: what admins entered when they
 * assigned a plan, trials excluded. It is labelled as such everywhere it shows,
 * because it is not a reconciliation with a bank.
 */

export const BILLING_VIEWS = ['expiring', 'active', 'expired', 'cancelled', 'all'];

const VIEW_WHERE = {
  expiring: 'mem.status = 1 AND mem.expire_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30',
  active: 'mem.status = 1 AND mem.expire_date >= CURRENT_DATE',
  expired: 'mem.status = 1 AND mem.expire_date < CURRENT_DATE AND mem.expire_date >= CURRENT_DATE - 90',
  cancelled: 'mem.status = 0',
  all: 'TRUE',
};

const VIEW_ORDER = {
  expiring: 'mem.expire_date ASC, mem.id ASC',
  active: 'mem.expire_date ASC, mem.id ASC',
  expired: 'mem.expire_date DESC, mem.id DESC',
  cancelled: 'mem.updated_at DESC NULLS LAST, mem.id DESC',
  all: 'mem.created_at DESC, mem.id DESC',
};

export async function listMembershipsForAdmin({ view = 'expiring', q, packageId, limit = 25, offset = 0 } = {}) {
  const resolved = BILLING_VIEWS.includes(view) ? view : 'expiring';
  const params = [];
  const where = [VIEW_WHERE[resolved]];
  const term = String(q || '').trim();
  if (term) {
    params.push(`%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    where.push(`(v.username ILIKE $${params.length} OR COALESCE(mem.transaction_id, '') ILIKE $${params.length})`);
  }
  if (packageId && Number.isFinite(Number(packageId))) {
    params.push(Number(packageId));
    where.push(`mem.package_id = $${params.length}`);
  }
  const whereClause = `WHERE ${where.join(' AND ')}`;
  const from = `FROM memberships mem LEFT JOIN packages pkg ON pkg.id = mem.package_id LEFT JOIN vendors v ON v.id = mem.vendor_id`;
  const pageLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 25, 1), 100);
  const pageOffset = Math.max(Number.parseInt(offset, 10) || 0, 0);
  const pool = getPool();
  const [count, page] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS total ${from} ${whereClause}`, params),
    pool.query(
      `SELECT mem.id, mem.status, mem.is_trial, mem.price, mem.currency, mem.currency_symbol, mem.payment_method,
              mem.transaction_id, mem.start_date, mem.expire_date, mem.created_at, mem.vendor_id,
              pkg.id AS package_id, pkg.title AS package_title, pkg.term AS package_term,
              v.username AS agency_name,
              (mem.expire_date - CURRENT_DATE) AS days_left
       ${from} ${whereClause}
       ORDER BY ${VIEW_ORDER[resolved]}
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageLimit, pageOffset],
    ),
  ]);
  return { view: resolved, total: count.rows[0]?.total ?? 0, rows: page.rows };
}

/**
 * Listings that may be featured — approved AND public, the same gate
 * setFeaturedAction enforces — searched server-side. Replaces a fixed list of
 * the 50 newest approved listings, which made listing #51 impossible to feature.
 * Currently featured listings come first.
 */
export async function searchFeaturableListings({ q, limit = 25 } = {}) {
  const term = String(q || '').trim();
  const id = /^#?\d+$/.test(term) ? Number.parseInt(term.replace('#', ''), 10) : -1;
  const { rows } = await getPool().query(
    `SELECT p.id, p.reference, pc.title,
            EXISTS (SELECT 1 FROM featured_properties fp WHERE fp.property_id = p.id AND fp.status = 1) AS featured
     FROM properties p
     LEFT JOIN property_contents pc ON pc.property_id = p.id AND pc.language_id = 20
     WHERE p.status = 1 AND p.approve_status = 1
       AND ($1 = '' OR p.id = $2 OR pc.title ILIKE $3 OR p.reference ILIKE $3)
     ORDER BY featured DESC, p.created_at DESC
     LIMIT $4`,
    [term, id, `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`, Math.min(Number(limit) || 25, 100)],
  );
  return rows.map((row) => ({ ...row, id: Number(row.id) }));
}

export async function getBillingSummary() {
  const pool = getPool();
  const [counts, revenue] = await Promise.all([
    pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE ${VIEW_WHERE.expiring})::int  AS expiring,
        COUNT(*) FILTER (WHERE ${VIEW_WHERE.active})::int    AS active,
        COUNT(*) FILTER (WHERE ${VIEW_WHERE.expired})::int   AS expired,
        COUNT(*) FILTER (WHERE ${VIEW_WHERE.cancelled})::int AS cancelled,
        COUNT(*)::int AS all
      FROM memberships mem
    `),
    pool.query(`
      SELECT COALESCE(NULLIF(currency, ''), 'USD') AS currency,
             SUM(price) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')::float AS last30,
             SUM(price) FILTER (WHERE created_at >= NOW() - INTERVAL '90 days')::float AS last90,
             COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')::int AS entries30
      FROM memberships
      WHERE COALESCE(is_trial, 0) = 0 AND price IS NOT NULL AND price > 0
      GROUP BY 1
      ORDER BY 1
    `),
  ]);
  return { counts: counts.rows[0], revenue: revenue.rows };
}
