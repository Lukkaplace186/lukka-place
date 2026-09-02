import Link from 'next/link';
import { Plus, Landmark, BarChart3, Phone, Mail } from 'lucide-react';
import { getCurrentAgentId } from '@/lib/agentSession';
import { getAgentDashboardContext } from '@/lib/agentDashboard';
import {
  getAgentListingViews,
  getAgentWhatsAppClicks,
  getAgentListingViewsSeries,
  getAgentMonthlyDeltas,
  VIEW_RANGES,
} from '@/lib/analytics';
import { listLeads, getAgentPitchUsage } from '@/lib/adminApi';
import {
  hasDemandFeedAccess,
  isWithinLaunchTrial,
  launchTrialEndsAtLabel,
  currentPitchPeriodStart,
  resolvePitchQuota,
} from '@/lib/demandFeed';
import { SITE_URL, ICON_STROKE_WIDTH } from '@/lib/constants';
import AgentPageHeader from '@/components/AgentPageHeader';
import AgentPortfolioBanner from '@/components/AgentPortfolioBanner';
import AgentStatGrid from '@/components/AgentStatGrid';
import AgentViewsChart from '@/components/AgentViewsChart';
import AgentRecentLeads from '@/components/AgentRecentLeads';
import AgentSubscriptionCard from '@/components/AgentSubscriptionCard';

const RANGE_OPTIONS = Object.entries(VIEW_RANGES).map(([value, { label }]) => ({ value, label }));

export default async function AgentOverviewPage({ searchParams }) {
  const params = await searchParams;
  // The design's chart opens on "30 derniers jours, par semaine".
  const range = typeof params.range === 'string' && VIEW_RANGES[params.range] ? params.range : '30d';

  const agentId = await getCurrentAgentId();
  const { agent, listings, propertyIds, listingById, leadScope, hasLeadScope, newLeadsCount } =
    await getAgentDashboardContext(agentId);

  const [views30d, whatsappClicks, leadsPage, series, deltas, pitchUsage] = await Promise.all([
    getAgentListingViews(propertyIds, 30),
    getAgentWhatsAppClicks(propertyIds),
    hasLeadScope ? listLeads({ ...leadScope, limit: 3 }) : Promise.resolve({ total: 0, data: [] }),
    getAgentListingViewsSeries(propertyIds, range),
    getAgentMonthlyDeltas(agentId, propertyIds),
    // Same degrade-don't-die contract the rest of this dashboard follows: the
    // engine being unreachable must not take the overview down. The card
    // simply shows no quota line rather than a fabricated one — and
    // proposeListingAction re-checks the real count server-side before any
    // pitch is written, so an unreadable count here can never grant one.
    getAgentPitchUsage({ agentId, since: currentPitchPeriodStart() }).catch((err) => {
      console.warn(`[compte/agent] pitch usage unavailable: ${err.message}`);
      return null;
    }),
  ]);

  const pitchQuota = pitchUsage ? resolvePitchQuota(agent, pitchUsage.used) : null;

  const activeCount = listings.filter((l) => l.approve_status === 1 && l.listing_status === 'active').length;

  // Exactly the design's four cells, in its order, with its labels. The
  // remaining real metrics (profile views, favourites, pending moderation)
  // are not crammed in beside them — the design's strip is four, and the
  // pending count already has a home on Mes biens.
  //
  // Every cell deep-links into the list that actually contains the rows
  // behind the number, rather than being a dead figure:
  //   Biens actifs      the listings table, pre-filtered to status=active
  //   Vues / Clics      the same table, which carries a real per-listing
  //                     Vues and Clics column (getPerListingStats) — there
  //                     is no separate analytics page, and inventing one
  //                     would be a bigger claim than the data supports
  //   Demandes reçues   the inbox
  const stats = [
    { key: 'active', label: 'Biens actifs', value: activeCount, icon: Landmark, href: '/compte/agent/biens?status=active', delta: { kind: 'count', value: deltas.listings } },
    { key: 'views', label: 'Vues sur 30 jours', value: views30d, icon: BarChart3, href: '/compte/agent/biens', delta: { kind: 'pct', value: deltas.views } },
    { key: 'clicks', label: 'Clics WhatsApp', value: whatsappClicks, icon: Phone, href: '/compte/agent/biens', delta: { kind: 'pct', value: deltas.clicks } },
    { key: 'leads', label: 'Demandes reçues', value: leadsPage.total, icon: Mail, href: '/compte/agent/demandes' },
  ];

  return (
    <>
      <AgentPageHeader
        title="Vue d'ensemble"
        newLeadsCount={newLeadsCount}
        searchAction="/compte/agent/biens"
        searchPlaceholder="Rechercher un bien, un client"
        action={
          <Link
            href="/compte/agent/biens"
            className="u-btn-primary u-press inline-flex h-11 items-center gap-1.5 rounded-lg bg-blue px-5 text-sm font-bold text-white"
          >
            <Plus strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
            Ajouter un bien
          </Link>
        }
      />

      <div className="flex flex-col gap-6 px-5 py-7 sm:px-8">
        <AgentPortfolioBanner
          listingsCount={listings.length}
          profileUrl={`${SITE_URL}/agents/${agent.id}`}
          profilePath={`/agents/${agent.id}`}
        />

        <AgentStatGrid stats={stats} />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] lg:items-start">
          <AgentViewsChart
            series={series}
            rangeOptions={RANGE_OPTIONS}
            range={range}
            rangeLabel={VIEW_RANGES[range].caption}
          />
          <div className="flex flex-col gap-6">
            <AgentRecentLeads leads={leadsPage.data} listingById={listingById} />
            <AgentSubscriptionCard
              packageTitle={agent.package_title}
              packageTerm={agent.package_term}
              isTrial={agent.subscription_is_trial}
              expireDate={agent.expire_date}
              listingCount={listings.length}
              listingLimit={agent.listing_limit}
              feedAccess={hasDemandFeedAccess(agent)}
              // Only passed when the launch trial is what's actually granting
              // access — an agency on a real paid membership shouldn't be told
              // their access expires on the trial's date.
              feedTrialEndsAt={
                isWithinLaunchTrial() && !agent.package_title ? launchTrialEndsAtLabel() : null
              }
              pitchQuota={pitchQuota}
            />
          </div>
        </div>
      </div>
    </>
  );
}
