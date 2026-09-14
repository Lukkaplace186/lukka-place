'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/adminSession';
import { recordAudit } from '@/lib/adminAudit';
import { bulkUpdateAgentStatus } from '@/lib/agents';
import { getT } from '@/lib/i18n/server';

/**
 * Bulk Activer / Suspendre from the /admin/agents and /admin/agencies tables.
 * Writes the same `agents.status` 0/1 the per-row control writes, and nothing
 * else — so a bulk change is exactly N single changes, each audited.
 * Verification, routing and territory are deliberately NOT bulk-editable.
 */
export async function bulkUpdateAgentStatusAction(agentIds, status) {
  const t = await getT();
  try {
    const session = await requireAdmin('agents.bulk');
    const ids = [...new Set((agentIds || []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
    const changed = await bulkUpdateAgentStatus(ids, Number(status));
    for (const id of ids) {
      await recordAudit(session, { action: 'agent.status', entityType: 'agent', entityId: id, details: { status: Number(status), bulk: ids.length } });
    }
    revalidatePath('/admin/agents');
    revalidatePath('/admin/agencies');
    return {
      ok: true,
      message: Number(status) === 1
        ? t('admin.agents.bulkActivated', { count: changed })
        : t('admin.agents.bulkSuspended', { count: changed }),
    };
  } catch (err) {
    return { ok: false, error: err.message || t('errors.actionFailed') };
  }
}
