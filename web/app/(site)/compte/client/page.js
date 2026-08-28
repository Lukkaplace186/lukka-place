import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Heart, Bell, Mail, CalendarDays, ArrowRight, MessageCircle } from 'lucide-react';
import PropertyCard from '@/components/PropertyCard';
import { PortalPanel, PortalSectionHeading, PortalStat, PortalBadge, PortalEmpty } from '@/components/ClientPortalUI';
import { getPortalCustomer, isViewingLead } from '@/lib/customerPortal';
import { listFavoriteIds, listSavedSearches } from '@/lib/customers';
import { getSavedSearchMatches } from '@/lib/alerts';
import { getCustomerInquiries } from '@/lib/customerInquiries';
import { getListingsByIds } from '@/lib/listings';
import { LEAD_STATUS_LABELS_FR } from '@/lib/adminLabels';
import { getCentralWhatsAppHref } from '@/lib/whatsapp';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

export const metadata = {
  title: 'Espace client — Lukka Place',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const DATE_FORMATTER = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : DATE_FORMATTER.format(date);
}

const LEAD_TONES = {
  NEW: 'royal',
  CONTACTED: 'royal',
  QUALIFIED: 'royal',
  VIEWING_REQUESTED: 'warning',
  VIEWING_COMPLETED: 'success',
  CONVERTED: 'success',
  LOST: 'neutral',
};

/**
 * Espace Client — "Vue d'ensemble".
 *
 * The design's canvas has no overview tab (it opens straight onto Favoris),
 * but the portal needs a landing page for `/compte/client` itself, so this
 * is assembled from the design's own vocabulary — its stat treatment, its
 * white panels, its section heading pair — rather than invented chrome.
 *
 * Every number here is real: favorites and saved searches come from this
 * app's own `customer_favorites`/`customer_saved_searches` tables, the
 * "nouvelles" counts are real re-runs of each saved search through the
 * unmodified getListings() (lib/alerts.js), and the demandes/visites counts
 * are the customer's own leads from the engine, scoped by their own phone.
 *
 * touchSavedSearchesViewed is deliberately NOT called here — landing on the
 * overview must not zero out the counter the Alertes tab is about to show.
 * Same reasoning as /compte's account overview.
 */
export default async function EspaceClientPage() {
  const session = await getPortalCustomer();
  if (!session) redirect('/compte/connexion?next=/compte/client');
  const { customerId } = session;

  const [favoriteIds, savedSearches, inquiries] = await Promise.all([
    listFavoriteIds(customerId),
    listSavedSearches(customerId),
    getCustomerInquiries(customerId),
  ]);

  const [recentFavorites, searchMatches] = await Promise.all([
    favoriteIds.length > 0 ? getListingsByIds(favoriteIds.slice(0, 3)) : [],
    savedSearches.length > 0 ? getSavedSearchMatches(savedSearches) : [],
  ]);

  const newMatchesTotal = searchMatches.reduce((sum, m) => sum + m.newCount, 0);
  const viewings = inquiries.filter(({ lead }) => isViewingLead(lead));
  const recentInquiries = inquiries.slice(0, 3);

  const whatsappHref = getCentralWhatsAppHref(
    'Bonjour, je vous contacte depuis mon espace client Lukka Place.',
  );

  return (
    <div className="flex flex-col gap-12">
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <PortalStat
          icon={Heart}
          label="Favoris"
          value={favoriteIds.length}
          hint={recentFavorites.length > 0 ? recentFavorites.map((l) => l.title).join(' · ') : null}
          href="/compte/client/favoris"
        />
        <PortalStat
          icon={Bell}
          label="Alertes"
          value={savedSearches.length}
          hint={
            savedSearches.length === 0
              ? null
              : newMatchesTotal > 0
                ? `${newMatchesTotal} nouvelle${newMatchesTotal > 1 ? 's' : ''} annonce${newMatchesTotal > 1 ? 's' : ''} depuis votre dernière visite`
                : 'Aucune nouvelle annonce depuis votre dernière visite'
          }
          href="/compte/client/alertes"
        />
        <PortalStat
          icon={Mail}
          label="Demandes"
          value={inquiries.length}
          hint={inquiries.length > 0 ? `Dernière le ${formatDate(inquiries[0].lead.created_at) || '—'}` : null}
          href="/compte/client/messages"
        />
        <PortalStat
          icon={CalendarDays}
          label="Visites"
          value={viewings.length}
          hint={viewings.length > 0 ? 'Demandes de visite en cours avec les agences' : null}
          href="/compte/client/visites"
        />
      </div>

      <section>
        <PortalSectionHeading
          title="Vos derniers favoris"
          lead={
            favoriteIds.length > 0
              ? `${favoriteIds.length} bien${favoriteIds.length > 1 ? 's' : ''} sauvegardé${favoriteIds.length > 1 ? 's' : ''}.`
              : 'Les biens que vous sauvegardez apparaissent ici.'
          }
          action={
            favoriteIds.length > 0 ? (
              <Link
                href="/compte/client/favoris"
                className="inline-flex items-center gap-1.5 text-[0.875rem] font-semibold text-blue-deep hover:underline"
              >
                Tout voir
                <ArrowRight strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
              </Link>
            ) : null
          }
          className="mb-7"
        />

        {recentFavorites.length > 0 ? (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {recentFavorites.map((listing) => (
              <PropertyCard key={listing.id} listing={listing} />
            ))}
          </div>
        ) : (
          <PortalEmpty
            icon={Heart}
            title="Aucun favori pour le moment"
            actionLabel="Parcourir les annonces"
            actionHref="/listings"
          >
            Touchez le cœur sur une annonce pour la retrouver ici, sur tous vos appareils.
          </PortalEmpty>
        )}
      </section>

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_21.25rem] lg:items-start">
        <div>
          <PortalSectionHeading
            title="Vos dernières demandes"
            lead="Les demandes que vous avez envoyées aux agences partenaires."
            className="mb-7"
          />

          {recentInquiries.length > 0 ? (
            <div className="flex flex-col gap-4">
              {recentInquiries.map(({ lead, listing }) => (
                <PortalPanel key={lead.id} className="p-5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[0.8125rem] text-ink-35">
                      Envoyée le {formatDate(lead.created_at) || '—'}
                    </span>
                    <PortalBadge tone={LEAD_TONES[lead.status] || 'neutral'}>
                      {LEAD_STATUS_LABELS_FR[lead.status] || lead.status}
                    </PortalBadge>
                  </div>
                  {lead.requirements_summary ? (
                    <p className="mt-3 whitespace-pre-line text-[0.875rem] leading-[1.55] text-ink-70">
                      {lead.requirements_summary}
                    </p>
                  ) : null}
                  {listing ? (
                    <Link
                      href={`/listings/${listing.id}`}
                      className="mt-3 inline-flex items-center gap-1.5 text-[0.8125rem] font-semibold text-blue-deep hover:underline"
                    >
                      {listing.title}
                      <ArrowRight strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" aria-hidden="true" />
                    </Link>
                  ) : null}
                </PortalPanel>
              ))}
            </div>
          ) : (
            <PortalEmpty
              icon={Mail}
              title="Aucune demande envoyée"
              actionLabel="Soumettre une recherche"
              actionHref="/compte/client/demandes"
            >
              Décrivez le bien que vous cherchez et nous transmettons votre demande aux agences partenaires.
            </PortalEmpty>
          )}
        </div>

        <PortalPanel className="flex flex-col gap-4 p-6">
          <h3 className="text-[1.125rem] font-bold text-ink">Parler à quelqu&apos;un</h3>
          <p className="text-[0.8125rem] leading-[1.5] text-ink-45">
            Lukka Place n&apos;a pas de messagerie interne : tous les échanges avec les agences se poursuivent sur
            WhatsApp, sur le numéro central de Lukka Place.
          </p>
          {whatsappHref ? (
            <a
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-full bg-green px-5 py-2.5 text-[0.875rem] font-semibold text-white transition-colors hover:bg-green-deep"
            >
              <MessageCircle strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
              Ouvrir WhatsApp
            </a>
          ) : (
            <p className="rounded-md bg-canvas-deep px-4 py-3 text-[0.8125rem] leading-[1.5] text-ink-45">
              Le numéro WhatsApp de contact n&apos;est pas encore configuré sur cette installation.
            </p>
          )}
        </PortalPanel>
      </section>
    </div>
  );
}
