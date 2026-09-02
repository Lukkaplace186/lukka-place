import { getCurrentAgentId } from '@/lib/agentSession';
import { getAgentDashboardContext } from '@/lib/agentDashboard';
import { hasDemandFeedAccess, isWithinLaunchTrial, launchTrialEndsAtLabel, getAgentPitchQuota } from '@/lib/demandFeed';
import AgentPageHeader from '@/components/AgentPageHeader';
import AgentSubscriptionCard from '@/components/AgentSubscriptionCard';

export const metadata = {
  title: 'Abonnement — Espace agent — Lukka Place',
  robots: { index: false, follow: false },
};

/**
 * Dedicated Abonnement page — the same real subscription facts the overview
 * card already shows (packages/memberships via lib/agents.js's
 * AGENT_FIELDS/AGENT_JOINS, and the real monthly pitch quota via
 * lib/demandFeed.js's getAgentPitchQuota), given its own sidebar entry and
 * URL rather than being reachable only as a card buried at the bottom of
 * Vue d'ensemble.
 *
 * Reuses AgentSubscriptionCard as-is rather than forking a second copy of
 * its markup — the overview keeps its own card too (a returning agent
 * checking their dashboard shouldn't have to leave it to see whether their
 * quota is exhausted), so this page is the detail view, not a replacement.
 */
export default async function AgentSubscriptionPage() {
  const agentId = await getCurrentAgentId();
  const { agent, listings, newLeadsCount } = await getAgentDashboardContext(agentId);

  const pitchQuota = await getAgentPitchQuota(agentId, agent);

  return (
    <>
      <AgentPageHeader title="Abonnement" newLeadsCount={newLeadsCount} />

      <div className="px-5 py-7 sm:px-8">
        <div className="max-w-md">
          <AgentSubscriptionCard
            packageTitle={agent.package_title}
            packageTerm={agent.package_term}
            isTrial={agent.subscription_is_trial}
            expireDate={agent.expire_date}
            listingCount={listings.length}
            listingLimit={agent.listing_limit}
            feedAccess={hasDemandFeedAccess(agent)}
            feedTrialEndsAt={isWithinLaunchTrial() && !agent.package_title ? launchTrialEndsAtLabel() : null}
            pitchQuota={pitchQuota}
          />
        </div>
      </div>
    </>
  );
}
