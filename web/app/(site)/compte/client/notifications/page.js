import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Bell, CalendarClock, CheckCheck, Heart, MessageCircle, Search } from 'lucide-react';
import { PortalEmpty } from '@/components/ClientPortalUI';
import { getPortalCustomer } from '@/lib/customerPortal';
import { listNotifications } from '@/lib/pushNotifications';
import { parseCursor } from '@/lib/pushRules';
import { chatInboxTime } from '@/lib/chatTime';
import { getLocale, getT } from '@/lib/i18n/server';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { markAllCustomerNotificationsReadAction } from './actions';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('account.notifications.metaTitle'), robots: { index: false, follow: false } };
}

export const dynamic = 'force-dynamic';

// An icon per kind the engine sends for customers; anything new gets the bell.
const KIND_ICONS = {
  visit: CalendarClock,
  chat: MessageCircle,
  search_alert: Search,
  price_drop: Heart,
};

/**
 * Notifications — every alert the app sent this customer, newest first,
 * each opening its page through /compte/client/notifications/<id> (which
 * marks it read). Not "Alertes": that tab already holds saved searches.
 * Filled by the engine (services/pushNotify.js); a customer without the app
 * still gets WhatsApp, as before.
 */
export default async function CustomerNotificationsPage({ searchParams }) {
  const t = await getT();
  const locale = await getLocale();
  const session = await getPortalCustomer();
  if (!session) redirect('/compte/connexion?next=/compte/client/notifications');
  const before = parseCursor((await searchParams)?.avant);
  const inbox = await listNotifications('customer', session.customerId, { before }).catch((err) => {
    console.error(`[compte/client/notifications] inbox read failed: ${err.message}`);
    return { items: [], nextCursor: null, available: false };
  });
  const now = new Date();
  const hasUnread = inbox.items.some((item) => !item.read);

  return (
    <div className="mx-auto flex max-w-[45rem] flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="u-title-page text-ink">{t('account.notifications.title')}</h1>
        {hasUnread && (
          <form action={markAllCustomerNotificationsReadAction}>
            <button
              type="submit"
              className="u-press inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-[0.8125rem] font-bold text-blue-deep"
            >
              <CheckCheck strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
              {t('account.notifications.markAllRead')}
            </button>
          </form>
        )}
      </div>

      {inbox.items.length === 0 ? (
        <PortalEmpty icon={Bell} title={t('account.notifications.emptyTitle')}>
          {inbox.available ? t('account.notifications.empty') : t('account.notifications.unavailable')}
        </PortalEmpty>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-card bg-surface shadow-[var(--hairline)]">
          {inbox.items.map((item) => {
            const Icon = KIND_ICONS[item.kind] || Bell;
            return (
              <li key={item.id}>
                <Link
                  href={`/compte/client/notifications/${item.id}`}
                  prefetch={false}
                  className={`flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-canvas-alt ${item.read ? '' : 'bg-blue-tint/40'}`}
                >
                  <span className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full ${item.read ? 'bg-canvas-alt text-ink-45' : 'bg-blue text-white'}`}>
                    <Icon strokeWidth={ICON_STROKE_WIDTH} className="h-[1.125rem] w-[1.125rem]" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className={`truncate text-[0.90625rem] font-semibold ${item.read ? 'text-ink-70' : 'text-ink'}`}>{item.title}</span>
                      <span className="u-tabular shrink-0 text-xs text-ink-45">{chatInboxTime(item.createdAt, now, locale, t)}</span>
                    </span>
                    {item.body && <span className="mt-0.5 line-clamp-2 block text-[0.8125rem] text-ink-70">{item.body}</span>}
                  </span>
                  {!item.read && <span className="sr-only">{t('account.notifications.unread')}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {inbox.nextCursor && (
        <Link
          href={`/compte/client/notifications?avant=${inbox.nextCursor}`}
          className="u-btn-secondary u-press inline-flex h-11 items-center justify-center self-center rounded-lg px-5 text-sm font-bold text-ink"
        >
          {t('account.notifications.older')}
        </Link>
      )}
    </div>
  );
}
