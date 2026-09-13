'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { ADMIN_SESSION_COOKIE, isValidSessionToken } from '@/lib/adminAuth';
import { bulkUpdateAgentStatus } from '@/lib/agents';
import { getT } from '@/lib/i18n/server';

/**
 * Bulk Activer / Suspendre from the /admin/agents table. Writes the same
 * `agents.status` 0/1 the per-row control writes, and nothing else — so a bulk
 * change is exactly N single changes. Verification, routing and territory are
 * deliberately NOT bulk-editable: each is a claim about one agent that should
 * be made on that agent's page, with its evidence in view.
 */
export async function bulkUpdateAgentStatusAction(agentIds, status) {
  const t = await getT();
  try {
    const token = (await cookies()).get(ADMIN_SESSION_COOKIE)?.value;
    if (!isValidSessionToken(token)) throw new Error('Not authenticated');
    const changed = await bulkUpdateAgentStatus(agentIds, Number(status));
    revalidatePath('/admin/agents');
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
