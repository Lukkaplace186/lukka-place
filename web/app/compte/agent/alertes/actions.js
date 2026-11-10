'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentChatAgentId } from '@/lib/chat';
import { markAllNotificationsRead } from '@/lib/pushNotifications';

/** "Tout marquer comme lu" on Alertes. The agent is the session's. */
export async function markAllAlertsReadAction() {
  const agentId = await getCurrentChatAgentId();
  if (!agentId) return;
  try {
    await markAllNotificationsRead('agent', agentId);
  } catch (err) {
    console.error(`[alertes] mark all read failed for agent #${agentId}: ${err.message}`);
  }
  revalidatePath('/compte/agent/alertes');
}
