import { cache, Suspense } from 'react';
import { getT } from '@/lib/i18n/server';
import { Landmark, BarChart3, Phone, Mail } from 'lucide-react';
import { getCurrentAgentId } from '@/lib/agentSession';
import { getAgentDashboardContext } from '@/lib/agentDashboard';
import { getListingQuota } from '@/lib/listingQuota';
import {
  getAgentListingViews,
  getAgentWhatsAppClicks,
  getAgentListingViewsSeries,
  getAgentMonthlyDeltas,
  VIEW_RANGES,
} from '@/lib/analytics';
import { listLeads } from '@/lib/adminApi';
import { SITE_URL } from '@/lib/constants';
import AgentPageHeader from '@/components/AgentPageHeader';
import CreateListingDialog from '@/components/CreateListingDialog';
import { getLocationHierarchyWithFallback } from '@/lib/locations';
import { getPropertyCategories } from '@/lib/agentListings';
import AgentPortfolioBanner from '@/components/AgentPortfolioBanner';
import AgentStatGrid from '@/components/AgentStatGrid';
import AgentViewsChart from '@/components/AgentViewsChart';
import AgentRecentLeads from '@/components/AgentRecentLeads';
import AgentSubscriptionCard from '@/components/AgentSubscriptionCard';
import AgentTodayPanel, { AgentVisitReminderBanner } from '@/components/AgentTodayPanel';
import { loadAgentTodo } from '@/lib/agentTodoLoader';
import AgentCompletenessCard from '@/components/AgentCompletenessCard';
import { getIncompleteListings, getAgentProfileGaps } from '@/lib/completeness';
import AgentStatusOfTheDay from '@/components/AgentStatusOfTheDay';
import { getStatusSuggestions, serialiseSuggestion } from '@/lib/listingShares';
import { STATUS_RECENT_DAYS } from '@/lib/listingShareRules';
import { shareBlocker } from '@/lib/listingShareCopy';
import AgentMoreOnPhone from '@/components/AgentMoreOnPhone';
import { AgentSectionSkeleton } from '@/components/RouteSkeletons';

const RANGE_OPTIONS = Object.entries(VIEW_RANGES).map(([value, { label }]) => ({ value, label }));

// Read by the header's "Ajouter un bien" and the subscription card — once.
const quotaFor = cache((agentId) => getListingQuota(agentId).catch(() => null));

/**
 * The overview STREAMS. It used to await about a dozen Postgres and engine
 * reads before sending a byte, so on 3G the agent watched a skeleton for the
 * slowest of them — usually the chart series. Now the page waits only for
 * "À faire aujourd'hui" (the reason anyone opens it) and every other section
 * is its own async component behind <Suspense>, arriving as its data does.
 * Each one degrades on its own, exactly as the single page used to.
 *
 * On a phone, everything under the four figures sits behind "Voir plus"
 * (AgentMoreOnPhone); from `sm` up the page reads as before.
 */
export default async function AgentOverviewPage({ searchParams }) {
  const t = await getT();
  const params = await searchParams;
  // The design's chart opens on "30 derniers jours, par semaine".
  const range = typeof params.range === 'string' && VIEW_RANGES[params.range] ? params.range : '30d';

  const agentId = await getCurrentAgentId();
  const context = await getAgentDashboardContext(agentId);
  const { agent, listings, propertyIds, listingById, leadScope, hasLeadScope, newLeadsCount } = context;

  // "À faire aujourd'hui" + the morning reminder. Never throws: each engine
  // read degrades on its own and the panel says the list may be incomplete.
  const todo = await loadAgentTodo({ agentId, leadScope, hasLeadScope });

  return (
    <>
      <AgentPageHeader
        title={t('agent.overview.title')}
        newLeadsCount={newLeadsCount}
        searchAction="/compte/agent/biens"
        searchPlaceholder="Rechercher un bien, un client"
        action={
          // The creation form opens right here — it used to link to Mes biens,
          // where the agent had to press "Ajouter un bien" a second time.
          <Suspense fallback={<span className="inline-block h-10 w-10 shrink-0 rounded-lg bg-canvas-alt sm:w-36" aria-hidden="true" />}>
            <OverviewCreateAction agentId={agentId} />
          </Suspense>
        }
      />

      <div className="flex flex-col gap-4 px-3 py-4 sm:gap-6 sm:px-8 sm:py-7">
        <AgentVisitReminderBanner visits={todo.todayVisits} listingById={listingById} />
        <AgentTodayPanel todo={todo} listingById={listingById} />

        <Suspense fallback={<AgentSectionSkeleton className="h-48 sm:h-28" />}>
          <OverviewStats agentId={agentId} listings={listings} propertyIds={propertyIds} leadScope={leadScope} hasLeadScope={hasLeadScope} />
        </Suspense>

        <AgentMoreOnPhone>
          <AgentPortfolioBanner
            listingsCount={listings.length}
            profileUrl={`${SITE_URL}/agents/${agent.id}`}
            profilePath={`/agents/${agent.id}`}
          />

          <Suspense fallback={null}>
            <OverviewCompleteness agent={agent} agentId={agentId} />
          </Suspense>

          <Suspense fallback={null}>
            <OverviewStatusOfTheDay agentId={agentId} listings={listings} />
          </Suspense>

          <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] lg:items-start">
            <Suspense fallback={<AgentSectionSkeleton className="h-72" />}>
              <OverviewChart propertyIds={propertyIds} range={range} />
            </Suspense>
            <div className="flex flex-col gap-6">
              <Suspense fallback={<AgentSectionSkeleton className="h-48" />}>
                <OverviewRecentLeads leadScope={leadScope} hasLeadScope={hasLeadScope} listingById={listingById} />
              </Suspense>
              <Suspense fallback={<AgentSectionSkeleton className="h-40" />}>
                <OverviewSubscription agent={agent} agentId={agentId} listingsCount={listings.length} />
              </Suspense>
            </div>
          </div>
        </AgentMoreOnPhone>
      </div>
    </>
  );
}

async function OverviewCreateAction({ agentId }) {
  // Same degrade posture as Mes biens: a failed read costs the dialog its
  // options, never the overview.
  const [listingQuota, createHierarchy, createCategories] = await Promise.all([
    quotaFor(agentId),
    getLocationHierarchyWithFallback().catch(() => ({ communes: [] })),
    getPropertyCategories().catch(() => []),
  ]);
  return (
    <CreateListingDialog
      primary
      communes={createHierarchy?.communes ?? []}
      categories={createCategories}
      draftKey={`agent:${agentId}:new-listing`}
      quota={
        listingQuota
          ? { atLimit: listingQuota.atLimit, limit: listingQuota.limit, used: listingQuota.used, planTitle: listingQuota.planTitle }
          : null
      }
    />
  );
}

async function OverviewStats({ agentId, listings, propertyIds, leadScope, hasLeadScope }) {
  const t = await getT();
  const [views30d, whatsappClicks, leadsPage, deltas] = await Promise.all([
    getAgentListingViews(propertyIds, 30),
    getAgentWhatsAppClicks(propertyIds),
    hasLeadScope ? listLeads({ ...leadScope, limit: 1 }) : Promise.resolve({ total: 0, data: [] }),
    getAgentMonthlyDeltas(agentId, propertyIds),
  ]);
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
    { key: 'active', label: t('agent.overview.activeListings'), value: activeCount, icon: Landmark, href: '/compte/agent/biens?status=active', delta: { kind: 'count', value: deltas.listings } },
    { key: 'views', label: t('agent.overview.views30d'), value: views30d, icon: BarChart3, href: '/compte/agent/biens', delta: { kind: 'pct', value: deltas.views } },
    { key: 'clicks', label: t('agent.overview.whatsappClicks'), value: whatsappClicks, icon: Phone, href: '/compte/agent/biens', delta: { kind: 'pct', value: deltas.clicks } },
    { key: 'leads', label: t('agent.overview.leadsReceived'), value: leadsPage.total, icon: Mail, href: '/compte/agent/demandes' },
  ];
  return <AgentStatGrid stats={stats} />;
}

async function OverviewCompleteness({ agent, agentId }) {
  // Degrade, don't die: the checklist is a nudge, never a reason for the
  // overview to fail. getIncompleteListings already swallows its own errors.
  const [profileGaps, incompleteListings] = await Promise.all([
    getAgentProfileGaps(agent).catch((error) => {
      console.error('[agent/overview] profile gaps unavailable:', error.message);
      return [];
    }),
    getIncompleteListings(agentId, { limit: 200 }),
  ]);
  return <AgentCompletenessCard profileGaps={profileGaps} incompleteListingsCount={incompleteListings.length} />;
}

async function OverviewStatusOfTheDay({ agentId, listings }) {
  // A failed read hides the card rather than the whole overview;
  // getStatusSuggestions already degrades when listing_shares does not exist yet.
  const statusSuggestions = await getStatusSuggestions(agentId).catch((err) => {
    console.error(`[status-of-the-day] agent ${agentId}: ${err.message}`);
    return null;
  });
  if (!statusSuggestions) return null;
  // Live = what the share kit would let them advertise (shareBlocker), so the
  // card can tell "nothing live" from "everything shared recently".
  const liveCount = listings.filter((l) => !shareBlocker(l)).length;
  return (
    <AgentStatusOfTheDay
      items={statusSuggestions.items.map(serialiseSuggestion)}
      tracked={statusSuggestions.tracked}
      liveCount={liveCount}
      recentDays={STATUS_RECENT_DAYS}
    />
  );
}

async function OverviewChart({ propertyIds, range }) {
  const series = await getAgentListingViewsSeries(propertyIds, range);
  return <AgentViewsChart series={series} rangeOptions={RANGE_OPTIONS} range={range} rangeLabel={VIEW_RANGES[range].caption} />;
}

async function OverviewRecentLeads({ leadScope, hasLeadScope, listingById }) {
  const leadsPage = hasLeadScope ? await listLeads({ ...leadScope, limit: 3 }) : { total: 0, data: [] };
  return <AgentRecentLeads leads={leadsPage.data} listingById={listingById} />;
}

async function OverviewSubscription({ agent, agentId, listingsCount }) {
  const listingQuota = await quotaFor(agentId);
  return (
    <AgentSubscriptionCard
      packageTitle={agent.package_title}
      packageTerm={agent.package_term}
      isTrial={agent.subscription_is_trial}
      expireDate={agent.expire_date}
      listingCount={listingQuota?.capped ? listingQuota.used : listingsCount}
      listingLimit={agent.listing_limit}
    />
  );
}
