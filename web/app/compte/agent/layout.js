import { redirect } from 'next/navigation';
import { getCurrentAgentId } from '@/lib/agentSession';
import { getAgentProfile, getOwnListingsForDashboard } from '@/lib/agencies';
import { listLeads } from '@/lib/adminApi';
import AgentSidebar from '@/components/AgentSidebar';
import { agentLogoutAction } from './actions';

export const metadata = {
  title: 'Espace agent — Lukka Place',
  robots: { index: false, follow: false },
};

// No searchParams/cookies() call of its own would trip Next's automatic
// dynamic-rendering detection — same fix admin pages already had to make.
export const dynamic = 'force-dynamic';

/**
 * Dashboard app shell for every /compte/agent/** route — a plain top-level
 * app/compte/agent/ tree (not app/(site)/compte/agent/), same reasoning
 * app/admin sits outside (site): the design's own full sidebar+header shell
 * would otherwise render *underneath* the public site's Header/SideRail/
 * BottomNav/Footer from app/(site)/layout.js. /compte/agent/connexion and
 * /compte/agent/inscription stay in (site) — this shell is only for the
 * authenticated dashboard itself. middleware.js already gates every
 * /compte/agent/* path by URL, unaffected by which physical app/ tree
 * implements it.
 */
export default async function AgentDashboardLayout({ children }) {
  const agentId = await getCurrentAgentId();
  if (!agentId) redirect('/compte/agent/connexion');

  const agent = await getAgentProfile(agentId);
  if (!agent) redirect('/compte/agent/connexion');

  const listings = await getOwnListingsForDashboard(agentId);
  const propertyIds = listings.map((l) => l.id);
  const { total: newLeadsCount } = propertyIds.length
    ? await listLeads({ propertyIds, status: 'NEW', limit: 1 })
    : { total: 0 };

  const name = [agent.first_name, agent.last_name].filter(Boolean).join(' ') || agent.username || 'Agent';
  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('') || 'A';

  return (
    <div className="flex min-h-screen bg-canvas-alt">
      <AgentSidebar
        agentName={name}
        agentInitials={initials}
        listingsCount={listings.length}
        newLeadsCount={newLeadsCount}
        logoutAction={agentLogoutAction}
      />
      <div className="flex min-w-0 flex-1 flex-col pb-16 lg:pb-0">{children}</div>
    </div>
  );
}
