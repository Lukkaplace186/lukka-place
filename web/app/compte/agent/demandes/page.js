import Link from 'next/link';
import { getCurrentAgentId } from '@/lib/agentSession';
import { getAgentDashboardContext } from '@/lib/agentDashboard';
import { listLeads, listViewingRequests } from '@/lib/adminApi';
import { LEAD_STATUSES, LEAD_STATUS_LABEL_KEYS, VIEWING_REQUEST_STATUS_LABEL_KEYS } from '@/lib/adminLabels';
import { formatRelative } from '@/lib/format';
import { buildAgentInbox, inboxFilterFromParams, inboxSeenStamp } from '@/lib/agentInbox';
import AgentPageHeader from '@/components/AgentPageHeader';
import AgentLeadCard from '@/components/AgentLeadCard';
import AgentVisitRequestCard from '@/components/AgentVisitRequestCard';
import { updateAgentLeadStatusAction, replyToLeadAction } from '../actions';
import { getLocale, getT } from '@/lib/i18n/server';
import { QuickRepliesProvider } from '@/components/AgentQuickReplies';
import InboxSeenMarker from '@/components/InboxSeenMarker';
import { listQuickReplies, getQuickReplyListings } from '@/lib/quickReplies';

// `labelKey`, resolved at render — a module constant cannot hold translated
// text (see components/navItems.js).
const STATUS_OPTIONS = LEAD_STATUSES.map((value) => ({ value, labelKey: LEAD_STATUS_LABEL_KEYS[value] }));

const FILTERS = [
  { value: '', labelKey: 'agent.inbox.filters.all', count: 'all' },
  { value: 'a-traiter', labelKey: 'agent.inbox.filters.waiting', count: 'a-traiter' },
  { value: 'confirmees', labelKey: 'agent.inbox.filters.confirmed', count: 'confirmees' },
  { value: 'traitees', labelKey: 'agent.inbox.filters.done', count: 'traitees' },
];

function budgetText(lead, t) {
  const amount = (value) => Number(value).toLocaleString('fr-FR');
  const min = lead.price_min != null ? amount(lead.price_min) : null;
  const max = lead.price_max != null ? amount(lead.price_max) : null;
  if (min && max) return t('agent.inbox.budget.range', { min, max });
  if (max) return t('agent.inbox.budget.upTo', { max });
  if (min) return t('agent.inbox.budget.from', { min });
  return null;
}

/**
 * Demandes — ONE inbox (2026-10-06 redesign, product direction). Enquiries
 * and visit requests used to be two sub-tabs ("Mes demandes" / "Visites"), so
 * an agent checked two lists for one customer, and each card stacked up to
 * six buttons. Now:
 *
 *   - one list from both engine reads, a web visit request shown once (its
 *     lead is folded into the visit — lib/agentInbox.js, the rule the to-do
 *     list already uses);
 *   - filter pills Toutes · À traiter · Confirmées · Traitées, counted;
 *     what waits on the agent first, then confirmed visits soonest first,
 *     then the handled ones;
 *   - each card one primary action + call + "···" (AgentVisitRequestCard,
 *     AgentLeadCard);
 *   - every label through the dictionary, relative times in the reader's
 *     language (an English dashboard printed "il y a 8 jours").
 *
 * Old links keep working: `?tab=visites` shows the whole inbox, `?status=`
 * maps onto the matching pill (inboxFilterFromParams), and `?lead=` (the
 * WhatsApp alert's deep link) pins that request — or the visit it was folded
 * into — to the top; `?visite=` (the templates' link button) pins a visit by
 * its own id.
 *
 * Both lists come from the WhatsApp engine. When it is unreachable the page
 * still opens and says the requests are temporarily unavailable, instead of
 * an empty inbox (which reads as "nobody asked") or an error screen.
 */
export default async function AgentInquiriesPage({ searchParams }) {
  const t = await getT();
  const locale = await getLocale();
  const params = await searchParams;
  const filter = inboxFilterFromParams(params);
  const focusLeadId = Number.parseInt(params.lead, 10);
  const focusVisitId = Number.parseInt(params.visite, 10);
  const q = typeof params.q === 'string' ? params.q.trim() : '';
  const replySent = params.reply_sent === '1';
  const replyError = typeof params.reply_error === 'string' ? params.reply_error : null;

  const agentId = await getCurrentAgentId();
  // Server clock, read before the engine: a request arriving while this page
  // renders is still "new" next time.
  const renderedAt = inboxSeenStamp();
  const { listingById, leadScope, hasLeadScope, waitingCount, listings } = await getAgentDashboardContext(agentId);

  let leadsUnavailable = false;
  const unavailable = (label) => (err) => {
    console.error(`[agent/demandes] ${label} unavailable: ${err.message}`);
    leadsUnavailable = true;
    return { total: 0, data: [] };
  };
  const empty = { total: 0, data: [] };
  // Everything in parallel: both engine reads and the quick replies.
  const [leadsPage, visitsPage, quickReplies, quickReplyListings] = await Promise.all([
    hasLeadScope ? listLeads({ ...leadScope, limit: 100 }).catch(unavailable('leads')) : empty,
    hasLeadScope ? listViewingRequests({ ...leadScope, limit: 100 }).catch(unavailable('visits')) : empty,
    // Réponses rapides on every card. Degrade, don't die: without them the
    // cards simply have no quick-reply button.
    listQuickReplies(agentId).catch((err) => {
      console.error(`[agent/demandes] quick replies unavailable: ${err.message}`);
      return { templates: [] };
    }),
    getQuickReplyListings(agentId).catch((err) => {
      console.error(`[agent/demandes] quick-reply listings unavailable: ${err.message}`);
      return [];
    }),
  ]);

  const titleFor = (propertyId) => listingById.get(String(propertyId))?.title || null;
  const { items, counts, focusFound } = buildAgentInbox({
    visits: visitsPage.data,
    leads: leadsPage.data,
    filter,
    q,
    focusLeadId: Number.isFinite(focusLeadId) ? focusLeadId : null,
    focusVisitId: Number.isFinite(focusVisitId) ? focusVisitId : null,
    titleFor,
  });
  const myActiveListings = listings.filter((l) => l.approve_status === 1 && l.listing_status === 'active');

  const hrefFor = (value) => {
    const query = new URLSearchParams();
    if (value) query.set('filtre', value);
    if (q) query.set('q', q);
    const qs = query.toString();
    return qs ? `/compte/agent/demandes?${qs}` : '/compte/agent/demandes';
  };

  return (
    <>
      <AgentPageHeader
        title={t('agent.leads.title')}
        newLeadsCount={waitingCount}
        searchAction="/compte/agent/demandes"
        searchDefaultValue={q}
        searchPlaceholder={t('agent.inbox.searchPlaceholder')}
        hiddenSearchFields={{ filtre: filter }}
      />

      {/* Opening the inbox is "seen": stamps the device's last look, and
          refreshes the layout so the tab badge and bell clear at once. */}
      <InboxSeenMarker seenAt={renderedAt} badge={waitingCount} />
      <QuickRepliesProvider templates={quickReplies.templates} listings={quickReplyListings}>
        <div className="flex flex-col gap-3 px-3 py-4 sm:px-8 sm:py-7 lg:max-w-3xl">
          {/* Held under the page header while the list scrolls on a phone. */}
          <nav
            aria-label={t('agent.inbox.filterLabel')}
            className="no-scrollbar sticky top-[3.5625rem] z-10 -mx-3 -mt-4 flex gap-2 overflow-x-auto bg-canvas-alt px-3 py-3 sm:top-[4.8125rem] sm:-mx-8 sm:-mt-7 sm:px-8 sm:py-4 lg:static lg:mx-0 lg:mt-0 lg:bg-transparent lg:px-0 lg:py-0"
          >
            {FILTERS.map((item) => {
              const active = item.value === filter;
              const count = counts[item.count];
              return (
                <Link
                  key={item.value || 'all'}
                  href={hrefFor(item.value)}
                  scroll={false}
                  aria-current={active ? 'page' : undefined}
                  className={`u-press inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-4 text-[0.8125rem] font-bold transition-colors ${
                    active ? 'bg-ink text-white' : 'bg-surface text-ink-70 ring-1 ring-line hover:bg-canvas-deep'
                  }`}
                >
                  {t(item.labelKey)}
                  {count > 0 && (
                    <span
                      className={`u-tabular inline-grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[0.6875rem] font-extrabold ${
                        active ? 'bg-white/20 text-white' : item.value === 'a-traiter' ? 'bg-blue text-white' : 'bg-canvas-deep text-ink-70'
                      }`}
                    >
                      {count}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>

          {leadsUnavailable && (
            <p className="u-micro rounded-lg bg-warning-tint px-4 py-3 font-semibold text-warning-ink" role="status">
              {t('agent.leads.unavailable')}
            </p>
          )}
          {!focusFound && (
            <p className="u-micro rounded-lg bg-warning-tint px-4 py-3 font-semibold text-warning-ink" role="status">
              {t('agent.inbox.focusMissing', { id: Number.isFinite(focusVisitId) ? focusVisitId : focusLeadId })}
            </p>
          )}
          {replySent && (
            <p className="rounded-lg bg-success-tint px-4 py-3 text-sm font-semibold text-success" role="status">
              {t('agent.leads.replySent')}
            </p>
          )}
          {replyError && (
            <p className="rounded-lg bg-danger-tint px-4 py-3 text-sm font-semibold text-danger" role="alert">
              {replyError === 'empty' ? t('agent.leads.emptyMessage') : t('agent.inbox.replyFailed')}
            </p>
          )}

          {items.length === 0 ? (
            // Three different empty states: a filter that matches nothing is
            // not an empty inbox, and an empty inbox with no listing needs a
            // different next step from one that simply has no requests yet.
            <div className="u-card rounded-card bg-surface px-6 py-14 text-center text-sm text-ink-45">
              {filter || q
                ? t('agent.inbox.emptyFilter')
                : listings.length === 0
                  ? t('agent.leads.addListingToReceive')
                  : t('agent.inbox.empty')}
            </div>
          ) : (
            <div className="u-stagger contents">
              {/* `contents`: no box of its own, so the rows keep the parent's gap; it only scopes .u-stagger's row entrance (app/globals.css). */}
              {items.map((item) => {
                const row = item.row;
                if (item.kind === 'visit') {
                  const propertyId = row.property_id || row.lead_property_id;
                  return (
                    <AgentVisitRequestCard
                      key={item.key}
                      viewingRequest={row}
                      highlighted={item.focused}
                      statusLabel={VIEWING_REQUEST_STATUS_LABEL_KEYS[row.status] ? t(VIEWING_REQUEST_STATUS_LABEL_KEYS[row.status]) : row.status}
                      relativeTime={formatRelative(row.created_at, locale)}
                      target={(propertyId && titleFor(propertyId)) || [row.lead_quartier, row.lead_commune].filter(Boolean).join(', ') || null}
                    />
                  );
                }
                return (
                  <AgentLeadCard
                    key={item.key}
                    lead={row}
                    highlighted={item.focused}
                    myListings={myActiveListings}
                    statusLabel={LEAD_STATUS_LABEL_KEYS[row.status] ? t(LEAD_STATUS_LABEL_KEYS[row.status]) : row.status}
                    statusOptions={STATUS_OPTIONS}
                    relativeTime={formatRelative(row.created_at, locale)}
                    budget={budgetText(row, t)}
                    target={(row.property_id && titleFor(row.property_id)) || [row.quartier, row.commune].filter(Boolean).join(', ') || null}
                    replyAction={replyToLeadAction.bind(null, row.id)}
                    statusAction={updateAgentLeadStatusAction.bind(null, row.id)}
                  />
                );
              })}
            </div>
          )}
        </div>
      </QuickRepliesProvider>
    </>
  );
}
