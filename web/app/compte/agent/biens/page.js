import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getT } from '@/lib/i18n/server';
import { getCurrentAgentId } from '@/lib/agentSession';
import { getAgentDashboardContext } from '@/lib/agentDashboard';
import { getPerListingStats } from '@/lib/analytics';
import { getLocationHierarchyWithFallback } from '@/lib/locations';
import { getPropertyCategories } from '@/lib/agentListings';
import AgentPageHeader from '@/components/AgentPageHeader';
import CreateListingDialog from '@/components/CreateListingDialog';
import AgentListingsTable from '@/components/AgentListingsTable';
import { getListingQuota } from '@/lib/listingQuota';
import { UPGRADE_PATH } from '@/lib/listingQuotaRules';
import { getAgentListingGaps } from '@/lib/completeness';

// The listing_status vocabulary. A closed listing must stay filterable even
// though it's no longer reachable from a row's own status actions.
const LISTING_STATUS_OPTIONS = [
  { value: 'active', labelKey: 'status.listing.active' },
  { value: 'under_offer', labelKey: 'status.listing.under_offer' },
  { value: 'closed', labelKey: 'status.listing.closed' },
];

// The one filter control: a row of chips, each a plain link into `?status=`
// with its count on it. It replaced a pill row PLUS a status <select> with a
// "Filtrer" button beside it — two controls for one question, the second a
// full page submit. A chip with nothing behind it is not drawn (unless it is
// the one selected), so the row stays short on a phone.
//
// 'archived' is deliberately in this list even though it is NOT a
// listing_status value — it's `properties.status = 0`, a different axis (see
// setListingArchivedAction). 'incomplete' is a third thing again: listings with
// at least one gap (lib/completeness.js). `matchesFilter` below is what keeps
// these axes from being conflated in the data.
const FILTER_PILLS = [
  { value: '', labelKey: 'listings.filters.allTypes', always: true },
  { value: 'active', labelKey: 'agent.listings.online', always: true },
  { value: 'incomplete', labelKey: 'agent.listings.toComplete' },
  { value: 'under_offer', labelKey: LISTING_STATUS_OPTIONS[1].labelKey },
  { value: 'closed', labelKey: 'agent.listings.soldOrLet' },
  { value: 'archived', labelKey: 'agent.listings.archived' },
];

/**
 * One place that knows `?status=` spans independent columns:
 *   'archived'                     -> properties.status = 0 (visibility)
 *   'incomplete'                   -> has a completeness gap
 *   'active' | 'under_offer' | ... -> properties.listing_status (market)
 *
 * 'active' additionally excludes archived rows: an agent asking for their
 * live inventory does not mean "including the ones hidden from the site".
 */
function matchesFilter(listing, filter, gapsByListing = {}) {
  if (!filter) return true;
  const archived = Number(listing.status) === 0;
  if (filter === 'incomplete') return Boolean(gapsByListing[String(listing.id)]);
  if (filter === 'archived') return archived && listing.listing_status !== 'closed';
  if (filter === 'active') return listing.listing_status === 'active' && !archived;
  return listing.listing_status === filter;
}

export default async function AgentListingsPage({ searchParams }) {
  const t = await getT();
  const params = await searchParams;
  const statusFilter = typeof params.status === 'string' ? params.status : '';
  const q = typeof params.q === 'string' ? params.q.trim() : '';

  const agentId = await getCurrentAgentId();
  // getAgentDashboardContext returns null when the session's agent row is gone
  // (deleted account, restored database, cookie outliving the row). The layout
  // redirects on exactly this condition, but layout and page render
  // concurrently in the App Router, so destructuring null here can still throw
  // first — and a TypeError, unlike a redirect, is what the visitor sees.
  const context = await getAgentDashboardContext(agentId);
  if (!context) redirect('/compte/agent/connexion');

  const listings = Array.isArray(context.listings) ? context.listings : [];
  const propertyIds = Array.isArray(context.propertyIds) ? context.propertyIds : [];
  const newLeadsCount = context.newLeadsCount ?? 0;

  // Degrade, don't die — the same contract the overview page follows. Not one
  // of these is what this page is *for*: the table renders from `listings`,
  // which is already in hand. Analytics, categories or the gap read being
  // unreachable should cost an empty Vues/Clics column, a create dialog with
  // no categories, or cards without "À compléter" hints — never the list.
  //
  // What is missing from each listing sits ON its card (AgentListingsTable),
  // not in a panel above the list: a wall of chips above the inventory pushed
  // the first card below the fold and never said which property it meant.
  // The "Toujours disponible ?" prompt lives on the overview's to-do list and
  // in the editor, for the same reason.
  const [perListingStats, hierarchy, categories, quota, listingGaps] = await Promise.all([
    getPerListingStats(propertyIds).catch((error) => {
      console.error('[agent/biens] per-listing stats unavailable:', error.message);
      return { views: {}, clicks: {} };
    }),
    getLocationHierarchyWithFallback().catch((error) => {
      console.error('[agent/biens] location hierarchy unavailable:', error.message);
      return { communes: [] };
    }),
    getPropertyCategories().catch((error) => {
      console.error('[agent/biens] property categories unavailable:', error.message);
      return [];
    }),
    getListingQuota(agentId).catch((error) => {
      console.error('[agent/biens] listing quota unavailable:', error.message);
      return null;
    }),
    getAgentListingGaps(agentId).catch((error) => {
      console.error('[agent/biens] listing gaps unavailable:', error.message);
      return [];
    }),
  ]);
  const communes = hierarchy?.communes ?? [];
  const gapsByListing = Object.fromEntries(
    listingGaps
      .filter((l) => l.gaps.length > 0)
      .map((l) => [String(l.id), { gaps: l.gaps, photoCount: l.photoCount }]),
  );

  const needle = q.toLowerCase();
  const filtered = listings.filter((l) => {
    if (!matchesFilter(l, statusFilter, gapsByListing)) return false;
    if (!needle) return true;
    return `${l.title || ''} ${l.quartier || ''} ${l.reference || ''}`.toLowerCase().includes(needle);
  });

  const pills = FILTER_PILLS.map((pill) => ({
    ...pill,
    count: listings.filter((l) => matchesFilter(l, pill.value, gapsByListing)).length,
  })).filter((pill) => pill.always || pill.count > 0 || pill.value === statusFilter);

  return (
    <>
      <AgentPageHeader
        title={t('agent.listings.title')}
        newLeadsCount={newLeadsCount}
        searchAction="/compte/agent/biens"
        searchDefaultValue={q}
        searchPlaceholder={t('nav.searchAria')}
        hiddenSearchFields={{ status: statusFilter }}
      />

      <div className="flex flex-col gap-4 px-3 py-4 sm:px-8 sm:py-7">
        {quota?.atLimit ? (
          <div role="status" className="flex flex-col gap-3 rounded-card border border-warning/40 bg-warning-tint p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-ink">
              {t('agent.quota.reached', { limit: quota.limit, plan: quota.planTitle || t('agent.quota.currentPlan') })}
            </p>
            <Link
              href={UPGRADE_PATH}
              className="u-btn-primary u-press inline-flex h-10 shrink-0 items-center justify-center rounded-lg bg-blue px-4 text-sm font-bold text-white hover:bg-blue-deep"
            >
              {t('agent.quota.upgrade')}
            </Link>
          </div>
        ) : quota?.capped ? (
          <p className="text-xs text-ink-45">{t('agent.quota.usage', { used: quota.used, limit: quota.limit })}</p>
        ) : null}
        <nav
          aria-label={t('agent.listings.filterByStatus')}
          className="no-scrollbar -mx-3 flex gap-2 overflow-x-auto px-3 sm:mx-0 sm:flex-wrap sm:px-0"
        >
          {pills.map((pill) => {
            const active = pill.value === statusFilter;
            const query = new URLSearchParams();
            if (pill.value) query.set('status', pill.value);
            if (q) query.set('q', q);
            const qs = query.toString();
            return (
              <Link
                key={pill.value}
                href={qs ? `/compte/agent/biens?${qs}` : '/compte/agent/biens'}
                scroll={false}
                aria-current={active ? 'page' : undefined}
                className={`u-press inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-[0.8125rem] font-bold transition-colors ${
                  active ? 'bg-ink text-white' : 'bg-surface text-ink-70 ring-1 ring-line hover:bg-canvas-deep'
                }`}
              >
                {t(pill.labelKey)}
                <span className={`u-tabular text-[0.75rem] ${active ? 'text-white/70' : 'text-ink-45'}`}>{pill.count}</span>
              </Link>
            );
          })}
        </nav>

        <div className="u-card overflow-hidden rounded-card bg-surface">
          <AgentListingsTable
            listings={filtered}
            perListingStats={perListingStats}
            gapsByListing={gapsByListing}
            title={`${listings.length} bien${listings.length === 1 ? '' : 's'}`}
            emptyMessage={listings.length === 0 ? t('agent.listings.emptyDashboard') : 'Aucune annonce ne correspond à ces filtres.'}
            action={
              <CreateListingDialog
                communes={communes}
                categories={categories}
                draftKey={`agent:${agentId}:new-listing`}
                quota={quota ? { atLimit: quota.atLimit, limit: quota.limit, used: quota.used, planTitle: quota.planTitle } : null}
              />
            }
          />
        </div>
      </div>
    </>
  );
}
