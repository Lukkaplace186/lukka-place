'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/adminSession';
import { recordAudit } from '@/lib/adminAudit';
import { setAgentDirectRouting } from '@/lib/adminLeadRouting';
import { getT } from '@/lib/i18n/server';

/**
 * The verification control: route this agent's listings direct (wa.me to the
 * agent) or force the central fallback. Switching ON is refused in SQL for an
 * agent whose number is unverified — see lib/adminLeadRouting.js. Owner-only:
 * it decides whose phone number is published on listing pages.
 */
export async function setDirectRoutingAction(agentId, enabled) {
  const t = await getT();
  try {
    const session = await requireAdmin('routing.manage');
    const updated = await setAgentDirectRouting(agentId, enabled);
    if (!updated) return { ok: false, error: t('admin.agentPerformance.cannotEnableUnverified') };
    await recordAudit(session, { action: 'agent.routing', entityType: 'agent', entityId: agentId, details: { enabled: Boolean(enabled) } });
    revalidatePath('/admin/benchmarks');
    return {
      ok: true,
      message: enabled ? t('admin.agentPerformance.routingOn') : t('admin.agentPerformance.routingOff'),
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
