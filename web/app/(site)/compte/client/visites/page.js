import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CalendarClock } from 'lucide-react';
import { PortalEmpty } from '@/components/ClientPortalUI';
import { getPortalCustomer } from '@/lib/customerPortal';
import { getCustomerInquiries } from '@/lib/customerInquiries';
import { groupCustomerVisits } from '@/lib/customerAgenda';
import { isAwaitingCustomer } from '@/lib/clientPortalView';
import { getLocale, getT } from '@/lib/i18n/server';
import VisitCard from './VisitCard';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('account.agenda.metaTitle'), robots: { index: false, follow: false } };
}

export const dynamic = 'force-dynamic';

/**
 * The customer's visits (2026-10-05 redesign): "À répondre" first — a slot
 * the agent proposed, which only the customer can accept — then Aujourd'hui /
 * Demain / À venir / Heure à préciser / Passées (lib/customerAgenda.js).
 *
 * Each card opens with its time band (VisitCard.js): amber proposed, green
 * confirmed, blue waiting, grey past. Accept / cancel / check-in are the
 * Messages tab's engine calls. No directions: the exact position stays with
 * the agent until they share it.
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
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="u-title-page text-ink">{t('account.agenda.title')}</h1>
          <p className="mt-1 text-[0.8125rem] text-ink-45">{t('account.agenda.lead')}</p>
        </div>
        <Link href="/compte/client/messages" className="u-micro-strong inline-flex min-h-11 shrink-0 items-center text-blue hover:underline">
          {t('account.agenda.toMessages')}
        </Link>
      </div>

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
