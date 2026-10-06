import Link from 'next/link';
import { CalendarCheck, CalendarClock, CalendarPlus, CalendarX, History, Hourglass, Phone } from 'lucide-react';
import SafeImage from '@/components/SafeImage';
import { WhatsAppIcon } from '@/components/WhatsAppCTA';
import { customerToAgentMessage } from '@/lib/customerAgenda';
import { needsCheckin, proposalExpired, proposedSlotAt } from '@/lib/clientPortalView';
import { formatVisitDay, formatVisitTime } from '@/lib/visitAgenda';
import { buildWhatsAppLink, getCentralWhatsAppHref } from '@/lib/whatsapp';
import { displayableAgencyName } from '@/lib/agentIdentity';
import { listingImages, feedLocationLine } from '@/lib/listingView';
import { formatPrice } from '@/lib/format';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { cn } from '@/lib/utils';
import CustomerVisitActions from './CustomerVisitActions';
import VisitCheckin from './VisitCheckin';

const upperFirst = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/**
 * The time band that opens every visit card — the agent portal's language,
 * one colour per state the customer has to read at a glance:
 *   amber  the agent proposed another slot (the customer answers)
 *   green  confirmed
 *   blue   asked, the agent has not answered
 *   grey   past, cancelled or done
 */
const BAND = {
  ask: { tone: 'bg-warning-tint', note: 'text-warning-ink', icon: CalendarClock, iconTone: 'text-warning-ink' },
  ok: { tone: 'bg-success-tint', note: 'text-success', icon: CalendarCheck, iconTone: 'text-success' },
  wait: { tone: 'bg-blue-tint', note: 'text-blue-deep', icon: Hourglass, iconTone: 'text-blue' },
  muted: { tone: 'bg-canvas-deep', note: 'text-ink-45', icon: History, iconTone: 'text-ink-45' },
  cancelled: { tone: 'bg-canvas-deep', note: 'text-ink-45', icon: CalendarX, iconTone: 'text-ink-45' },
};

function slotLabel(at, locale) {
  const day = formatVisitDay(at, locale);
  const time = formatVisitTime(at, locale);
  return day && time ? `${upperFirst(day)} · ${time}` : null;
}

/** Which band, and what it says. */
function bandFor(visit, { past, expired, locale, t, now }) {
  const when = visit.at ? slotLabel(visit.at, locale) : null;
  const phrase = upperFirst(visit.requestedTime) || t('account.agenda.noTime');
  if (visit.tone === 'rescheduled' && !past) {
    // The agent's own formatSlotFr phrase, shown in the reader's language when
    // it parses (lib/clientPortalView.js); their words otherwise.
    const proposed = proposedSlotAt(visit.requestedTime, now);
    const label = (proposed && slotLabel(proposed, locale)) || phrase;
    return expired
      ? { kind: 'cancelled', main: label, note: t('account.agenda.band.proposalPassed') }
      : { kind: 'ask', main: label, note: t('account.agenda.band.proposed') };
  }
  if (visit.tone === 'cancelled') return { kind: 'cancelled', main: when || phrase, note: t('account.agenda.tone.cancelled') };
  if (visit.tone === 'done') return { kind: 'muted', main: when || phrase, note: t('account.agenda.tone.done') };
  if (past) return { kind: 'muted', main: when || phrase, note: t('account.agenda.band.past') };
  if (visit.tone === 'confirmed') {
    return when
      ? { kind: 'ok', main: when, note: t('account.agenda.band.confirmed') }
      : { kind: 'ok', main: t('account.agenda.noTime'), note: t('account.agenda.band.confirmedNoTime') };
  }
  return { kind: 'wait', main: when || phrase, note: t('account.agenda.band.waiting') };
}

const BTN = 'u-press inline-flex min-h-11 items-center justify-center gap-2 rounded-[0.625rem] px-4 text-sm font-bold';

/**
 * One visit, shared by Visites and Accueil's "Prochaine visite". A server
 * component: every action inside it is the existing client control
 * (CustomerVisitActions, VisitCheckin) or a plain link.
 *
 * The contact rule is the listing page's: the agent's own number only when
 * it reaches the page (verified, routing on — lib/listings.js nulls it
 * otherwise), else Lukka Place's, labelled so.
 */
export default function VisitCard({ visit, t, locale, past = false, compact = false, now = new Date() }) {
  const listing = visit.listing;
  const expired = proposalExpired(visit, now);
  const band = bandFor(visit, { past, expired, locale, t, now });
  const look = BAND[band.kind];
  const BandIcon = look.icon;
  const open = !past && !['cancelled', 'done'].includes(visit.tone);

  const agentName = displayableAgencyName(listing?.agency_name) || null;
  const agentPhone = listing?.agent_phone ? String(listing.agent_phone).replace(/\D/g, '') : null;
  const message = customerToAgentMessage({ agentName, phrase: visit.phrase, listing });
  const whatsappHref = agentPhone ? buildWhatsAppLink(agentPhone, message) : getCentralWhatsAppHref(message);
  const centralDigits = String(process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || '').replace(/\D/g, '');
  const callHref = agentPhone ? `tel:+${agentPhone}` : centralDigits ? `tel:+${centralDigits}` : null;
  const image = listing ? listingImages(listing)[0] : null;
  const meta = listing
    ? [formatPrice(listing.price, listing.purpose, listing.price_period), agentName || feedLocationLine(listing)].filter(Boolean).join(' · ')
    : null;
  const checkin = needsCheckin(visit, now);

  return (
    <article className="overflow-hidden rounded-card bg-surface shadow-[var(--hairline),var(--shadow-card)]">
      <div className={cn('flex items-center gap-3 px-4 py-3.5', look.tone)}>
        <BandIcon strokeWidth={ICON_STROKE_WIDTH} className={cn('h-6 w-6 flex-none', look.iconTone)} aria-hidden="true" />
        <div className="min-w-0">
          <p className="u-tabular truncate text-base font-extrabold text-ink">{band.main}</p>
          <p className={cn('text-[0.78125rem] font-semibold', look.note)}>{band.note}</p>
        </div>
      </div>

      <div className="flex flex-col gap-3 px-4 pb-4 pt-3">
        {listing ? (
          <Link href={`/listings/${listing.id}`} className="u-press flex items-center gap-3">
            <span className="relative h-[3.25rem] w-[3.25rem] flex-none overflow-hidden rounded-[0.625rem] bg-canvas-deep">
              {image ? <SafeImage src={image} alt="" fill sizes="52px" className="object-cover" /> : null}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-bold text-ink">{listing.title}</span>
              {meta ? <span className="u-tabular block truncate text-[0.8125rem] text-ink-45">{meta}</span> : null}
            </span>
          </Link>
        ) : (
          <p className="text-sm text-ink-45">{t('account.agenda.listingGone')}</p>
        )}

        {visit.tone === 'rescheduled' && open && !expired ? (
          <div className="flex gap-2">
            <CustomerVisitActions viewingId={visit.id} status={visit.status} />
          </div>
        ) : null}

        {visit.tone === 'confirmed' && open ? (
          <>
            <div className="flex gap-2">
              {whatsappHref ? (
                <a href={whatsappHref} target="_blank" rel="noopener noreferrer" className={cn(BTN, 'flex-1 bg-green-ink text-white')}>
                  <WhatsAppIcon className="h-[1.125rem] w-[1.125rem] shrink-0" />
                  {agentPhone ? t('account.agenda.whatsappShort') : t('account.agenda.whatsappLukka')}
                </a>
              ) : null}
              {callHref ? (
                <a href={callHref} className={cn(BTN, 'flex-1 text-ink shadow-[inset_0_0_0_1.5px_var(--ink-25)]')}>
                  <Phone strokeWidth={ICON_STROKE_WIDTH} className="h-[1.0625rem] w-[1.0625rem]" aria-hidden="true" />
                  {t('account.agenda.callShort')}
                </a>
              ) : null}
              {visit.at ? (
                <a
                  href={`/compte/client/visites/${visit.id}/agenda.ics`}
                  aria-label={t('account.agenda.addToCalendar')}
                  title={t('account.agenda.addToCalendar')}
                  className={cn(BTN, 'w-11 flex-none px-0 text-ink shadow-[inset_0_0_0_1.5px_var(--ink-25)]')}
                >
                  <CalendarPlus strokeWidth={ICON_STROKE_WIDTH} className="h-[1.125rem] w-[1.125rem]" aria-hidden="true" />
                </a>
              ) : null}
            </div>
            {compact ? null : (
              <div className="-ml-2.5 flex">
                <CustomerVisitActions viewingId={visit.id} status={visit.status} />
              </div>
            )}
          </>
        ) : null}

        {(visit.tone === 'pending' || (visit.tone === 'rescheduled' && expired)) && open ? (
          <div className="flex items-center gap-2">
            {whatsappHref ? (
              <a href={whatsappHref} target="_blank" rel="noopener noreferrer" className={cn(BTN, 'flex-1 text-green-ink shadow-[inset_0_0_0_1.5px_var(--ink-25)]')}>
                <WhatsAppIcon className="h-[1.125rem] w-[1.125rem] shrink-0" />
                {agentPhone ? t('account.agenda.whatsappShort') : t('account.agenda.whatsappLukka')}
              </a>
            ) : null}
            <CustomerVisitActions viewingId={visit.id} status={expired ? 'PENDING' : visit.status} />
          </div>
        ) : null}

        {checkin ? <VisitCheckin viewingId={visit.id} /> : null}
        {visit.receiptSentAt ? <p className="text-xs text-ink-45">{t('account.agenda.receipt')}</p> : null}
        {!agentPhone && open && listing ? <p className="text-xs text-ink-45">{t('account.agenda.centralNote')}</p> : null}
      </div>
    </article>
  );
}
