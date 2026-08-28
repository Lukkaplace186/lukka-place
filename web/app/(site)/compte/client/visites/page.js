import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CalendarDays, MapPin, MessageCircle, ImageOff } from 'lucide-react';
import SafeImage from '@/components/SafeImage';
import { PortalPanel, PortalSectionHeading, PortalBadge, PortalEmpty } from '@/components/ClientPortalUI';
import { getPortalCustomer, isViewingLead } from '@/lib/customerPortal';
import { getCustomerInquiries } from '@/lib/customerInquiries';
import { listingImages, feedLocationLine } from '@/lib/listingView';
import { LEAD_STATUS_LABELS_FR } from '@/lib/adminLabels';
import { getCentralWhatsAppHref } from '@/lib/whatsapp';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

export const metadata = {
  title: 'Visites planifiées — Lukka Place',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const WEEKDAY = new Intl.DateTimeFormat('fr-FR', { weekday: 'long' });
const DAY_MONTH_YEAR = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

function capitalise(value) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

/**
 * "Visites planifiées" — the design's viewing timeline, over the only real
 * viewing signal this app can actually read.
 *
 * The honest constraint, stated plainly because it shapes the whole page:
 * the engine's `viewing_requests` table (which does hold a real
 * `requested_time`) is **not exposed through routes/admin.js**, so `web/`
 * has no path to it. What is reachable is the customer's own leads, and
 * `VIEWING_REQUESTED` / `VIEWING_COMPLETED` are two real LEAD_STATUSES.
 *
 * So the timeline's gutter shows the date the visit was **requested** —
 * which is real — and never an appointment day/time, which would be
 * fabricated. The agencies confirm the actual slot on WhatsApp, and the
 * card says so and links there.
 */
export default async function VisitesPage() {
  const session = await getPortalCustomer();
  if (!session) redirect('/compte/connexion?next=/compte/client/visites');

  const inquiries = await getCustomerInquiries(session.customerId);
  const viewings = inquiries.filter(({ lead }) => isViewingLead(lead));

  if (viewings.length === 0) {
    return (
      <div>
        <PortalSectionHeading
          title="Visites planifiées"
          lead="Le suivi de vos demandes de visite avec les agences."
          className="mb-7"
        />
        <PortalEmpty
          icon={CalendarDays}
          title="Aucune visite en cours"
          actionLabel="Voir mes favoris"
          actionHref="/compte/client/favoris"
        >
          Demandez une visite depuis un de vos favoris : dès que l&apos;agence l&apos;enregistre, elle apparaît ici
          avec son avancement.
        </PortalEmpty>
      </div>
    );
  }

  return (
    <div className="max-w-[55rem]">
      <PortalSectionHeading
        title="Visites planifiées"
        lead={`${viewings.length} demande${viewings.length > 1 ? 's' : ''} de visite en cours. L'horaire exact est confirmé par l'agence sur WhatsApp.`}
        className="mb-8"
      />

      <ol className="flex flex-col">
        {viewings.map(({ lead, listing }) => {
          const requestedAt = new Date(lead.created_at);
          const valid = !Number.isNaN(requestedAt.getTime());
          const cover = listing ? listingImages(listing)[0] || null : null;
          const where = listing ? feedLocationLine(listing) : null;

          const rescheduleHref = getCentralWhatsAppHref(
            listing
              ? `Bonjour, je souhaite convenir d'un créneau pour la visite de l'annonce Ref: ${listing.reference || `#${listing.id}`}.`
              : `Bonjour, je souhaite convenir d'un créneau pour ma demande de visite n° ${lead.id}.`,
          );
          const cancelHref = getCentralWhatsAppHref(
            listing
              ? `Bonjour, je souhaite annuler ma demande de visite pour l'annonce Ref: ${listing.reference || `#${listing.id}`}.`
              : `Bonjour, je souhaite annuler ma demande de visite n° ${lead.id}.`,
          );

          return (
            <li key={lead.id} className="grid gap-6 pb-7 sm:grid-cols-[7.5rem_minmax(0,1fr)]">
              <div className="pt-5 sm:text-right">
                <p className="u-eyebrow">Demandée le</p>
                <p className="mt-1.5 text-[0.8125rem] font-bold text-ink">
                  {valid ? capitalise(WEEKDAY.format(requestedAt)) : '—'}
                </p>
                <p className="u-tabular mt-0.5 text-[0.8125rem] text-ink-45">
                  {valid ? DAY_MONTH_YEAR.format(requestedAt) : ''}
                </p>
              </div>

              <div className="relative border-l border-line pl-7">
                <span
                  aria-hidden="true"
                  className="absolute -left-[0.3125rem] top-7 h-[0.6875rem] w-[0.6875rem] rounded-full bg-blue ring-4 ring-canvas-warm"
                />

                <PortalPanel as="article" className="flex flex-col gap-5 p-5 sm:flex-row">
                  <div className="relative h-[6.875rem] w-full shrink-0 overflow-hidden rounded-xl bg-canvas-deep sm:w-[8.25rem]">
                    {cover ? (
                      <SafeImage src={cover} alt={listing.title} fill sizes="132px" className="object-cover" />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center text-ink-25">
                        <ImageOff strokeWidth={ICON_STROKE_WIDTH} className="h-6 w-6" aria-hidden="true" />
                      </span>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="text-[1.0625rem] font-bold leading-snug text-ink">
                        {listing ? (
                          <Link href={`/listings/${listing.id}`} className="transition-colors hover:text-blue-deep">
                            {listing.title}
                          </Link>
                        ) : (
                          'Visite demandée'
                        )}
                      </h3>
                      <PortalBadge tone={lead.status === 'VIEWING_COMPLETED' ? 'success' : 'warning'}>
                        {LEAD_STATUS_LABELS_FR[lead.status] || lead.status}
                      </PortalBadge>
                    </div>

                    {where ? (
                      <p className="mt-2 flex items-center gap-1.5 text-[0.8125rem] text-ink-45">
                        <MapPin strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        {where}
                      </p>
                    ) : null}

                    {lead.requirements_summary ? (
                      <p className="mt-3 whitespace-pre-line text-[0.8125rem] leading-[1.5] text-ink-70">
                        {lead.requirements_summary}
                      </p>
                    ) : null}

                    {/* `assigned_agent` is a real column and is only rendered
                        when the team has genuinely assigned someone. There is
                        no agent phone or photo on a lead, so none is shown. */}
                    {lead.assigned_agent ? (
                      <p className="mt-3 border-t border-line pt-3 text-[0.8125rem] text-ink-70">
                        Suivie par <span className="font-bold text-ink">{lead.assigned_agent}</span>
                      </p>
                    ) : null}

                    <div className="mt-4 flex flex-wrap gap-2.5">
                      {rescheduleHref ? (
                        <a
                          href={rescheduleHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 rounded-full bg-green px-4 py-2 text-[0.8125rem] font-semibold text-white transition-colors hover:bg-green-deep"
                        >
                          <MessageCircle strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
                          Convenir d&apos;un créneau
                        </a>
                      ) : null}
                      {cancelHref ? (
                        <a
                          href={cancelHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center rounded-full px-4 py-2 text-[0.8125rem] font-semibold text-ink-45 transition-colors hover:bg-canvas-alt hover:text-ink"
                        >
                          Annuler la visite
                        </a>
                      ) : null}
                    </div>
                  </div>
                </PortalPanel>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
