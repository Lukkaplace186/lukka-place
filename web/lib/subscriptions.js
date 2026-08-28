import 'server-only';
import { getPool } from './db';

/**
 * Real memberships/packages data (7 real membership rows, 9 real packages —
 * confirmed directly, not seed data). One real membership row's vendor_id
 * doesn't resolve to a current vendors row (no FK enforces this at the DB
 * level) — LEFT JOIN so that row still shows up with '—' instead of being
 * silently dropped.
 */
export async function getMemberships() {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT mem.id, mem.status, mem.price, mem.currency_symbol, mem.start_date, mem.expire_date,
            pkg.title AS package_title,
            v.id AS vendor_id, v.username AS vendor_username
     FROM memberships mem
     LEFT JOIN packages pkg ON pkg.id = mem.package_id
     LEFT JOIN vendors v ON v.id = mem.vendor_id
     ORDER BY mem.created_at DESC`,
  );
  return rows;
}

export async function getFeaturedPricings() {
  const pool = getPool();
  const { rows } = await pool.query(
    'SELECT id, price, number_of_days FROM featured_pricings WHERE status = 1 ORDER BY number_of_days',
  );
  return rows;
}

/** Which real properties.id values currently have an active featured_properties row. */
export async function getFeaturedPropertyIds() {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT property_id FROM featured_properties WHERE status = 1 AND end_date > NOW()`,
  );
  return new Set(rows.map((r) => Number(r.property_id)));
}
