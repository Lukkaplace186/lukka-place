import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Heart } from 'lucide-react';
import { PortalEmpty } from '@/components/ClientPortalUI';
import { getPortalCustomer } from '@/lib/customerPortal';
import { listFavoriteIds, listSavedSearches, touchSavedSearchesViewed } from '@/lib/customers';
import { getListingsByIds } from '@/lib/listings';
import { getSavedSearchMatches } from '@/lib/alerts';
import { getCentralWhatsAppHref } from '@/lib/whatsapp';
import { cn } from '@/lib/utils';
import { removeFavoriteAction } from './actions';
import FavoritesBoard from './favoris/FavoritesBoard';
import AlertsBoard from './alertes/AlertsBoard';
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

  let content;
  if (view === 'alertes') {
    const matches = savedSearches.length > 0 ? await getSavedSearchMatches(savedSearches) : [];
    // Runs after computing `matches`, same as the old standalone Alertes
    // page: viewing this tab must not zero out the "new since last visit"
    // counts it's about to show.
    await touchSavedSearchesViewed(
      customerId,
      savedSearches.map((s) => s.id),
    );
    const whatsappHref = getCentralWhatsAppHref(
      t('account.favorites.whatsappAlert'),
    );
    content = <AlertsBoard matches={matches} whatsappHref={whatsappHref} />;
  } else {
    const listings = favoriteIds.length > 0 ? await getListingsByIds(favoriteIds) : [];
    content =
      listings.length === 0 ? (
        <PortalEmpty
          icon={Heart}
          title={t('account.favorites.emptyTitle')}
          actionLabel={t('account.favorites.browseListings')}
          actionHref="/listings"
        >
          {t('account.favorites.emptyBody')}
        </PortalEmpty>
      ) : (
        <FavoritesBoard
          listings={listings}
          whatsappNumber={process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || null}
          removeAction={removeFavoriteAction}
        />
      );
  }

  return (
    <div>
      <div className="mb-7 inline-flex gap-1 rounded-full bg-canvas-deep p-1">
        <Link
          href="/compte/client"
          className={cn(
            'rounded-full px-4 py-2 text-[0.8125rem] font-bold transition-colors',
            view === 'favoris' ? 'bg-surface text-ink shadow-sm' : 'text-ink-45 hover:text-ink',
          )}
        >
          Favoris{favoriteIds.length > 0 ? ` (${favoriteIds.length})` : ''}
        </Link>
        <Link
          href="/compte/client?tab=alertes"
          className={cn(
            'rounded-full px-4 py-2 text-[0.8125rem] font-bold transition-colors',
            view === 'alertes' ? 'bg-surface text-ink shadow-sm' : 'text-ink-45 hover:text-ink',
          )}
        >
          Alertes{savedSearches.length > 0 ? ` (${savedSearches.length})` : ''}
        </Link>
      </div>

      {content}
    </div>
  );
}
