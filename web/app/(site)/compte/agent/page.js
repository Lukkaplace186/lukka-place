import { redirect } from 'next/navigation';
import { getCurrentAgentId } from '@/lib/agentSession';
import { getAgentProfile, getOwnListingsForDashboard } from '@/lib/agencies';
import {
  getAgentProfileViews,
  getAgentListingViews,
  getAgentWhatsAppClicks,
  getAgentFavoritesCount,
  getPerListingStats,
  getAgentListingViewsByDay,
} from '@/lib/analytics';
import { listLeads } from '@/lib/adminApi';
import { buildWhatsAppLink, getCentralWhatsAppHref } from '@/lib/whatsapp';
import { SITE_URL } from '@/lib/constants';
import { formatPrice } from '@/lib/format';
import { updateListingStatusAction, agentLogoutAction } from './actions';
import WhatsAppPortfolioGenerator from '@/components/WhatsAppPortfolioGenerator';
import AgentDashboardView from '@/components/AgentDashboardView';

export const metadata = {
  title: 'Espace agent — Lukka Place',
  robots: { index: false, follow: false },
};

// No searchParams/cookies() call of its own would trip Next's automatic
// dynamic-rendering detection — same fix Phase 2 already had to make twice
// for admin pages in this exact situation.
export const dynamic = 'force-dynamic';

const LISTING_STATUS_LABELS = { active: 'Actif', under_offer: 'Sous compromis', closed: 'Loué / Vendu' };
const APPROVE_STATUS_LABELS = { 0: 'En attente', 1: 'Approuvé', 2: 'Rejeté' };

export default async function AgentDashboardPage() {
  const agentId = await getCurrentAgentId();
  if (!agentId) redirect('/compte/agent/connexion');

  const agent = await getAgentProfile(agentId);
  if (!agent) redirect('/compte/agent/connexion');

  const listings = await getOwnListingsForDashboard(agentId);
  const propertyIds = listings.map((l) => l.id);

  const [profileViews, listingViews, whatsappClicks, favoritesCount, perListingStats, leadsPage, viewsByDay] =
    await Promise.all([
      getAgentProfileViews(agentId),
      getAgentListingViews(propertyIds),
      getAgentWhatsAppClicks(propertyIds),
      getAgentFavoritesCount(propertyIds),
      getPerListingStats(propertyIds),
      propertyIds.length > 0 ? listLeads({ propertyIds, limit: 50 }) : Promise.resolve({ data: [] }),
      getAgentListingViewsByDay(propertyIds),
    ]);

  const name = [agent.first_name, agent.last_name].filter(Boolean).join(' ') || agent.username || '—';

  // Real counts only — pendingCount from the same `listings` array the
  // table below already renders, never a second/duplicate fetch.
  const pendingCount = listings.filter((l) => l.approve_status === 0).length;
  const addListingHref = getCentralWhatsAppHref(
    'Bonjour, je souhaite ajouter une nouvelle propriété à mon compte agent.',
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-[-0.02em] text-ink">Bonjour, {name}</h1>
          <p className="mt-1 text-sm text-ink-45">
            <a href={`/agents/${agent.id}`} className="text-blue-deep hover:underline">
              Voir mon profil public ↗
            </a>
          </p>
        </div>
        <form action={agentLogoutAction}>
          <button type="submit" className="text-sm font-medium text-ink-45 hover:text-ink">
            Se déconnecter
          </button>
        </form>
      </div>

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
        recentInquiries={leadsPage.data.slice(0, 3)}
        addListingHref={addListingHref}
      />

      <div className="mb-8">
        <h2 className="mb-3 text-sm font-semibold text-ink">Mes annonces</h2>
        {listings.length === 0 ? (
          <div className="rounded-card border border-dashed border-line bg-white p-10 text-center text-sm text-ink-45">
            Aucune annonce pour le moment.
          </div>
        ) : (
          <div className="overflow-hidden rounded-card border border-line bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-canvas-alt text-xs uppercase tracking-wide text-ink-45">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Annonce</th>
                  <th className="px-4 py-2.5 font-semibold">Modération</th>
                  <th className="px-4 py-2.5 font-semibold">Statut</th>
                  <th className="px-4 py-2.5 font-semibold">Vues</th>
                  <th className="px-4 py-2.5 font-semibold">Clics WhatsApp</th>
                </tr>
              </thead>
              <tbody>
                {listings.map((listing) => {
                  const boundStatus = updateListingStatusAction.bind(null, listing.id);
                  return (
                    <tr key={listing.id} className="border-b border-line last:border-b-0">
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-ink">{listing.title}</div>
                        <div className="text-xs text-ink-45">{formatPrice(listing.price, listing.purpose)}</div>
                      </td>
                      <td className="px-4 py-2.5 text-ink-70">{APPROVE_STATUS_LABELS[listing.approve_status] || '—'}</td>
                      <td className="px-4 py-2.5">
                        <form action={boundStatus} className="flex items-center gap-1.5">
                          <select
                            name="listing_status"
                            defaultValue={listing.listing_status}
                            className="rounded-full border border-line bg-white px-2 py-1 text-xs font-medium text-ink"
                          >
                            {Object.entries(LISTING_STATUS_LABELS).map(([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ))}
                          </select>
                          <button type="submit" className="rounded-full border border-line px-2 py-1 text-xs font-medium text-ink hover:bg-canvas-alt">
                            OK
                          </button>
                        </form>
                      </td>
                      <td className="u-tabular px-4 py-2.5 text-ink-70">{perListingStats.views[listing.id] || 0}</td>
                      <td className="u-tabular px-4 py-2.5 text-ink-70">{perListingStats.clicks[listing.id] || 0}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div id="prospects" className="mb-8 grid grid-cols-1 gap-8 scroll-mt-20 lg:grid-cols-[1fr_20rem]">
        <div>
          <h2 className="mb-3 text-sm font-semibold text-ink">Prospects</h2>
          {leadsPage.data.length === 0 ? (
            <div className="rounded-card border border-dashed border-line bg-white p-10 text-center text-sm text-ink-45">
              Aucun prospect pour le moment.
            </div>
          ) : (
            <div className="overflow-hidden rounded-card border border-line bg-white">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-line bg-canvas-alt text-xs uppercase tracking-wide text-ink-45">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">Contact</th>
                    <th className="px-4 py-2.5 font-semibold">Détails</th>
                    <th className="px-4 py-2.5 font-semibold" />
                  </tr>
                </thead>
                <tbody>
                  {leadsPage.data.map((lead) => (
                    <tr key={lead.id} className="border-b border-line last:border-b-0">
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-ink">{lead.name || lead.wa_id}</div>
                        <div className="text-xs text-ink-45">{lead.created_at}</div>
                      </td>
                      <td className="px-4 py-2.5 text-ink-70">{lead.requirements_summary || '—'}</td>
                      <td className="px-4 py-2.5">
                        <a
                          href={buildWhatsAppLink(lead.wa_id, `Bonjour ${lead.name || ''}, merci pour votre intérêt sur Lukka Place.`)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded-full border border-green bg-green-tint px-2.5 py-1 text-xs font-medium text-green-deep hover:bg-green hover:text-white"
                        >
                          Répondre sur WhatsApp
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <WhatsAppPortfolioGenerator listings={listings} siteUrl={SITE_URL} />
      </div>
    </div>
  );
}
