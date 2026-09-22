'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentAgentId } from '@/lib/agentSession';
import { saveQuickReply, deleteQuickReply } from '@/lib/quickReplies';
import { getT } from '@/lib/i18n/server';

/**
 * The Paramètres "Réponses rapides" card. Called imperatively so the card can
 * keep its place and show a toast; ownership is enforced by lib/quickReplies.js
 * in every statement, from the session's agent id — never an id the client
 * sends.
 */

async function finish(result) {
  const t = await getT();
  if (!result.ok) return { ok: false, error: t(result.errorKey) };
  revalidatePath('/compte/agent/parametres');
  revalidatePath('/compte/agent/demandes');
  return { ok: true };
}

export async function saveQuickReplyAction(formData) {
  const agentId = await getCurrentAgentId();
  if (!agentId) {
    const t = await getT();
    return { ok: false, error: t('agent.quickReplies.errors.session') };
  }
  const result = await saveQuickReply(agentId, {
    id: String(formData.get('id') || ''),
    title: String(formData.get('title') || ''),
    body: String(formData.get('body') || ''),
  });
  return finish(result);
}

export async function deleteQuickReplyAction(id) {
  const agentId = await getCurrentAgentId();
  if (!agentId) {
    const t = await getT();
    return { ok: false, error: t('agent.quickReplies.errors.session') };
  }
  return finish(await deleteQuickReply(agentId, String(id || '')));
}
