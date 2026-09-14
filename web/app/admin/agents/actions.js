'use server';

import { revalidatePath } from 'next/cache';
import { getPool } from '@/lib/db';
import { requireAdmin } from '@/lib/adminSession';
import { recordAudit } from '@/lib/adminAudit';

export async function updateAgentStatusAction(agentId, formData) {
  const session = await requireAdmin('agents.manage');
  const status = Number.parseInt(formData.get('status'), 10);
  if (![0, 1].includes(status)) throw new Error('status must be 0 or 1');

  const pool = getPool();
  await pool.query('UPDATE agents SET status = $1, updated_at = NOW() WHERE id = $2', [status, agentId]);
  await recordAudit(session, { action: 'agent.status', entityType: 'agent', entityId: agentId, details: { status } });
  revalidatePath('/admin/agents');
  revalidatePath(`/admin/agents/${agentId}`);
}

/**
 * No FK constrains agents.vendor_id at the database level (confirmed via
 * information_schema), so a bad vendorId would silently "succeed" and orphan
 * the agent from a real agency — validated here instead.
 */
export async function reassignAgentVendorAction(agentId, formData) {
  const session = await requireAdmin('agents.manage');
  const raw = formData.get('vendor_id');
  const vendorId = raw ? Number.parseInt(raw, 10) : null;

  const pool = getPool();

  if (vendorId !== null) {
    const { rows } = await pool.query('SELECT id FROM vendors WHERE id = $1', [vendorId]);
    if (!rows.length) throw new Error(`No vendor #${vendorId}`);
  }

  await pool.query('UPDATE agents SET vendor_id = $1, updated_at = NOW() WHERE id = $2', [vendorId, agentId]);
  await recordAudit(session, { action: 'agent.vendor', entityType: 'agent', entityId: agentId, details: { vendorId } });
  revalidatePath('/admin/agents');
  revalidatePath('/admin/agencies');
}

/**
 * Same unenforced-at-the-DB-level situation as vendor_id above, so the
 * listing id is validated for real before writing.
 */
export async function assignAgentToListingAction(propertyId, agentId) {
  const session = await requireAdmin('listings.edit');
  const pool = getPool();

  const { rows } = await pool.query('SELECT id, agent_id FROM properties WHERE id = $1', [propertyId]);
  if (!rows.length) throw new Error(`No property #${propertyId}`);

  await pool.query('UPDATE properties SET agent_id = $1, updated_at = NOW() WHERE id = $2', [agentId, propertyId]);
  await recordAudit(session, {
    action: 'listing.assign_agent',
    entityType: 'listing',
    entityId: propertyId,
    details: { from: rows[0].agent_id == null ? null : Number(rows[0].agent_id), to: agentId },
  });
  revalidatePath('/admin/agents');
  revalidatePath('/admin/listings');
}

/**
 * Backs the public agent storefront's "Communes desservies" section. Values
 * are only ever taken from the real, canonical commune list — never free text.
 */
export async function updateAgentCommunesAction(agentId, validCommunes, formData) {
  try {
    const session = await requireAdmin('agents.manage');
    const validSet = new Set(validCommunes);
    const selected = formData.getAll('communes').filter((c) => validSet.has(c));

    const pool = getPool();
    await pool.query('UPDATE agents SET primary_communes = $1, updated_at = NOW() WHERE id = $2', [
      selected,
      agentId,
    ]);
    await recordAudit(session, { action: 'agent.communes', entityType: 'agent', entityId: agentId, details: { primary: selected } });
    revalidatePath('/admin/agents');
    revalidatePath(`/agents/${agentId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message || 'La mise à jour a échoué.' };
  }
}
