import { getCurrentAgentId } from '@/lib/agentSession';
import { getOwnListingsForDashboard } from '@/lib/agencies';
import { getPerListingStats } from '@/lib/analytics';
import { formatPrice } from '@/lib/format';
import { Image as ImageIcon } from 'lucide-react';
import SafeImage from '@/components/SafeImage';
import AgentPageHeader from '@/components/AgentPageHeader';
import { updateListingStatusAction } from '../actions';

const LISTING_STATUS_LABELS = { active: 'Actif', under_offer: 'Sous compromis', closed: 'Loué / Vendu' };
const APPROVE_STATUS_LABELS = { 0: 'En attente', 1: 'Approuvé', 2: 'Rejeté' };

const STATUS_PILL = {
  active: 'bg-green-tint text-green-deep',
  under_offer: 'bg-brass-tint text-brass-deep',
  closed: 'bg-canvas-deep text-ink-70',
};

export default async function AgentListingsPage({ searchParams }) {
  const params = await searchParams;
  const statusFilter = typeof params.status === 'string' ? params.status : '';

  const agentId = await getCurrentAgentId();
  const listings = await getOwnListingsForDashboard(agentId);
  const propertyIds = listings.map((l) => l.id);
  const perListingStats = await getPerListingStats(propertyIds);

  const filtered = statusFilter ? listings.filter((l) => l.listing_status === statusFilter) : listings;

  const activeCount = listings.filter((l) => l.listing_status === 'active').length;
  const closedCount = listings.filter((l) => l.listing_status === 'closed').length;
  const underOfferCount = listings.filter((l) => l.listing_status === 'under_offer').length;

  return (
    <>
      <AgentPageHeader
        title="Mes biens"
        subtitle={`${listings.length} bien${listings.length === 1 ? '' : 's'} · ${activeCount} actif${activeCount === 1 ? '' : 's'} · ${underOfferCount} sous compromis · ${closedCount} loué/vendu`}
      />

      <div className="px-5 py-6 sm:px-8">
        <div className="mb-4 flex justify-end">
          <form method="get" className="flex items-center gap-2">
            <select
              name="status"
              defaultValue={statusFilter}
              className="rounded-md border border-line bg-white px-2.5 py-1.5 text-sm text-ink"
            >
              <option value="">Tous les statuts</option>
              {Object.entries(LISTING_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <button type="submit" className="rounded-md border border-line bg-white px-3 py-1.5 text-sm font-medium text-ink hover:bg-canvas-alt">
              Filtrer
            </button>
          </form>
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-card border border-dashed border-line bg-white p-10 text-center text-sm text-ink-45">
            {listings.length === 0 ? 'Aucune annonce pour le moment.' : 'Aucune annonce pour ce statut.'}
          </div>
        ) : (
          <div className="overflow-hidden rounded-card border border-line bg-white">
            <div className="grid grid-cols-[minmax(0,2.4fr)_1fr_1fr_1.3fr] gap-3 border-b border-line bg-canvas-alt px-5 py-2.5 text-[0.6875rem] font-bold uppercase tracking-wide text-ink-35">
              <div>Bien</div>
              <div>Prix</div>
              <div>Vues / Clics</div>
              <div>Statut</div>
            </div>
            {filtered.map((listing) => {
              const boundStatus = updateListingStatusAction.bind(null, listing.id);
              return (
                <div
                  key={listing.id}
                  className="grid grid-cols-[minmax(0,2.4fr)_1fr_1fr_1.3fr] items-center gap-3 border-b border-line px-5 py-3.5 last:border-b-0"
                >
                  <div className="flex min-w-0 items-center gap-3.5">
                    <div className="h-12 w-16 shrink-0 overflow-hidden rounded-lg bg-canvas-deep">
                      {listing.featured_image ? (
                        <SafeImage
                          src={listing.featured_image}
                          alt=""
                          width={64}
                          height={48}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-ink-25">
                          <ImageIcon className="h-4 w-4" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-bold text-ink">{listing.title}</div>
                      <div className="mt-0.5 text-xs text-ink-45">
                        {listing.quartier || '—'} · {APPROVE_STATUS_LABELS[listing.approve_status] || '—'}
                      </div>
                    </div>
                  </div>
                  <div className="u-tabular text-sm font-bold text-ink">{formatPrice(listing.price, listing.purpose)}</div>
                  <div className="u-tabular text-sm text-ink-70">
                    {perListingStats.views[listing.id] || 0} / {perListingStats.clicks[listing.id] || 0}
                  </div>
                  <form action={boundStatus} className="flex items-center gap-1.5">
                    <select
                      name="listing_status"
                      defaultValue={listing.listing_status}
                      className={`appearance-none rounded-full border-0 px-3 py-1.5 text-xs font-bold ${STATUS_PILL[listing.listing_status] || STATUS_PILL.active}`}
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
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
