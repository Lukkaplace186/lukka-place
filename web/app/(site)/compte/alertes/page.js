import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Bookmark } from 'lucide-react';
import Breadcrumb from '@/components/Breadcrumb';
import PropertyCard from '@/components/PropertyCard';
import { getCurrentCustomerId, listSavedSearches, touchSavedSearchesViewed } from '@/lib/customers';
import { getSavedSearchMatches } from '@/lib/alerts';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

export const metadata = {
  title: 'Alertes — Lukka Place',
  robots: { index: false, follow: false },
};

const SHOWN_PER_SEARCH = 6;

/**
 * In-app pull-model alerts, per the explicit product decision: a customer
 * sees new matches when they visit this page, not a proactive WhatsApp push
 * (that would need a Meta-approved template + new scheduled-job
 * infrastructure, neither of which exists — see the plan). Every saved
 * search is re-run through the real, unmodified getListings() at render
 * time; "new" is real too — created_at compared against the search's own
 * last_viewed_at (or created_at if never viewed), not a fabricated count.
 *
 * touchSavedSearchesViewed runs AFTER computing the counts below, so this
 * page's own visit doesn't zero out the very numbers it's about to show.
 */
export default async function AlertesPage() {
  const customerId = await getCurrentCustomerId();
  if (!customerId) redirect('/compte/connexion?next=/compte/alertes');

  const searches = await listSavedSearches(customerId);

  const matches = await getSavedSearchMatches(searches);
  const sections = matches.map(({ search, newListings, newCount, total }) => ({
    search,
    newListings: newListings.slice(0, SHOWN_PER_SEARCH),
    newCount,
    total,
  }));

  await touchSavedSearchesViewed(customerId, searches.map((s) => s.id));

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
      <Breadcrumb className="mb-6" items={[{ label: 'Accueil', href: '/' }, { label: 'Alertes' }]} />

      <header className="mb-10">
        <h1 className="u-title-hero text-ink">
          Alertes
        </h1>
        <p className="mt-3 text-[0.9375rem] leading-relaxed text-ink-45">
          Les nouvelles annonces correspondant à vos recherches sauvegardées, depuis votre dernière visite ici.
        </p>
      </header>

      {sections.length === 0 ? (
        <div className="rounded-lg border border-line bg-surface px-6 py-14 text-center">
          <span className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-canvas-alt text-ink-45">
            <Bookmark strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" />
          </span>
          <h3 className="u-title-section text-ink">Aucune recherche sauvegardée</h3>
          <p className="mx-auto mt-2 max-w-sm text-[0.875rem] leading-relaxed text-ink-45">
            Sauvegardez une recherche depuis la page des annonces pour être alerté des nouveaux biens correspondants.
          </p>
          <Link
            href="/listings"
            className="mt-7 inline-flex items-center rounded-full bg-blue px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-deep u-btn-primary"
          >
            Parcourir les annonces
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-12">
          {sections.map(({ search, newListings, newCount, total }) => (
            <section key={search.id}>
              <div className="mb-4 flex items-center justify-between gap-3 border-b border-line pb-3">
                <div>
                  <h2 className="text-[0.9375rem] font-semibold text-ink">{search.label}</h2>
                  <p className="u-tabular mt-0.5 text-[0.8125rem] text-ink-45">
                    {newCount > 0
                      ? `${newCount} nouvelle${newCount > 1 ? 's' : ''} annonce${newCount > 1 ? 's' : ''} depuis votre dernière visite`
                      : 'Aucune nouvelle annonce depuis votre dernière visite'}
                  </p>
                </div>
                <Link href={search.href || `/listings?${search.query}`} className="shrink-0 text-[0.8125rem] font-semibold text-blue-deep hover:underline">
                  Voir tout ({total})
                </Link>
              </div>

              {newListings.length > 0 && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {newListings.map((listing) => (
                    <PropertyCard key={listing.id} listing={listing} />
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
