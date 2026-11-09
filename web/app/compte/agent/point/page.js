import { redirect } from 'next/navigation';
import StatusCheckBoard from '@/components/statusCheck/StatusCheckBoard';
import { getCurrentAgentId } from '@/lib/agentSession';
import { getStatusBoardItems } from '@/lib/statusCheckItems';

/**
 * The same "Faites le point" board as the WhatsApp link
 * (app/(site)/point/[token]), for a signed-in agent: answers are scoped to
 * the session's agent and recorded with channel 'DASHBOARD'.
 */

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Faites le point — Lukka Place' };

export default async function AgentStatusPage() {
  const agentId = await getCurrentAgentId();
  if (!agentId) redirect('/compte/agent/connexion');
  const items = await getStatusBoardItems(agentId);
  return (
    <div className="mx-auto max-w-xl px-3 py-4 sm:px-0 sm:py-6">
      <StatusCheckBoard token={null} items={items} />
    </div>
  );
}
