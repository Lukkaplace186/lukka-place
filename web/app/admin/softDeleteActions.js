'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/adminSession';
import { actorLabel, recordAudit } from '@/lib/adminAudit';
import { restoreBatch, softDelete } from '@/lib/adminSoftDelete';
import { SOFT_DELETE_ENTITIES, cleanIds, isBatchId } from '@/lib/adminSoftDeleteRules';
import { getT } from '@/lib/i18n/server';

const PERMISSION = { agent: 'agents.delete', agency: 'agents.delete', listing: 'listings.delete' };

function revalidateLists() {
  revalidatePath('/admin/agents');
  revalidatePath('/admin/agencies');
  revalidatePath('/admin/listings');
  // Deleted listings leave the storefront at once (status = 0).
  revalidatePath('/', 'layout');
}

/**
 * Bulk soft delete from the console tables' "Supprimer la sélection".
 * @returns {Promise<{ok: true, message: string, batchId: string} | {ok: false, error: string}>}
 */
export async function softDeleteAction(entity, ids) {
  const t = await getT();
  try {
    if (!SOFT_DELETE_ENTITIES.includes(entity)) return { ok: false, error: t('errors.actionFailed') };
    const session = await requireAdmin(PERMISSION[entity]);
    const clean = cleanIds(ids);
    if (!clean) return { ok: false, error: t('admin.softDelete.invalidSelection') };
    const actor = actorLabel(session).slice(0, 200);
    const result = await softDelete(entity, clean, actor);
    await recordAudit(session, {
      action: `${entity}.soft_delete`,
      entityType: entity,
      entityId: clean.length === 1 ? clean[0] : `batch:${result.batchId}`,
      details: { ids: clean, batchId: result.batchId, deleted: result.deleted, cascadedAgents: result.cascadedAgents, cascadedListings: result.cascadedListings },
    });
    revalidateLists();
    const cascade = [
      result.cascadedAgents ? t('admin.softDelete.cascadeAgents', { count: result.cascadedAgents }) : null,
      result.cascadedListings ? t('admin.softDelete.cascadeListings', { count: result.cascadedListings }) : null,
    ].filter(Boolean).join(', ');
    return {
      ok: true,
      batchId: result.batchId,
      message: [t('admin.softDelete.deleted', { count: result.deleted }), cascade ? `(${cascade})` : null].filter(Boolean).join(' '),
    };
  } catch (err) {
    return { ok: false, error: err.message || t('errors.actionFailed') };
  }
}

/** "Annuler" on the toast. Same permission as the delete it undoes. */
export async function undoSoftDeleteAction(entity, batchId) {
  const t = await getT();
  try {
    if (!SOFT_DELETE_ENTITIES.includes(entity) || !isBatchId(batchId)) return { ok: false, error: t('errors.actionFailed') };
    const session = await requireAdmin(PERMISSION[entity]);
    const result = await restoreBatch(batchId, actorLabel(session).slice(0, 200));
    if (!result.ok) return { ok: false, error: t(`admin.softDelete.undo_${result.reason}`) };
    await recordAudit(session, { action: `${entity}.soft_delete_undo`, entityType: entity, entityId: `batch:${batchId}`, details: { restored: result.restored } });
    revalidateLists();
    return { ok: true, message: t('admin.softDelete.restored') };
  } catch (err) {
    return { ok: false, error: err.message || t('errors.actionFailed') };
  }
}
