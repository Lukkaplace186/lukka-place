'use server';

import { revalidatePath } from 'next/cache';
import { getPool } from '@/lib/db';
import { requireAdmin } from '@/lib/adminSession';
import { recordAudit } from '@/lib/adminAudit';
import { deleteAgentAccount, getAgentDeletionImpact } from '@/lib/adminAgentDeletion';

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

/** What the "Supprimer" dialog shows before anything is removed. */
export async function getAgentDeletionImpactAction(agentId) {
  await requireAdmin('agents.delete');
  const impact = await getAgentDeletionImpact(agentId);
  return impact ? { ok: true, impact } : { ok: false, error: 'Agent introuvable.' };
}

/**
 * Permanently deletes an agent account — lib/adminAgentDeletion.js has what
 * happens to every row that points at it. Owner-only (`agents.delete`), and the
 * dialog makes the admin type the agent's id, so a misclick cannot do it.
 */
export async function deleteAgentAction(agentId, formData) {
  const session = await requireAdmin('agents.delete');
  const id = Number(agentId);
  if (String(formData.get('confirm_id') || '').trim() !== String(id)) {
    return { ok: false, error: `Saisissez ${id} pour confirmer la suppression.` };
  }
  const listings = String(formData.get('listings') || 'archive');
  const impact = await getAgentDeletionImpact(id);
  const result = await deleteAgentAccount(id, { listings });
  if (!result.ok) {
    const error = {
      not_found: 'Cet agent n’existe plus.',
      commissions: `Suppression refusée : ${result.count} commission(s) commerciale(s) en attente, approuvée(s) ou payée(s) sont liées à cet agent. Annulez-les ou réglez-les dans Commerciaux d’abord.`,
      bad_mode: 'Choix des annonces invalide.',
    }[result.reason];
    return { ok: false, error: error || 'La suppression a échoué.' };
  }
  await recordAudit(session, {
    action: 'agent.delete',
    entityType: 'agent',
    entityId: id,
    // The account is gone after this; the audit row is what says who it was.
    details: { name: impact?.name ?? null, phone: impact?.phone ?? null, ...result.summary },
  });
  revalidatePath('/admin/agents');
  revalidatePath('/admin/agencies');
  revalidatePath('/admin/listings');
  return {
    ok: true,
    message: `Agent supprimé — ${result.summary.deletedListings} annonce(s) supprimée(s), ${result.summary.archivedListings} archivée(s).`,
  };
}
