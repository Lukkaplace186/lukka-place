import Link from 'next/link';
import { Image as ImageIcon, ExternalLink, MessageCircle } from 'lucide-react';
import { getCurrentAgentId } from '@/lib/agentSession';
import { getAgentDashboardContext } from '@/lib/agentDashboard';
import { getPerListingStats } from '@/lib/analytics';
import { formatPrice } from '@/lib/format';
import { getCentralWhatsAppHref } from '@/lib/whatsapp';
import { getLocationHierarchySafe } from '@/lib/locations';
import { getPropertyCategories } from '@/lib/agentListings';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import SafeImage from '@/components/SafeImage';
import AgentPageHeader from '@/components/AgentPageHeader';
import AgentListingStatusSelect from '@/components/AgentListingStatusSelect';
import CreateListingDialog from '@/components/CreateListingDialog';
import MarkListingSoldDialog from '@/components/MarkListingSoldDialog';
import { updateListingStatusAction } from '../actions';

// The full vocabulary, used by the top filter dropdown — a closed listing
// must stay filterable even though it's no longer reachable from the
// per-row select below.
const LISTING_STATUS_OPTIONS = [
  { value: 'active', label: 'Actif' },
  { value: 'under_offer', label: 'Sous compromis' },
  { value: 'closed', label: 'Loué / Vendu' },
];

// The per-row select's options — deliberately excludes 'closed'. Reaching
// that state now only happens through MarkListingSoldDialog, which requires
// a real final price; offering it here too would let an agent bypass that
// and leave sold_price null. See actions.js's LISTING_STATUSES comment.
const LISTING_STATUS_EDIT_OPTIONS = [
  { value: 'active', label: 'Actif' },
  { value: 'under_offer', label: 'Sous compromis' },
];

const APPROVE_STATUS = {
  0: { label: 'En attente', className: 'bg-warning-tint text-warning' },
  1: { label: 'Publié', className: 'bg-success-tint text-success' },
  2: { label: 'Rejeté', className: 'bg-danger-tint text-danger' },
};

// Written out as a full literal (not composed or .replace()-d at runtime):
// Tailwind scans source text, so an arbitrary-value class it never sees
// spelled out simply doesn't get generated — see web/CLAUDE.md.
const GRID_COLS = 'lg:grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,1.3fr)_minmax(0,1.2fr)]';

export default async function AgentListingsPage({ searchParams }) {
  const params = await searchParams;
  const statusFilter = typeof params.status === 'string' ? params.status : '';
  const q = typeof params.q === 'string' ? params.q.trim() : '';

  const agentId = await getCurrentAgentId();
  const { listings, propertyIds, newLeadsCount } = await getAgentDashboardContext(agentId);
  const [perListingStats, { communes }, categories] = await Promise.all([
    getPerListingStats(propertyIds),
    getLocationHierarchySafe(),
    getPropertyCategories(),
  ]);

  const needle = q.toLowerCase();
  const filtered = listings.filter((l) => {
    if (statusFilter && l.listing_status !== statusFilter) return false;
    if (!needle) return true;
    return `${l.title || ''} ${l.quartier || ''}`.toLowerCase().includes(needle);
  });

  const counts = LISTING_STATUS_OPTIONS.map(
    (o) => `${listings.filter((l) => l.listing_status === o.value).length} ${o.label.toLowerCase()}`,
  ).join(' · ');

  return (
    <>
      <AgentPageHeader
        title="Mes biens"
        newLeadsCount={newLeadsCount}
        searchAction="/compte/agent/biens"
        searchDefaultValue={q}
        searchPlaceholder="Rechercher un bien"
        hiddenSearchFields={{ status: statusFilter }}
      />

      <div className="px-5 py-7 sm:px-8">
        <div className="u-card overflow-hidden rounded-card bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line px-6 py-5">
            <div>
              <div className="text-[1.125rem] font-bold text-ink">
                {listings.length} bien{listings.length === 1 ? '' : 's'}
              </div>
              <div className="mt-0.5 text-[0.8125rem] text-ink-45">{counts}</div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <form method="get" className="flex items-center gap-2">
                {q && <input type="hidden" name="q" value={q} />}
                <select
                  name="status"
                  defaultValue={statusFilter}
                  aria-label="Filtrer par statut"
                  className="u-focus-ring h-10 w-[10.625rem] rounded-lg border border-line bg-surface px-3 text-[0.8125rem] font-medium text-ink"
                >
                  <option value="">Tous les statuts</option>
                  {LISTING_STATUS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="u-btn-secondary u-press h-10 rounded-lg px-3.5 text-[0.8125rem] font-bold text-ink"
                >
                  Filtrer
                </button>
              </form>

              <CreateListingDialog communes={communes} categories={categories} />
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="px-6 py-16 text-center text-sm text-ink-45">
              {listings.length === 0
                ? 'Aucune annonce pour le moment. Cliquez sur « Ajouter un bien » pour publier votre premier bien.'
                : 'Aucune annonce ne correspond à ces filtres.'}
            </div>
          ) : (
            <>
              <div
                // lg:gap-3 must match the data rows below exactly — without
                // it the header's five columns are each ~17px wider (the
                // four 12px gaps the rows spend and the header doesn't), so
                // every column label sits off its own column.
                className={`hidden ${GRID_COLS} bg-canvas-alt px-6 py-3 text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-ink-35 lg:grid lg:gap-3`}
              >
                <div>Bien</div>
                <div>Prix</div>
                <div>Vues</div>
                <div>Statut</div>
                <div className="text-right">Actions</div>
              </div>

              {filtered.map((listing) => {
                const boundStatus = updateListingStatusAction.bind(null, listing.id);
                const approve = APPROVE_STATUS[listing.approve_status];
                const isClosed = listing.listing_status === 'closed';
                const editHref = getCentralWhatsAppHref(
                  `Bonjour, je souhaite modifier mon annonce « ${listing.title} » (réf. ${listing.id}).`,
                );

                return (
                  <div
                    key={listing.id}
                    className={`flex flex-wrap items-center gap-4 border-t border-line px-6 py-4 lg:grid ${GRID_COLS} lg:gap-3`}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3.5 lg:flex-none">
                      <div className="grid h-12 w-16 shrink-0 place-items-center overflow-hidden rounded-[10px] bg-canvas-deep text-ink-25">
                        {listing.featured_image ? (
                          <SafeImage
                            src={listing.featured_image}
                            alt=""
                            width={64}
                            height={48}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <ImageIcon strokeWidth={ICON_STROKE_WIDTH} className="h-[1.125rem] w-[1.125rem]" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-bold text-ink">{listing.title}</div>
                        <div className="mt-[3px] flex items-center gap-2 text-xs text-ink-45">
                          <span className="truncate">{listing.quartier || 'Localisation non précisée'}</span>
                          {approve && (
                            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[0.625rem] font-bold ${approve.className}`}>
                              {approve.label}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="u-tabular text-sm font-bold text-ink">
                      {formatPrice(listing.price, listing.purpose)}
                      {isClosed && listing.sold_price != null && (
                        <div className="mt-0.5 text-xs font-semibold text-ink-45">
                          Prix final : {formatPrice(listing.sold_price, listing.purpose)}
                        </div>
                      )}
                    </div>

                    <div className="u-tabular text-sm text-ink-70">
                      <span className="lg:hidden">Vues : </span>
                      {(perListingStats.views[listing.id] || 0).toLocaleString('fr-FR')}
                    </div>

                    {isClosed ? (
                      <span className="w-full max-w-[10.5rem] rounded-full bg-canvas-deep px-3.5 py-[0.4375rem] text-center text-[0.8125rem] font-bold text-ink-70">
                        {listing.purpose === 'rent' ? 'Loué' : 'Vendu'}
                      </span>
                    ) : (
                      <form action={boundStatus}>
                        <AgentListingStatusSelect
                          name="listing_status"
                          defaultValue={listing.listing_status}
                          options={LISTING_STATUS_EDIT_OPTIONS}
                          label={`Statut de ${listing.title}`}
                        />
                      </form>
                    )}

                    <div className="flex items-center justify-end gap-1.5">
                      {listing.approve_status === 1 && (
                        <Link
                          href={`/listings/${listing.id}`}
                          target="_blank"
                          aria-label={`Voir l'annonce ${listing.title}`}
                          title="Voir l'annonce publique"
                          className="u-press grid h-[2.125rem] w-[2.125rem] place-items-center rounded-lg text-ink-45 transition-colors hover:bg-canvas-alt hover:text-ink"
                        >
                          <ExternalLink strokeWidth={ICON_STROKE_WIDTH} className="h-[1.0625rem] w-[1.0625rem]" />
                        </Link>
                      )}
                      {!isClosed && (
                        <MarkListingSoldDialog propertyId={listing.id} purpose={listing.purpose} title={listing.title} />
                      )}
                      {editHref && (
                        <a
                          href={editHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Demander une modification de ${listing.title}`}
                          title="Demander une modification sur WhatsApp"
                          className="u-press grid h-[2.125rem] w-[2.125rem] place-items-center rounded-lg text-ink-45 transition-colors hover:bg-canvas-alt hover:text-ink"
                        >
                          <MessageCircle strokeWidth={ICON_STROKE_WIDTH} className="h-[1.0625rem] w-[1.0625rem]" />
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>
    </>
  );
}
