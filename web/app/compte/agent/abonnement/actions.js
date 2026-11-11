'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentAgentId } from '@/lib/agentSession';
import { resumeAutoRenew, stopAutoRenew } from '@/lib/maishapayPayments';

/**
 * "Arrêter / Réactiver le renouvellement automatique" on /compte/agent/abonnement.
 * The paid period is never touched: stopping only means no new PIN prompt is
 * sent when it ends (lib/subscriptionRenewals.js). Scoped to the signed-in
 * agent's own agency in SQL.
 */
export async function setAutoRenewAction(on) {
  const agentId = await getCurrentAgentId();
  if (!agentId) return { ok: false, error: 'auth' };
  try {
    const changed = on ? await resumeAutoRenew(agentId) : await stopAutoRenew(agentId);
    revalidatePath('/compte/agent/abonnement');
    return { ok: true, changed };
  } catch (err) {
    console.error(`[payments] auto-renew ${on ? 'resume' : 'stop'} failed for agent #${agentId}: ${err.message}`);
    return { ok: false, error: 'server' };
  }
}
