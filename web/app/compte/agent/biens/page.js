import Link from 'next/link';
import { getCurrentAgentId } from '@/lib/agentSession';
import { getAgentDashboardContext } from '@/lib/agentDashboard';
import { getPerListingStats } from '@/lib/analytics';
import { getLocationHierarchyWithFallback } from '@/lib/locations';
import { getPropertyCategories } from '@/lib/agentListings';
import AgentPageHeader from '@/components/AgentPageHeader';
import CreateListingDialog from '@/components/CreateListingDialog';
import AgentListingsTable from '@/components/AgentListingsTable';

// The full vocabulary, used by the top filter dropdown — a closed listing
// must stay filterable even though it's no longer reachable from the
// per-row select in AgentListingsTable.
const LISTING_STATUS_OPTIONS = [
  { value: 'active', label: 'Actif' },
  { value: 'under_offer', label: 'Sous compromis' },
  { value: 'closed', label: 'Loué / Vendu' },
];

// Broad pills above the table — plain GET links into the same `?status=`
// param the detailed select already reads, not a second client-side
// filtering mechanism. "Loués / Vendus" groups 'closed' the same way the
// design's own grouping does; the granular select beside it still offers
// 'under_offer' on its own for whoever wants it.
//
// 'archived' is deliberately in this list even though it is NOT a
// listing_status value — it's `properties.status = 0`, a different axis (see
// setListingArchivedAction). Filtering by it from the same control is right
// for the agent ("show me the ones that aren't on the site"); `matchesFilter`
// below is what keeps the two axes from being conflated in the data.
const FILTER_PILLS = [
  { value: '', label: 'Tous' },
  { value: 'active', label: 'En ligne' },
  { value: 'archived', label: 'Archivés' },
  { value: 'closed', label: 'Loués / Vendus' },
];

/**
 * One place that knows `?status=` spans two independent columns:
 *   'archived'                     -> properties.status = 0 (visibility)
 *   'active' | 'under_offer' | ... -> properties.listing_status (market)
 *
 * 'active' additionally excludes archived rows: an agent asking for their
 * live inventory does not mean "including the ones hidden from the site".
 */
function matchesFilter(listing, filter) {
  if (!filter) return true;
  const archived = Number(listing.status) === 0;
  if (filter === 'archived') return archived && listing.listing_status !== 'closed';
  if (filter === 'active') return listing.listing_status === 'active' && !archived;
  return listing.listing_status === filter;
}

export default async function AgentListingsPage({ searchParams }) {
  const params = await searchParams;
  const statusFilter = typeof params.status === 'string' ? params.status : '';
  const q = typeof params.q === 'string' ? params.q.trim() : '';

  const agentId = await getCurrentAgentId();
  const { listings, propertyIds, newLeadsCount } = await getAgentDashboardContext(agentId);
  const [perListingStats, { communes }, categories] = await Promise.all([
    getPerListingStats(propertyIds),
    getLocationHierarchyWithFallback(),
    getPropertyCategories(),
  ]);

  const needle = q.toLowerCase();
  const filtered = listings.filter((l) => {
    if (!matchesFilter(l, statusFilter)) return false;
    if (!needle) return true;
    return `${l.title || ''} ${l.quartier || ''}`.toLowerCase().includes(needle);
  });

  const counts = [
    ...LISTING_STATUS_OPTIONS.map(
      (o) => `${listings.filter((l) => matchesFilter(l, o.value)).length} ${o.label.toLowerCase()}`,
    ),
    `${listings.filter((l) => matchesFilter(l, 'archived')).length} archivé(s)`,
  ].join(' · ');

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

      <div className="flex flex-col gap-4 px-5 py-7 sm:px-8">
        <div className="flex flex-wrap items-center gap-2">
          {FILTER_PILLS.map((pill) => {
            const active = pill.value === statusFilter || (pill.value === '' && !statusFilter);
            const href = pill.value
              ? `/compte/agent/biens?status=${pill.value}${q ? `&q=${encodeURIComponent(q)}` : ''}`
              : `/compte/agent/biens${q ? `?q=${encodeURIComponent(q)}` : ''}`;
            return (
              <Link
                key={pill.value}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`u-press rounded-full px-3.5 py-1.5 text-[0.8125rem] font-bold transition-colors ${
                  active ? 'bg-ink text-white' : 'bg-canvas-alt text-ink-70 hover:bg-canvas-deep'
                }`}
              >
                {pill.label}
              </Link>
            );
          })}
        </div>

        <div className="u-card overflow-hidden rounded-card bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line px-6 py-5">
            <div>
              <div className="u-title-card text-ink">
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
                  <option value="archived">Archivé (masqué du site)</option>
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
            <AgentListingsTable listings={filtered} perListingStats={perListingStats} />
          )}
        </div>
      </div>
    </>
  );
}
