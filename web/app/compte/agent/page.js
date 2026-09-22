import Link from 'next/link';
import { getT } from '@/lib/i18n/server';
import { Plus, Landmark, BarChart3, Phone, Mail } from 'lucide-react';
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
import { getAgentLeadQuota } from '@/lib/leadQuota';
import { SITE_URL, ICON_STROKE_WIDTH } from '@/lib/constants';
import AgentPageHeader from '@/components/AgentPageHeader';
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

const RANGE_OPTIONS = Object.entries(VIEW_RANGES).map(([value, { label }]) => ({ value, label }));

export default async function AgentOverviewPage({ searchParams }) {
  const t = await getT();
  const params = await searchParams;
  // The design's chart opens on "30 derniers jours, par semaine".
  const range = typeof params.range === 'string' && VIEW_RANGES[params.range] ? params.range : '30d';

  const agentId = await getCurrentAgentId();
  const { agent, listings, propertyIds, listingById, leadScope, hasLeadScope, newLeadsCount } =
    await getAgentDashboardContext(agentId);
  const listingQuota = await getListingQuota(agentId).catch(() => null);

  // Degrade, don't die: the checklist is a nudge, never a reason for the
  // overview to fail. getIncompleteListings already swallows its own errors.
  const [profileGaps, incompleteListings] = await Promise.all([
    getAgentProfileGaps(agent).catch((error) => {
      console.error('[agent/overview] profile gaps unavailable:', error.message);
      return [];
    }),
    getIncompleteListings(agentId, { limit: 200 }),
  ]);

  const [views30d, whatsappClicks, leadsPage, series, deltas, leadQuota, todo, statusSuggestions] = await Promise.all([
    getAgentListingViews(propertyIds, 30),
    getAgentWhatsAppClicks(propertyIds),
    hasLeadScope ? listLeads({ ...leadScope, limit: 3 }) : Promise.resolve({ total: 0, data: [] }),
    getAgentListingViewsSeries(propertyIds, range),
    getAgentMonthlyDeltas(agentId, propertyIds),
    // Same degrade-don't-die contract the rest of this dashboard follows: the
    // engine being unreachable must not take the overview down. The card
    // simply shows no quota bar rather than a fabricated one — and the write
    // path re-checks the real count server-side before recording a response,
    // so an unreadable count here can never grant one.
    getAgentLeadQuota(agentId, agent),
    // "À faire aujourd'hui" + the morning reminder. Never throws: each engine
    // read degrades on its own and the panel says the list may be incomplete.
    loadAgentTodo({ agentId, leadScope, hasLeadScope }),
    // "Statut du jour". A failed read hides the card's list rather than the
    // whole overview; getStatusSuggestions already degrades when
    // listing_shares does not exist yet.
    getStatusSuggestions(agentId).catch((err) => {
      console.error(`[status-of-the-day] agent ${agentId}: ${err.message}`);
      return null;
    }),
  ]);
  // Live = what the share kit would let them advertise (shareBlocker), so the
  // card can tell "nothing live" from "everything shared recently".
  const liveCount = listings.filter((l) => !shareBlocker(l)).length;

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

  return (
    <>
      <AgentPageHeader
        title={t('agent.overview.title')}
        newLeadsCount={newLeadsCount}
        searchAction="/compte/agent/biens"
        searchPlaceholder="Rechercher un bien, un client"
        action={
          <Link
            href="/compte/agent/biens"
            className="u-btn-primary u-press inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-blue px-3 text-[0.8125rem] font-bold text-white sm:h-11 sm:px-5 sm:text-sm"
          >
            <Plus strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
            {t('agent.overview.addListing')}
          </Link>
        }
      />

      <div className="flex flex-col gap-4 px-3 py-4 sm:gap-6 sm:px-8 sm:py-7">
        <AgentVisitReminderBanner visits={todo.todayVisits} listingById={listingById} />
        <AgentTodayPanel todo={todo} listingById={listingById} />

        <AgentPortfolioBanner
          listingsCount={listings.length}
          profileUrl={`${SITE_URL}/agents/${agent.id}`}
          profilePath={`/agents/${agent.id}`}
        />

        <AgentCompletenessCard profileGaps={profileGaps} incompleteListingsCount={incompleteListings.length} />

        <AgentStatGrid stats={stats} />

        {statusSuggestions && (
          <AgentStatusOfTheDay
            items={statusSuggestions.items.map(serialiseSuggestion)}
            tracked={statusSuggestions.tracked}
            liveCount={liveCount}
            recentDays={STATUS_RECENT_DAYS}
          />
        )}

        <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] lg:items-start">
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
              listingCount={listingQuota?.capped ? listingQuota.used : listings.length}
              listingLimit={agent.listing_limit}
              leadQuota={leadQuota}
            />
          </div>
        </div>
      </div>
    </>
  );
}
