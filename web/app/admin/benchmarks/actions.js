'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { ADMIN_SESSION_COOKIE, isValidSessionToken } from '@/lib/adminAuth';
import { setAgentDirectRouting } from '@/lib/adminLeadRouting';
import { getT } from '@/lib/i18n/server';

async function assertAdminSession() {
  const token = (await cookies()).get(ADMIN_SESSION_COOKIE)?.value;
  if (!isValidSessionToken(token)) throw new Error('Not authenticated');
}

/**
 * The verification control: route this agent's listings direct (wa.me to the
 * agent) or force the central fallback. Switching ON is refused in SQL for an
 * agent whose number is unverified — see lib/adminLeadRouting.js.
 */
export async function setDirectRoutingAction(agentId, enabled) {
  const t = await getT();
  try {
    await assertAdminSession();
    const updated = await setAgentDirectRouting(agentId, enabled);
    if (!updated) return { ok: false, error: t('admin.agentPerformance.cannotEnableUnverified') };
    revalidatePath('/admin/benchmarks');
    return {
      ok: true,
      message: enabled ? t('admin.agentPerformance.routingOn') : t('admin.agentPerformance.routingOff'),
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
