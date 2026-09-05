'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { getPool } from '@/lib/db';
import { ADMIN_SESSION_COOKIE, isValidSessionToken } from '@/lib/adminAuth';
import {
  createPackage,
  updatePackage,
  assignPackageToAgent,
  resolvePlanChangeRequest,
  PACKAGE_TERMS,
} from '@/lib/subscriptions';

async function assertAdminSession() {
  const token = (await cookies()).get(ADMIN_SESSION_COOKIE)?.value;
  if (!isValidSessionToken(token)) throw new Error('Not authenticated');
}

function readPackageForm(formData) {
  const title = String(formData.get('title') || '').trim();
  const price = Number.parseFloat(formData.get('price'));
  const term = String(formData.get('term') || '');
  const numberOfPropertyRaw = formData.get('number_of_property');
  const numberOfProperty = numberOfPropertyRaw ? Number.parseInt(numberOfPropertyRaw, 10) : null;
  const isTrial = formData.get('is_trial') === 'on';
  const trialDays = Number.parseInt(formData.get('trial_days'), 10) || 0;

  if (!title) throw new Error('Le nom du forfait est obligatoire.');
  if (!Number.isFinite(price) || price < 0) throw new Error('Indiquez un prix valide.');
  if (!PACKAGE_TERMS.includes(term)) throw new Error(`term must be one of: ${PACKAGE_TERMS.join(', ')}`);

  return { title, price, term, numberOfProperty, isTrial, trialDays };
}

export async function createPackageAction(formData) {
  await assertAdminSession();
  await createPackage(readPackageForm(formData));
  revalidatePath('/admin/subscriptions');
}

export async function updatePackageAction(packageId, formData) {
  await assertAdminSession();
  const status = Number.parseInt(formData.get('status'), 10);
  await updatePackage(packageId, { ...readPackageForm(formData), status: [0, 1].includes(status) ? status : 1 });
  revalidatePath('/admin/subscriptions');
}

/**
 * Manual payment ledger — the admin records what was actually agreed/paid
 * (price/method/transaction reference) at the moment they assign a package,
 * since this app has no payment gateway of its own (per the product
 * decision behind this feature: manual entry, not a real processor).
 */
export async function assignPackageAction(formData) {
  await assertAdminSession();

  const agentId = Number.parseInt(formData.get('agent_id'), 10);
  const packageId = Number.parseInt(formData.get('package_id'), 10);
  if (!Number.isFinite(agentId)) throw new Error('agent_id is required');
  if (!Number.isFinite(packageId)) throw new Error('package_id is required');

  const priceRaw = formData.get('price');
  const price = priceRaw ? Number.parseFloat(priceRaw) : null;

  await assignPackageToAgent({
    agentId,
    packageId,
    isTrial: formData.get('is_trial') === 'on',
    price: Number.isFinite(price) ? price : null,
    currency: String(formData.get('currency') || '').trim() || null,
    currencySymbol: String(formData.get('currency_symbol') || '').trim() || null,
    paymentMethod: String(formData.get('payment_method') || '').trim() || null,
    transactionId: String(formData.get('transaction_id') || '').trim() || null,
    receipt: String(formData.get('receipt') || '').trim() || null,
  });

  revalidatePath('/admin/subscriptions');
  revalidatePath('/admin/agents');
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

/**
 * Approve or decline an agent's own plan-change request.
 *
 * "Approve" here means "we have taken the payment and are provisioning it" —
 * this platform has no gateway (deliberately: /admin/subscriptions is a
 * manual ledger for cash, bank transfer and Mobile Money), so approving both
 * resolves the request AND assigns the package in one transaction-shaped
 * action rather than leaving an admin to remember the second half.
 *
 * The payment details are optional on purpose: an agency put on a plan
 * pending payment is a real situation, and forcing a fabricated amount to
 * record the provisioning would put a fake number straight into the ledger.
 */
export async function resolvePlanRequestAction(requestId, decision, formData) {
  await assertAdminSession();

  if (!['approved', 'declined'].includes(decision)) {
    throw new Error("decision must be 'approved' or 'declined'");
  }

  const note = String(formData?.get('handled_note') || '').trim() || null;

  if (decision === 'approved') {
    const agentId = Number.parseInt(formData.get('agent_id'), 10);
    const packageId = Number.parseInt(formData.get('package_id'), 10);
    if (!Number.isFinite(agentId) || !Number.isFinite(packageId)) {
      throw new Error('agent_id and package_id are required to approve a request');
    }

    const priceRaw = formData.get('price');
    const price = priceRaw ? Number.parseFloat(priceRaw) : null;

    await assignPackageToAgent({
      agentId,
      packageId,
      price: Number.isFinite(price) ? price : null,
      currency: String(formData.get('currency') || '').trim() || null,
      currencySymbol: String(formData.get('currency_symbol') || '').trim() || null,
      paymentMethod: String(formData.get('payment_method') || '').trim() || null,
      transactionId: String(formData.get('transaction_id') || '').trim() || null,
    });
  }

  await resolvePlanChangeRequest(requestId, decision, note);

  revalidatePath('/admin/subscriptions');
  revalidatePath('/admin/agents');
  revalidatePath('/compte/agent/abonnement');
}

/**
 * Extend, expire or cancel an existing membership without creating a new
 * ledger row.
 *
 * `memberships` doubles as the payment ledger (one row per assignment or
 * renewal — see lib/subscriptions.js), which is exactly why extending has to
 * be a distinct verb from assigning: a goodwill week added to a plan is not a
 * payment, and recording it as one would inflate revenue in the very table an
 * admin reads to reconcile cash.
 *
 * `status = 0` is this schema's own "not active" for a membership; the
 * agent-facing card reads `expire_date` and shows an honest expired state, so
 * cancelling by pulling the date back to today is what the rest of the app
 * already understands.
 */
export async function updateMembershipAction(membershipId, formData) {
  await assertAdminSession();
  const action = String(formData.get('action') || '');
  const pool = getPool();

  if (action === 'extend') {
    const days = Number.parseInt(formData.get('days'), 10);
    if (!Number.isFinite(days) || days === 0) throw new Error('days must be a non-zero integer');
    await pool.query(
      `UPDATE memberships
       SET expire_date = GREATEST(COALESCE(expire_date, CURRENT_DATE), CURRENT_DATE) + make_interval(days => $1),
           status = 1, updated_at = NOW()
       WHERE id = $2`,
      [days, membershipId],
    );
  } else if (action === 'cancel') {
    await pool.query(
      `UPDATE memberships SET status = 0, expire_date = CURRENT_DATE, updated_at = NOW() WHERE id = $1`,
      [membershipId],
    );
  } else if (action === 'reactivate') {
    await pool.query(`UPDATE memberships SET status = 1, updated_at = NOW() WHERE id = $1`, [membershipId]);
  } else {
    throw new Error(`Unknown membership action: ${action}`);
  }

  revalidatePath('/admin/subscriptions');
  revalidatePath('/admin/agents');
}

/**
 * Quota override on a PACKAGE, not on one agency.
 *
 * There is no per-agent quota column anywhere in this schema — the caps are
 * `packages.number_of_property` and `packages.monthly_pitch_limit`, which
 * every agency on that tier shares. Adding a per-agent override column would
 * be a real migration and a second source of truth for every quota check in
 * both applications; editing the tier is the honest capability this schema
 * actually supports, and the form says so rather than implying a per-agent
 * grant that doesn't exist.
 */
export async function updatePackageQuotasAction(packageId, formData) {
  await assertAdminSession();

  const listingLimitRaw = formData.get('number_of_property');
  const pitchLimitRaw = formData.get('monthly_pitch_limit');
  const priorityRaw = formData.get('priority_multiplier');

  const listingLimit = listingLimitRaw ? Number.parseInt(listingLimitRaw, 10) : null;
  const pitchLimit = Number.parseInt(pitchLimitRaw, 10);
  const priority = Number.parseFloat(priorityRaw);

  if (!Number.isFinite(pitchLimit) || pitchLimit < 0) throw new Error('monthly_pitch_limit must be >= 0');
  if (!Number.isFinite(priority) || priority <= 0) throw new Error('priority_multiplier must be > 0');

  const pool = getPool();
  await pool.query(
    `UPDATE packages
     SET number_of_property = $1, monthly_pitch_limit = $2, priority_multiplier = $3, updated_at = NOW()
     WHERE id = $4`,
    [listingLimit, pitchLimit, priority, packageId],
  );

  revalidatePath('/admin/subscriptions');
  revalidatePath('/compte/agent/abonnement');
}
