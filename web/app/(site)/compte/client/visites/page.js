import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CalendarClock, CalendarPlus, Home, MessageCircle, Phone } from 'lucide-react';
import { PortalEmpty, PortalSectionHeading } from '@/components/ClientPortalUI';
import SafeImage from '@/components/SafeImage';
import { getPortalCustomer } from '@/lib/customerPortal';
import { getCustomerInquiries } from '@/lib/customerInquiries';
import { customerToAgentMessage, groupCustomerVisits } from '@/lib/customerAgenda';
import { formatVisitSlot, formatVisitTime } from '@/lib/visitAgenda';
import { buildWhatsAppLink, getCentralWhatsAppHref } from '@/lib/whatsapp';
import { displayableAgencyName } from '@/lib/agentIdentity';
import { listingImages, feedLocationLine } from '@/lib/listingView';
import { formatPrice } from '@/lib/format';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { getLocale, getT } from '@/lib/i18n/server';
import CustomerVisitActions from './CustomerVisitActions';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('account.agenda.metaTitle'), robots: { index: false, follow: false } };
}

export const dynamic = 'force-dynamic';

const TONE_CLASS = {
  pending: 'bg-warning-tint text-warning',
  confirmed: 'bg-success-tint text-success',
  rescheduled: 'bg-blue-tint text-blue-deep',
  cancelled: 'bg-danger-tint text-danger',
  done: 'bg-canvas-alt text-ink-70',
};

/**
 * The customer's visits, day by day: Aujourd'hui / Demain / À venir /
 * Heure à préciser / Passées (lib/customerAgenda.js). Each card: the listing,
 * the time (agreed, or "demandé" while the agent has not answered), the status,
 * and what they can do — call or WhatsApp the agent (the verified agent's own
 * number under the listing page's rule, else Lukka Place's, labelled so), open
 * the listing, cancel or accept a proposed slot (the same engine calls as the
 * Messages tab), add a confirmed visit to their calendar.
 *
 * No directions: the exact position stays with the agent until they share it.
 */
export default async function VisitesPage() {
  const portal = await getPortalCustomer();
  if (!portal) redirect('/compte/connexion?next=/compte/client/visites');
  const t = await getT();
  const locale = await getLocale();

  let inquiries = [];
  let unavailable = false;
  try {
    inquiries = await getCustomerInquiries(portal.customerId);
  } catch (err) {
    console.warn('[compte/client/visites] inquiries unavailable:', err.message);
    unavailable = true;
  }
  const groups = groupCustomerVisits(inquiries, new Date());
  const sections = [
    ['today', groups.today],
    ['tomorrow', groups.tomorrow],
    ['upcoming', groups.upcoming],
    ['unscheduled', groups.unscheduled],
    ['past', groups.past.slice(0, 20)],
  ].filter(([, items]) => items.length);
  const total = sections.reduce((n, [, items]) => n + items.length, 0);

  return (
    <div className="flex flex-col gap-6">
      <PortalSectionHeading
        title={t('account.agenda.title')}
        lead={t('account.agenda.lead')}
        action={(
          <Link href="/compte/client/messages" className="u-micro-strong text-blue-deep hover:underline">
            {t('account.agenda.toMessages')}
          </Link>
        )}
      />

      {unavailable ? (
        <p className="rounded-lg bg-warning-tint px-4 py-3 text-sm text-warning" role="alert">{t('account.agenda.unavailable')}</p>
      ) : null}

      {!unavailable && total === 0 ? (
        <PortalEmpty icon={CalendarClock} title={t('account.agenda.emptyTitle')} actionLabel={t('account.agenda.emptyAction')} actionHref="/listings">
          {t('account.agenda.emptyBody')}
        </PortalEmpty>
      ) : null}

      {sections.map(([key, items]) => (
        <section key={key} className="flex flex-col gap-3">
          <h2 className="u-title-sub text-ink">{t(`account.agenda.groups.${key}`)}</h2>
          <ul className="flex flex-col gap-3">
            {items.map((visit) => {
              const listing = visit.listing;
              const agentName = displayableAgencyName(listing?.agency_name) || null;
              const agentPhone = listing?.agent_phone ? String(listing.agent_phone).replace(/\D/g, '') : null;
              const message = customerToAgentMessage({ agentName, phrase: visit.phrase, listing });
              const whatsappHref = agentPhone ? buildWhatsAppLink(agentPhone, message) : getCentralWhatsAppHref(message);
              const centralDigits = String(process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || '').replace(/\D/g, '');
              const callHref = agentPhone ? `tel:+${agentPhone}` : centralDigits ? `tel:+${centralDigits}` : null;
              const image = listing ? listingImages(listing)[0] : null;
              const open = !['cancelled', 'done'].includes(visit.tone) && key !== 'past';
              return (
                <li key={visit.id} className="u-card flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
                  <div className="flex gap-3">
                    <div className="relative h-16 w-20 flex-none overflow-hidden rounded-lg bg-canvas-alt">
                      {image ? <SafeImage src={image} alt="" fill sizes="80px" className="object-cover" /> : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={cn('rounded-full px-2 py-0.5 text-[0.75rem] font-bold', TONE_CLASS[visit.tone])}>
                          {t(`account.agenda.tone.${visit.tone}`)}
                        </span>
                        {visit.at ? (
                          <span className="u-tabular text-sm font-bold text-ink">
                            {key === 'today' || key === 'tomorrow' ? formatVisitTime(visit.at, locale) : formatVisitSlot(visit.at, locale)}
                          </span>
                        ) : (
                          <span className="text-sm text-ink-70">{t('account.agenda.noTime')}</span>
                        )}
                        {visit.at && !visit.agreed && visit.tone === 'pending' ? (
                          <span className="text-xs text-ink-45">{t('account.agenda.requested')}</span>
                        ) : null}
                      </div>
                      <p className="mt-1 truncate text-sm font-semibold text-ink">{listing?.title || t('account.agenda.listingGone')}</p>
                      {listing ? (
                        <p className="truncate text-xs text-ink-45">
                          {[feedLocationLine(listing), formatPrice(listing.price, listing.purpose, listing.price_period)].filter(Boolean).join(' · ')}
                        </p>
                      ) : null}
                      {visit.tone === 'rescheduled' && visit.requestedTime ? (
                        <p className="mt-1 text-xs font-semibold text-blue-deep">{t('account.agenda.proposed', { slot: visit.requestedTime })}</p>
                      ) : null}
                      {visit.receiptSentAt ? <p className="mt-1 text-xs text-ink-45">{t('account.agenda.receipt')}</p> : null}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {callHref && open ? (
                      <a href={callHref} className="u-press inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-line px-3 text-sm font-semibold text-ink">
                        <Phone strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
                        {agentPhone ? t('account.agenda.callAgent') : t('account.agenda.callLukka')}
                      </a>
                    ) : null}
                    {whatsappHref && open ? (
                      <a href={whatsappHref} target="_blank" rel="noopener noreferrer" className="u-press inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-line px-3 text-sm font-semibold text-ink">
                        <MessageCircle strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 text-green-deep" />
                        {agentPhone ? t('account.agenda.whatsappAgent') : t('account.agenda.whatsappLukka')}
                      </a>
                    ) : null}
                    {listing ? (
                      <Link href={`/listings/${listing.id}`} className="u-press inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-line px-3 text-sm font-semibold text-ink">
                        <Home strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
                        {t('account.agenda.viewListing')}
                      </Link>
                    ) : null}
                    {visit.tone === 'confirmed' && visit.at && open ? (
                      <a href={`/compte/client/visites/${visit.id}/agenda.ics`} className="u-press inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-line px-3 text-sm font-semibold text-ink">
                        <CalendarPlus strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
                        {t('account.agenda.addToCalendar')}
                      </a>
                    ) : null}
                    {open ? <CustomerVisitActions viewingId={visit.id} status={visit.status} /> : null}
                  </div>
                  {!agentPhone && open ? <p className="text-xs text-ink-45">{t('account.agenda.centralNote')}</p> : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
