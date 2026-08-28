import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Bell, Trash2, SlidersHorizontal, Plus, MessageCircle, ArrowRight } from 'lucide-react';
import PropertyCard from '@/components/PropertyCard';
import { PortalPanel, PortalSectionHeading, PortalEmpty } from '@/components/ClientPortalUI';
import { getPortalCustomer } from '@/lib/customerPortal';
import { listSavedSearches, touchSavedSearchesViewed } from '@/lib/customers';
import { getSavedSearchMatches } from '@/lib/alerts';
import { searchCriteriaTags } from '@/lib/searchLabel';
import { getCentralWhatsAppHref } from '@/lib/whatsapp';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { removeSavedSearchAction } from '../actions';

export const metadata = {
  title: 'Mes alertes — Lukka Place',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const SHOWN_PER_SEARCH = 3;

/**
 * "Mes alertes" — the design's alerts board over this app's real
 * `customer_saved_searches` rows.
 *
 * Alerts are pull-model by an explicit product decision (see
 * app/(site)/compte/alertes/page.js, the original implementation of this
 * data): a customer sees new matches when they open this page. Every saved
 * search is re-run through the real, unmodified getListings() at render
 * time, and "new" means created_at after the search's own last_viewed_at
 * (or created_at if never viewed) — not a fabricated count.
 * touchSavedSearchesViewed runs AFTER the counts are computed, so this
 * page's own visit never zeroes out the numbers it is about to show.
 *
 * Two things the design's mockup carries that this schema cannot back, and
 * which are therefore replaced with an honest explanation in the aside
 * rather than rendered as dead controls:
 *
 *  - **Per-alert frequency** ("Instantané / Résumé quotidien / Désactivé").
 *    There is no frequency column on `customer_saved_searches`, and no
 *    scheduled-job infrastructure to honour one.
 *  - **Notification channels** (WhatsApp / e-mail switches). `customers`
 *    holds a phone number and nothing else — there is no email column, and
 *    a proactive WhatsApp push would need a Meta-approved template that
 *    does not exist. Both switches would have been decorative.
 */
export default async function AlertesPage() {
  const session = await getPortalCustomer();
  if (!session) redirect('/compte/connexion?next=/compte/client/alertes');

  const searches = await listSavedSearches(session.customerId);
  const matches = searches.length > 0 ? await getSavedSearchMatches(searches) : [];

  await touchSavedSearchesViewed(
    session.customerId,
    searches.map((s) => s.id),
  );

  const whatsappHref = getCentralWhatsAppHref(
    'Bonjour, je souhaite être prévenu des nouveaux biens correspondant à ma recherche.',
  );

  if (searches.length === 0) {
    return (
      <PortalEmpty
        icon={Bell}
        title="Aucune recherche sauvegardée"
        actionLabel="Parcourir les annonces"
        actionHref="/listings"
      >
        Sauvegardez une recherche depuis la page des annonces : nous vous montrons ici les nouveaux biens qui y
        correspondent à chacune de vos visites.
      </PortalEmpty>
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_21.25rem] lg:items-start">
      <div>
        <PortalSectionHeading
          title="Mes alertes"
          lead={`${searches.length} recherche${searches.length > 1 ? 's' : ''} active${
            searches.length > 1 ? 's' : ''
          }. Les nouveaux biens correspondants apparaissent ici à chaque visite.`}
          className="mb-7"
        />

        <div className="flex flex-col gap-5">
          {matches.map(({ search, newListings, newCount, total }) => {
            const tags = searchCriteriaTags(new URLSearchParams(search.query));
            const shown = newListings.slice(0, SHOWN_PER_SEARCH);

            return (
              <PortalPanel key={search.id} className="p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h3 className="text-[1.125rem] font-bold leading-snug text-ink">{search.label}</h3>
                    <p
                      className={`mt-2 inline-flex items-center gap-1.5 text-[0.8125rem] font-semibold ${
                        newCount > 0 ? 'text-blue-deep' : 'text-ink-45'
                      }`}
                    >
                      <Bell strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" aria-hidden="true" />
                      {newCount > 0
                        ? `${newCount} nouveau${newCount > 1 ? 'x' : ''} résultat${newCount > 1 ? 's' : ''} depuis votre dernière visite`
                        : 'Aucun nouveau résultat depuis votre dernière visite'}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <Link
                      href={`/listings?${search.query}`}
                      aria-label={`Modifier la recherche « ${search.label} »`}
                      title="Modifier la recherche"
                      className="u-press inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-45 transition-colors hover:bg-canvas-deep hover:text-ink"
                    >
                      <SlidersHorizontal strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
                    </Link>
                    <form action={removeSavedSearchAction}>
                      <input type="hidden" name="query" value={search.query} />
                      <button
                        type="submit"
                        aria-label={`Supprimer l'alerte « ${search.label} »`}
                        title="Supprimer l'alerte"
                        className="u-press inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-45 transition-colors hover:bg-danger-tint hover:text-danger"
                      >
                        <Trash2 strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </form>
                  </div>
                </div>

                {tags.length > 0 ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {tags.map((tag) => (
                      <span key={tag} className="u-tag">
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : null}

                <div className="my-5 h-px bg-line" />

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="u-tabular text-[0.8125rem] text-ink-45">
                    {total} bien{total > 1 ? 's' : ''} correspond{total > 1 ? 'ent' : ''} à cette recherche
                  </span>
                  <Link
                    href={`/listings?${search.query}`}
                    className="inline-flex items-center gap-1.5 text-[0.8125rem] font-semibold text-blue-deep hover:underline"
                  >
                    Voir tous les résultats
                    <ArrowRight strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                </div>

                {shown.length > 0 ? (
                  <div className="mt-5 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                    {shown.map((listing) => (
                      <PropertyCard key={listing.id} listing={listing} />
                    ))}
                  </div>
                ) : null}
              </PortalPanel>
            );
          })}
        </div>
      </div>

      <PortalPanel as="aside" className="flex flex-col gap-5 p-6">
        <div>
          <h3 className="text-[1.125rem] font-bold text-ink">Comment vous êtes prévenu</h3>
          <p className="mt-2 text-[0.8125rem] leading-[1.5] text-ink-45">
            Vos alertes sont consultables ici : à chaque visite, chaque recherche est relancée et les biens publiés
            depuis votre dernier passage sont mis en avant.
          </p>
        </div>

        <div className="h-px bg-line" />

        <p className="text-[0.8125rem] leading-[1.5] text-ink-45">
          Il n&apos;y a pas encore d&apos;envoi automatique par WhatsApp ou par e-mail. Si vous voulez être prévenu
          activement d&apos;un bien précis, dites-le-nous sur WhatsApp et l&apos;équipe s&apos;en charge.
        </p>

        {whatsappHref ? (
          <a
            href={whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-full bg-green px-5 py-2.5 text-[0.875rem] font-semibold text-white transition-colors hover:bg-green-deep"
          >
            <MessageCircle strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
            En parler sur WhatsApp
          </a>
        ) : null}

        <Link
          href="/listings"
          className="u-btn-secondary inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-[0.875rem] font-semibold text-ink"
        >
          <Plus strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
          Créer une alerte
        </Link>
      </PortalPanel>
    </div>
  );
}
