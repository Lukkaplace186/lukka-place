'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/adminSession';
import { recordAudit } from '@/lib/adminAudit';
import { updateProspect } from '@/lib/marketProspects';
import { getT } from '@/lib/i18n/server';

/** Saves the team's follow-up on one prospect (status, contact date, channel, notes, name, agency). */
export async function updateProspectAction(id, input) {
  const t = await getT();
  try {
    const session = await requireAdmin('market.manage');
    const numericId = Number(id);
    if (!Number.isInteger(numericId) || numericId <= 0) return { ok: false, error: t('errors.actionFailed') };
    const result = await updateProspect(numericId, input || {}, session.id || null);
    if (!result.ok) return { ok: false, error: t(`admin.marketProspects.errors.${result.error}`) };
    await recordAudit(session, {
      action: 'market.prospect_update',
      entityType: 'market_prospect',
      entityId: String(numericId),
      details: { status: input?.status, channel: input?.channel || null, notes_length: String(input?.notes || '').length },
    });
    revalidatePath('/admin/market-data/prospects');
    return { ok: true };
  } catch (err) {
    console.error(`[admin/prospects] update failed: ${err.message}`);
    return { ok: false, error: t('errors.actionFailed') };
  }
}
