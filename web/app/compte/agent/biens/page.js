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

// The full vocabulary, used by the top filter dropdown — a closed listing
// must stay filterable even though it's no longer reachable from the
// per-row select in AgentListingsTable.
const LISTING_STATUS_OPTIONS = [
  { value: 'active', labelKey: 'status.listing.active' },
  { value: 'under_offer', labelKey: 'status.listing.under_offer' },
  { value: 'closed', labelKey: 'status.listing.closed' },
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
  { value: '', labelKey: 'listings.filters.allTypes' },
  { value: 'active', labelKey: 'agent.listings.online' },
  { value: 'archived', labelKey: 'agent.listings.archived' },
  { value: 'closed', labelKey: 'agent.listings.soldOrLet' },
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
  // of these three is what this page is *for*: the table renders from
  // `listings`, which is already in hand. Analytics or the category list being
  // unreachable should cost an empty Vues/Clics column or a create dialog with
  // no categories to offer — never the agent's inventory list itself.
  const [perListingStats, hierarchy, categories, quota] = await Promise.all([
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
  ]);
  const communes = hierarchy?.communes ?? [];

  const needle = q.toLowerCase();
  const filtered = listings.filter((l) => {
    if (!matchesFilter(l, statusFilter)) return false;
    if (!needle) return true;
    return `${l.title || ''} ${l.quartier || ''}`.toLowerCase().includes(needle);
  });

  // `o.label` here — not `t(o.labelKey)` — is what took this whole page down:
  // the i18n migration renamed the field on LISTING_STATUS_OPTIONS and updated
  // both JSX reads of it, but missed this one, so every render threw
  // `Cannot read properties of undefined (reading 'toLowerCase')` before it
  // produced any output. `t()` always returns a string (it falls back to the
  // key itself), so there is no undefined to guard against here.
  const counts = [
    ...LISTING_STATUS_OPTIONS.map(
      (o) => `${listings.filter((l) => matchesFilter(l, o.value)).length} ${t(o.labelKey).toLowerCase()}`,
    ),
    `${listings.filter((l) => matchesFilter(l, 'archived')).length} archivé(s)`,
  ].join(' · ');

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
                {t(pill.labelKey)}
              </Link>
            );
          })}
        </div>

        <div className="u-card overflow-hidden rounded-card bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-3 py-3.5 sm:gap-4 sm:px-6 sm:py-5">
            <div className="min-w-0">
              <div className="u-title-card text-ink">
                {listings.length} bien{listings.length === 1 ? '' : 's'}
              </div>
              <div className="mt-0.5 text-xs text-ink-45 sm:text-[0.8125rem]">{counts}</div>
            </div>

            {/* Phone: the status filter takes the row's remaining width and
                "Ajouter un bien" sits beside it, instead of a fixed 10.6rem
                select pushing the group past the screen. */}
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:gap-2.5">
              <form method="get" className="flex min-w-0 flex-1 items-center gap-2 sm:flex-none">
                {q && <input type="hidden" name="q" value={q} />}
                <select
                  name="status"
                  defaultValue={statusFilter}
                  aria-label={t('agent.listings.filterByStatus')}
                  className="u-focus-ring h-10 min-w-0 flex-1 rounded-lg border border-line bg-surface px-2.5 text-[0.8125rem] font-medium text-ink sm:w-[10.625rem] sm:flex-none sm:px-3"
                >
                  <option value="">{t('agent.listings.allStatuses')}</option>
                  {LISTING_STATUS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {t(o.labelKey)}
                    </option>
                  ))}
                  <option value="archived">{t('agent.listings.archivedHidden')}</option>
                </select>
                <button
                  type="submit"
                  className="u-btn-secondary u-press h-10 shrink-0 rounded-lg px-3 text-[0.8125rem] font-bold text-ink sm:px-3.5"
                >
                  {t('agent.listings.filter')}
                </button>
              </form>

              <CreateListingDialog
                communes={communes}
                categories={categories}
                draftKey={`agent:${agentId}:new-listing`}
                quota={quota ? { atLimit: quota.atLimit, limit: quota.limit, used: quota.used, planTitle: quota.planTitle } : null}
              />
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-ink-45 sm:px-6 sm:py-16">
              {listings.length === 0
                ? t('agent.listings.emptyDashboard')
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
