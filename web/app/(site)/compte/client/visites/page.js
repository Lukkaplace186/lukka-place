import { redirect } from 'next/navigation';
import { CalendarClock, Check } from 'lucide-react';
import { PortalEmpty } from '@/components/ClientPortalUI';
import { getPortalCustomer } from '@/lib/customerPortal';
import { getCustomerInquiries } from '@/lib/customerInquiries';
import { groupCustomerVisits } from '@/lib/customerAgenda';
import { isAwaitingCustomer } from '@/lib/clientPortalView';
import { getLocale, getT } from '@/lib/i18n/server';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import VisitCard from './VisitCard';
import ActivitySubTabs, { activityCounts } from '../ActivitySubTabs';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('account.agenda.metaTitle'), robots: { index: false, follow: false } };
}

export const dynamic = 'force-dynamic';

// The booking dialog's own error codes (app/(site)/listings/[id]/actions.js).
const VISIT_ERROR_KEYS = {
  phone: 'enquiry.errors.phone',
  time: 'enquiry.errors.time',
  closed: 'enquiry.errors.closed',
};

/**
 * Activité › Visites — the customer's visits (2026-10-05 redesign): "À répondre" first — a slot
 * the agent proposed, which only the customer can accept — then Aujourd'hui /
 * Demain / À venir / Heure à préciser / Passées (lib/customerAgenda.js).
 *
 * Each card opens with its time band (VisitCard.js): amber proposed, green
 * confirmed, blue waiting, grey past. Accept / cancel / check-in are the
 * Messages tab's engine calls. No directions: the exact position stays with
 * the agent until they share it.
 *
 * `?visit_sent=1` / `?visit_error=` come from a booking made on the saved
 * listings board, which answers here because this is where the request now is.
 */
export default async function VisitesPage({ searchParams }) {
  const portal = await getPortalCustomer();
  if (!portal) redirect('/compte/connexion?next=/compte/client/visites');
  const t = await getT();
  const locale = await getLocale();
  const params = await searchParams;
  const visitSent = params?.visit_sent === '1';
  const visitError = typeof params?.visit_error === 'string' ? params.visit_error : null;

  let inquiries = [];
  let unavailable = false;
  try {
    inquiries = await getCustomerInquiries(portal.customerId);
  } catch (err) {
    console.warn('[compte/client/visites] inquiries unavailable:', err.message);
    unavailable = true;
  }
  const now = new Date();
  const groups = groupCustomerVisits(inquiries, now);
  const answer = groups.unscheduled.filter((v) => isAwaitingCustomer(v, now));
  const sections = [
    ['answer', answer],
    ['today', groups.today],
    ['tomorrow', groups.tomorrow],
    ['upcoming', groups.upcoming],
    ['unscheduled', groups.unscheduled.filter((v) => !isAwaitingCustomer(v, now))],
    ['past', groups.past.slice(0, 20)],
  ].filter(([, items]) => items.length);
  const total = sections.reduce((n, [, items]) => n + items.length, 0);

  return (
    <div className="mx-auto flex max-w-[45rem] flex-col gap-6">
      <div>
        <h1 className="u-title-page mb-4 text-ink sm:mb-6">{t('account.activity.title')}</h1>
        <ActivitySubTabs view="visites" counts={unavailable ? null : activityCounts(inquiries)} />
        <p className="-mt-1 text-[0.8125rem] text-ink-45 sm:-mt-3">{t('account.agenda.lead')}</p>
      </div>

      {visitSent ? (
        <p role="status" className="flex items-start gap-2.5 rounded-md bg-success-tint px-4 py-3 text-[0.875rem] font-medium text-success">
          <Check strokeWidth={ICON_STROKE_WIDTH} className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {t('account.agenda.sent')}
        </p>
      ) : null}
      {visitError ? (
        <p role="alert" className="rounded-md bg-danger-tint px-4 py-3 text-[0.875rem] font-semibold text-danger">
          {t(VISIT_ERROR_KEYS[visitError] || 'enquiry.errors.failed')}
        </p>
      ) : null}

      {unavailable ? (
        <p className="rounded-xl bg-warning-tint px-4 py-3 text-sm text-warning-ink" role="alert">{t('account.agenda.unavailable')}</p>
      ) : null}

      {!unavailable && total === 0 ? (
        <PortalEmpty icon={CalendarClock} title={t('account.agenda.emptyTitle')} actionLabel={t('account.agenda.emptyAction')} actionHref="/listings">
          {t('account.agenda.emptyBody')}
        </PortalEmpty>
      ) : null}

      {sections.map(([key, items]) => (
        <section key={key} aria-labelledby={`visits-${key}`}>
          <h2 id={`visits-${key}`} className="u-eyebrow mb-2 ml-0.5 text-ink-45">{t(`account.agenda.groups.${key}`)}</h2>
          <ul className="u-stagger flex flex-col gap-3">
            {items.map((visit) => (
              <li key={visit.id}>
                <VisitCard visit={visit} t={t} locale={locale} past={key === 'past'} now={now} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
