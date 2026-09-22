import { Fragment } from 'react';
import Link from 'next/link';
import { getCurrentAgentId } from '@/lib/agentSession';
import { getAgentDashboardContext } from '@/lib/agentDashboard';
import { listLeads, listViewingRequests } from '@/lib/adminApi';
import {
  LEAD_STATUSES,
  LEAD_STATUS_LABEL_KEYS,
  VIEWING_REQUEST_STATUSES,
  VIEWING_REQUEST_STATUS_LABEL_KEYS,
} from '@/lib/adminLabels';
import { formatRelativeFr } from '@/lib/format';
import AgentPageHeader from '@/components/AgentPageHeader';
import AgentLeadCard from '@/components/AgentLeadCard';
import AgentVisitRequestCard from '@/components/AgentVisitRequestCard';
import { updateAgentLeadStatusAction, replyToLeadAction } from '../actions';
import { getT } from '@/lib/i18n/server';
import { QuickRepliesProvider } from '@/components/AgentQuickReplies';
import { listQuickReplies, getQuickReplyListings } from '@/lib/quickReplies';

// `labelKey`, resolved at render — a module constant cannot hold translated
// text (see components/navItems.js).
const STATUS_OPTIONS = LEAD_STATUSES.map((value) => ({ value, labelKey: LEAD_STATUS_LABEL_KEYS[value] }));

/**
 * Visites used to be its own sidebar section. It is a sub-tab here now: a
 * viewing request is not a separate inbox, it is one stage of the same
 * client conversation the other two tabs already show — the customer portal
 * made the same merge on its own side (compte/client/visites now redirects
 * into Messages & Visites). `/compte/agent/visites` still resolves; it
 * redirects here so an existing bookmark or notification link keeps working.
 */
/**
 * Two tabs, not three. "Opportunités communes" — a browsable feed of every
 * unclaimed request in the agent's communes — has been removed entirely.
 *
 * It was a pull model: the agent had to remember to come and look, the
 * fastest-checking agencies took everything, and a customer's request could
 * sit unseen for days while seven agencies who wanted it never knew it
 * existed. The engine's dispatcher (services/leadDispatch.js) replaces it
 * with a push: a new request is ranked against the real agencies covering
 * its commune the instant it's submitted, and the best seven get a WhatsApp
 * alert with a deep link straight into this page. Those requests arrive in
 * "Mes demandes" below — nothing here asks an agent to go looking.
 */
const TABS = [
  { value: 'mes-demandes', labelKey: 'agent.leads.tabRequests' },
  { value: 'visites', labelKey: 'agent.leads.tabVisits' },
];

const VISIT_STATUS_OPTIONS = VIEWING_REQUEST_STATUSES.map((value) => ({
  value,
  labelKey: VIEWING_REQUEST_STATUS_LABEL_KEYS[value],
}));

/**
 * The status filter on both tabs: a row of chips, each a plain link (soft
 * navigation, no skeleton) into `?status=`. It replaced a <select> with a
 * separate "Filtrer" submit — two taps and a full reload per filter.
 */
function StatusChips({ label, options, current, allLabel, extra }) {
  const hrefFor = (value) => {
    const query = new URLSearchParams(extra);
    if (value) query.set('status', value);
    const qs = query.toString();
    return qs ? `/compte/agent/demandes?${qs}` : '/compte/agent/demandes';
  };
  const chip = (value, text) => {
    const active = value === current;
    return (
      <Link
        key={value || 'all'}
        href={hrefFor(value)}
        scroll={false}
        aria-current={active ? 'page' : undefined}
        className={`u-press inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-full px-3.5 text-[0.8125rem] font-bold transition-colors ${
          active ? 'bg-ink text-white' : 'bg-surface text-ink-70 ring-1 ring-line hover:bg-canvas-deep'
        }`}
      >
        {text}
      </Link>
    );
  };
  return (
    <nav aria-label={label} className="no-scrollbar -mx-3 flex gap-2 overflow-x-auto px-3 sm:mx-0 sm:flex-wrap sm:px-0">
      {chip('', allLabel)}
      {options.map((o) => chip(o.value, o.label))}
    </nav>
  );
}

function budgetText(lead) {
  const min = lead.price_min != null ? Number(lead.price_min).toLocaleString('fr-FR') : null;
  const max = lead.price_max != null ? Number(lead.price_max).toLocaleString('fr-FR') : null;
  if (min && max) return `${min} – ${max} $`;
  if (max) return `Jusqu'à ${max} $`;
  if (min) return `À partir de ${min} $`;
  return null;
}

/**
 * The former /compte/agent/visites section, as a tab. Same real data and
 * same Accept / Reschedule / Cancel controls it already had
 * (AgentVisitRequestCard -> updateViewingRequestAction) — this only changes
 * where it lives, not what it can do.
 *
 * The status chips reuse the shared `?status=` param the other tab uses, with
 * `tab=visites` carried in each link so filtering doesn't bounce back to Mes
 * demandes. The two vocabularies never collide because each tab resolves the
 * param against its own status list.
 */
// Async, so it can resolve its own translator — it is a Server Component
// rendered by the page below, not a client child, so awaiting here is free.
async function VisitsTab({ visitsPage, statusFilter, listingById, hasListings }) {
  const t = await getT();
  const pending = visitsPage.data.filter((v) => v.status === 'PENDING').length;

  return (
    <>
      <StatusChips
        label={t('agent.leads.filterByStatus')}
        current={statusFilter}
        allLabel={`${t('agent.leads.allVisits')} · ${visitsPage.total}`}
        extra={{ tab: 'visites' }}
        options={VISIT_STATUS_OPTIONS.map((o) => ({
          value: o.value,
          label: o.value === 'PENDING' && pending > 0 ? `${t(o.labelKey)} · ${pending}` : t(o.labelKey),
        }))}
      />

      {visitsPage.data.length === 0 ? (
        <div className="u-card rounded-card bg-surface px-6 py-16 text-center text-sm text-ink-45">
          {statusFilter
            ? t('agent.leads.noVisitsForFilter')
            : hasListings
              ? t('agent.leads.noVisitsYet')
              : 'Ajoutez un bien pour commencer à recevoir des demandes de visite.'}
        </div>
      ) : (
        visitsPage.data.map((viewingRequest) => {
          const propertyId = viewingRequest.property_id || viewingRequest.lead_property_id;
          const property = propertyId ? listingById.get(String(propertyId)) : null;
          const target =
            property?.title ||
            [viewingRequest.lead_quartier, viewingRequest.lead_commune].filter(Boolean).join(', ') ||
            null;

          return (
            <AgentVisitRequestCard
              key={viewingRequest.id}
              viewingRequest={viewingRequest}
              statusLabel={
                VIEWING_REQUEST_STATUS_LABEL_KEYS[viewingRequest.status]
                  ? t(VIEWING_REQUEST_STATUS_LABEL_KEYS[viewingRequest.status])
                  : viewingRequest.status
              }
              relativeTime={formatRelativeFr(viewingRequest.created_at)}
              target={target}
            />
          );
        })
      )}
    </>
  );
}

export default async function AgentInquiriesPage({ searchParams }) {
  const t = await getT();
  const params = await searchParams;
  const tab = params.tab === 'visites' ? 'visites' : 'mes-demandes';
  // Set by the WhatsApp alert's deep link (services/leadDispatch.js's
  // agentLink) so the agent lands on the exact request they were notified
  // about, pinned to the top of their inbox instead of having to find it.
  const focusLeadId = Number.parseInt(params.lead, 10);
  const statusFilter = typeof params.status === 'string' && LEAD_STATUSES.includes(params.status) ? params.status : '';
  const visitStatusFilter =
    typeof params.status === 'string' && VIEWING_REQUEST_STATUSES.includes(params.status) ? params.status : '';
  const q = typeof params.q === 'string' ? params.q.trim() : '';
  const replySent = params.reply_sent === '1';
  const replyError = typeof params.reply_error === 'string' ? params.reply_error : null;

  const agentId = await getCurrentAgentId();
  const { agent, listingById, leadScope, hasLeadScope, newLeadsCount, pendingVisitsCount, listings } =
    await getAgentDashboardContext(agentId);

  const leadsPage = hasLeadScope
    ? await listLeads({ ...leadScope, status: statusFilter || undefined, limit: 100 })
    : { total: 0, data: [] };

  const visitsPage =
    tab === 'visites' && hasLeadScope
      ? await listViewingRequests({ ...leadScope, status: visitStatusFilter || undefined, limit: 100 })
      : { total: 0, data: [] };

  // Réponses rapides on every card — loaded once per page. Degrade, don't
  // die: without them the cards simply have no quick-reply button.
  const [quickReplies, quickReplyListings] = await Promise.all([
    listQuickReplies(agentId).catch((err) => {
      console.error(`[agent/demandes] quick replies unavailable: ${err.message}`);
      return { templates: [] };
    }),
    getQuickReplyListings(agentId).catch((err) => {
      console.error(`[agent/demandes] quick-reply listings unavailable: ${err.message}`);
      return [];
    }),
  ]);

  const needle = q.toLowerCase();
  const leads = needle
    ? leadsPage.data.filter((l) =>
        `${l.name || ''} ${l.wa_id || ''} ${l.requirements_summary || ''}`.toLowerCase().includes(needle),
      )
    : leadsPage.data;

  // The deep-linked request first, everything else in the order the engine
  // returned it. Sorting rather than filtering: an agent arriving from a
  // WhatsApp alert should see that request at the top AND still have their
  // whole inbox, not a single-row page they have to escape from.
  const orderedLeads = Number.isFinite(focusLeadId)
    ? [...leads].sort((a, b) => (b.id === focusLeadId) - (a.id === focusLeadId))
    : leads;
  const focusedLeadPresent = Number.isFinite(focusLeadId) && leads.some((l) => l.id === focusLeadId);

  const myActiveListings = listings.filter((l) => l.approve_status === 1 && l.listing_status === 'active');

  return (
    <>
      <AgentPageHeader
        title={t('agent.leads.title')}
        newLeadsCount={newLeadsCount}
        searchAction="/compte/agent/demandes"
        searchDefaultValue={q}
        searchPlaceholder="Rechercher un client"
        hiddenSearchFields={{ status: statusFilter }}
      />

      <QuickRepliesProvider templates={quickReplies.templates} listings={quickReplyListings}>
      <div className="flex flex-col gap-4 px-3 py-4 sm:px-8 sm:py-7">
        <div className="flex items-center gap-1 border-b border-line">
          {TABS.map((item) => (
            <Link
              key={item.value}
              href={`/compte/agent/demandes?tab=${item.value}`}
              scroll={false}
              className={`-mb-px border-b-2 px-3.5 py-2.5 text-[0.8125rem] font-semibold transition-colors ${
                tab === item.value ? 'border-blue text-blue-deep' : 'border-transparent text-ink-45 hover:text-ink'
              }`}
            >
              {t(item.labelKey)}
              {item.value === 'visites' && pendingVisitsCount > 0 ? ` · ${pendingVisitsCount}` : ''}
              {item.value === 'mes-demandes' && newLeadsCount > 0 ? ` · ${newLeadsCount}` : ''}
            </Link>
          ))}
        </div>

        {/* Each tab's body carries its own key, so switching tabs REMOUNTS it
            instead of reconciling one tab's markup into the other's. Both
            bodies open with the same element shape (a header row, a title
            div, a subtitle div), so without keys React reused those
            elements and patched their text nodes in place — and under
            browser page translation those text nodes have already been
            swapped for <font> wrappers. That is what crashed this tab switch
            ("This page couldn't load"), and with lib/translationDomGuard.js
            in place it still left the previous tab's translated subtitle on
            screen beside the new one. A remount only removes and inserts
            whole elements, which translation never moves. */}
        {tab === 'visites' ? (
          <Fragment key="visites">
            <VisitsTab
              visitsPage={visitsPage}
              statusFilter={visitStatusFilter}
              listingById={listingById}
              hasListings={listings.length > 0}
            />
          </Fragment>
        ) : (
          <Fragment key="mes-demandes">
            <StatusChips
              label={t('agent.leads.filterByStatus')}
              current={statusFilter}
              allLabel={t('agent.leads.allRequests')}
              extra={q ? { q } : {}}
              options={STATUS_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
            />

            {Number.isFinite(focusLeadId) && !focusedLeadPresent && (
              <p className="u-micro rounded-lg bg-warning-tint px-4 py-3 font-semibold text-warning" role="status">
                La demande n° {focusLeadId} ne figure plus dans votre liste — elle a peut-être été traitée par
                {t('agent.leads.otherAgencyOrFiltered')}
              </p>
            )}

            {replySent && (
              <p className="rounded-lg bg-success-tint px-4 py-3 text-sm font-semibold text-success" role="status">
                {t('agent.leads.replySent')}
              </p>
            )}
            {replyError && (
              <p className="rounded-lg bg-danger-tint px-4 py-3 text-sm font-semibold text-danger" role="alert">
                {replyError === 'empty'
                  ? t('agent.leads.emptyMessage')
                  : "L'envoi WhatsApp a échoué. Réessayez dans un instant."}
              </p>
            )}

            {leads.length === 0 ? (
              /* Three genuinely different empty states. Collapsing them told an
                 agent with 8 live listings and no filter set that "aucune
                 demande ne correspond à ces filtres" — blaming a filter they
                 never applied for an inbox that is simply still empty. */
              <div className="u-card rounded-card bg-surface px-6 py-16 text-center text-sm text-ink-45">
                {statusFilter || q
                  ? t('agent.leads.noRequestsForFilters')
                  : listings.length === 0
                    ? t('agent.leads.addListingToReceive')
                    : 'Aucune demande pour le moment. Partagez votre page publique pour en recevoir.'}
              </div>
            ) : (
              orderedLeads.map((lead) => {
                const property = lead.property_id ? listingById.get(String(lead.property_id)) : null;
                return (
                  <AgentLeadCard
                    key={lead.id}
                    lead={lead}
                    highlighted={lead.id === focusLeadId}
                    myListings={myActiveListings}
                    statusLabel={LEAD_STATUS_LABEL_KEYS[lead.status] ? t(LEAD_STATUS_LABEL_KEYS[lead.status]) : lead.status}
                    statusOptions={STATUS_OPTIONS}
                    relativeTime={formatRelativeFr(lead.created_at)}
                    budget={budgetText(lead)}
                    target={property?.title || [lead.quartier, lead.commune].filter(Boolean).join(', ') || null}
                    replyAction={replyToLeadAction.bind(null, lead.id)}
                    statusAction={updateAgentLeadStatusAction.bind(null, lead.id)}
                  />
                );
              })
            )}
          </Fragment>
        )}
      </div>
      </QuickRepliesProvider>
    </>
  );
}
