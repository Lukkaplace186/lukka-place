'use server';

import { revalidatePath } from 'next/cache';
import { sendManualReply, updateConversation } from '@/lib/adminApi';
import { requireAdmin } from '@/lib/adminSession';
import { recordAudit } from '@/lib/adminAudit';
import { getAgentNamesByIds } from '@/lib/agents';
import { getT } from '@/lib/i18n/server';

/**
 * Quick actions behind the conversation drawer. Each returns `{ok, message}`
 * or `{ok: false, error}` so the drawer can toast the real outcome, checks the
 * caller's role, and records itself in the audit log.
 *
 * Every state change still goes through the engine's PATCH, i.e. through
 * services/conversationState.js's validated transitions: an admin cannot put
 * a thread in a state the assistant itself could not reach.
 */

function revalidate(id) {
  revalidatePath('/admin/conversations');
  revalidatePath(`/admin/conversations/${id}`);
}

async function run(id, work, messageKey, audit) {
  const t = await getT();
  try {
    const session = await requireAdmin('conversations.reply');
    const details = await work();
    await recordAudit(session, { action: audit, entityType: 'conversation', entityId: id, details: details || null });
    revalidate(id);
    return { ok: true, message: t(messageKey) };
  } catch (err) {
    return { ok: false, error: err.message || t('errors.actionFailed') };
  }
}

/** AI goes silent; a human owns the thread until it is handed back. */
export async function takeOverConversationAction(id) {
  return run(id, () => updateConversation(id, { ai_active: false, state: 'HUMAN_HANDOFF' }).then(() => null), 'admin.conversations.tookOver', 'conversation.take_over');
}

export async function returnConversationToAiAction(id) {
  return run(id, () => updateConversation(id, { ai_active: true, state: 'COLLECTING_REQUIREMENTS' }).then(() => null), 'admin.conversations.returnedToAi', 'conversation.return_ai');
}

/**
 * "Mark as resolved" is the existing CLOSED state — no new status. A customer
 * who writes again afterwards starts a fresh thread (getActiveConversation
 * skips CLOSED), with the assistant active by default.
 */
export async function resolveConversationAction(id) {
  return run(id, () => updateConversation(id, { state: 'CLOSED' }).then(() => null), 'admin.conversations.resolved', 'conversation.resolve');
}

/**
 * `conversations.assigned_agent` is a display-name TEXT column (the engine
 * has no Postgres access to resolve one), so the name is resolved HERE from
 * the chosen agents.id — never taken from the browser.
 */
export async function assignConversationAgentAction(id, agentId) {
  return run(
    id,
    async () => {
      let name = null;
      if (agentId != null) {
        const names = await getAgentNamesByIds([agentId]);
        name = names.get(Number(agentId))?.name;
        if (!name) throw new Error(`No agent #${agentId}`);
      }
      await updateConversation(id, { assigned_agent: name });
      return { agentId: agentId ?? null };
    },
    agentId == null ? 'admin.conversations.unassigned' : 'admin.conversations.assigned',
    'conversation.assign',
  );
}

export async function sendConversationReplyAction(id, text) {
  const body = String(text || '').trim();
  if (!body) {
    const t = await getT();
    return { ok: false, error: t('admin.conversations.emptyReply') };
  }
  return run(id, () => sendManualReply(id, body).then(() => ({ length: body.length })), 'admin.conversations.replySent', 'conversation.reply');
}
