import { redirect } from 'next/navigation';
import { getCurrentAgentId } from '@/lib/agentSession';
import { getAgentDashboardContext } from '@/lib/agentDashboard';
import AgentSidebar from '@/components/AgentSidebar';
import AgentKeyboardShortcuts from '@/components/AgentKeyboardShortcuts';
import { ToastProvider } from '@/components/Toast';
import { agentLogoutAction } from './actions';
import { getI18n, getT } from '@/lib/i18n/server';
import { I18nProvider } from '@/lib/i18n/client';

// generateMetadata rather than a static object, so the browser-tab title
// follows the language too — see app/(site)/a-propos/page.js.
export async function generateMetadata() {
  const t = await getT();
  return {
    title: t('agent.meta.title'),
    robots: { index: false, follow: false },
  };
}

/*
 * The agent dashboard's own namespaces, added on top of the chrome ones the
 * root layout supplies (I18nProvider merges — see lib/i18n/client.js). This
 * tree sits outside the (site) route group, so it does NOT inherit the
 * storefront's listing vocabulary; `listings` is included explicitly because
 * the agent's own tables render listing statuses and specs.
 */
const AGENT_NAMESPACES = ['agent', 'listings', 'status', 'auth', 'errors'];

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
  const { locale, messages } = await getI18n(AGENT_NAMESPACES);
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
    <I18nProvider locale={locale} messages={messages}>
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
    </I18nProvider>
  );
}
