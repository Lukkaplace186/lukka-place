'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/adminSession';
import { recordAudit, actorLabel } from '@/lib/adminAudit';
import { addNote } from '@/lib/adminNotes';
import { adminCreateAgent, adminVerifyAgent } from '@/lib/adminApi';
import { getLocationHierarchyWithFallback } from '@/lib/locations';
import { ADMIN_AGENT_ERROR_KEYS, adminVerificationNote, parseAdminAgentForm } from '@/lib/adminAgentCreate';
import { getT } from '@/lib/i18n/server';

/**
 * "Créer un agent" and "Vérifier le numéro": the team vouches for a number,
 * with no code from that phone. This skips proof of ownership on purpose, so
 * it lives only here, behind `agents.manage`, and the engine half only behind
 * requireApiKey. `phone_verified_at` publishes the number on the agent's
 * listings and routes enquiries to it — who vouched is recorded twice: the
 * audit log and a note on the agent's timeline.
 */

function refusal(t, err) {
  const key = ADMIN_AGENT_ERROR_KEYS[err?.code];
  if (key) return t(key, { id: err.agentId ?? '' });
  return err?.message || t('errors.actionFailed');
}

async function recordVouch(session, agentId, { created, details }) {
  await recordAudit(session, {
    action: created ? 'agent.admin_create' : 'agent.admin_verify',
    entityType: 'agent',
    entityId: agentId,
    details,
  });
  try {
    await addNote(session, 'agent', agentId, adminVerificationNote({ created, actor: actorLabel(session) }));
  } catch (err) {
    console.error(`[admin/agents] note for #${agentId} failed: ${err.message}`);
  }
}

export async function adminCreateAgentAction(formData) {
  const t = await getT();
  let session;
  try {
    session = await requireAdmin('agents.manage');
  } catch (err) {
    return { ok: false, error: err.message };
  }

  // The commune list is re-read here, never trusted from the browser.
  const { communes } = await getLocationHierarchyWithFallback({ city: 'all' });
  const parsed = parseAdminAgentForm(formData, communes);
  if (!parsed.ok) return { ok: false, error: t(parsed.errorKey) };
  const { values } = parsed;

  let result;
  try {
    result = await adminCreateAgent(values);
  } catch (err) {
    if (!ADMIN_AGENT_ERROR_KEYS[err.code]) console.error(`[admin/agents] create ${values.phone} failed: ${err.message}`);
    return { ok: false, error: refusal(t, err), existingAgentId: err.code === 'phone-taken' ? err.agentId ?? null : null };
  }

  await recordVouch(session, result.agentId, {
    created: true,
    details: { phone: result.phone, communes: values.primaryCommunes, claimed: result.claimed?.linkedIds?.length ?? 0 },
  });
  revalidatePath('/admin/agents');
  return {
    ok: true,
    agentId: result.agentId,
    phone: result.phone,
    firstName: values.firstName,
    link: result.link,
    claimed: result.claimed?.linkedIds?.length ?? 0,
    claimError: Boolean(result.claimed?.error),
  };
}

export async function adminVerifyAgentAction(agentId) {
  const t = await getT();
  let session;
  try {
    session = await requireAdmin('agents.manage');
  } catch (err) {
    return { ok: false, error: err.message };
  }
  const id = Number.parseInt(agentId, 10);
  if (!Number.isFinite(id)) return { ok: false, error: t('errors.agentNotFound') };

  let result;
  try {
    result = await adminVerifyAgent(id);
  } catch (err) {
    if (!ADMIN_AGENT_ERROR_KEYS[err.code]) console.error(`[admin/agents] verify #${id} failed: ${err.message}`);
    return { ok: false, error: refusal(t, err) };
  }

  await recordVouch(session, id, {
    created: false,
    details: { phone: result.phone, alreadyVerified: result.alreadyVerified, claimed: result.claimed?.linkedIds?.length ?? 0 },
  });
  revalidatePath('/admin/agents');
  revalidatePath(`/admin/agents/${id}`);
  revalidatePath(`/agents/${id}`);
  return {
    ok: true,
    agentId: id,
    phone: result.phone,
    link: result.link,
    claimed: result.claimed?.linkedIds?.length ?? 0,
    claimError: Boolean(result.claimed?.error),
  };
}
