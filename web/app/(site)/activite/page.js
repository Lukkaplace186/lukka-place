import Link from '@/components/LocaleLink';
import { Activity, Bell, CalendarClock, Check, CheckCheck, Heart, MessageCircle, Search, Video } from 'lucide-react';
import SafeImage from '@/components/SafeImage';
import { getPortalCustomer } from '@/lib/customerPortal';
import { getCustomerInquiries } from '@/lib/customerInquiries';
import { groupCustomerVisits } from '@/lib/customerAgenda';
import { isAwaitingCustomer } from '@/lib/clientPortalView';
import { listNotifications } from '@/lib/pushNotifications';
import { chatInboxTime } from '@/lib/chatTime';
import { listingImages, locationLine } from '@/lib/listingView';
import { groupByDay, leadVisit, visitSteps } from '@/lib/appActivityRules';
import { getLocale, getT } from '@/lib/i18n/server';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { markAllCustomerNotificationsReadAction } from '../compte/client/notifications/actions';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('appShell.activity.title'), robots: { index: false, follow: false } };
}

export const dynamic = 'force-dynamic';

// An icon per kind the engine sends for customers; anything new gets the bell.
const KIND_ICONS = { visit: CalendarClock, chat: MessageCircle, search_alert: Search, price_drop: Heart };

/**
 * Activité — the app's third tab (the owner's app design, 2026-11-13): what
 * is happening for this customer, in one place. The visit that needs them
 * first leads, with its four steps; under it, every alert the app sent them,
 * newest first, by day.
 *
 * Nothing new is stored or sent: the visit comes from the same engine rows
 * as "Mes visites" (lib/customerInquiries.js) and the feed is the
 * notifications inbox (lib/pushNotifications.js), each row opening through
 * /compte/client/notifications/<id>, which marks it read. Either source being
 * unreachable leaves its part out and the rest of the screen stands.
 *
 * Signed out, the tab says what will arrive here and offers to sign in: it
 * never redirects, a tab has to open.
 */
export default async function ActivityPage() {
  const t = await getT();
  const locale = await getLocale();
  const session = await getPortalCustomer();

  if (!session) {
    return (
      <div className="mx-auto max-w-lg px-5 pb-10 pt-8">
        <h1 className="u-title-hero text-ink">{t('appShell.activity.title')}</h1>
        <div className="mt-6 rounded-card bg-surface p-5 shadow-[var(--shadow-card)]">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-tint text-blue-deep">
            <Activity strokeWidth={ICON_STROKE_WIDTH} className="h-6 w-6" aria-hidden="true" />
          </span>
          <h2 className="mt-4 text-[1.0625rem] font-bold text-ink">{t('appShell.activity.guestTitle')}</h2>
          <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-ink-70">{t('appShell.activity.guestText')}</p>
          <Link
            href="/compte/connexion?next=/activite"
            className="u-press u-btn-primary mt-5 flex h-12 w-full items-center justify-center rounded-xl bg-blue text-[0.9375rem] font-semibold text-white"
          >
            {t('common.actions.login')}
          </Link>
        </div>
      </div>
    );
  }

  const now = new Date();
  const [inquiries, inbox] = await Promise.all([
    getCustomerInquiries(session.customerId).catch((err) => {
      console.warn('[activite] visits unavailable:', err.message);
      return null;
    }),
    listNotifications('customer', session.customerId).catch((err) => {
      console.error(`[activite] inbox read failed: ${err.message}`);
      return { items: [], nextCursor: null, available: false };
    }),
  ]);
  const groups = inquiries ? groupCustomerVisits(inquiries, now) : null;
  const answer = groups ? groups.unscheduled.filter((v) => isAwaitingCustomer(v, now)) : [];
  const visit = leadVisit(groups, answer);
  const days = groupByDay(inbox.items, now);
  const hasUnread = inbox.items.some((item) => !item.read);
  const dayLabel = (day) => {
    if (day === 'today' || day === 'yesterday') return t(`appShell.activity.${day}`);
    return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));
  };

  return (
    <div className="mx-auto max-w-lg pb-8 pt-6">
      <div className="flex items-center justify-between gap-3 px-5">
        <h1 className="u-title-hero text-ink">{t('appShell.activity.title')}</h1>
        {hasUnread ? (
          <form action={markAllCustomerNotificationsReadAction}>
            <button type="submit" className="u-press inline-flex min-h-11 items-center gap-1.5 rounded-lg px-1 text-[0.8125rem] font-semibold text-blue-deep">
              <CheckCheck strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
              {t('account.notifications.markAllRead')}
            </button>
          </form>
        ) : null}
      </div>

      {visit ? <LeadVisit visit={visit} awaiting={answer.includes(visit)} t={t} /> : null}

      {days.length === 0 ? (
        <div className="mx-4 mt-5 rounded-card bg-surface p-5 text-center shadow-[var(--shadow-card)]">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-canvas-deep text-ink-70">
            <Bell strokeWidth={ICON_STROKE_WIDTH} className="h-6 w-6" aria-hidden="true" />
          </span>
          <h2 className="mt-3 text-[1rem] font-semibold text-ink">{t('account.notifications.emptyTitle')}</h2>
          <p className="mt-1 text-[0.875rem] leading-relaxed text-ink-70">
            {inbox.available === false ? t('account.notifications.unavailable') : t('account.notifications.empty')}
          </p>
        </div>
      ) : (
        days.map(({ day, items }) => (
          <section key={day} className="mt-6">
            <h2 className="px-5 text-[0.8125rem] font-semibold text-ink-45">{dayLabel(day)}</h2>
            <ul className="mt-2 divide-y divide-line border-y border-line bg-surface">
              {items.map((item) => {
                const Icon = KIND_ICONS[item.kind] || Bell;
                return (
                  <li key={item.id}>
                    <Link
                      href={`/compte/client/notifications/${item.id}`}
                      prefetch={false}
                      className={`flex items-start gap-3.5 px-5 py-4 active:bg-canvas-alt ${item.read ? '' : 'bg-canvas-alt/70'}`}
                    >
                      <span className={`mt-0.5 flex h-10 w-10 flex-none items-center justify-center rounded-full ${item.read ? 'bg-canvas-deep text-ink-70' : 'bg-blue-tint text-blue-deep'}`}>
                        <Icon strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={`block text-[0.9375rem] leading-snug ${item.read ? 'font-semibold text-ink-70' : 'font-bold text-ink'}`}>{item.title}</span>
                        {item.body ? <span className="mt-0.5 line-clamp-3 block text-[0.875rem] leading-snug text-ink-70">{item.body}</span> : null}
                        <span className="u-tabular mt-1 block text-[0.75rem] text-ink-45">{chatInboxTime(item.createdAt, now, locale, t)}</span>
                      </span>
                      {item.read ? null : (
                        <span className="mt-2 h-2.5 w-2.5 flex-none rounded-full bg-blue">
                          <span className="sr-only">{t('account.notifications.unread')}</span>
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}

      {inbox.nextCursor ? (
        <div className="mt-5 flex justify-center">
          <Link href={`/compte/client/notifications?avant=${inbox.nextCursor}`} className="u-press inline-flex h-11 items-center rounded-lg px-5 text-[0.875rem] font-semibold text-blue-deep">
            {t('account.notifications.older')}
          </Link>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The visit that needs the customer first. Royal, because it is the one
 * thing on this screen they are waiting on. The two buttons open the visit
 * in "Mes visites", where answering, writing to the agent and changing the
 * time already live (VisitCard): nothing is duplicated here.
 */
function LeadVisit({ visit, awaiting, t }) {
  const listing = visit.listing || null;
  const photo = listing ? listingImages(listing)[0] : null;
  const where = listing ? locationLine(listing) : null;
  const steps = visitSteps(visit);
  const lastDone = steps.reduce((last, step, index) => (step.state === 'done' ? index : last), 0);

  return (
    <section className="mx-4 mt-4 rounded-card bg-blue-deep p-4 text-white shadow-[var(--shadow-md)]">
      <div className="flex items-center gap-3">
        {photo ? (
          <span className="relative h-14 w-14 flex-none overflow-hidden rounded-xl bg-blue-900">
            <SafeImage src={photo} alt="" fill sizes="56px" className="object-cover" />
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[0.8125rem] text-white/75">
            {visit.mode === 'video' ? <Video strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" /> : null}
            {t(awaiting ? 'appShell.activity.visitAnswer' : visit.mode === 'video' ? 'appShell.activity.visitLabelVideo' : 'appShell.activity.visitLabel')}
          </p>
          <p className="text-[1.25rem] font-bold leading-tight">{visit.phrase || t('appShell.activity.timeToConfirm')}</p>
          {listing?.title || where ? <p className="mt-0.5 truncate text-[0.875rem] text-white/85">{[listing?.title, where].filter(Boolean).join(' · ')}</p> : null}
        </div>
      </div>

      <ol className="mt-4 grid grid-cols-4">
        {steps.map((step, index) => (
          <li key={step.key} className="relative flex flex-col items-start">
            {index < steps.length - 1 ? (
              <span aria-hidden="true" className={`absolute left-5 right-0 top-2.5 h-0.5 ${index < lastDone ? 'bg-white' : 'bg-white/30'}`} />
            ) : null}
            <span
              className={`relative flex h-5 w-5 items-center justify-center rounded-full border-2 ${
                step.state === 'done' ? 'border-white bg-white text-blue-deep' : step.state === 'current' ? 'border-white bg-blue-deep' : 'border-white/45 bg-blue-deep'
              }`}
            >
              {step.state === 'done' ? <Check strokeWidth={3} className="h-3 w-3" aria-hidden="true" /> : null}
            </span>
            <span className={`mt-1.5 pr-1 text-[0.75rem] leading-tight ${step.state === 'upcoming' ? 'text-white/65' : 'font-semibold text-white'}`}>
              {t(`appShell.activity.steps.${step.key}`)}
            </span>
          </li>
        ))}
      </ol>

      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <Link
          href={`/compte/client/visites?visite=${visit.id}`}
          className="u-press flex h-11 items-center justify-center rounded-xl bg-white px-3 text-[0.875rem] font-semibold text-blue-deep"
        >
          {t(awaiting ? 'appShell.activity.answer' : 'appShell.activity.seeVisit')}
        </Link>
        <Link
          href="/compte/client/visites"
          className="u-press flex h-11 items-center justify-center rounded-xl border-[1.5px] border-white/70 px-3 text-[0.875rem] font-semibold text-white"
        >
          {t('appShell.activity.allVisits')}
        </Link>
      </div>
    </section>
  );
}
