'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { getPool } from '@/lib/db';
import { ADMIN_SESSION_COOKIE, isValidSessionToken } from '@/lib/adminAuth';

async function assertAdminSession() {
  const token = (await cookies()).get(ADMIN_SESSION_COOKIE)?.value;
  if (!isValidSessionToken(token)) throw new Error('Not authenticated');
}

/**
 * featured_properties.property_id has no FK constraint (confirmed via
 * information_schema) and no FK to properties.id would even mean "real
 * listing" on its own — a real listing here specifically means approved and
 * public, the same `status = 1 AND approve_status = 1` gate every public
 * query in lib/listings.js applies. Featuring a pending/rejected listing
 * would be a real bug, not just an edge case, so it's checked explicitly
 * rather than trusted.
 */
export async function setFeaturedAction(propertyId, formData) {
  await assertAdminSession();
  const featuredPricingId = Number.parseInt(formData.get('featured_pricing_id'), 10);
  if (!Number.isFinite(featuredPricingId)) throw new Error('featured_pricing_id is required');

  // featured_properties.vendor_id is NOT NULL at the database level (caught
  // live — an insert with agent_id's vendor came back null and the DB
  // correctly rejected it rather than silently accepting bad data). Every
  // real listing today has agent_id NULL, so there's usually no vendor to
  // infer automatically — the admin must attribute the grant to a real
  // vendor explicitly, not have one invented.
  const vendorId = Number.parseInt(formData.get('vendor_id'), 10);
  if (!Number.isFinite(vendorId)) throw new Error('vendor_id is required');

  const pool = getPool();

  const { rows: propertyRows } = await pool.query(
    'SELECT id FROM properties WHERE id = $1 AND status = 1 AND approve_status = 1',
    [propertyId],
  );
  if (!propertyRows.length) throw new Error(`Property #${propertyId} is not a real, approved listing`);

  const { rows: vendorRows } = await pool.query('SELECT id FROM vendors WHERE id = $1', [vendorId]);
  if (!vendorRows.length) throw new Error(`No vendor #${vendorId}`);

  const { rows: pricingRows } = await pool.query(
    'SELECT number_of_days, price FROM featured_pricings WHERE id = $1 AND status = 1',
    [featuredPricingId],
  );
  if (!pricingRows.length) throw new Error(`No active featured pricing #${featuredPricingId}`);
  const { number_of_days: numberOfDays, price } = pricingRows[0];

  await pool.query(
    `INSERT INTO featured_properties
       (featured_pricing_id, property_id, vendor_id, amount, number_of_days, status, start_date, end_date, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 1, NOW(), NOW() + make_interval(days => $5), NOW(), NOW())`,
    [featuredPricingId, propertyId, vendorId, price, numberOfDays],
  );

  revalidatePath('/admin/subscriptions');
}

export async function unsetFeaturedAction(propertyId) {
  await assertAdminSession();
  const pool = getPool();
  await pool.query(
    `UPDATE featured_properties SET status = 0, updated_at = NOW() WHERE property_id = $1 AND status = 1`,
    [propertyId],
  );
  revalidatePath('/admin/subscriptions');
}
