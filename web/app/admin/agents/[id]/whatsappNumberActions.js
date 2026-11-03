'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/adminSession';
import { recordAudit, actorLabel } from '@/lib/adminAudit';
import { addNote } from '@/lib/adminNotes';
import { addAgentWhatsAppNumber, removeAgentWhatsAppNumber } from '@/lib/adminApi';
import { ADMIN_AGENT_ERROR_KEYS, adminAgentRefusal, parseAgentNumberForm } from '@/lib/adminAgentCreate';
import { formatPhoneDisplay } from '@/lib/phone';
import { getT } from '@/lib/i18n/server';

/**
 * Extra WhatsApp numbers an agent sends listings from (the engine's
 * services/agentNumbers.js). Linking one is the team vouching that the number
 * is the agent's: listings WhatsApped from it are attributed to them. Same
 * posture as "Vérifier le numéro" (createAgentActions.js): `agents.manage`
 * only, and who did it goes to the audit log and the agent's timeline.
 */

async function timelineNote(session, agentId, body) {
  try {
    await addNote(session, 'agent', agentId, body);
  } catch (err) {
    console.error(`[admin/agents] note for #${agentId} failed: ${err.message}`);
  }
}

export async function addAgentWhatsAppNumberAction(agentId, formData) {
  const t = await getT();
  let session;
  try {
    session = await requireAdmin('agents.manage');
  } catch (err) {
    return { ok: false, error: err.message };
  }
  const id = Number.parseInt(agentId, 10);
  if (!Number.isFinite(id)) return { ok: false, error: t('errors.agentNotFound') };
  const parsed = parseAgentNumberForm(formData);
  if (!parsed.ok) return { ok: false, error: t(parsed.errorKey) };

  let result;
  try {
    result = await addAgentWhatsAppNumber(id, parsed.phone, actorLabel(session));
  } catch (err) {
    if (!ADMIN_AGENT_ERROR_KEYS[err.code]) console.error(`[admin/agents] link ${parsed.phone} to #${id} failed: ${err.message}`);
    return { ok: false, error: adminAgentRefusal(t, err) };
  }

  const claimed = result.claimed?.linkedIds?.length ?? 0;
  await recordAudit(session, {
    action: 'agent.whatsapp_number_add',
    entityType: 'agent',
    entityId: id,
    details: { phone: result.phone, claimed },
  });
  await timelineNote(session, id, t('admin.agentNumbers.noteAdded', {
    phone: formatPhoneDisplay(result.phone),
    actor: actorLabel(session),
  }));
  revalidatePath(`/admin/agents/${id}`);
  return { ok: true, phone: result.phone, claimed, claimError: Boolean(result.claimed?.error) };
}

export async function removeAgentWhatsAppNumberAction(agentId, phone) {
  const t = await getT();
  let session;
  try {
    session = await requireAdmin('agents.manage');
  } catch (err) {
    return { ok: false, error: err.message };
  }
  const id = Number.parseInt(agentId, 10);
  const digits = String(phone || '').replace(/\D/g, '');
  if (!Number.isFinite(id) || !digits) return { ok: false, error: t('errors.agentNotFound') };

  let result;
  try {
    result = await removeAgentWhatsAppNumber(id, digits);
  } catch (err) {
    if (!ADMIN_AGENT_ERROR_KEYS[err.code]) console.error(`[admin/agents] unlink ${digits} from #${id} failed: ${err.message}`);
    return { ok: false, error: adminAgentRefusal(t, err) };
  }

  if (result.removed) {
    await recordAudit(session, {
      action: 'agent.whatsapp_number_remove',
      entityType: 'agent',
      entityId: id,
      details: { phone: digits },
    });
    await timelineNote(session, id, t('admin.agentNumbers.noteRemoved', {
      phone: formatPhoneDisplay(digits),
      actor: actorLabel(session),
    }));
  }
  revalidatePath(`/admin/agents/${id}`);
  return { ok: true, removed: result.removed };
}
