'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentAgentId } from '@/lib/agentSession';
import { getT } from '@/lib/i18n/server';
import { phoneFromForm } from '@/lib/phone';
import { parseClientFields } from '@/lib/clientMatching';
import { getLocationHierarchyWithFallback } from '@/lib/locations';
import { createAgentClient, updateAgentClient, deleteAgentClient, recordClientContact } from '@/lib/agentClients';

/**
 * The client book's writes (/compte/agent/clients). Each re-reads the agent
 * from the session cookie and passes it into a query that is scoped on it
 * (lib/agentClients.js) — a client id from the browser is never enough on its
 * own. Called imperatively, so every path returns {ok, error} rather than
 * throwing; the dialogs toast the answer.
 *
 * The commune allow-list is fetched HERE, not accepted from the form (the
 * known gap web/CLAUDE.md records for createListingAction).
 */

function refresh() {
  revalidatePath('/compte/agent/clients');
  revalidatePath('/compte/agent/biens');
  revalidatePath('/compte/agent');
}

const REASON_KEYS = {
  duplicate: 'agent.clients.errors.duplicate',
  unavailable: 'agent.clients.errors.unavailable',
  not_found: 'agent.clients.errors.notFound',
};

/**
 * @param {string|null} clientId null creates, an id updates
 * @param {FormData} formData
 */
export async function saveAgentClientAction(clientId, formData) {
  const t = await getT();
  const agentId = await getCurrentAgentId();
  if (!agentId) return { ok: false, error: t('agent.clients.errors.auth') };

  const { communes: validCommunes } = await getLocationHierarchyWithFallback().catch(() => ({ communes: [] }));
  const parsed = parseClientFields(
    {
      name: formData.get('name'),
      phone: phoneFromForm(formData, 'phone'),
      transaction_type: formData.get('transaction_type'),
      communes: formData.getAll('communes'),
      budget_min: formData.get('budget_min'),
      budget_max: formData.get('budget_max'),
      bedrooms: formData.get('bedrooms'),
      notes: formData.get('notes'),
    },
    { validCommunes },
  );
  if (!parsed.ok) return { ok: false, error: t(parsed.errorKey) };

  try {
    const result = clientId
      ? await updateAgentClient(agentId, clientId, parsed.value)
      : await createAgentClient(agentId, parsed.value);
    if (!result.ok) return { ok: false, error: t(REASON_KEYS[result.reason] || 'errors.submissionFailed') };
  } catch (err) {
    console.error(`[compte/agent] client save failed for agent #${agentId}: ${err.message}`);
    return { ok: false, error: t('errors.submissionFailed') };
  }

  refresh();
  return { ok: true };
}

export async function deleteAgentClientAction(clientId) {
  const t = await getT();
  const agentId = await getCurrentAgentId();
  if (!agentId) return { ok: false, error: t('agent.clients.errors.auth') };
  try {
    const result = await deleteAgentClient(agentId, clientId);
    if (!result.ok) return { ok: false, error: t(REASON_KEYS[result.reason] || 'errors.submissionFailed') };
  } catch (err) {
    console.error(`[compte/agent] client delete failed for agent #${agentId}: ${err.message}`);
    return { ok: false, error: t('errors.submissionFailed') };
  }
  refresh();
  return { ok: true };
}

/**
 * Called as the agent taps a pre-filled WhatsApp link. Records that WhatsApp
 * was OPENED — whether the message was then sent happens on the agent's phone
 * and we cannot see it. No revalidate: the chip updates its own marker, and a
 * refresh here would re-render the whole row list under the agent's thumb.
 */
export async function recordClientContactAction(clientId, listingId) {
  const agentId = await getCurrentAgentId();
  if (!agentId) return { ok: false };
  try {
    return await recordClientContact(agentId, clientId, listingId);
  } catch (err) {
    console.error(`[compte/agent] client contact marker failed for agent #${agentId}: ${err.message}`);
    return { ok: false };
  }
}
