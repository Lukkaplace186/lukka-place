import Link from 'next/link';
import {
  AlertTriangle, BellRing, CalendarClock, FileText, Hand, Landmark, Lock, PauseCircle, Send, ShieldQuestion,
} from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { can } from '@/lib/adminRoles';
import { getWorkQueueCounts } from '@/lib/adminWorkQueues';
import { getT } from '@/lib/i18n/server';
import { ErrorNote } from '../LeadRoutingUI';

function waited(iso, t) {
  if (!iso) return null;
  const hours = Math.round((Date.now() - new Date(iso).getTime()) / 3600000);
  return hours < 48 ? t('admin.queues.oldestHours', { count: Math.max(hours, 0) }) : t('admin.queues.oldestDays', { count: Math.round(hours / 24) });
}

/**
 * "What needs doing right now" — the top of the console. Each card is a real
 * count that links straight into the filtered queue where the work is done,
 * shown only to roles that may act on it. Urgent queues turn red when not empty.
 */
export default async function WorkQueues({ role }) {
  const t = await getT();
  const counts = await getWorkQueueCounts({ fresh: true });

  const cards = [
    { key: 'pendingListings', icon: FileText, href: '/admin/listings', permission: 'listings.moderate', urgent: true, hint: waited(counts.oldestPendingAt, t) },
    { key: 'escalatedViewings', icon: AlertTriangle, href: '/admin/viewings?status=ESCALATED', permission: 'viewings.manage', urgent: true },
    { key: 'awaitingAgent', icon: BellRing, href: '/admin/telemetry', permission: 'viewings.manage' },
    { key: 'humanConversations', icon: Hand, href: '/admin/conversations?ai=0', permission: 'conversations.reply', urgent: true },
    { key: 'failedPushes24h', icon: Send, href: '/admin/matching?days=7&status=FAILED', permission: 'leads.view', urgent: true },
    { key: 'pendingPlanRequests', icon: Landmark, href: '/admin/subscriptions', permission: 'billing.manage' },
    { key: 'expiringMemberships', icon: CalendarClock, href: '/admin/billing?view=expiring', permission: 'billing.view' },
    { key: 'unverifiedAgents', icon: ShieldQuestion, href: '/admin/agents?verified=no&status=1', permission: 'agents.manage' },
    { key: 'lockedCustomers', icon: Lock, href: '/admin/customers?status=locked', permission: 'customers.manage' },
    { key: 'suspendedListings', icon: PauseCircle, href: '/admin/listings?status=suspended', permission: 'listings.moderate' },
  ].filter((card) => can(role, card.permission));

  return (
    <section className="mb-8 flex flex-col gap-3">
      <h2 className="u-title-section text-ink">{t('admin.queues.title')}</h2>
      {counts.postgresError || counts.engineError ? (
        <ErrorNote>{t('admin.queues.partial', { error: counts.postgresError || counts.engineError })}</ErrorNote>
      ) : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {cards.map(({ key, icon: Icon, href, urgent, hint }) => {
          const value = counts[key];
          const hot = urgent && Number(value) > 0;
          return (
            <Link
              key={key}
              href={href}
              className={`u-card group flex flex-col gap-1 rounded-card border p-4 transition-colors ${
                hot ? 'border-danger/40 bg-danger-tint hover:border-danger' : 'border-transparent bg-surface hover:border-blue'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={`u-eyebrow ${hot ? 'text-danger' : 'text-ink-45'}`}>{t(`admin.queues.${key}`)}</span>
                <Icon strokeWidth={ICON_STROKE_WIDTH} className={`h-4 w-4 ${hot ? 'text-danger' : 'text-ink-35'}`} />
              </div>
              <span className={`u-stat ${hot ? 'text-danger' : 'text-ink'}`}>{value == null ? '—' : Number(value).toLocaleString('fr-FR')}</span>
              {hint && Number(value) > 0 ? <span className="u-micro text-ink-70">{hint}</span> : null}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
