import Link from 'next/link';
import { Bell, CalendarClock, CheckCheck, FileCheck2, Mail, MessageCircle } from 'lucide-react';
import AgentPageHeader from '@/components/AgentPageHeader';
import { getCurrentAgentId } from '@/lib/agentSession';
import { getAgentDashboardContext } from '@/lib/agentDashboard';
import { listNotifications } from '@/lib/pushNotifications';
import { parseCursor } from '@/lib/pushRules';
import { chatInboxTime } from '@/lib/chatTime';
import { getLocale, getT } from '@/lib/i18n/server';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { markAllAlertsReadAction } from './actions';

export const dynamic = 'force-dynamic';

// One icon per kind the engine sends (services/pushNotify.js); anything new
// falls back to the bell rather than failing.
const KIND_ICONS = {
  viewing_request: CalendarClock,
  enquiry: Mail,
  chat: MessageCircle,
  listing_verdict: FileCheck2,
};

/**
 * Alertes — every alert the app has pushed (or tried to), newest first: the
 * same text the phone showed, each opening its page through
 * /compte/agent/alertes/<id> (which marks it read). Filled by the engine;
 * an agent without the app still gets their alerts on WhatsApp, and they
 * are listed here too.
 */
export default async function AgentAlertsPage({ searchParams }) {
  const t = await getT();
  const locale = await getLocale();
  const params = await searchParams;
  const before = parseCursor(params.avant);
  const agentId = await getCurrentAgentId();
  const [{ waitingCount }, inbox] = await Promise.all([
    getAgentDashboardContext(agentId),
    listNotifications('agent', agentId, { before }).catch((err) => {
      console.error(`[compte/agent/alertes] inbox read failed: ${err.message}`);
      return { items: [], nextCursor: null, available: false };
    }),
  ]);
  const now = new Date();
  const hasUnread = inbox.items.some((item) => !item.read);

  return (
    <>
      <AgentPageHeader title={t('agent.alerts.title')} newLeadsCount={waitingCount} />

      <div className="flex flex-col gap-4 px-3 py-4 sm:px-8 sm:py-7">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="u-micro text-ink-45">{t('agent.alerts.intro')}</p>
          {hasUnread && (
            <form action={markAllAlertsReadAction}>
              <button
                type="submit"
                className="u-press inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-[0.8125rem] font-bold text-blue-deep"
              >
                <CheckCheck strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
                {t('agent.alerts.markAllRead')}
              </button>
            </form>
          )}
        </div>

        {inbox.items.length === 0 ? (
          <div className="u-card flex flex-col items-center gap-2 rounded-card bg-surface px-4 py-10 text-center">
            <Bell strokeWidth={ICON_STROKE_WIDTH} className="h-8 w-8 text-ink-35" aria-hidden="true" />
            <h2 className="u-title-section text-ink">{t('agent.alerts.emptyTitle')}</h2>
            <p className="u-micro max-w-sm text-ink-45">
              {inbox.available ? t('agent.alerts.empty') : t('agent.alerts.unavailable')}
            </p>
          </div>
        ) : (
          <ul className="u-card divide-y divide-line overflow-hidden rounded-card bg-surface">
            {inbox.items.map((item) => {
              const Icon = KIND_ICONS[item.kind] || Bell;
              return (
                <li key={item.id}>
                  <Link
                    href={`/compte/agent/alertes/${item.id}`}
                    prefetch={false}
                    className={`flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-canvas-alt ${item.read ? '' : 'bg-blue-tint/40'}`}
                  >
                    <span className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full ${item.read ? 'bg-canvas-alt text-ink-45' : 'bg-blue text-white'}`}>
                      <Icon strokeWidth={ICON_STROKE_WIDTH} className="h-[1.125rem] w-[1.125rem]" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-3">
                        <span className={`u-micro-strong truncate ${item.read ? 'text-ink-70' : 'text-ink'}`}>{item.title}</span>
                        <span className="u-tabular shrink-0 text-xs text-ink-45">{chatInboxTime(item.createdAt, now, locale, t)}</span>
                      </span>
                      {item.body && <span className="u-micro mt-0.5 line-clamp-2 block text-ink-70">{item.body}</span>}
                    </span>
                    {!item.read && <span className="sr-only">{t('agent.alerts.unread')}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        {inbox.nextCursor && (
          <Link
            href={`/compte/agent/alertes?avant=${inbox.nextCursor}`}
            className="u-btn-secondary u-press inline-flex h-11 items-center justify-center self-center rounded-lg px-5 text-sm font-bold text-ink"
          >
            {t('agent.alerts.older')}
          </Link>
        )}
      </div>
    </>
  );
}
