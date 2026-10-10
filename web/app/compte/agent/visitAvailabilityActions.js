'use server';

import { getCurrentAgentId } from '@/lib/agentSession';
import { getAgentAvailability, saveAgentAvailability } from '@/lib/agentAvailability';
import { getT } from '@/lib/i18n/server';

/**
 * Saves the agent's "jours sans visites" (components/AgentVisitAvailability.js).
 * The agent id is the session's, never the form's; the values are cleaned by
 * lib/visitSlots.js `normaliseAvailability` inside saveAgentAvailability, so a
 * crafted payload can only ever block weekdays 0–6 and real dates of its own
 * calendar.
 *
 * Returns what is now stored, so the card shows the saved state rather than
 * what was typed (past dates are dropped on save).
 *
 * @returns {Promise<{ok: boolean, error?: string, closedWeekdays?: number[], blockedDates?: string[]}>}
 */
export async function saveVisitAvailabilityAction(input) {
  const t = await getT();
  const agentId = await getCurrentAgentId();
  if (!agentId) return { ok: false, error: t('agent.agenda.done.auth') };

  try {
    const outcome = await saveAgentAvailability(agentId, {
      closedWeekdays: input?.closedWeekdays,
      blockedDates: input?.blockedDates,
    });
    if (outcome === 'unavailable') return { ok: false, error: t('agent.agenda.availability.unavailable') };
    const stored = await getAgentAvailability(agentId);
    return { ok: true, closedWeekdays: stored.closedWeekdays, blockedDates: stored.blockedDates };
  } catch (err) {
    console.error(`[visit-availability] agent #${agentId}: ${err.message}`);
    return { ok: false, error: t('agent.agenda.availability.failed') };
  }
}
