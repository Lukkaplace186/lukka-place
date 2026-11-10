import { NextResponse } from 'next/server';
import { getCurrentChatAgentId } from '@/lib/chat';
import { openNotification } from '@/lib/pushNotifications';
import { parseId, safeAgentPath } from '@/lib/pushRules';

export const dynamic = 'force-dynamic';

/** A relative Location: behind the proxy request.url names localhost:3002 (see admin/impersonation/exit). */
function goTo(path) {
  return new NextResponse(null, { status: 303, headers: { Location: path, 'Cache-Control': 'no-store' } });
}

/**
 * GET /compte/agent/alertes/<id> — what a tapped alert opens, from the
 * phone's notification or the inbox: marks it read (which also cancels its
 * late WhatsApp copy) and redirects to the page it is about. The target is
 * the stored path, kept inside the agent space; not this agent's alert, or
 * none → the inbox.
 */
export async function GET(request, { params }) {
  const { id } = await params;
  const agentId = await getCurrentChatAgentId();
  if (!agentId) return goTo('/compte/agent/connexion');
  const notificationId = parseId(id);
  const opened = notificationId ? await openNotification('agent', agentId, notificationId) : null;
  return goTo(opened ? safeAgentPath(opened.url) : '/compte/agent/alertes');
}
