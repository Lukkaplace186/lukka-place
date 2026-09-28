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
import AgentTodayPanel, { AgentVisitReminderBanner } from '@/components/AgentTodayPanel';
import { loadAgentTodo } from '@/lib/agentTodoLoader';
import AgentProfileGapsBanner from '@/components/AgentProfileGapsBanner';
import { getAgentProfileGaps } from '@/lib/completeness';
import { AgentSectionSkeleton } from '@/components/RouteSkeletons';
import AgentProjectsCard from '@/components/projects/AgentProjectsCard';

const RANGE_OPTIONS = Object.entries(VIEW_RANGES).map(([value, { label }]) => ({ value, label }));

const quotaFor = cache((agentId) => getListingQuota(agentId).catch(() => null));

/**
 * The overview STREAMS. It used to await about a dozen Postgres and engine
 * reads before sending a byte, so on 3G the agent watched a skeleton for the
 * slowest of them — usually the chart series. Now the page waits only for
 * "À faire aujourd'hui" (the reason anyone opens it) and every other section
 * is its own async component behind <Suspense>, arriving as its data does.
 * Each one degrades on its own.
 *
 * ONE SCROLL, FOUR THINGS (2026-09-28). The page had grown to eight sections
 * — a to-do list, figures, a portfolio banner, an onboarding checklist, the
 * Status tool, a chart, recent requests and a subscription card — and read as
 * everything at once. Now, in this order:
 *
 *   1. the four figures
 *   2. "À faire aujourd'hui", three rows + one "Voir les N actions" link
 *   3. the portfolio link
 *   4. the views chart
 *
 * Everything that left has a better home: recent requests and the plan are
 * their own bottom-nav tabs (Demandes, Abonnement), "Statut du jour" is on
 * Mes biens, and the profile checklist is at the top of Réglages — the
 * overview keeps only a one-line banner pointing there when something is
 * missing. Today's confirmed-visit reminder stays above everything: it is
 * the one thing more urgent than the figures.
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

        <Suspense fallback={null}>
          <OverviewProfileGaps agent={agent} />
        </Suspense>

        <Suspense fallback={<AgentSectionSkeleton className="h-48 sm:h-28" />}>
          <OverviewStats agentId={agentId} listings={listings} propertyIds={propertyIds} leadScope={leadScope} hasLeadScope={hasLeadScope} />
        </Suspense>

        <AgentTodayPanel todo={todo} listingById={listingById} />

        <AgentPortfolioBanner
          listingsCount={listings.length}
          profileUrl={`${SITE_URL}/agents/${agent.id}`}
          profilePath={`/agents/${agent.id}`}
        />

        {/* Only for a developer with at least one project (/projets). */}
        <Suspense fallback={null}>
          <AgentProjectsCard agentId={agentId} />
        </Suspense>

        <Suspense fallback={<AgentSectionSkeleton className="h-72" />}>
          <OverviewChart propertyIds={propertyIds} range={range} />
        </Suspense>
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
    // Engine down: the cell shows "—" rather than a false 0 or a broken page.
    hasLeadScope
      ? listLeads({ ...leadScope, limit: 1 }).catch((err) => {
          console.error(`[agent/overview] lead count unavailable: ${err.message}`);
          return { total: null, data: [] };
        })
      : Promise.resolve({ total: 0, data: [] }),
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

async function OverviewChart({ propertyIds, range }) {
  const series = await getAgentListingViewsSeries(propertyIds, range);
  return <AgentViewsChart series={series} rangeOptions={RANGE_OPTIONS} range={range} rangeLabel={VIEW_RANGES[range].caption} />;
}

async function OverviewProfileGaps({ agent }) {
  // A nudge, never a reason for the overview to fail.
  const profileGaps = await getAgentProfileGaps(agent).catch((error) => {
    console.error('[agent/overview] profile gaps unavailable:', error.message);
    return [];
  });
  return <AgentProfileGapsBanner profileGaps={profileGaps} />;
}
