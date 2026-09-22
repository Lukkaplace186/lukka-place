import Link from 'next/link';
import { CalendarPlus, Clock, MapPin, Navigation, Phone, ArrowRight } from 'lucide-react';
import { getCurrentAgentId } from '@/lib/agentSession';
import { getAgentDashboardContext } from '@/lib/agentDashboard';
import { listViewingRequests } from '@/lib/adminApi';
import { getListingPlaces, visitPropertyId } from '@/lib/agentAgenda';
import {
  directionsUrl,
  formatVisitDay,
  formatVisitTime,
  groupAgenda,
  placeLine,
  slotPhraseFr,
} from '@/lib/visitAgenda';
import { buildWhatsAppLink } from '@/lib/whatsapp';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import AgentPageHeader from '@/components/AgentPageHeader';
import { getLocale, getT } from '@/lib/i18n/server';

/**
 * The agent's visit agenda: CONFIRMED visits by Kinshasa day, a seven-day
 * strip, and per visit the customer, the place, "Itinéraire" and "Ajouter à
 * mon agenda" (.ics, ./[id]/agenda.ics/route.js).
 *
 * This route used to redirect into Demandes' Visites tab, which still holds
 * every REQUEST (pending, rescheduled, declined…) with its answer buttons.
 * This page is the other half: what has been agreed and where to be. The two
 * link to each other; an old bookmark to /compte/agent/visites now lands on
 * the agenda, which is what "Visites" means once a visit is booked.
 *
 * Only a visit with a real `scheduled_at` is placed on a day. A confirmed
 * visit without one (confirmed before the dashboard asked for a time, or on
 * WhatsApp without one) is listed apart as "heure à fixer", never put on the
 * day the customer's phrase happens to name.
 */
export default async function AgentVisitAgendaPage() {
  const t = await getT();
  const locale = await getLocale();
  const now = new Date();

  const agentId = await getCurrentAgentId();
  const { listingById, leadScope, hasLeadScope, newLeadsCount, pendingVisitsCount } =
    await getAgentDashboardContext(agentId);

  let visits = [];
  let failed = false;
  if (hasLeadScope) {
    try {
      ({ data: visits } = await listViewingRequests({ ...leadScope, status: 'CONFIRMED', limit: 100 }));
    } catch (err) {
      console.error(`[agenda] confirmed visits for agent #${agentId} failed: ${err.message}`);
      failed = true;
    }
  }

  let places = new Map();
  try {
    places = await getListingPlaces(agentId, visits.map(visitPropertyId));
  } catch (err) {
    // Directions are a convenience; the agenda still renders without them.
    console.error(`[agenda] listing places for agent #${agentId} failed: ${err.message}`);
  }

  const agenda = groupAgenda(visits, now);

  function describe(visit) {
    const propertyId = visitPropertyId(visit);
    const place = propertyId ? places.get(String(propertyId)) : null;
    const listing = propertyId ? listingById.get(String(propertyId)) : null;
    return {
      title: listing?.title || place?.title || [visit.lead_quartier, visit.lead_commune].filter(Boolean).join(', ') || null,
      place: place ? placeLine(place) : null,
      directions: place ? directionsUrl(place) : null,
    };
  }

  function renderVisit(visit, scheduled) {
    const { title, place, directions } = describe(visit);
    const phone = String(visit.lead_wa_id || '').replace(/\D/g, '');
    // Always French: the customer reads it (same rule as lib/listingShareCopy.js).
    const message = scheduled
      ? `Bonjour, je vous contacte via Lukka Place au sujet de votre visite du ${slotPhraseFr(visit.scheduled_at)}.`
      : 'Bonjour, je vous contacte via Lukka Place au sujet de votre visite.';
    const action =
      'u-press inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-line px-3 text-[0.8125rem] font-semibold text-ink hover:bg-canvas-alt sm:flex-none';

    return (
      <li key={visit.id} className="u-card rounded-card bg-surface p-4">
        <div className="flex items-start gap-3.5">
          <div className="w-14 shrink-0 text-center">
            {scheduled ? (
              <span className="u-tabular block text-lg font-extrabold text-ink">{formatVisitTime(visit.scheduled_at, locale)}</span>
            ) : (
              <Clock strokeWidth={ICON_STROKE_WIDTH} className="mx-auto h-5 w-5 text-warning" aria-hidden="true" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="u-micro-strong truncate text-ink">{visit.lead_name || (phone ? `+${phone}` : t('agent.today.unknownCustomer'))}</div>
            {title && <div className="u-micro truncate text-ink-70">{title}</div>}
            {place && (
              <div className="u-micro mt-0.5 flex items-start gap-1 text-ink-45">
                <MapPin strokeWidth={ICON_STROKE_WIDTH} className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0">{place}</span>
              </div>
            )}
            {!scheduled && (
              <div className="u-micro mt-0.5 text-warning">
                {visit.requested_time
                  ? t('agent.agenda.unscheduledAsked', { time: visit.requested_time })
                  : t('agent.agenda.unscheduledNoTime')}
              </div>
            )}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {scheduled && (
            <a href={`/compte/agent/visites/${visit.id}/agenda.ics`} download className={action}>
              <CalendarPlus strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
              {t('agent.agenda.addToCalendar')}
            </a>
          )}
          {directions && (
            <a href={directions} target="_blank" rel="noopener noreferrer" className={action}>
              <Navigation strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
              {t('agent.agenda.directions')}
            </a>
          )}
          {phone && (
            <a href={buildWhatsAppLink(phone, message)} target="_blank" rel="noopener noreferrer" className={action}>
              <Phone strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
              {t('agent.agenda.contactCustomer')}
            </a>
          )}
          {!scheduled && (
            <Link href="/compte/agent/demandes?tab=visites" className={action}>
              {t('agent.agenda.setTime')}
            </Link>
          )}
        </div>
      </li>
    );
  }

  const hasAnything = agenda.days.length > 0 || agenda.unscheduled.length > 0 || agenda.past.length > 0;

  return (
    <>
      <AgentPageHeader title={t('agent.agenda.title')} newLeadsCount={newLeadsCount} />

      <div className="flex flex-col gap-5 px-3 py-4 sm:px-8 sm:py-7">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="u-micro text-ink-45">{t('agent.agenda.intro')}</p>
          <Link
            href="/compte/agent/demandes?tab=visites"
            className="u-micro inline-flex min-h-10 items-center gap-1 font-semibold text-blue-deep hover:underline"
          >
            {pendingVisitsCount > 0
              ? t('agent.agenda.pendingRequests', { count: pendingVisitsCount })
              : t('agent.agenda.allRequests')}
            <ArrowRight strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
          </Link>
        </div>

        {/* Seven days from today, each with its real count; a day links to its
            section when it has one. */}
        <nav aria-label={t('agent.agenda.weekLabel')} className="grid grid-cols-7 gap-1">
          {agenda.week.map((day) => {
            const body = (
              <>
                <span className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em]">
                  {new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'fr-FR', { timeZone: 'Africa/Kinshasa', weekday: 'short' }).format(day.startsAt + 12 * 3600000)}
                </span>
                <span className="u-tabular text-base font-extrabold">{Number(day.key.slice(8, 10))}</span>
                <span className={`h-1.5 w-1.5 rounded-full ${day.count > 0 ? 'bg-blue' : 'bg-transparent'}`} aria-hidden="true" />
                <span className="sr-only">{t('agent.agenda.dayCount', { count: day.count })}</span>
              </>
            );
            const cls = `flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-lg border py-1.5 ${
              day.isToday ? 'border-blue bg-blue-tint text-blue-deep' : 'border-line bg-surface text-ink-70'
            }`;
            return day.count > 0 ? (
              <a key={day.key} href={`#jour-${day.key}`} className={`u-press ${cls}`}>
                {body}
              </a>
            ) : (
              <div key={day.key} className={cls}>
                {body}
              </div>
            );
          })}
        </nav>

        {failed && (
          <p className="u-micro rounded-lg bg-warning-tint px-4 py-3 font-semibold text-warning" role="status">
            {t('agent.agenda.loadFailed')}
          </p>
        )}

        {!failed && !hasAnything && (
          <div className="u-card rounded-card bg-surface px-6 py-12 text-center">
            <p className="u-micro text-ink-45">{t('agent.agenda.empty')}</p>
          </div>
        )}

        {agenda.days.map((day) => (
          <section key={day.key} id={`jour-${day.key}`} aria-labelledby={`jour-${day.key}-title`} className="scroll-mt-24">
            <h2 id={`jour-${day.key}-title`} className="u-title-sub mb-2.5 text-ink first-letter:uppercase">
              {day.isToday ? `${t('agent.agenda.today')} · ` : ''}
              {formatVisitDay(day.startsAt + 12 * 3600000, locale)}
            </h2>
            <ul className="flex flex-col gap-2.5">
              {day.visits.map((visit) => (
                renderVisit(visit, true)
              ))}
            </ul>
          </section>
        ))}

        {agenda.unscheduled.length > 0 && (
          <section aria-labelledby="agenda-unscheduled-title">
            <h2 id="agenda-unscheduled-title" className="u-title-sub mb-1 text-ink">
              {t('agent.agenda.unscheduledHeading')}
            </h2>
            <p className="u-micro mb-2.5 text-ink-45">{t('agent.agenda.unscheduledHint')}</p>
            <ul className="flex flex-col gap-2.5">
              {agenda.unscheduled.map((visit) => (
                renderVisit(visit, false)
              ))}
            </ul>
          </section>
        )}

        {agenda.past.length > 0 && (
          <details className="group">
            <summary className="u-micro-strong inline-flex min-h-10 cursor-pointer items-center text-ink-70">
              {t('agent.agenda.pastHeading', { count: Math.min(agenda.past.length, 10) })}
            </summary>
            <ul className="mt-2 flex flex-col gap-2.5">
              {agenda.past.slice(0, 10).map((visit) => (
                <li key={visit.id} className="u-micro flex flex-wrap gap-x-2 rounded-lg border border-line bg-surface px-3 py-2 text-ink-70">
                  <span className="u-tabular font-semibold text-ink">
                    {formatVisitDay(visit.scheduled_at, locale, { long: false })} · {formatVisitTime(visit.scheduled_at, locale)}
                  </span>
                  <span className="truncate">{visit.lead_name || describe(visit).title}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </>
  );
}
