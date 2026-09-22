import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { Heart } from 'lucide-react';
import { PortalEmpty } from '@/components/ClientPortalUI';
import { PortalBoardSkeleton } from '@/components/PortalSkeleton';
import { getPortalCustomer } from '@/lib/customerPortal';
import {
  listFavoriteIds,
  listSavedSearches,
  touchSavedSearchesViewed,
  getWhatsAppAlertsOptOut,
  listFavoriteNotes,
} from '@/lib/customers';
import { getListingsByIds } from '@/lib/listings';
import { getSavedSearchMatches } from '@/lib/alerts';
import { getCentralWhatsAppHref } from '@/lib/whatsapp';
import { removeFavoriteAction, restoreFavoriteAction, saveFavoriteNoteAction } from './actions';
import FavoritesBoard from './favoris/FavoritesBoard';
import AlertsBoard from './alertes/AlertsBoard';
import SavedSubTabs from './SavedSubTabs';
import { getT } from '@/lib/i18n/server';

// generateMetadata, not a static object: a static export is evaluated at
// module load, where there is no request and so no translator.
export async function generateMetadata() {
  const t = await getT();
  return {
    title: t('account.favorites.metaTitle'),
    robots: { index: false, follow: false },
  };
}

export const dynamic = 'force-dynamic';

/** The saved listings, as full rows. Streams in behind the sub-tab pills. */
async function FavoritesSection({ customerId, favoriteIds }) {
  const t = await getT();
  const [rows, notes] = await Promise.all([
    favoriteIds.length > 0 ? getListingsByIds(favoriteIds) : [],
    listFavoriteNotes(customerId).catch(() => ({})),
  ]);
  // In the order they were SAVED (listFavoriteIds is newest-saved first), not
  // the order the listings were published — same reasoning as lib/savedHome.js.
  const byId = new Map(rows.map((listing) => [String(listing.id), listing]));
  const listings = favoriteIds.map((id) => byId.get(String(id))).filter(Boolean);
  // A favourite whose listing was let, sold or withdrawn drops out of the
  // approved read. Say how many, rather than letting the count silently shrink.
  const unavailableCount = favoriteIds.length - listings.length;
  if (listings.length === 0) {
    return (
      <PortalEmpty
        icon={Heart}
        title={t('account.favorites.emptyTitle')}
        actionLabel={t('account.favorites.browseListings')}
        actionHref="/listings"
      >
        {t('account.favorites.emptyBody')}
      </PortalEmpty>
    );
  }
  return (
    <FavoritesBoard
      listings={listings}
      whatsappNumber={process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || null}
      removeAction={removeFavoriteAction}
      restoreAction={restoreFavoriteAction}
      notes={notes}
      saveNoteAction={saveFavoriteNoteAction}
      unavailableCount={unavailableCount}
    />
  );
}

/** Every saved search re-run. The expensive half of this tab — see lib/alerts.js. */
async function AlertsSection({ customerId, phone, savedSearches }) {
  const t = await getT();
  const [matches, optedOutAt] = await Promise.all([
    savedSearches.length > 0 ? getSavedSearchMatches(savedSearches) : [],
    getWhatsAppAlertsOptOut(customerId),
  ]);
  // Runs after computing `matches`, same as the old standalone Alertes
  // page: viewing this tab must not zero out the "new since last visit"
  // counts it's about to show.
  await touchSavedSearchesViewed(
    customerId,
    savedSearches.map((s) => s.id),
  );
  const whatsappHref = getCentralWhatsAppHref(t('account.favorites.whatsappAlert'));
  return <AlertsBoard matches={matches} whatsappHref={whatsappHref} phone={phone} optedOut={Boolean(optedOutAt)} />;
}

/**
 * "Favoris & Alertes" — the portal's default landing tab (replacing the old
 * "Vue d'ensemble" summary page: a visitor lands straight on their saved
 * properties rather than a redundant re-statement of numbers the tab bar
 * already shows).
 *
 * Favoris and Alertes stay two real, separately-fetched datasets behind a
 * `?tab=` sub-toggle — same URL-driven-state convention as the `/listings`
 * map/list toggle (web/CLAUDE.md) — rather than one merged list, because
 * they're different shapes (saved listings vs. saved searches) and Alertes
 * is genuinely expensive to compute (`getSavedSearchMatches` re-runs
 * `getListings()` once per saved search). Only the active sub-tab's data is
 * fetched; the cheap id/count lists for both pill labels are fetched
 * unconditionally since neither costs a real query beyond `customers`.
 *
 * The pills render at once and the active sub-tab streams in under
 * Suspense, keyed by the sub-tab so switching shows its skeleton instead of
 * leaving the other sub-tab's content on screen while the new one computes.
 * The id/count lists are memoised per request (lib/customers.js), so the
 * layout's tab counts and these pills share one read.
 */
export default async function EspaceClientPage({ searchParams }) {
  const t = await getT();
  const session = await getPortalCustomer();
  if (!session) redirect('/compte/connexion?next=/compte/client');
  const { customerId } = session;

  const params = await searchParams;
  const view = params?.tab === 'alertes' ? 'alertes' : 'favoris';

  const [favoriteIds, savedSearches] = await Promise.all([
    listFavoriteIds(customerId),
    listSavedSearches(customerId),
  ]);

  return (
    <div>
      <SavedSubTabs
        view={view}
        tabs={[
          {
            key: 'favoris',
            href: '/compte/client',
            label: `${t('account.portal.subtabs.favorites')}${favoriteIds.length > 0 ? ` (${favoriteIds.length})` : ''}`,
          },
          {
            key: 'alertes',
            href: '/compte/client?tab=alertes',
            label: `${t('account.portal.subtabs.alerts')}${savedSearches.length > 0 ? ` (${savedSearches.length})` : ''}`,
          },
        ]}
      />

      <Suspense key={view} fallback={<PortalBoardSkeleton label={t('account.portal.loading')} />}>
        {view === 'alertes' ? (
          <AlertsSection customerId={customerId} phone={session.customer.phone} savedSearches={savedSearches} />
        ) : (
          <FavoritesSection customerId={customerId} favoriteIds={favoriteIds} />
        )}
      </Suspense>
    </div>
  );
}
