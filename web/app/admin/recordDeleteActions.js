'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/adminSession';
import { recordAudit } from '@/lib/adminAudit';
import { deleteLeadRecord, deleteViewingRequestRecord } from '@/lib/adminApi';
import { getT } from '@/lib/i18n/server';

/**
 * Permanent deletes of engine records from the console, owner only. These
 * rows live in the engine's SQLite (no soft-delete column there), so the
 * audit entry is the record that they existed. Nobody is messaged.
 */
export async function deleteLeadAction(leadId) {
  const t = await getT();
  try {
    const session = await requireAdmin('leads.delete');
    const result = await deleteLeadRecord(leadId);
    await recordAudit(session, { action: 'lead.delete', entityType: 'lead', entityId: leadId, details: { visits: result?.visits ?? 0 } });
    revalidatePath('/admin/leads');
    revalidatePath('/admin/viewings');
    return { ok: true, message: t('admin.records.leadDeleted', { count: result?.visits ?? 0 }) };
  } catch (err) {
    return { ok: false, error: err.status === 404 ? t('admin.records.notFound') : err.message || t('errors.actionFailed') };
  }
}

export async function deleteViewingAction(viewingRequestId) {
  const t = await getT();
  try {
    const session = await requireAdmin('viewings.delete');
    const result = await deleteViewingRequestRecord(viewingRequestId);
    await recordAudit(session, { action: 'viewing.delete', entityType: 'viewing', entityId: viewingRequestId, details: { leadId: result?.leadId ?? null } });
    revalidatePath('/admin/viewings');
    revalidatePath('/admin/leads');
    return { ok: true, message: t('admin.records.viewingDeleted') };
  } catch (err) {
    return { ok: false, error: err.status === 404 ? t('admin.records.notFound') : err.message || t('errors.actionFailed') };
  }
}
