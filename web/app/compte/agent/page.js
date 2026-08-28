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
import { listLeads } from '@/lib/adminApi';
import { getCentralWhatsAppHref } from '@/lib/whatsapp';
import { SITE_URL, ICON_STROKE_WIDTH } from '@/lib/constants';
import AgentPageHeader from '@/components/AgentPageHeader';
import AgentPortfolioBanner from '@/components/AgentPortfolioBanner';
import AgentStatGrid from '@/components/AgentStatGrid';
import AgentViewsChart from '@/components/AgentViewsChart';
import AgentRecentLeads from '@/components/AgentRecentLeads';
import WhatsAppPortfolioGenerator from '@/components/WhatsAppPortfolioGenerator';

const RANGE_OPTIONS = Object.entries(VIEW_RANGES).map(([value, { label }]) => ({ value, label }));

export default async function AgentOverviewPage({ searchParams }) {
  const params = await searchParams;
  // The design's chart opens on "30 derniers jours, par semaine".
  const range = typeof params.range === 'string' && VIEW_RANGES[params.range] ? params.range : '30d';

  const agentId = await getCurrentAgentId();
  const { agent, listings, propertyIds, listingById, leadScope, hasLeadScope, newLeadsCount } =
    await getAgentDashboardContext(agentId);

  const [views30d, whatsappClicks, leadsPage, series, deltas] = await Promise.all([
    getAgentListingViews(propertyIds, 30),
    getAgentWhatsAppClicks(propertyIds),
    hasLeadScope ? listLeads({ ...leadScope, limit: 3 }) : Promise.resolve({ total: 0, data: [] }),
    getAgentListingViewsSeries(propertyIds, range),
    getAgentMonthlyDeltas(agentId, propertyIds),
  ]);

  const activeCount = listings.filter((l) => l.approve_status === 1 && l.listing_status === 'active').length;

  const addListingHref = getCentralWhatsAppHref(
    'Bonjour, je souhaite ajouter une nouvelle propriété à mon compte agent.',
  );

  // Exactly the design's four cells, in its order, with its labels. The
  // remaining real metrics (profile views, favourites, pending moderation)
  // are not crammed in beside them — the design's strip is four, and the
  // pending count already has a home on Mes biens.
  const stats = [
    { key: 'active', label: 'Biens actifs', value: activeCount, icon: Landmark, delta: { kind: 'count', value: deltas.listings } },
    { key: 'views', label: 'Vues sur 30 jours', value: views30d, icon: BarChart3, delta: { kind: 'pct', value: deltas.views } },
    { key: 'clicks', label: 'Clics WhatsApp', value: whatsappClicks, icon: Phone, delta: { kind: 'pct', value: deltas.clicks } },
    { key: 'leads', label: 'Demandes reçues', value: leadsPage.total, icon: Mail },
  ];

  return (
    <>
      <AgentPageHeader
        title="Vue d'ensemble"
        newLeadsCount={newLeadsCount}
        searchAction="/compte/agent/biens"
        searchPlaceholder="Rechercher un bien, un client"
        action={
          addListingHref && (
            <a
              href={addListingHref}
              target="_blank"
              rel="noopener noreferrer"
              className="u-btn-primary u-press inline-flex h-11 items-center gap-1.5 rounded-lg bg-blue px-5 text-sm font-bold text-white"
            >
              <Plus strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
              Ajouter un bien
            </a>
          )
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
          <AgentRecentLeads leads={leadsPage.data} listingById={listingById} />
        </div>

        {listings.length > 0 && <WhatsAppPortfolioGenerator listings={listings} siteUrl={SITE_URL} />}
      </div>
    </>
  );
}
