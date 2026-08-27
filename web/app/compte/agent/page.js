import { getCurrentAgentId } from '@/lib/agentSession';
import { getAgentProfile, getOwnListingsForDashboard, agentDisplayName } from '@/lib/agencies';
import {
  getAgentProfileViews,
  getAgentListingViews,
  getAgentWhatsAppClicks,
  getAgentFavoritesCount,
  getAgentListingViewsByDay,
} from '@/lib/analytics';
import { listLeads } from '@/lib/adminApi';
import { getCentralWhatsAppHref } from '@/lib/whatsapp';
import { SITE_URL, ICON_STROKE_WIDTH } from '@/lib/constants';
import { Plus } from 'lucide-react';
import AgentPageHeader from '@/components/AgentPageHeader';
import AgentPortfolioBanner from '@/components/AgentPortfolioBanner';
import AgentDashboardView from '@/components/AgentDashboardView';
import WhatsAppPortfolioGenerator from '@/components/WhatsAppPortfolioGenerator';

export default async function AgentOverviewPage() {
  const agentId = await getCurrentAgentId();
  const agent = await getAgentProfile(agentId);

  const listings = await getOwnListingsForDashboard(agentId);
  const propertyIds = listings.map((l) => l.id);
  const displayName = agentDisplayName(agent);

  const [profileViews, listingViews, whatsappClicks, favoritesCount, leadsPage, viewsByDay] = await Promise.all([
    getAgentProfileViews(agentId),
    getAgentListingViews(propertyIds),
    getAgentWhatsAppClicks(propertyIds),
    getAgentFavoritesCount(propertyIds),
    propertyIds.length > 0 || displayName
      ? listLeads({ propertyIds, assignedAgent: displayName || undefined, limit: 3 })
      : Promise.resolve({ data: [] }),
    getAgentListingViewsByDay(propertyIds),
  ]);

  const pendingCount = listings.filter((l) => l.approve_status === 0).length;
  const addListingHref = getCentralWhatsAppHref(
    'Bonjour, je souhaite ajouter une nouvelle propriété à mon compte agent.',
  );

  return (
    <>
      <AgentPageHeader
        title="Vue d'ensemble"
        action={
          addListingHref && (
            <a
              href={addListingHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full bg-blue px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-blue-deep u-btn-primary"
            >
              Ajouter un bien
              <Plus strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
            </a>
          )
        }
      />

      <div className="flex flex-col gap-6 px-5 py-6 sm:px-8">
        <AgentPortfolioBanner
          listingsCount={listings.length}
          profileUrl={`${SITE_URL}/agents/${agent.id}`}
          profilePath={`/agents/${agent.id}`}
        />

        <AgentDashboardView
          metrics={{
            totalProperties: listings.length,
            totalPending: pendingCount,
            totalViews: listingViews,
            totalFavourites: favoritesCount,
            totalProfileViews: profileViews,
            totalWhatsappClicks: whatsappClicks,
          }}
          chartData={viewsByDay}
          recentInquiries={leadsPage.data}
        />

        {listings.length > 0 && <WhatsAppPortfolioGenerator listings={listings} siteUrl={SITE_URL} />}
      </div>
    </>
  );
}
