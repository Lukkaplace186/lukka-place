import { cache, Suspense } from 'react';
import { getT } from '@/lib/i18n/server';
import { Landmark, Eye, MousePointerClick, Mail } from 'lucide-react';
import { getCurrentAgentId } from '@/lib/agentSession';
import { getAgentDashboardContext } from '@/lib/agentDashboard';
import { getListingQuota } from '@/lib/listingQuota';
import { getAgentListingViewsSeries, getAgentWindowStats, trendPercent, VIEW_RANGES } from '@/lib/analytics';
import { isLiveListing } from '@/lib/agentListingFilters';
import TrendChip from '@/components/TrendChip';
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
 * ONE SCROLL, FOUR THINGS (2026-09-28; reordered 2026-10-05 with the
 * redesign approved from web/Design/agent-portal-prototype.html):
 *
 *   1. the portfolio share card (copy link, share on WhatsApp)
 *   2. the four figures, each over the last 30 days with its trend
 *   3. "À faire aujourd'hui", swipeable cards on a phone
 *   4. the views chart, whose 30-day bars add up to the "Vues" figure
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
  const { agent, listings, propertyIds, listingById, leadScope, hasLeadScope, waitingCount } = context;

  // "À faire aujourd'hui" + the morning reminder. Never throws: each engine
  // read degrades on its own and the panel says the list may be incomplete.
  const todo = await loadAgentTodo({ agentId, leadScope, hasLeadScope });

  return (
    <>
      <AgentPageHeader
        title={t('agent.overview.title')}
        newLeadsCount={waitingCount}
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

        <AgentPortfolioBanner
          liveCount={listings.filter(isLiveListing).length}
          profileUrl={`${SITE_URL}/agents/${agent.id}`}
          profilePath={`/agents/${agent.id}`}
        />

        <Suspense fallback={<AgentSectionSkeleton className="h-[16.5rem] lg:h-36" />}>
          <OverviewStats agentId={agentId} listings={listings} propertyIds={propertyIds} leadScope={leadScope} hasLeadScope={hasLeadScope} />
        </Suspense>

        <AgentTodayPanel todo={todo} listingById={listingById} />

        {/* Only for a developer with at least one project (/projets). */}
        <Suspense fallback={null}>
          <AgentProjectsCard agentId={agentId} />
        </Suspense>

        <Suspense fallback={<AgentSectionSkeleton className="h-[22rem]" />}>
          <OverviewChart agentId={agentId} propertyIds={propertyIds} range={range} />
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

// Same request, same window: the stat cards and the chart's 30-day trend both
// read it, and React's cache() runs the queries once.
const windowStatsFor = cache((agentId, propertyIds) =>
  getAgentWindowStats({ agentId, propertyIds }).catch((error) => {
    console.error(`[agent/overview] window stats unavailable: ${error.message}`);
    return null;
  }),
);

async function OverviewStats({ agentId, listings, propertyIds, leadScope, hasLeadScope }) {
  const t = await getT();
  const [stats, leadsPage] = await Promise.all([
    windowStatsFor(agentId, propertyIds),
    // Engine down: the cell shows "—" rather than a false 0 or a broken page.
    hasLeadScope
      ? listLeads({ ...leadScope, limit: 1 }).catch((err) => {
          console.error(`[agent/overview] lead count unavailable: ${err.message}`);
          return { total: null, data: [] };
        })
      : Promise.resolve({ total: 0, data: [] }),
  ]);
  // "En ligne" is lib/agentListingFilters.js's rule, the same one the Mes
  // biens chip counts with — the two used to disagree (18 here, 20 there).
  const live = listings.filter(isLiveListing);
  const underOffer = live.filter((l) => l.listing_status === 'under_offer').length;

  // Every cell deep-links into the list behind its number.
  const cells = [
    {
      key: 'active',
      label: t('agent.overview.liveListings'),
      value: live.length,
      icon: Landmark,
      href: '/compte/agent/biens?status=active',
      delta: stats ? { kind: 'count', value: stats.newListings } : null,
      foot: underOffer > 0 ? t('agent.overview.underOfferFoot', { count: underOffer }) : null,
    },
    {
      key: 'views',
      label: t('agent.overview.views'),
      value: stats ? stats.views : null,
      icon: Eye,
      href: '#agent-views-chart-title',
      delta: stats ? { kind: 'pct', value: trendPercent(stats.views, stats.viewsPrev) } : null,
    },
    {
      key: 'clicks',
      label: t('agent.overview.whatsappClicks'),
      value: stats ? stats.clicks : null,
      icon: MousePointerClick,
      href: '/compte/agent/biens',
      delta: stats ? { kind: 'pct', value: trendPercent(stats.clicks, stats.clicksPrev) } : null,
    },
    { key: 'leads', label: t('agent.overview.leadsReceived'), value: leadsPage.total, icon: Mail, href: '/compte/agent/demandes' },
  ];
  return <AgentStatGrid stats={cells} caption={t('agent.overview.windowCaption')} />;
}

async function OverviewChart({ agentId, propertyIds, range }) {
  const t = await getT();
  const series = await getAgentListingViewsSeries(propertyIds, range);
  // Only the 30-day view has a previous period measured the same way.
  let trend = null;
  if (range === '30d') {
    const stats = await windowStatsFor(agentId, propertyIds);
    const value = stats ? trendPercent(stats.views, stats.viewsPrev) : null;
    if (value != null) {
      trend = (
        <>
          <TrendChip delta={{ kind: 'pct', value }} />
          <span className="u-micro text-ink-45">{t('agent.overview.vsPrevious')}</span>
        </>
      );
    }
  }
  return (
    <AgentViewsChart
      series={series}
      rangeOptions={RANGE_OPTIONS}
      range={range}
      rangeLabel={VIEW_RANGES[range].caption}
      trend={trend}
    />
  );
}

async function OverviewProfileGaps({ agent }) {
  // A nudge, never a reason for the overview to fail.
  const profileGaps = await getAgentProfileGaps(agent).catch((error) => {
    console.error('[agent/overview] profile gaps unavailable:', error.message);
    return [];
  });
  return <AgentProfileGapsBanner profileGaps={profileGaps} />;
}
