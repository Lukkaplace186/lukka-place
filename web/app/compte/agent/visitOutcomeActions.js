'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentAgentId } from '@/lib/agentSession';
import { findOwnedViewingRequest } from '@/lib/agentViewingOwnership';
import { recordAgentVisitOutcome } from '@/lib/adminApi';
import { canDeclareVisitOutcome, VISIT_OUTCOMES } from '@/lib/visitOutcome';
import { getT } from '@/lib/i18n/server';

/**
 * "Visite effectuée" / "Pas eu lieu" from the agent agenda. Ownership is the
 * Visites tab's own rule (lib/agentViewingOwnership.js) and the engine
 * re-checks it by agents.id (services/visitReceipt.js). DONE sends the customer
 * the bon de visite; nothing here changes the status.
 *
 * @returns {Promise<{ok: boolean, message?: string, error?: string, receiptText?: string, customerWaId?: string}>}
 */
export async function recordVisitOutcomeAction(viewingRequestId, outcome) {
  const t = await getT();
  const agentId = await getCurrentAgentId();
  if (!agentId) return { ok: false, error: t('agent.agenda.done.auth') };
  if (!VISIT_OUTCOMES.includes(outcome)) return { ok: false, error: t('agent.agenda.done.failed') };
  const id = Number.parseInt(viewingRequestId, 10);
  if (!Number.isSafeInteger(id)) return { ok: false, error: t('agent.agenda.done.failed') };

  let visit;
  try {
    visit = await findOwnedViewingRequest(agentId, id, { status: 'CONFIRMED' });
  } catch (err) {
    console.error(`[visit-outcome] lookup #${id} for agent #${agentId}: ${err.message}`);
    return { ok: false, error: t('agent.agenda.done.failed') };
  }
  if (!visit || !canDeclareVisitOutcome(visit)) return { ok: false, error: t('agent.agenda.done.notYet') };

  try {
    const result = await recordAgentVisitOutcome(id, { agentId, outcome });
    revalidatePath('/compte/agent/visites');
    if (outcome === 'NOT_DONE') return { ok: true, message: t('agent.agenda.done.notDoneSaved') };
    return {
      ok: true,
      message: result.receiptSent ? t('agent.agenda.done.receiptSent') : t('agent.agenda.done.receiptNotSent'),
      receiptText: result.receiptText || null,
      customerWaId: result.customerWaId || visit.lead_wa_id || null,
    };
  } catch (err) {
    console.error(`[visit-outcome] #${id}: ${err.message}`);
    return { ok: false, error: t('agent.agenda.done.failed') };
  }
}
