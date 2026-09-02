import { redirect } from 'next/navigation';
import { getCurrentAgentId } from '@/lib/agentSession';
import { getAgentDashboardContext } from '@/lib/agentDashboard';
import AgentSidebar from '@/components/AgentSidebar';
import AgentKeyboardShortcuts from '@/components/AgentKeyboardShortcuts';
import { ToastProvider } from '@/components/Toast';
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
 * would otherwise render *underneath* the public site's Header/Footer from
 * app/(site)/layout.js. /compte/agent/connexion and
 * /compte/agent/inscription stay in (site) — this shell is only for the
 * authenticated dashboard itself. middleware.js already gates every
 * /compte/agent/* path by URL, unaffected by which physical app/ tree
 * implements it.
 *
 * Ground is `canvas-alt` (the design's --chalk page rest) so the white cards
 * and the white sidebar both read as figure against it.
 */
export default async function AgentDashboardLayout({ children }) {
  const agentId = await getCurrentAgentId();
  if (!agentId) redirect('/compte/agent/connexion');

  const context = await getAgentDashboardContext(agentId);
  if (!context) redirect('/compte/agent/connexion');

  const { agent, listings, newLeadsCount, pendingVisitsCount, completion, displayName } = context;

  const name = displayName || agent.username || 'Agent';
  // Initials are built from LETTERS only. An agent who hasn't set a name yet
  // has `username` = their own phone digits, and slicing that gives a stray
  // "2" in the avatar disc; `null` tells AgentSidebar to draw a neutral mark
  // instead.
  const initials =
    name
      .split(/\s+/)
      .filter((part) => /^[A-Za-zÀ-ÿ]/.test(part))
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join('') || null;

  return (
    <div className="flex min-h-screen bg-canvas-alt">
      <AgentKeyboardShortcuts />
      <AgentSidebar
        agentName={name}
        agentInitials={initials}
        listingsCount={listings.length}
        newLeadsCount={newLeadsCount}
        pendingVisitsCount={pendingVisitsCount}
        completion={completion}
        logoutAction={agentLogoutAction}
      />
      <ToastProvider>
        <div className="flex min-w-0 flex-1 flex-col pb-16 lg:pb-0">{children}</div>
      </ToastProvider>
    </div>
  );
}
