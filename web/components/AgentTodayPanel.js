import Link from 'next/link';
import { CalendarDays, CheckCircle2 } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { formatRelativeFr } from '@/lib/format';
import { formatVisitSlot, formatVisitTime } from '@/lib/visitAgenda';
import { TODO_KINDS, TODO_SEE_ALL_HREF } from '@/lib/agentTodo';
import { getLocale, getT } from '@/lib/i18n/server';
import AgentTodayList from './AgentTodayList';

const SEE_ALL_KEY = {
  [TODO_KINDS.VISIT]: 'agent.today.seeAll.visits',
  [TODO_KINDS.LEAD]: 'agent.today.seeAll.leads',
  [TODO_KINDS.LISTING_CONFIRM]: 'agent.today.seeAll.listingsToConfirm',
  [TODO_KINDS.LISTING_INCOMPLETE]: 'agent.today.seeAll.incompleteListings',
};

// Lead rows carry `name`, visit rows `lead_name`; reading only the second is
// what printed a lead's customer as a bare "+4479…" beside their own name.
function customerLabel(row) {
  const name = row?.lead_name || row?.name;
  if (name && /[A-Za-zÀ-ÿ]/.test(name)) return name;
  return row?.lead_wa_id || row?.wa_id ? `+${row.lead_wa_id || row.wa_id}` : null;
}

/**
 * Turns lib/agentTodo.js items into display rows. Runs on the server, so the
 * relative times ("il y a 3 heures") are computed once, here, and the client
 * list never reads the clock during render.
 */
function toRow(item, { t, locale, listingById }) {
  const base = {
    key: item.key,
    kind: item.kind,
    id: item.id,
    overdue: Boolean(item.overdue),
    stale: Boolean(item.stale),
    primary: item.primary,
    secondary: item.secondary || null,
  };

  if (item.kind === TODO_KINDS.VISIT) {
    const v = item.visit;
    const propertyId = v.property_id || v.lead_property_id;
    const listing = propertyId ? listingById.get(String(propertyId)) : null;
    const ago = formatRelativeFr(v.created_at);
    let meta;
    if (item.slotAt && (item.overdue || item.stale)) meta = t('agent.today.meta.slotPassed', { slot: formatVisitSlot(item.slotAt, locale) });
    else if (v.requested_time) meta = t('agent.today.meta.requested', { time: v.requested_time, ago });
    else meta = t('agent.today.meta.requestedNoTime', { ago });
    return {
      ...base,
      title: item.customerName || customerLabel(v) || t('agent.today.unknownCustomer'),
      subtitle: listing?.title || [v.lead_quartier, v.lead_commune].filter(Boolean).join(', ') || null,
      badge: item.stale
        ? t('agent.today.badge.stale')
        : item.overdue
        ? t('agent.today.badge.overdue')
        : v.status === 'RESCHEDULED'
          ? t('agent.today.badge.slotProposed')
          : t('agent.today.badge.unanswered'),
      meta,
      prefillLabel: item.primary.prefill ? formatVisitSlot(item.primary.prefill, locale) : null,
    };
  }

  if (item.kind === TODO_KINDS.LEAD) {
    const l = item.lead;
    const listing = l.property_id ? listingById.get(String(l.property_id)) : null;
    return {
      ...base,
      title: item.customerName || customerLabel(l) || t('agent.today.unknownCustomer'),
      subtitle: listing?.title || l.requirements_summary || [l.quartier, l.commune].filter(Boolean).join(', ') || null,
      badge: t('agent.today.badge.newLead'),
      meta: t('agent.today.meta.leadReceived', { ago: formatRelativeFr(l.created_at) }),
    };
  }

  if (item.kind === TODO_KINDS.LISTING_CONFIRM) {
    const days = Number(item.listing.daysSince);
    return {
      ...base,
      title: item.listing.title || t('agent.today.untitledListing'),
      subtitle: null,
      badge: null,
      meta: Number.isFinite(days)
        ? t('agent.today.meta.lastConfirmed', { count: days })
        : t('agent.today.meta.neverConfirmed'),
    };
  }

  return {
    ...base,
    title: item.listing.title || t('agent.today.untitledListing'),
    subtitle: null,
    badge: null,
    meta: item.listing.gaps.length ? t('agent.today.meta.missing', { gaps: item.listing.gaps.join(', ') }) : null,
  };
}

/**
 * The overview's "À faire aujourd'hui" card. `todo` is lib/agentTodoLoader.js's
 * result. An empty list says so plainly — but only when every source was read;
 * with an engine read down it says the list may be incomplete instead of
 * claiming there is nothing to do.
 */
export default async function AgentTodayPanel({ todo, listingById }) {
  const t = await getT();
  const locale = await getLocale();
  const rows = todo.visible.map((item) => toRow(item, { t, locale, listingById }));
  const seeAll = Object.entries(todo.hiddenByKind).map(([kind, count]) => ({
    kind,
    href: TODO_SEE_ALL_HREF[kind],
    label: t(SEE_ALL_KEY[kind], { count }),
  }));

  return (
    <section aria-labelledby="agent-today-title" className="u-card rounded-card bg-surface p-4 sm:p-6">
      <div className="mb-3.5 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="agent-today-title" className="u-title-card text-ink">
          {t('agent.today.title')}
        </h2>
        {todo.total > 0 && (
          <span className="u-micro text-ink-45">
            {t('agent.today.count', { count: todo.total })}
            {todo.overdueCount > 0 ? ` · ${t('agent.today.overdueCount', { count: todo.overdueCount })}` : ''}
          </span>
        )}
      </div>

      {todo.degraded.length > 0 && (
        <p className="u-micro mb-3 rounded-lg bg-warning-tint px-3 py-2 font-semibold text-warning" role="status">
          {t('agent.today.degraded')}
        </p>
      )}

      {rows.length === 0 ? (
        todo.degraded.length === 0 && (
          <p className="u-micro flex items-center gap-2 text-ink-45">
            <CheckCircle2 strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 text-success" />
            {t('agent.today.empty')}
          </p>
        )
      ) : (
        <AgentTodayList rows={rows} seeAll={seeAll} />
      )}
    </section>
  );
}

/**
 * The same-morning reminder: today's confirmed visits that have not already
 * finished, with their Kinshasa time and place. Renders nothing on a day with
 * no visit — no banner saying "no visits today".
 */
export async function AgentVisitReminderBanner({ visits, listingById }) {
  if (!visits?.length) return null;
  const t = await getT();
  const locale = await getLocale();
  const parts = visits.slice(0, 3).map((v) => {
    const propertyId = v.property_id || v.lead_property_id;
    const listing = propertyId ? listingById.get(String(propertyId)) : null;
    const where = listing?.title || v.lead_commune || customerLabel(v);
    return [formatVisitTime(v.scheduled_at, locale), where].filter(Boolean).join(' · ');
  });

  return (
    <Link
      href="/compte/agent/visites"
      className="u-press flex items-start gap-3 rounded-card border border-blue/20 bg-blue-tint px-4 py-3 text-blue-deep"
    >
      <CalendarDays strokeWidth={ICON_STROKE_WIDTH} className="mt-0.5 h-5 w-5 shrink-0" />
      <span className="min-w-0">
        <span className="u-micro-strong block">{t('agent.agenda.reminder.summary', { count: visits.length })}</span>
        <span className="u-micro block truncate">
          {parts.join(' — ')}
          {visits.length > 3 ? ` — ${t('agent.agenda.reminder.more', { count: visits.length - 3 })}` : ''}
        </span>
      </span>
    </Link>
  );
}
