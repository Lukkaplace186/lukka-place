'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { sendManualReply, updateConversation } from '@/lib/adminApi';
import { ADMIN_SESSION_COOKIE, isValidSessionToken } from '@/lib/adminAuth';
import { getAgentNamesByIds } from '@/lib/agents';
import { getT } from '@/lib/i18n/server';

/**
 * Quick actions behind the conversation drawer. Each returns `{ok, message}`
 * or `{ok: false, error}` so the drawer can toast the real outcome — the older
 * form actions in app/admin/actions.js return nothing, so a rejected state
 * change there was invisible.
 *
 * Every state change still goes through the engine's PATCH, i.e. through
 * services/conversationState.js's validated transitions: an admin cannot put
 * a thread in a state the assistant itself could not reach, and an illegal
 * move comes back as that module's own error message.
 */

async function assertAdminSession() {
  const token = (await cookies()).get(ADMIN_SESSION_COOKIE)?.value;
  if (!isValidSessionToken(token)) throw new Error('Not authenticated');
}

function revalidate(id) {
  revalidatePath('/admin/conversations');
  revalidatePath(`/admin/conversations/${id}`);
}

async function run(id, work, messageKey) {
  const t = await getT();
  try {
    await assertAdminSession();
    await work();
    revalidate(id);
    return { ok: true, message: t(messageKey) };
  } catch (err) {
    return { ok: false, error: err.message || t('errors.actionFailed') };
  }
}

/** AI goes silent; a human owns the thread until it is handed back. */
export async function takeOverConversationAction(id) {
  return run(id, () => updateConversation(id, { ai_active: false, state: 'HUMAN_HANDOFF' }), 'admin.conversations.tookOver');
}

export async function returnConversationToAiAction(id) {
  return run(id, () => updateConversation(id, { ai_active: true, state: 'COLLECTING_REQUIREMENTS' }), 'admin.conversations.returnedToAi');
}

/**
 * "Mark as resolved" is the existing CLOSED state — no new status. A customer
 * who writes again afterwards starts a fresh thread (getActiveConversation
 * skips CLOSED), with the assistant active by default.
 */
export async function resolveConversationAction(id) {
  return run(id, () => updateConversation(id, { state: 'CLOSED' }), 'admin.conversations.resolved');
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
    },
    agentId == null ? 'admin.conversations.unassigned' : 'admin.conversations.assigned',
  );
}

export async function sendConversationReplyAction(id, text) {
  const body = String(text || '').trim();
  if (!body) {
    const t = await getT();
    return { ok: false, error: t('admin.conversations.emptyReply') };
  }
  return run(id, () => sendManualReply(id, body), 'admin.conversations.replySent');
}
