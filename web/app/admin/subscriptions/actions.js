'use server';

import { revalidatePath } from 'next/cache';
import { getPool } from '@/lib/db';
import { requireAdmin } from '@/lib/adminSession';
import { recordAudit } from '@/lib/adminAudit';
import {
  createPackage,
  updatePackage,
  deletePackage,
  assignPackageToAgent,
  resolvePlanChangeRequest,
  readPhotoAllowance,
  PACKAGE_TERMS,
} from '@/lib/subscriptions';

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

  return {
    title, price, term, numberOfProperty, isTrial, trialDays,
    ...readPhotoAllowance(formData.get('photo_sessions_per_month'), formData.get('photo_discount_pct')),
  };
}

function revalidateBilling() {
  revalidatePath('/admin/subscriptions');
  revalidatePath('/admin/billing');
  revalidatePath('/admin/agents');
}

export async function createPackageAction(formData) {
  const session = await requireAdmin('billing.manage');
  const pkg = readPackageForm(formData);
  await createPackage(pkg);
  await recordAudit(session, { action: 'package.create', entityType: 'package', details: pkg });
  revalidateBilling();
}

export async function updatePackageAction(packageId, formData) {
  const session = await requireAdmin('billing.manage');
  const status = Number.parseInt(formData.get('status'), 10);
  const pkg = { ...readPackageForm(formData), status: [0, 1].includes(status) ? status : 1 };
  await updatePackage(packageId, pkg);
  await recordAudit(session, { action: 'package.update', entityType: 'package', entityId: packageId, details: pkg });
  revalidateBilling();
}

/**
 * "Supprimer le forfait". lib/subscriptions.js deletePackage moves agencies on
 * an active membership to the Free plan first, then soft-deletes a package
 * with history or deletes one nobody ever held. Returns a result for the
 * dialog rather than throwing, so a refusal reads as a message.
 */
export async function deletePackageAction(packageId) {
  const session = await requireAdmin('billing.manage');
  const result = await deletePackage(packageId);
  if (!result.ok) {
    const error = {
      not_found: 'Ce forfait n’existe plus.',
      is_default: 'Le forfait Free ne peut pas être supprimé : c’est vers lui que les agences sont réaffectées.',
      no_default: 'Des agences ont un abonnement actif sur ce forfait et aucun forfait Free actif n’existe pour les y réaffecter.',
    }[result.reason];
    return { ok: false, error: error || 'La suppression a échoué.' };
  }
  await recordAudit(session, { action: 'package.delete', entityType: 'package', entityId: Number(packageId), details: result });
  revalidateBilling();
  revalidatePath('/compte/agent/abonnement');
  const moved = result.moved ? ` ${result.moved} agence(s) basculée(s) sur Free.` : '';
  return {
    ok: true,
    message: result.mode === 'deleted'
      ? `Forfait supprimé.${moved}`
      : `Forfait supprimé (conservé dans l’historique de facturation).${moved}`,
  };
}

/**
 * Manual payment ledger — the admin records what was actually agreed/paid at
 * the moment they assign a package; this platform has no payment gateway by
 * product decision.
 */
export async function assignPackageAction(formData) {
  const session = await requireAdmin('billing.manage');

  const agentId = Number.parseInt(formData.get('agent_id'), 10);
  const packageId = Number.parseInt(formData.get('package_id'), 10);
  if (!Number.isFinite(agentId)) throw new Error('agent_id is required');
  if (!Number.isFinite(packageId)) throw new Error('package_id is required');

  const priceRaw = formData.get('price');
  const price = priceRaw ? Number.parseFloat(priceRaw) : null;
  const entry = {
    agentId,
    packageId,
    isTrial: formData.get('is_trial') === 'on',
    price: Number.isFinite(price) ? price : null,
    currency: String(formData.get('currency') || '').trim() || null,
    currencySymbol: String(formData.get('currency_symbol') || '').trim() || null,
    paymentMethod: String(formData.get('payment_method') || '').trim() || null,
    transactionId: String(formData.get('transaction_id') || '').trim() || null,
    receipt: String(formData.get('receipt') || '').trim() || null,
  };
  await assignPackageToAgent(entry);
  await recordAudit(session, { action: 'membership.assign', entityType: 'agent', entityId: agentId, details: entry });
  revalidateBilling();
}

/**
 * featured_properties.property_id has no FK; featuring a pending/rejected
 * listing would be a real bug, so the public gate is checked explicitly.
 */
export async function setFeaturedAction(propertyId, formData) {
  const session = await requireAdmin('billing.manage');
  const featuredPricingId = Number.parseInt(formData.get('featured_pricing_id'), 10);
  if (!Number.isFinite(featuredPricingId)) throw new Error('featured_pricing_id is required');

  // featured_properties.vendor_id is NOT NULL — the admin must attribute the
  // grant to a real vendor explicitly, not have one invented.
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

  await recordAudit(session, {
    action: 'featured.set',
    entityType: 'listing',
    entityId: propertyId,
    details: { featuredPricingId, vendorId, days: numberOfDays, price: Number(price) },
  });
  revalidateBilling();
}

export async function unsetFeaturedAction(propertyId) {
  const session = await requireAdmin('billing.manage');
  const pool = getPool();
  await pool.query(
    `UPDATE featured_properties SET status = 0, updated_at = NOW() WHERE property_id = $1 AND status = 1`,
    [propertyId],
  );
  await recordAudit(session, { action: 'featured.unset', entityType: 'listing', entityId: propertyId });
  revalidateBilling();
}

/**
 * Approve or decline an agent's own plan-change request. Approving both
 * resolves the request AND assigns the package; payment details stay optional
 * so a plan provisioned pending payment never gets a fabricated amount.
 */
export async function resolvePlanRequestAction(requestId, decision, formData) {
  const session = await requireAdmin('billing.manage');

  if (!['approved', 'declined'].includes(decision)) {
    throw new Error("decision must be 'approved' or 'declined'");
  }

  const note = String(formData?.get('handled_note') || '').trim() || null;
  let assigned = null;

  if (decision === 'approved') {
    const agentId = Number.parseInt(formData.get('agent_id'), 10);
    const packageId = Number.parseInt(formData.get('package_id'), 10);
    if (!Number.isFinite(agentId) || !Number.isFinite(packageId)) {
      throw new Error('agent_id and package_id are required to approve a request');
    }

    const priceRaw = formData.get('price');
    const price = priceRaw ? Number.parseFloat(priceRaw) : null;
    assigned = {
      agentId,
      packageId,
      price: Number.isFinite(price) ? price : null,
      currency: String(formData.get('currency') || '').trim() || null,
      currencySymbol: String(formData.get('currency_symbol') || '').trim() || null,
      paymentMethod: String(formData.get('payment_method') || '').trim() || null,
      transactionId: String(formData.get('transaction_id') || '').trim() || null,
    };
    await assignPackageToAgent(assigned);
  }

  await resolvePlanChangeRequest(requestId, decision, note);
  await recordAudit(session, {
    action: `plan_request.${decision}`,
    entityType: 'membership',
    entityId: `request:${requestId}`,
    details: { note, assigned },
  });

  revalidateBilling();
  revalidatePath('/compte/agent/abonnement');
}

/**
 * Extend, expire or cancel an existing membership without creating a new
 * ledger row — a goodwill week is not a payment.
 */
export async function updateMembershipAction(membershipId, formData) {
  const session = await requireAdmin('billing.manage');
  const action = String(formData.get('action') || '');
  const pool = getPool();
  let details = {};

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
    details = { days };
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

  await recordAudit(session, { action: `membership.${action}`, entityType: 'membership', entityId: membershipId, details });
  revalidateBilling();
}

/** Quota override on a PACKAGE — this schema has no per-agent quota column. */
export async function updatePackageQuotasAction(packageId, formData) {
  const session = await requireAdmin('billing.manage');

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

  await recordAudit(session, {
    action: 'package.quotas',
    entityType: 'package',
    entityId: packageId,
    details: { listingLimit, pitchLimit, priority },
  });
  revalidateBilling();
  revalidatePath('/compte/agent/abonnement');
}
